"""Review Pipeline: AI-drafted models + AI-proposed risk hypotheses,
checked end-to-end by the existing Z3 verifier.

The pipeline endpoints accept a plain-English system description, produce a
finite state-machine model and safety checks, propose risk hypotheses, and
hand the hypotheses to the verifier. The AI step is optional — if no
``OPENAI_API_KEY`` is set we use deterministic heuristics for the bundled
scenarios. The Z3 step is always real.

The framing is deliberate: AI proposes, Z3 confirms. The audit log we
return is *explanatory*, not a proof. The only authoritative claim is the
solver's counterexample (or its inability to find one within the bound).
"""

from __future__ import annotations

import copy
import json
import os
import re
import uuid
from typing import Any, Iterable, List, Optional, Tuple

from .counterexample import find_culprit
from .diff import diff_results
from .explain import explain_failure
from .guards import parse_guard
from .health_check import run_health_check
from .property_lint import lint_property
from .models import (
    AbstractionPlan,
    AssuranceDiffResponse,
    CandidateMutation,
    ClarifyRequest,
    ClarifyResponse,
    DraftSource,
    HealthCheckItem,
    HypothesisCheckRequest,
    HypothesisCheckResponse,
    HypothesisCheckResult,
    ModelSpec,
    PropertySpec,
    RegressionEntry,
    RepairSpec,
    ReviewLogItem,
    RiskHypothesis,
    SpecDraftRequest,
    SpecDraftResponse,
    SpecReviewRequest,
    SpecReviewResponse,
    TransitionSpec,
    VariableSpec,
    VerifyResponse,
    VerifySummary,
)
from .narrative_helpers import split_top_conjuncts
from .parser import validate_model, validate_property
from .repair import suggest_repair
from .verifier import Verifier


# ---------------------------------------------------------------------------
# Public entrypoints
# ---------------------------------------------------------------------------


def draft_from_description(req: SpecDraftRequest) -> SpecDraftResponse:
    """LLM-first drafting with a validation-driven repair loop.

    Policy (per the product spec):

    - When ``OPENAI_API_KEY`` is configured we ALWAYS call the LLM. If the
      first draft passes the model health check we return it as
      ``draft_source="llm"``. If it is blocked we feed the validation
      errors back to the LLM and ask for a repaired JSON, up to
      ``_MAX_REPAIR_ATTEMPTS`` times. A repaired draft that subsequently
      validates is labelled ``"llm_repaired"`` with ``repair_attempts``
      reflecting how many round trips were needed.

    - If the LLM call itself fails catastrophically (network error,
      un-parseable JSON, schema mismatch) we fall back to a deterministic
      template and label it ``"template_fallback"`` with the failure
      reason in ``fallback_reason`` — the UI must NOT pretend this is
      LLM output.

    - If the LLM produces JSON but health-check still blocks after the
      retry budget is exhausted, we return the latest blocked draft as
      ``draft_source="blocked"``. Review and Z3 will both refuse it.

    - When no LLM is configured, the deterministic template is used by
      design and labelled ``"deterministic_fallback"``.
    """
    if _have_llm():
        return _draft_with_llm_repair_loop(req)
    return _deterministic_template_response(
        req,
        source="deterministic_fallback",
        fallback_reason=None,
    )


# How many times we ask the LLM to repair a blocked draft before we give
# up and return the blocked draft for the user to inspect.
_MAX_REPAIR_ATTEMPTS = 2


def _draft_with_llm_repair_loop(req: SpecDraftRequest) -> SpecDraftResponse:
    """Two-phase drafting with a validation-driven repair loop.

    Per product spec, Phase 1 (abstraction plan) runs ONCE on the first
    attempt; the repair loop reuses that plan rather than regenerating
    it, which saves a round trip per repair while still giving the LLM
    explicit modeling decisions to anchor against.

    Phase ordering:
      1. Phase 1 — abstraction plan. If this fails catastrophically, we
         skip Phase 1 and fall through to the one-shot prompt (the
         legacy code path) so a Phase-1 outage doesn't break drafting.
      2. Phase 2 — generate the formal model from the plan.
      3. Health check.
      4. Repair loop (up to _MAX_REPAIR_ATTEMPTS) — same plan, same
         repair prompt, with the most recent validation errors fed back.
    """

    # ----- Phase 1: abstraction plan -------------------------------------
    plan, plan_err = _llm_abstraction_plan(req)
    plan_warnings: List[str] = []
    if plan is None and plan_err:
        plan_warnings.append(
            "Phase-1 abstraction call failed"
            + (f" ({plan_err})" if plan_err else "")
            + ". Falling through to single-shot drafting."
        )

    # ----- Phase 2: formal model from plan -------------------------------
    draft, llm_err = _llm_draft(req, plan=plan)
    if draft is None:
        return _deterministic_template_response(
            req,
            source="template_fallback",
            fallback_reason=(
                "LLM call did not return a usable model"
                + (f" ({llm_err})" if llm_err else "")
                + ". Returning a deterministic template so the demo can continue."
            ),
        )

    draft.warnings = list(draft.warnings) + plan_warnings + _collect_property_lints(
        draft.properties
    )
    draft.health = run_health_check(
        draft.model, draft.properties, req.description
    )
    draft.abstraction_plan = plan

    if draft.health.classification != "blocked":
        draft.draft_source = "llm"
        draft.repair_attempts = 0
        return draft

    # ----- Repair loop ---------------------------------------------------
    for attempt in range(1, _MAX_REPAIR_ATTEMPTS + 1):
        errors = [i for i in draft.health.items if i.severity == "error"]
        repaired, repair_err = _llm_repair_draft(req, draft, errors, plan=plan)
        if repaired is None:
            draft.warnings = list(draft.warnings) + [
                f"LLM repair attempt {attempt} failed"
                + (f": {repair_err}" if repair_err else "")
                + "."
            ]
            break

        repaired.warnings = list(repaired.warnings) + _collect_property_lints(
            repaired.properties
        )
        repaired.health = run_health_check(
            repaired.model, repaired.properties, req.description
        )
        # Preserve the plan from the original Phase-1 call through repairs.
        repaired.abstraction_plan = plan
        draft = repaired
        draft.repair_attempts = attempt
        if draft.health.classification != "blocked":
            draft.draft_source = "llm_repaired"
            return draft

    # Retries exhausted and the draft is still blocked.
    draft.draft_source = "blocked"
    draft.fallback_reason = (
        "LLM produced a draft that validation could not repair within "
        f"{_MAX_REPAIR_ATTEMPTS} attempts. Review and Z3 are disabled. "
        "Use the clarification flow or pick a starter example."
    )
    return draft


def _deterministic_template_response(
    req: SpecDraftRequest,
    source: DraftSource,
    fallback_reason: Optional[str],
) -> SpecDraftResponse:
    """Build a deterministic-template SpecDraftResponse labelled honestly.

    Templates are picked by a tiny keyword classifier — but ONLY in the
    fallback paths, so the railway/warehouse/field choices never silently
    replace an LLM draft when a key is configured.
    """
    extra_warnings: List[str] = []
    if source == "deterministic_fallback":
        extra_warnings.append(
            "Using deterministic demo reviewer. Set OPENAI_API_KEY to enable AI drafting."
        )
    elif source == "template_fallback" and fallback_reason:
        extra_warnings.append(fallback_reason)

    resp = _deterministic_draft(req, warnings=extra_warnings)
    resp.warnings = list(resp.warnings) + _collect_property_lints(resp.properties)
    resp.health = run_health_check(resp.model, resp.properties, req.description)
    resp.draft_source = source
    resp.repair_attempts = 0
    resp.fallback_reason = fallback_reason
    return resp


def review_model(req: SpecReviewRequest) -> SpecReviewResponse:
    warnings: List[str] = []
    # Hard gate: if the model has structural errors, refuse to review.
    # The endpoint translates this to HTTP 400 with the failing items.
    health = run_health_check(req.model, req.properties, req.description or "")
    if health.classification == "blocked":
        errors = [i for i in health.items if i.severity == "error"]
        msg = "; ".join(f"{i.title}: {i.message}" for i in errors[:3])
        raise BlockedDraftError(
            "Draft is blocked by the model health check and cannot be reviewed: "
            + msg,
            items=errors,
        )

    if _have_llm():
        llm_result, llm_err = _llm_review(req)
        if llm_result is not None:
            extra = _lint_hypotheses(
                llm_result.hypotheses, req.model, req.abstraction_plan
            )
            llm_result.hypotheses = _filter_bad_hypotheses(
                llm_result.hypotheses, req.model, req.abstraction_plan
            )
            llm_result.warnings = list(llm_result.warnings) + extra
            return llm_result
        warnings.append(
            "OpenAI call did not return a valid review"
            + (f" ({llm_err})" if llm_err else "")
            + ". Falling back to the deterministic reviewer."
        )
    resp = _deterministic_review(req, warnings=warnings)
    extra = _lint_hypotheses(resp.hypotheses, req.model, req.abstraction_plan)
    resp.hypotheses = _filter_bad_hypotheses(
        resp.hypotheses, req.model, req.abstraction_plan
    )
    resp.warnings = list(resp.warnings) + extra
    return resp


def _collect_property_lints(properties: List[PropertySpec]) -> List[str]:
    out: List[str] = []
    for p in properties:
        out.extend(lint_property(p))
    return out


def _resolve_recovery_modes(
    plan: Optional[AbstractionPlan],
) -> set[str]:
    """Use plan.recovery_modes when present, else keyword fallback."""
    if plan and plan.recovery_modes:
        return set(plan.recovery_modes)
    return _RECOVERY_MODES


def _resolve_critical_modes(
    plan: Optional[AbstractionPlan],
) -> set[str]:
    """Use plan.dangerous_modes when present, else keyword fallback."""
    if plan and plan.dangerous_modes:
        return set(plan.dangerous_modes)
    return _CRITICAL_MODES


def _lint_hypotheses(
    hypotheses: List["RiskHypothesis"],
    base_model: "ModelSpec",
    plan: Optional[AbstractionPlan] = None,
) -> List[str]:
    """Flag hypotheses that look semantically off. Returns the warnings;
    the list of hypotheses is filtered separately by ``_filter_bad_hypotheses``.
    """
    warnings: List[str] = []
    base_targets = {t.name: t.updates.get("mode") for t in base_model.transitions}
    recovery = _resolve_recovery_modes(plan)
    for h in hypotheses:
        if h.mutation is None or h.mutation.kind != "remove_guard_clause":
            continue
        target_mode = base_targets.get(h.mutation.transition)
        if target_mode in recovery:
            warnings.append(
                f"Dropped hypothesis `{h.id}` — it removed a clause from "
                f"`{h.mutation.transition}`, which enters the safety/recovery "
                f"mode `{target_mode}`. Removing a clause from a recovery "
                "transition makes the safe response easier to fire (the "
                "conservative direction), so it is not a useful unsafe "
                "weakening. Disable the transition instead."
            )
    return warnings


def _filter_bad_hypotheses(
    hypotheses: List["RiskHypothesis"],
    base_model: "ModelSpec",
    plan: Optional[AbstractionPlan] = None,
) -> List["RiskHypothesis"]:
    """Drop hypotheses that remove clauses from transitions entering a
    recovery mode. Their warnings are emitted separately so the user
    knows why they were filtered.
    """
    base_targets = {t.name: t.updates.get("mode") for t in base_model.transitions}
    recovery = _resolve_recovery_modes(plan)
    out: List[RiskHypothesis] = []
    for h in hypotheses:
        if (
            h.mutation is not None
            and h.mutation.kind == "remove_guard_clause"
            and base_targets.get(h.mutation.transition) in recovery
        ):
            continue
        out.append(h)
    return out


def check_hypotheses(req: HypothesisCheckRequest) -> HypothesisCheckResponse:
    results: List[HypothesisCheckResult] = []
    base = req.base_model
    properties = req.properties
    bound = req.bound

    for hyp in req.hypotheses:
        try:
            if hyp.mutation is not None:
                # Validate the mutated model before running the solver so the
                # UI can blame a bad mutation explicitly rather than getting
                # an opaque solver error.
                validate_model(hyp.mutation.mutated_model)
                old_v = Verifier(base)
                new_v = Verifier(hyp.mutation.mutated_model)
                old_results = [old_v.check_property(p, bound) for p in properties]
                new_results = [new_v.check_property(p, bound) for p in properties]
                summary, regressions = diff_results(
                    old_results, new_results, properties, hyp.mutation.mutated_model
                )
                # If the diff didn't already attach a strengthen_guard
                # template repair, synthesise the domain-general
                # "undo the mutation" repair for the user. This is what
                # makes the disable_transition / remove_guard_clause
                # findings actionable instead of dead ends.
                regressions = _attach_undo_repairs(
                    regressions, hyp, base
                )
                diff = AssuranceDiffResponse(
                    summary=summary, results=new_results, regressions=regressions
                )
                classification = _classify_diff(diff)
                results.append(
                    HypothesisCheckResult(
                        hypothesis=hyp,
                        classification=classification,
                        diff=diff,
                    )
                )
                continue

            if hyp.property is not None:
                validate_property(hyp.property)
                v = Verifier(base)
                vr = v.check_property(hyp.property, bound)
                summary = VerifySummary(
                    passed=1 if vr.status == "pass" else 0,
                    failed=1 if vr.status == "fail" else 0,
                    timed_out=1 if vr.status == "timeout" else 0,
                )
                verify = VerifyResponse(results=[vr], summary=summary)
                if vr.status == "fail":
                    classification = "confirmed_failure"
                elif vr.status == "timeout":
                    classification = "timeout"
                else:
                    classification = "no_counterexample"
                results.append(
                    HypothesisCheckResult(
                        hypothesis=hyp,
                        classification=classification,
                        verify=verify,
                    )
                )
                continue

            # Hypothesis has neither a mutation nor a property — invalid.
            results.append(
                HypothesisCheckResult(
                    hypothesis=hyp,
                    classification="invalid",
                    error="Hypothesis has no mutation and no property to check.",
                )
            )
        except Exception as exc:  # pragma: no cover - defensive
            results.append(
                HypothesisCheckResult(
                    hypothesis=hyp,
                    classification="invalid",
                    error=str(exc),
                )
            )

    return HypothesisCheckResponse(results=results)


# ---------------------------------------------------------------------------
# Diff classification
# ---------------------------------------------------------------------------


def _classify_diff(diff: AssuranceDiffResponse) -> str:
    if any(r.status == "timeout" for r in diff.results):
        return "timeout"
    if diff.regressions:
        return "confirmed_failure"
    return "no_counterexample"


def _attach_undo_repairs(
    regressions: List[RegressionEntry],
    hyp: "RiskHypothesis",
    base_model: "ModelSpec",
) -> List[RegressionEntry]:
    """For ``disable_transition`` and ``remove_guard_clause`` hypotheses,
    synthesise a generic ``restore_*`` ``RepairSpec`` so the UI can
    offer "undo the mutation and re-verify" as the obvious next action.

    We only fill in repairs that weren't already provided by the
    template-driven ``suggest_repair`` path (used for
    ``strengthen_guard``). If a regression already has a suggested
    repair we leave it alone.
    """
    if hyp.mutation is None:
        return regressions

    if hyp.mutation.kind == "disable_transition":
        original = next(
            (t for t in base_model.transitions if t.name == hyp.mutation.transition),
            None,
        )
        if original is None:
            return regressions
        synth = RepairSpec(
            kind="restore_transition",
            transition=hyp.mutation.transition,
            original_transition=original,
            rationale=(
                f"Re-enable `{hyp.mutation.transition}` by restoring its "
                "original guard, updates, and reactive flag from the "
                "baseline model."
            ),
        )
        return [
            r if r.suggested_repair is not None else r.model_copy(update={"suggested_repair": synth})
            for r in regressions
        ]

    if hyp.mutation.kind == "remove_guard_clause" and hyp.mutation.removed_clause:
        synth = RepairSpec(
            kind="restore_guard_clause",
            transition=hyp.mutation.transition,
            add_predicate=hyp.mutation.removed_clause,
            rationale=(
                f"Add `{hyp.mutation.removed_clause}` back to "
                f"`{hyp.mutation.transition}`."
            ),
        )
        return [
            r if r.suggested_repair is not None else r.model_copy(update={"suggested_repair": synth})
            for r in regressions
        ]

    return regressions


# ---------------------------------------------------------------------------
# LLM hook
# ---------------------------------------------------------------------------


def _have_llm() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


# Default LLM model. Kept conservative so the deployed demo doesn't depend on
# preview/frontier model availability. The README recommends overriding this
# with a stronger reasoning model for the Review Pipeline.
_DEFAULT_LLM_MODEL = "gpt-4o-mini"


def _llm_model_name() -> str:
    return os.getenv("ASSURANCE_LLM_MODEL", _DEFAULT_LLM_MODEL)


# Reasoning-tier OpenAI models (o-series, gpt-5+) only accept the default
# `temperature=1` — passing `temperature=0` returns a 400. Classic chat
# models (gpt-4, gpt-4o, gpt-4.1) accept any value and benefit from
# `temperature=0` for deterministic structured-JSON output.
def _supports_custom_temperature(model: str) -> bool:
    lower = model.lower()
    if lower.startswith(("o1", "o3", "o4")):
        return False
    if lower.startswith("gpt-5"):
        return False
    return True


def _chat_kwargs() -> dict:
    """Common kwargs for the OpenAI chat.completions.create call.

    Adds `temperature=0` for models that accept it and always asks for
    JSON-object responses. Callers pass `model` and `messages` themselves.
    """
    model = _llm_model_name()
    kwargs: dict = {"response_format": {"type": "json_object"}}
    if _supports_custom_temperature(model):
        kwargs["temperature"] = 0
    return kwargs


class BlockedDraftError(Exception):
    """Raised by review_model when the draft fails the health check."""

    def __init__(self, msg: str, items: list):
        super().__init__(msg)
        self.items = items


# ---------------------------------------------------------------------------
# Clarification
# ---------------------------------------------------------------------------


def clarify_description(req: ClarifyRequest) -> ClarifyResponse:
    """Return 2–4 concrete clarifying questions for a vague or blocked draft."""
    errors = [i for i in req.health_items if i.severity == "error"]
    questions = _deterministic_questions(req.description, errors)
    suggested_rewrite: Optional[str] = None

    if _have_llm():
        try:
            llm_q, llm_rewrite = _llm_clarify(req)
            if llm_q:
                return ClarifyResponse(
                    questions=llm_q[:4],
                    suggested_rewrite=llm_rewrite,
                    used_llm=True,
                )
        except Exception:
            pass
    return ClarifyResponse(
        questions=questions,
        suggested_rewrite=suggested_rewrite,
        used_llm=False,
    )


def _deterministic_questions(description: str, errors: list) -> List[str]:
    """Hand-written fallback clarifying questions."""
    qs: List[str] = []
    desc = (description or "").lower()
    if errors:
        qs.append(
            "What does each clause in the description map to? "
            "List the controller's modes, the boolean / enum conditions, "
            "and what each transition is supposed to do."
        )
    if "mode" not in desc and "state" not in desc:
        qs.append("What are the controller's modes (e.g. Idle, Active, Fault)?")
    if not any(k in desc for k in ("must", "should", "never", "only", "within")):
        qs.append(
            "What is the controller NOT allowed to do? "
            "Phrase the rule as a sentence with `must`, `must not`, "
            "`never`, or `within`."
        )
    if not any(
        k in desc
        for k in (
            "danger",
            "irreversible",
            "actuate",
            "fire",
            "open",
            "heat",
            "move",
            "load",
        )
    ):
        qs.append(
            "Which mode represents the dangerous or irreversible action? "
            "(e.g. Actuate, Heating, Moving.)"
        )
    if not any(
        k in desc
        for k in (
            "emergency",
            "recovery",
            "safe",
            "shutdown",
            "stop",
            "abort",
            "fault",
        )
    ):
        qs.append(
            "What state counts as recovery / shutdown? "
            "(e.g. EmergencyStop, Venting, SafeMode.)"
        )
    if len(qs) < 2:
        qs.append(
            "Should the safety rule be expressed as an invariant "
            "(`mode == X must never coexist with Y`) or as a bounded response "
            "(`if condition X holds, the controller must reach state Y within "
            "N steps`)?"
        )
    return qs[:4]


_CLARIFY_PROMPT = """\
You are helping a user describe a small discrete controller for a formal
model checker. The user's description was insufficient: it either failed
validation or is too vague.

Return ONLY a JSON object of the form:

{
  "questions": ["...", "...", "...", "..."],
  "suggested_rewrite": null OR "a tightened rewrite of the description that
    fixes the issues, in 2-4 sentences."
}

Rules for questions:
- 2-4 questions, each concrete and answerable in one sentence.
- Ask about modes, the dangerous / irreversible state, the recovery state,
  the safety rule's structure (invariant vs bounded response), and any
  specific conditions referenced by the validator.
- Do NOT include chain-of-thought.
"""


def _llm_clarify(req: ClarifyRequest) -> tuple[List[str], Optional[str]]:
    from openai import OpenAI  # type: ignore

    client = OpenAI()
    err_lines = [
        f"- [{i.category}] {i.title}: {i.message}"
        for i in req.health_items
        if i.severity == "error"
    ]
    warn_lines = [
        f"- [{i.category}] {i.title}: {i.message}"
        for i in req.health_items
        if i.severity == "warning"
    ]
    msg = (
        "Original description:\n"
        + (req.description or "(empty)")
        + ("\n\nHealth check errors:\n" + "\n".join(err_lines) if err_lines else "")
        + (
            "\n\nHealth check warnings:\n" + "\n".join(warn_lines)
            if warn_lines
            else ""
        )
    )
    resp = client.chat.completions.create(
        model=_llm_model_name(),
        messages=[
            {"role": "system", "content": _CLARIFY_PROMPT},
            {"role": "user", "content": msg},
        ],
        **_chat_kwargs(),
    )
    raw = resp.choices[0].message.content or "{}"
    data = json.loads(raw)
    questions = list(data.get("questions") or [])
    suggested = data.get("suggested_rewrite")
    if suggested and not isinstance(suggested, str):
        suggested = None
    return questions, suggested


# ---------------------------------------------------------------------------
# Phase 1 — Abstraction plan
#
# The LLM is asked to make its modeling decisions explicit BEFORE it
# writes any formal JSON. The output (an AbstractionPlan) is itself an
# auditable artifact the UI surfaces; Phase 2 then consumes the plan
# and emits the actual ModelSpec / properties.
# ---------------------------------------------------------------------------


_ABSTRACTION_SYSTEM_PROMPT = """\
You are a formal-methods engineer choosing how to abstract a small
discrete controller into a finite-state machine. You are NOT writing
the formal model yet — you are producing the modeling decisions that
will drive it.

Return ONLY a JSON object that matches this shape:

{
  "controller_modes": ["Idle", "Active", ...],
  "environment_inputs": [
    {"name": "...", "type": "bool" | "enum",
     "values": ["..."] (only for enum),
     "initial": false | true | "<enum value>",
     "rationale": "one sentence explaining why this is an input"}
  ],
  "latched_state_variables": [
    {"name": "...", "type": "bool" | "enum",
     "values": ["..."] (only for enum),
     "initial": false | true | "<enum value>",
     "rationale": "one sentence explaining what physical/remembered fact this tracks"}
  ],
  "dangerous_modes": ["..."],
  "recovery_modes": ["..."],
  "safety_preconditions": [
    {"mode": "DangerousMode",
     "required_conditions": ["cond_a == true", "cond_b == false", ...],
     "source_text": "the description sentence that motivated this"}
  ],
  "response_obligations": [
    {"trigger": "<predicate>",
     "response": "<predicate>",
     "bound": <int>,
     "source_text": "the description sentence that motivated this"}
  ],
  "requirement_mapping": [
    {"source_text": "exact sentence from the description",
     "formalization_type": "transition" | "invariant" | "bounded_response" | "assumption" | "ambiguous",
     "generated_artifact": "short name of the thing to be generated",
     "notes": ""}
  ],
  "ambiguities": ["..."]
}

KEY DISTINCTIONS — get these right:

1. Controller mode
   A mutually exclusive operating state, represented by `mode == X`.
   Examples: Idle, Armed, Mission, TrainPassing, Heating, Infusing.

2. Environment input
   A sensor/event/fault condition the controller observes but does NOT
   itself produce. The environment changes it through environment
   transitions. Examples: train_detected, gate_sensor_fault,
   pressure_high, air_in_line, occlusion_detected, comms_lost,
   battery_low, human_authorized, sensor_agreement.

3. Latched state
   A physical or remembered condition that PERSISTS once set, until a
   controller transition explicitly resets it. Examples:
   gate_fully_down, warning_lights_active, line_primed, dose_confirmed,
   train_cleared.

4. Dangerous mode
   A mode where entering WITHOUT required preconditions is the unsafe
   behavior. Examples: TrainPassing, Heating, Infusing, Actuate,
   Moving, Draining.

5. Recovery mode
   A mode representing safe response: fault, alarm, shutdown, hold,
   abort. Examples: Fault, EmergencyShutdown, OcclusionAlarm,
   AirInLineAlarm, Recovery, Stopped, SafeMode.

CRITICAL — DO NOT skip environment inputs.

If the description says:
  "train is detected" → environment_inputs MUST contain train_detected
  "pressure becomes high" → environment_inputs MUST contain pressure
                            (or pressure_high) with a transition that
                            can set it
  "air is detected" → air_in_line (input)
  "occlusion is detected" → occlusion_detected (input)
  "comms are lost" → comms (input, enum OK/Lost)
  "sensor reports a fault" → <name>_fault (input)

For each dangerous mode, every requirement of the form
"X must not happen unless Y" maps to a safety_precondition with Y in
required_conditions.

For each requirement of the form "after X, the controller must Y within
N steps" or "X should reach Y within N", add a response_obligation.

If a sentence is too vague to formalize, list it in ambiguities AND
mark it ambiguous in requirement_mapping.

Output strict JSON. No prose, no markdown fences.
"""


def _llm_abstraction_plan(
    req: SpecDraftRequest,
) -> Tuple[Optional[AbstractionPlan], Optional[str]]:
    """Phase-1 call. Returns (plan, error_message); exactly one is None.

    A catastrophic failure here doesn't have to abort drafting — the
    caller can fall back to the legacy one-phase draft path so the demo
    still works."""
    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI()
        resp = client.chat.completions.create(
            model=_llm_model_name(),
            messages=[
                {"role": "system", "content": _ABSTRACTION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        "Produce the abstraction plan for this system description.\n\n"
                        + req.description
                        + (f"\n\nDomain hint: {req.domain_hint}" if req.domain_hint else "")
                    ),
                },
            ],
            **_chat_kwargs(),
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        plan = AbstractionPlan.model_validate(data)
        return plan, None
    except Exception as exc:
        return None, _short_err(exc)


_SYSTEM_PROMPT = """\
You are drafting a small finite state-machine model for a formal model
checker. Return ONLY a JSON object that matches the example shape below
EXACTLY. Do not include chain-of-thought. Do include an audit log with
concise externally-checkable observations and evidence — not private
reasoning.

ABSOLUTE FIELD NAMES (do not invent synonyms):
- Top-level keys: "model", "properties", "assumptions", "review_log".
- A model has: "name" (string), "title" (string, optional), "description"
  (string, optional), "variables" (object), "transitions" (array).
- THERE IS NO top-level "states" key. Modes live inside
  variables.mode.values.
- A variable is either {"type": "enum", "values": [..], "initial": "..."}
  or {"type": "bool", "initial": true|false}.
- A transition is {"name": "...", "guard": "...", "updates": {var: value}}.
  Optional "reactive": true means the transition must fire whenever its
  guard holds.
- A property is either an invariant
  {"name": "...", "title": "...", "type": "invariant", "condition": "..."}
  or a bounded response
  {"name": "...", "title": "...", "type": "bounded_response",
   "trigger": "...", "response": "...", "bound": <int>}.

GUARDS use only: == != and or not parentheses, the literal `in [..]` list
form, enum values written bare, and the boolean keywords `true` / `false`.
No arithmetic, no function calls, no string literals.

LIMITS: at most 10 variables, at most 25 transitions, at most 10
properties. Do not claim anything is proven.

CRITICAL — PROPERTY WELL-FORMEDNESS:
- NEVER write a clause of the form `var == A and var == B` where A and
  B are distinct literals. A single variable cannot equal two values at
  once, so the conjunction is unsatisfiable and the invariant is
  vacuous. Use `or` for the "either/or" reading, e.g.
  `mode == Mission or mode == DegradedComms`.
- When a condition mixes `and` and `or`, ALWAYS add parentheses to make
  the grouping explicit. Python evaluates `and` before `or`, so
  `not (mode == Mixing or mode == Heating and lid_locked == false)`
  is parsed as
  `not (mode == Mixing or (mode == Heating and lid_locked == false))`,
  which is almost certainly not what you meant. Prefer:
  `not ((mode == Mixing or mode == Heating) and lid_locked == false)`
  or split into two invariants.
- Sensor-disagreement style checks should usually be a
  bounded_response, not an invariant: trigger on
  `mode == Heating and temperature_sensor_agreement == false`,
  response `mode == EmergencyShutdown`, bound 1 or 2.

CRITICAL — INPUT / EVENT REACHABILITY. Every boolean input variable that
appears in any guard, condition, trigger, or response MUST have at least
one transition that can flip it to the value the guard requires.

Concretely:
- If a guard says `train_detected == true` and `train_detected` is
  initialized `false`, you MUST also emit a transition (e.g.
  `detect_train`) whose updates set `train_detected: true`.
- If a guard says `lid_locked == false` and `lid_locked` is initialized
  `true`, you MUST also emit a transition (e.g. `unlock_lid`) whose
  updates set `lid_locked: false`.
- This rule applies regardless of how natural-sounding the name is.
  Variables named after sensors, faults, detections, operator actions,
  or environment events are inputs to the controller — the model needs
  explicit transitions to flip them, even if the description does not
  spell that out.

A bounded-response property is only meaningful if the trigger can become
true. If the trigger references a bool input, that input MUST have an
updater that can drive it to the triggering value.

Domain checklist (use the right set for the user's system):

Railway / train crossing:
- detect_train: train_detected == false → train_detected = true
- gate_sensor_fails: gate_sensor_fault == false → gate_sensor_fault = true
- train_clears: mode == TrainPassing → train_cleared = true

Chemical tank / vessel:
- pressure_rises: pressure == Normal → pressure = High
- pressure_normalizes: pressure == High → pressure = Normal
- lid_unlocks: lid_locked == true → lid_locked = false
- temperature_sensor_disagrees: temperature_sensor_agreement == true →
  temperature_sensor_agreement = false

Robot / autonomy:
- comms_loss: comms == OK → comms = Lost
- comms_restore: comms == Lost → comms = OK
- battery_drain: battery == High → battery = Low
- sensor_disagree: sensor_agreement == true → sensor_agreement = false
- operator_authorize: human_authorized == false → human_authorized = true

Reactive transitions (`reactive: true`) implied by the description
(e.g. `low_battery_recovery`, `comms_degrade`) must also be present —
they are how the controller responds to the environment events above.

If you omit these transitions, the model is "stuck" and every safety
check looks vacuously satisfied. Always include them.

EXAMPLE (illustrative — adapt to the user's description):
{
  "model": {
    "name": "autonomous_field_robot",
    "variables": {
      "mode": {"type": "enum",
               "values": ["Idle","Armed","Mission","DegradedComms","Recovery","EmergencyStop","Actuate"],
               "initial": "Idle"},
      "comms": {"type": "enum", "values": ["OK","Lost"], "initial": "OK"},
      "battery": {"type": "enum", "values": ["High","Low"], "initial": "High"},
      "human_authorized": {"type": "bool", "initial": false},
      "sensor_agreement": {"type": "bool", "initial": true}
    },
    "transitions": [
      {"name": "low_battery_recovery", "reactive": true,
       "guard": "(mode == Mission or mode == DegradedComms) and battery == Low",
       "updates": {"mode": "Recovery"}},
      {"name": "comms_degrade", "reactive": true,
       "guard": "mode == Mission and comms == Lost",
       "updates": {"mode": "DegradedComms"}},
      {"name": "arm",
       "guard": "mode == Idle and human_authorized == true",
       "updates": {"mode": "Armed"}},
      {"name": "start_mission",
       "guard": "mode == Armed and battery == High",
       "updates": {"mode": "Mission"}},
      {"name": "emergency_stop",
       "guard": "mode == Recovery",
       "updates": {"mode": "EmergencyStop"}},
      {"name": "authorized_actuation",
       "guard": "mode == DegradedComms and comms == Lost and human_authorized == true and sensor_agreement == true",
       "updates": {"mode": "Actuate"}},
      {"name": "operator_authorize",
       "guard": "human_authorized == false and (mode == Idle or mode == Armed)",
       "updates": {"human_authorized": true}},
      {"name": "operator_revoke",
       "guard": "human_authorized == true and (mode == Idle or mode == Armed)",
       "updates": {"human_authorized": false}},
      {"name": "comms_loss", "guard": "comms == OK", "updates": {"comms": "Lost"}},
      {"name": "comms_restore", "guard": "comms == Lost", "updates": {"comms": "OK"}},
      {"name": "battery_drain", "guard": "battery == High", "updates": {"battery": "Low"}},
      {"name": "sensor_disagree",
       "guard": "sensor_agreement == true and (mode == Idle or mode == Armed)",
       "updates": {"sensor_agreement": false}},
      {"name": "sensor_agree",
       "guard": "sensor_agreement == false",
       "updates": {"sensor_agreement": true}}
    ]
  },
  "properties": [
    {"name": "no_actuate_without_authority",
     "title": "Human Oversight",
     "type": "invariant",
     "condition": "not (mode == Actuate and comms == Lost and human_authorized == false)"},
    {"name": "no_actuate_on_sensor_disagreement",
     "title": "Sensor Safety",
     "type": "invariant",
     "condition": "not (mode == Actuate and sensor_agreement == false)"},
    {"name": "low_battery_recovers_within_2",
     "title": "Low Battery Recovery",
     "type": "bounded_response",
     "trigger": "(mode == Mission or mode == DegradedComms) and battery == Low",
     "response": "mode == Recovery or mode == EmergencyStop",
     "bound": 2}
  ],
  "assumptions": [
    "Operator approval is observable to the controller and can be granted or revoked while Idle or Armed."
  ],
  "review_log": [
    {"title": "Critical action state",
     "summary": "Identified Actuate as the irreversible command state.",
     "evidence": ["The description says Actuate performs an irreversible command."]},
    {"title": "Oversight predicate",
     "summary": "Mapped human_authorized to the operator-approval predicate guarding actuation.",
     "evidence": ["The description says actuation requires a human operator's approval."]}
  ]
}
"""


_REVIEW_SYSTEM_PROMPT = """\
You are an auditor reviewing a finite state-machine model and its safety
properties. Return ONLY a JSON object matching the shape below EXACTLY.
Do not include chain-of-thought. Each review item must be a concise,
externally-checkable observation with evidence drawn from the model — not
private reasoning.

POLARITY (very important — most common mistake):
Classify each transition by the role of its destination mode.

- CRITICAL destinations: the system is supposed to enter them only under
  tight preconditions. Examples: `Actuate`, `Moving`, `Loading`,
  `Heating`, `Draining`, `Mixing`, `TrainPassing`, `Infusing`,
  `OpenValve`, `ThrusterFire`, `Dispense`, `Fire`.
  For these, the unsafe weakening is to REMOVE a precondition clause
  from the transition's guard. Generate `remove_guard_clause` mutations.

- RECOVERY / SAFETY destinations: the system is supposed to be able to
  reach them as a safety response. Examples: `EmergencyShutdown`,
  `EmergencyStop`, `EmergencyLand`, `Recovery`, `Venting`, `Fault`,
  `SafeMode`, `Alarm`, `Abort`, `Shutdown`, `Hold`.
  For these, removing a clause makes the safe response EASIER to fire,
  which is the CONSERVATIVE direction — NOT a useful unsafe
  hypothesis. The unsafe direction is to DISABLE the transition (so
  recovery never fires) or to ADD an extra precondition clause that
  makes recovery harder to fire. Generate `disable_transition`
  mutations (or `strengthen_or_weaken_guard` if you want to harden the
  guard).

- Pre-state checks like `mode == Idle` are structural — don't bother
  removing them, that just breaks the transition.

DO NOT generate `remove_guard_clause` mutations on transitions whose
destination is a recovery mode. That is a frequent source of bad
findings.

Other rules:
- Do not claim a property holds or fails. The solver decides.
- Each hypothesis must have either a `property` (a PropertySpec, see
  invariant / bounded_response shapes from the draft prompt) or a
  `mutation`.
- `mutated_model` must be the full ModelSpec with the edit already
  applied (same shape as the input model, same field names: `name`,
  `variables`, `transitions`).
- Generate 1–6 hypotheses. Cap at 6.

Shape (JSON):
{
  "review_log": [
    {"title": "...", "summary": "...", "evidence": ["..."]}
  ],
  "hypotheses": [
    {
      "id": "hyp_<short_id>",
      "title": "...",
      "summary": "...",
      "rationale": "...",
      "expected_signal": "...",
      "property": null,
      "mutation": {
        "id": "mut_<short_id>",
        "title": "Remove `<clause>` from `<transition>`",
        "transition": "<transition_name>",
        "kind": "remove_guard_clause",
        "removed_clause": "human_authorized == true",
        "new_guard": "mode == DegradedComms and comms == Lost and sensor_agreement == true",
        "mutated_model": { "name": "...", "variables": { ... }, "transitions": [ ... ] }
      }
    }
  ]
}
"""


_PLAN_USER_INSTRUCTION = """\
You produced this abstraction plan in Phase 1. Generate the formal
model from it. Every variable in `environment_inputs` and
`latched_state_variables` MUST appear in `model.variables`. Every
`controller_modes` value MUST appear in `model.variables.mode.values`.
Every `safety_preconditions` requirement MUST appear as a guard clause
on the transition into the corresponding dangerous mode AND as an
invariant. Every `response_obligations` item MUST appear as a
bounded_response property. Every environment input MUST have at least
one transition that can flip it to the value the safety properties
require.

Stay within: ≤10 variables, ≤25 transitions, ≤10 properties.

Abstraction plan:
"""


def _llm_draft(
    req: SpecDraftRequest,
    plan: Optional[AbstractionPlan] = None,
) -> Tuple[Optional[SpecDraftResponse], Optional[str]]:
    """Returns (response, error_message). One of them is None.

    When `plan` is provided this is Phase 2 of the two-phase pipeline:
    we hand the LLM its own abstraction plan and ask it to generate the
    formal model that realises it. When `plan` is None we fall back to
    the legacy one-shot prompt (used by tests, and by the recovery path
    when Phase 1 itself fails).
    """
    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI()
        user_content = (
            "Draft a model for this system description.\n\n"
            + req.description
            + (f"\n\nDomain hint: {req.domain_hint}" if req.domain_hint else "")
        )
        if plan is not None:
            user_content += (
                "\n\n"
                + _PLAN_USER_INSTRUCTION
                + json.dumps(plan.model_dump(), indent=2)
            )
        resp = client.chat.completions.create(
            model=_llm_model_name(),
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            **_chat_kwargs(),
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        parsed = SpecDraftResponse.model_validate(
            {
                "model": data.get("model"),
                "properties": data.get("properties", []),
                "assumptions": data.get("assumptions", []),
                "review_log": data.get("review_log", []),
                "used_llm": True,
                "llm_model_name": _llm_model_name(),
                "warnings": [],
            }
        )
        validate_model(parsed.model)
        for p in parsed.properties:
            validate_property(p)
        return parsed, None
    except Exception as exc:
        return None, _short_err(exc)


_REPAIR_PROMPT = """\
You previously produced a finite-state model, but the model health
checker found hard errors that prevent the formal checker from running.
Return ONLY a corrected JSON object that follows the SAME schema as the
original draft (top-level "model", "properties", "assumptions",
"review_log"; same field names). Do not include chain-of-thought.

Rules:
- Do NOT change the user's intent. Preserve the modes, the meaning of
  each variable, and the safety properties.
- Do NOT invent unsupported variables or syntax. Stick to the guard
  grammar: == != and or not parentheses, `in [..]`, bare enum values,
  bool keywords true / false.
- Fix the SPECIFIC errors below. Apply the suggested fix when one is
  given. Do not introduce new safety properties unless required to
  satisfy a checker.
- For input/event reachability errors: add an environment transition
  that flips the offending bool to the required value. Example: if
  `train_detected == true` is referenced but no transition sets it
  true, add `{"name": "detect_train", "guard": "train_detected == false",
  "updates": {"train_detected": true}}`.
- For enum/boolean misuse: replace the offending compare with the
  suggested fix. Do NOT add a brand-new bool variable unless that is
  what the fix says to do.
- A bounded-response property is only meaningful if the trigger state is
  reachable from the initial state via the transitions you draft.
"""


def _llm_repair_draft(
    req: SpecDraftRequest,
    prior: SpecDraftResponse,
    errors: List["HealthCheckItem"],
    plan: Optional[AbstractionPlan] = None,
) -> Tuple[Optional[SpecDraftResponse], Optional[str]]:
    """Ask the LLM to repair a draft that failed the health check.

    The repair prompt feeds back the specific validation errors so the
    model has concrete targets to fix. We deliberately preserve the
    user's original description as the source of truth — the LLM is
    told not to redrift intent. When the Phase-1 abstraction plan is
    available we hand it back too so the repair stays consistent with
    the original modeling decisions."""
    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI()
        prior_payload = {
            "model": prior.model.model_dump(),
            "properties": [p.model_dump() for p in prior.properties],
            "assumptions": list(prior.assumptions),
            "review_log": [r.model_dump() for r in prior.review_log],
        }
        err_lines = [
            f"- [{i.category}] {i.title}: {i.message}"
            + (f"\n  Suggested fix: {i.suggested_fix}" if i.suggested_fix else "")
            for i in errors
        ]
        user_msg = "Original user description:\n" + req.description
        if plan is not None:
            user_msg += (
                "\n\nAbstraction plan (Phase 1). PRESERVE these modeling "
                "decisions — do not invent new modes or drop declared "
                "variables. Fixes must respect this plan:\n"
                + json.dumps(plan.model_dump(), indent=2)
            )
        user_msg += (
            "\n\nPrevious draft JSON:\n"
            + json.dumps(prior_payload, indent=2)
            + "\n\nValidation errors to fix:\n"
            + "\n".join(err_lines)
        )
        resp = client.chat.completions.create(
            model=_llm_model_name(),
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "system", "content": _REPAIR_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            **_chat_kwargs(),
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        parsed = SpecDraftResponse.model_validate(
            {
                "model": data.get("model"),
                "properties": data.get("properties", []),
                "assumptions": data.get("assumptions", []),
                "review_log": data.get("review_log", []),
                "used_llm": True,
                "llm_model_name": _llm_model_name(),
                "warnings": [],
            }
        )
        validate_model(parsed.model)
        for p in parsed.properties:
            validate_property(p)
        return parsed, None
    except Exception as exc:
        return None, _short_err(exc)


def _llm_review(
    req: SpecReviewRequest,
) -> Tuple[Optional[SpecReviewResponse], Optional[str]]:
    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI()
        user_msg = (
            "Here is the model and the safety properties:\n\n"
            + json.dumps(
                {
                    "model": req.model.model_dump(),
                    "properties": [p.model_dump() for p in req.properties],
                },
                indent=2,
            )
        )
        if req.description:
            user_msg += f"\n\nOriginal description:\n{req.description}"
        if req.abstraction_plan is not None:
            user_msg += (
                "\n\nAbstraction plan (use dangerous_modes / recovery_modes "
                "to ground hypotheses; do not classify a recovery mode as "
                "critical):\n"
                + json.dumps(req.abstraction_plan.model_dump(), indent=2)
            )
        resp = client.chat.completions.create(
            model=_llm_model_name(),
            messages=[
                {"role": "system", "content": _REVIEW_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            **_chat_kwargs(),
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        parsed = SpecReviewResponse.model_validate(
            {
                "review_log": data.get("review_log", []),
                "hypotheses": data.get("hypotheses", []),
                "used_llm": True,
                "llm_model_name": _llm_model_name(),
                "warnings": [],
            }
        )
        for hyp in parsed.hypotheses:
            if hyp.mutation is not None:
                validate_model(hyp.mutation.mutated_model)
            if hyp.property is not None:
                validate_property(hyp.property)
        return parsed, None
    except Exception as exc:
        return None, _short_err(exc)


def _short_err(exc: Exception) -> str:
    msg = f"{type(exc).__name__}: {exc}"
    # Keep it terse so we never leak large response payloads.
    return (msg[:240] + "…") if len(msg) > 240 else msg


# ---------------------------------------------------------------------------
# Deterministic draft + review
# ---------------------------------------------------------------------------


def _deterministic_draft(
    req: SpecDraftRequest, warnings: List[str]
) -> SpecDraftResponse:
    """Picks one of the bundled templates by keyword.

    IMPORTANT: this routine is only reached from the fallback paths in
    ``draft_from_description`` — never when an LLM key is configured and
    the LLM call succeeded. The caller is responsible for stamping
    ``draft_source`` ("deterministic_fallback" / "template_fallback")
    and for warning the user that the output is templated, not LLM-
    drafted.
    """
    kind = _classify_description(req.description, req.domain_hint)
    if kind == "warehouse_robot":
        model, properties, assumptions, review_log = _warehouse_robot_draft()
    elif kind == "railway_crossing":
        model, properties, assumptions, review_log = _railway_crossing_draft()
    else:
        model, properties, assumptions, review_log = _field_robot_draft()
    return SpecDraftResponse(
        model=model,
        properties=properties,
        assumptions=assumptions,
        review_log=review_log,
        used_llm=False,
        warnings=warnings,
    )


def _deterministic_review(
    req: SpecReviewRequest, warnings: List[str]
) -> SpecReviewResponse:
    hypotheses, review_log = _propose_hypotheses(
        req.model, req.properties, plan=req.abstraction_plan
    )
    if not _have_llm():
        warnings = [
            "Using deterministic demo reviewer. Set OPENAI_API_KEY to enable AI review."
        ] + warnings
    return SpecReviewResponse(
        review_log=review_log,
        hypotheses=hypotheses,
        used_llm=False,
        warnings=warnings,
    )


def _classify_description(desc: str, hint: Optional[str]) -> str:
    blob = (desc + " " + (hint or "")).lower()
    if any(
        k in blob
        for k in (
            "railway",
            "railroad",
            "train crossing",
            "level crossing",
            "trainpassing",
            "warning lights",
            "gate sensor",
        )
    ):
        return "railway_crossing"
    if any(k in blob for k in ["warehouse robot", "warehouse", "pallet", "loading dock"]):
        return "warehouse_robot"
    return "field_robot"


# ---------------------------------------------------------------------------
# Field robot deterministic model
# ---------------------------------------------------------------------------


def _field_robot_draft():
    model = ModelSpec(
        name="autonomous_field_robot",
        title="Field robot controller",
        description=(
            "Field robot with seven control modes and intermittent comms. "
            "Actuate represents an irreversible command (e.g. payload "
            "release). The controller must preserve human-in-the-loop "
            "authorization for actuation even when comms are degraded."
        ),
        variables={
            "mode": VariableSpec(
                type="enum",
                values=[
                    "Idle",
                    "Armed",
                    "Mission",
                    "DegradedComms",
                    "Recovery",
                    "EmergencyStop",
                    "Actuate",
                ],
                initial="Idle",
            ),
            "comms": VariableSpec(type="enum", values=["OK", "Lost"], initial="OK"),
            "gps": VariableSpec(type="enum", values=["OK", "Lost"], initial="OK"),
            "battery": VariableSpec(type="enum", values=["High", "Low"], initial="High"),
            "human_authorized": VariableSpec(type="bool", initial=False),
            "sensor_agreement": VariableSpec(type="bool", initial=True),
            "armed_before": VariableSpec(type="bool", initial=False),
        },
        transitions=[
            TransitionSpec(
                name="low_battery_recovery",
                reactive=True,
                guard="(mode == Mission or mode == DegradedComms) and battery == Low",
                updates={"mode": "Recovery"},
            ),
            TransitionSpec(
                name="comms_degrade",
                reactive=True,
                guard="mode == Mission and comms == Lost",
                updates={"mode": "DegradedComms"},
            ),
            TransitionSpec(
                name="arm",
                guard="mode == Idle and human_authorized == true",
                updates={"mode": "Armed", "armed_before": True},
            ),
            TransitionSpec(
                name="start_mission",
                guard="mode == Armed and gps == OK and battery == High",
                updates={"mode": "Mission"},
            ),
            TransitionSpec(
                name="emergency_stop",
                guard="mode == Recovery",
                updates={"mode": "EmergencyStop"},
            ),
            TransitionSpec(
                name="authorized_actuation",
                guard="mode == DegradedComms and comms == Lost and human_authorized == true and sensor_agreement == true",
                updates={"mode": "Actuate"},
            ),
            # Environment / operator events
            TransitionSpec(
                name="operator_authorize",
                guard="human_authorized == false and (mode == Idle or mode == Armed)",
                updates={"human_authorized": True},
            ),
            TransitionSpec(
                name="operator_revoke",
                guard="human_authorized == true and (mode == Idle or mode == Armed)",
                updates={"human_authorized": False},
            ),
            TransitionSpec(
                name="comms_loss",
                guard="comms == OK",
                updates={"comms": "Lost"},
            ),
            TransitionSpec(
                name="comms_restore",
                guard="comms == Lost",
                updates={"comms": "OK"},
            ),
            TransitionSpec(
                name="gps_loss",
                guard="gps == OK and (mode == Idle or mode == Armed)",
                updates={"gps": "Lost"},
            ),
            TransitionSpec(
                name="gps_restore",
                guard="gps == Lost",
                updates={"gps": "OK"},
            ),
            TransitionSpec(
                name="battery_drain",
                guard="battery == High",
                updates={"battery": "Low"},
            ),
            TransitionSpec(
                name="sensor_disagree",
                guard="sensor_agreement == true and (mode == Idle or mode == Armed)",
                updates={"sensor_agreement": False},
            ),
            TransitionSpec(
                name="sensor_agree",
                guard="sensor_agreement == false",
                updates={"sensor_agreement": True},
            ),
        ],
    )
    properties = [
        PropertySpec(
            name="no_actuate_without_authority",
            title="Human Oversight",
            description=(
                "The platform must never enter Actuate while comms are lost "
                "and no human operator has approved the action."
            ),
            type="invariant",
            condition="not (mode == Actuate and comms == Lost and human_authorized == false)",
        ),
        PropertySpec(
            name="no_actuate_on_sensor_disagreement",
            title="Sensor Safety",
            description="The platform must never actuate while sensors disagree.",
            type="invariant",
            condition="not (mode == Actuate and sensor_agreement == false)",
        ),
        PropertySpec(
            name="low_battery_recovers_within_2",
            title="Low Battery Recovery",
            description=(
                "Once battery is low while in Mission or DegradedComms, the "
                "platform must reach Recovery or EmergencyStop within two "
                "steps."
            ),
            type="bounded_response",
            trigger="(mode == Mission or mode == DegradedComms) and battery == Low",
            response="mode == Recovery or mode == EmergencyStop",
            bound=2,
        ),
        PropertySpec(
            name="mission_requires_armed_history",
            title="Armed Before Mission",
            description="The platform must not be in Mission without having been armed.",
            type="invariant",
            condition="not (mode == Mission and armed_before == false)",
        ),
        PropertySpec(
            name="gps_loss_prevents_mission_start",
            title="GPS Safety",
            description=(
                "GPS loss is only permitted prior to Mission; Mission must "
                "not coexist with GPS lost."
            ),
            type="invariant",
            condition="not (mode == Mission and gps == Lost)",
        ),
    ]
    assumptions = [
        "Operator approval can be granted or revoked while the platform is Idle or Armed.",
        "Communications, GPS, battery, and sensor agreement are observable inputs.",
        "Reactive transitions (low_battery_recovery, comms_degrade) fire as soon as their guard holds.",
    ]
    review_log = [
        ReviewLogItem(
            title="Critical action state",
            summary="Identified `Actuate` as the irreversible command state called out in the description.",
            evidence=["The description says Actuate means the robot performs an irreversible command."],
        ),
        ReviewLogItem(
            title="Oversight predicate",
            summary="Mapped `human_authorized` to the operator-approval predicate.",
            evidence=["The description says the robot should only actuate if a human operator approved the action."],
        ),
        ReviewLogItem(
            title="Degraded oversight condition",
            summary="Treated `comms == Lost` as the state where operator intervention is unreliable.",
            evidence=["The description says the robot may lose communications during a mission."],
        ),
        ReviewLogItem(
            title="Recovery contract",
            summary="Added a bounded-response check requiring battery-low to reach Recovery or EmergencyStop within two steps.",
            evidence=["The description says low battery should lead to Recovery or EmergencyStop."],
            generated_artifact="bounded_response(b=2): battery==Low ⇒ mode ∈ {Recovery, EmergencyStop}",
        ),
        ReviewLogItem(
            title="Sensor-agreement contract",
            summary="Added an invariant blocking Actuate while sensors disagree.",
            evidence=["The description says actuation requires sensor agreement."],
            generated_artifact="invariant: not (mode == Actuate and sensor_agreement == false)",
        ),
    ]
    return model, properties, assumptions, review_log


# ---------------------------------------------------------------------------
# Warehouse robot deterministic model
# ---------------------------------------------------------------------------


def _warehouse_robot_draft():
    model = ModelSpec(
        name="warehouse_robot",
        title="Warehouse robot controller",
        description=(
            "Warehouse robot that moves, loads pallets, and stops on supervisor "
            "override. The robot must not move near a human without a supervisor "
            "override and must not load while sensors disagree."
        ),
        variables={
            "mode": VariableSpec(
                type="enum",
                values=["Idle", "Moving", "Loading", "EmergencyStop"],
                initial="Idle",
            ),
            "human_near": VariableSpec(type="bool", initial=False),
            "supervisor_override": VariableSpec(type="bool", initial=False),
            "battery": VariableSpec(type="enum", values=["High", "Low"], initial="High"),
            "sensors_agree": VariableSpec(type="bool", initial=True),
        },
        transitions=[
            TransitionSpec(
                name="low_battery_emergency",
                reactive=True,
                guard="(mode == Moving or mode == Loading) and battery == Low",
                updates={"mode": "EmergencyStop"},
            ),
            TransitionSpec(
                name="start_moving",
                guard="mode == Idle and (human_near == false or supervisor_override == true)",
                updates={"mode": "Moving"},
            ),
            TransitionSpec(
                name="start_loading",
                guard="mode == Moving and sensors_agree == true",
                updates={"mode": "Loading"},
            ),
            TransitionSpec(
                name="finish_loading",
                guard="mode == Loading",
                updates={"mode": "Idle"},
            ),
            TransitionSpec(
                name="emergency_stop_button",
                guard="mode == Moving or mode == Loading",
                updates={"mode": "EmergencyStop"},
            ),
            TransitionSpec(
                name="release_emergency_stop",
                guard="mode == EmergencyStop",
                updates={"mode": "Idle"},
            ),
            # Env / operator events
            TransitionSpec(name="human_enters", guard="human_near == false", updates={"human_near": True}),
            TransitionSpec(name="human_leaves", guard="human_near == true", updates={"human_near": False}),
            TransitionSpec(name="supervisor_overrides", guard="supervisor_override == false", updates={"supervisor_override": True}),
            TransitionSpec(name="supervisor_revokes", guard="supervisor_override == true", updates={"supervisor_override": False}),
            TransitionSpec(name="battery_drain", guard="battery == High", updates={"battery": "Low"}),
            TransitionSpec(name="sensor_disagree", guard="sensors_agree == true and mode == Idle", updates={"sensors_agree": False}),
            TransitionSpec(name="sensor_agree", guard="sensors_agree == false", updates={"sensors_agree": True}),
        ],
    )
    properties = [
        PropertySpec(
            name="no_moving_near_human_without_override",
            title="Human-near override",
            description="The robot must not be moving with a human nearby unless a supervisor override is in effect.",
            type="invariant",
            condition="not (mode == Moving and human_near == true and supervisor_override == false)",
        ),
        PropertySpec(
            name="no_loading_on_sensor_disagreement",
            title="Sensor agreement for loading",
            description="The robot must not be loading while its safety sensors disagree.",
            type="invariant",
            condition="not (mode == Loading and sensors_agree == false)",
        ),
        PropertySpec(
            name="low_battery_reaches_emergency_stop",
            title="Low battery → EmergencyStop",
            description="Once battery is low while moving or loading, the robot reaches EmergencyStop within two steps.",
            type="bounded_response",
            trigger="(mode == Moving or mode == Loading) and battery == Low",
            response="mode == EmergencyStop",
            bound=2,
        ),
    ]
    assumptions = [
        "Supervisor override is a deliberate human action that can be granted or withdrawn at any time.",
        "Sensor agreement and battery state are observable inputs to the controller.",
    ]
    review_log = [
        ReviewLogItem(
            title="Movement near humans",
            summary="Identified `Moving` near a human without supervisor override as the high-risk transition.",
            evidence=["The description says the robot must not move near a human without an override."],
        ),
        ReviewLogItem(
            title="Loading sensor predicate",
            summary="Mapped `sensors_agree` to the predicate that gates loading.",
            evidence=["The description says the robot must not load while sensors disagree."],
        ),
        ReviewLogItem(
            title="Recovery contract",
            summary="Added a bounded-response check requiring battery-low to reach EmergencyStop within two steps.",
            evidence=["The description says low battery should reach EmergencyStop."],
            generated_artifact="bounded_response(b=2): battery==Low ⇒ mode == EmergencyStop",
        ),
    ]
    return model, properties, assumptions, review_log


# ---------------------------------------------------------------------------
# Railway crossing deterministic model
# ---------------------------------------------------------------------------


def _railway_crossing_draft():
    # Design note: mode transitions and the sensor booleans are deliberately
    # decoupled so that removing a precondition on `enter_train_passing`
    # produces a real reachable counterexample rather than a vacuous
    # no-op. Specifically `gate_reaches_down` only updates mode; the
    # separate environment event `gate_sensor_confirms_down` is what flips
    # `gate_fully_down`. Similarly `enter_fault` is non-reactive — the
    # bounded-response property below is the safety obligation, so the
    # solver can choose adversarial traces where the controller delays
    # entering Fault.
    model = ModelSpec(
        name="railway_crossing",
        title="Railway crossing controller",
        description=(
            "Railway crossing controller. When a train is detected, the "
            "controller turns on warning lights, lowers the gate, and only "
            "allows TrainPassing once the gate is fully down. A gate-sensor "
            "fault drives the controller into Fault and blocks TrainPassing."
        ),
        variables={
            "mode": VariableSpec(
                type="enum",
                values=[
                    "Idle",
                    "Warning",
                    "LoweringGate",
                    "GateDown",
                    "TrainPassing",
                    "RaisingGate",
                    "Fault",
                ],
                initial="Idle",
            ),
            "train_detected": VariableSpec(type="bool", initial=False),
            "gate_sensor_fault": VariableSpec(type="bool", initial=False),
            "warning_lights_active": VariableSpec(type="bool", initial=False),
            "gate_fully_down": VariableSpec(type="bool", initial=False),
            "train_cleared": VariableSpec(type="bool", initial=False),
        },
        transitions=[
            # ----- Reactive safety / controller chain ---------------------
            # File order matters: enter_fault is highest priority so it
            # always pre-empts the normal chain when a fault is reported.
            TransitionSpec(
                name="enter_fault",
                reactive=True,
                guard="gate_sensor_fault == true and mode != Fault",
                updates={"mode": "Fault"},
            ),
            # Once a train is detected while Idle, the controller is
            # obligated to start the warning sequence. Reactive so the
            # bounded-response below has a deterministic path to
            # GateDown.
            TransitionSpec(
                name="train_detected_warning",
                reactive=True,
                guard="train_detected == true and mode == Idle",
                updates={"mode": "Warning", "warning_lights_active": True},
            ),
            TransitionSpec(
                name="lower_gate",
                reactive=True,
                guard="mode == Warning and warning_lights_active == true",
                updates={"mode": "LoweringGate"},
            ),
            # NOTE: only updates mode. `gate_fully_down` is set separately
            # by `gate_sensor_confirms_down`; decoupling them is what
            # makes `gate_fully_down == true` a meaningful precondition
            # on enter_train_passing.
            TransitionSpec(
                name="gate_reaches_down",
                reactive=True,
                guard="mode == LoweringGate",
                updates={"mode": "GateDown"},
            ),

            # ----- Environment / sensor events ----------------------------
            TransitionSpec(
                name="detect_train",
                guard="train_detected == false",
                updates={"train_detected": True},
            ),
            TransitionSpec(
                name="gate_sensor_fails",
                guard="gate_sensor_fault == false",
                updates={"gate_sensor_fault": True},
            ),
            # The gate-down sensor reports gate-fully-down asynchronously.
            # Independent of mode so the solver can explore "mode reaches
            # GateDown before sensor confirms" as a real failure mode.
            TransitionSpec(
                name="gate_sensor_confirms_down",
                guard="gate_fully_down == false",
                updates={"gate_fully_down": True},
            ),

            # ----- Train-passing chain (operator-discretion) --------------
            TransitionSpec(
                name="enter_train_passing",
                guard=(
                    "mode == GateDown and gate_fully_down == true and "
                    "warning_lights_active == true and gate_sensor_fault == false"
                ),
                updates={"mode": "TrainPassing"},
            ),
            TransitionSpec(
                name="train_clears",
                guard="mode == TrainPassing and train_cleared == false",
                updates={"train_cleared": True},
            ),
            TransitionSpec(
                name="raise_gate",
                guard="mode == TrainPassing and train_cleared == true",
                updates={"mode": "RaisingGate"},
            ),
            TransitionSpec(
                name="return_to_idle",
                guard="mode == RaisingGate",
                updates={
                    "mode": "Idle",
                    "train_detected": False,
                    "warning_lights_active": False,
                    "gate_fully_down": False,
                    "train_cleared": False,
                },
            ),
        ],
    )
    properties = [
        PropertySpec(
            name="no_pass_without_gate_down",
            title="Gate must be down before TrainPassing",
            description=(
                "A train must not enter TrainPassing while the gate is "
                "not fully down."
            ),
            type="invariant",
            condition="not (mode == TrainPassing and gate_fully_down == false)",
        ),
        PropertySpec(
            name="no_pass_without_warning_lights",
            title="Warning lights must be active during TrainPassing",
            description="A train must not enter TrainPassing while warning lights are inactive.",
            type="invariant",
            condition="not (mode == TrainPassing and warning_lights_active == false)",
        ),
        PropertySpec(
            name="warning_lights_during_lowering",
            title="Warning lights active while LoweringGate",
            description="Warning lights must be on while the gate is being lowered.",
            type="invariant",
            condition="not (mode == LoweringGate and warning_lights_active == false)",
        ),
        PropertySpec(
            name="train_detection_reaches_gate_down",
            title="Train detection → GateDown (or Fault) within three steps",
            description=(
                "Once a train is detected while Idle, the controller must "
                "either reach GateDown within three steps or enter Fault "
                "if the gate-sensor fails along the way."
            ),
            type="bounded_response",
            trigger="train_detected == true and mode == Idle",
            response="mode == GateDown or mode == Fault",
            bound=3,
        ),
        PropertySpec(
            name="sensor_fault_reaches_fault_mode",
            title="Sensor fault → Fault within two steps",
            description=(
                "Once a gate-sensor fault is reported, the controller must "
                "reach Fault within two steps. Disabling the recovery "
                "transition is the canonical way to break this obligation."
            ),
            type="bounded_response",
            trigger="gate_sensor_fault == true and mode != Fault",
            response="mode == Fault",
            bound=2,
        ),
    ]
    assumptions = [
        "Train detection and gate-sensor faults are external events the controller observes.",
        "Lowering the gate eventually completes; the controller observes this as `gate_fully_down`.",
        "Operators / track-clear interlocks reset `train_detected`, `warning_lights_active`, and `gate_fully_down` when the controller returns to Idle.",
    ]
    review_log = [
        ReviewLogItem(
            title="Critical-action state",
            summary="Identified `TrainPassing` as the irreversible-while-active mode.",
            evidence=[
                "The description says a train must not enter TrainPassing without the gate fully down."
            ],
        ),
        ReviewLogItem(
            title="Environment events",
            summary=(
                "Added `detect_train` and `gate_sensor_fails` so the train-detection "
                "and sensor-fault paths are reachable. Without them, every safety "
                "check on TrainPassing would be vacuous."
            ),
            evidence=[
                "Guard `train_detected == true` only fires after `detect_train` runs.",
                "Guard `gate_sensor_fault == true` only fires after `gate_sensor_fails` runs.",
            ],
        ),
        ReviewLogItem(
            title="Recovery contract",
            summary="`enter_fault` is reactive: the controller transitions to Fault as soon as a sensor fault is observed.",
            evidence=["The description says a gate-sensor fault must drive the controller into Fault."],
        ),
        ReviewLogItem(
            title="Bounded-response contract",
            summary="Once a train is detected while Idle, the controller must reach GateDown within three steps.",
            evidence=["The description says the controller should reach GateDown within three steps."],
            generated_artifact="bounded_response(b=3): train_detected ⇒ mode == GateDown",
        ),
    ]
    return model, properties, assumptions, review_log


# ---------------------------------------------------------------------------
# Deterministic hypothesis generation
#
# Hypotheses are *polarity-aware*. Transitions that drive the system into a
# critical (dangerous) mode are probed by removing precondition clauses —
# that's the direction where the change weakens safety. Transitions that
# drive the system into a recovery / safety mode are probed by *disabling*
# them or by tightening their guards — removing clauses from a recovery
# transition makes it easier to fire, which is the *safe* direction and is
# therefore not a useful risk hypothesis.
# ---------------------------------------------------------------------------


# Modes the system is supposed to enter only under tight preconditions.
# Removing a guard clause on a transition to one of these is a risky
# weakening worth handing to the solver.
_CRITICAL_MODES = {
    "Actuate",
    "Loading",
    "Moving",
    "Heating",
    "Draining",
    "Mixing",
    "TrainPassing",
    "Infusing",
    "OpenValve",
    "ThrusterFire",
    "Fire",
    "Dispense",
}


# Modes the system is supposed to be able to enter as a safety response.
# Removing a guard clause from a transition that enters one of these
# WEAKENS the precondition — making the safe response easier — which is
# the *conservative* direction, not a meaningful unsafe weakening.
_RECOVERY_MODES = {
    "EmergencyShutdown",
    "EmergencyStop",
    "EmergencyLand",
    "Recovery",
    "Venting",
    "Fault",
    "SafeMode",
    "Alarm",
    "Abort",
    "Shutdown",
    "Hold",
}


# Clauses that are pre-state checks (e.g. `mode == Idle`) are structural;
# removing them just breaks the transition rather than weakening safety.
def _is_pre_state_check(clause: str) -> bool:
    return bool(re.match(r"^\s*mode\s*==\s*\w+\s*$", clause))


# Conservative cap on how many hypotheses to emit so the UI stays readable.
_MAX_HYPOTHESES = 6


def _propose_hypotheses(
    model: ModelSpec,
    properties: List[PropertySpec],
    plan: Optional[AbstractionPlan] = None,
) -> Tuple[List[RiskHypothesis], List[ReviewLogItem]]:
    """Generate grounded risk hypotheses.

    When `plan` is provided we take dangerous_modes / recovery_modes
    from the abstraction plan — this is the correct shape for the
    LLM-first pipeline because it lets the reviewer reason about
    arbitrary domains the keyword sets never covered. When `plan` is
    None we fall back to the keyword heuristics so the deterministic
    template path still works."""
    hypotheses: List[RiskHypothesis] = []
    log: List[ReviewLogItem] = []

    critical_modes = _resolve_critical_modes(plan)
    recovery_modes = _resolve_recovery_modes(plan)
    source_label = (
        "abstraction plan" if plan and (plan.dangerous_modes or plan.recovery_modes)
        else "keyword heuristic"
    )

    critical = [
        t for t in model.transitions if t.updates.get("mode") in critical_modes
    ]
    recovery = [
        t for t in model.transitions if t.updates.get("mode") in recovery_modes
    ]

    if critical:
        log.append(
            ReviewLogItem(
                title="Critical-state transitions",
                summary=(
                    f"Found transitions that enter a dangerous mode (via {source_label}): "
                    + ", ".join(
                        f"`{t.name}` → {t.updates.get('mode')}" for t in critical
                    )
                    + ". Their preconditions are the natural place to look for "
                    "unsafe weakenings."
                ),
                evidence=[
                    f"Transition `{t.name}` updates mode to `{t.updates.get('mode')}` "
                    f"(treated as a dangerous mode)."
                    for t in critical
                ],
            )
        )

    if recovery:
        log.append(
            ReviewLogItem(
                title="Recovery transitions",
                summary=(
                    f"Found transitions that enter a safety/recovery mode (via {source_label}): "
                    + ", ".join(
                        f"`{t.name}` → {t.updates.get('mode')}" for t in recovery
                    )
                    + ". Removing clauses from these makes the safe response "
                    "easier, not harder — so the unsafe weakening here is to "
                    "*disable* them instead."
                ),
                evidence=[
                    f"Transition `{t.name}` updates mode to `{t.updates.get('mode')}` "
                    f"(treated as a recovery mode)."
                    for t in recovery
                ],
            )
        )

    seen_remove: List[Tuple[str, str]] = []
    seen_disable: set[str] = set()

    # (1) Critical transitions: propose removing each non-pre-state clause.
    for trans in critical:
        if len(hypotheses) >= _MAX_HYPOTHESES:
            break
        for clause in split_top_conjuncts(trans.guard):
            if _is_pre_state_check(clause):
                continue
            key = (trans.name, " ".join(clause.split()))
            if key in seen_remove:
                continue
            seen_remove.append(key)
            hyp = _build_remove_clause_hypothesis(model, properties, trans, clause)
            if hyp is None:
                continue
            hypotheses.append(hyp)
            log.append(
                ReviewLogItem(
                    title=f"Precondition on `{trans.name}`",
                    summary=(
                        f"Generated a mutation that drops `{clause}` from the "
                        f"guard on `{trans.name}` so the solver can decide "
                        "whether the critical state becomes reachable without "
                        "that precondition."
                    ),
                    evidence=[
                        f"Clause `{clause}` looks like a safety precondition.",
                        f"It guards `{trans.name}` whose updates set "
                        f"mode = `{trans.updates.get('mode')}`.",
                    ],
                    generated_artifact=f"remove `{clause}` from `{trans.name}.guard`",
                )
            )
            if len(hypotheses) >= _MAX_HYPOTHESES:
                break

    # (2) Recovery transitions: propose disabling each.
    for trans in recovery:
        if len(hypotheses) >= _MAX_HYPOTHESES:
            break
        if trans.name in seen_disable:
            continue
        seen_disable.add(trans.name)
        hyp = _build_disable_hypothesis(model, properties, trans)
        if hyp is None:
            continue
        hypotheses.append(hyp)
        log.append(
            ReviewLogItem(
                title=f"Disable recovery `{trans.name}`",
                summary=(
                    f"Generated a mutation that disables `{trans.name}` — the "
                    "transition that drives the system into "
                    f"`{trans.updates.get('mode')}`. If a bounded-response "
                    "check on this recovery exists, the solver should now "
                    "find a violation."
                ),
                evidence=[
                    f"Transition `{trans.name}` updates mode to "
                    f"`{trans.updates.get('mode')}` (recovery mode).",
                    "Removing the transition is the unsafe direction; "
                    "removing clauses would only make it easier to fire.",
                ],
                generated_artifact=f"disable transition `{trans.name}`",
            )
        )

    if not hypotheses:
        log.append(
            ReviewLogItem(
                title="No risky candidates spotted",
                summary=(
                    "Did not find transitions that enter a critical or "
                    "recovery mode whose mutation would change safety. "
                    "Re-running the bundled properties against the unchanged "
                    "model."
                ),
                evidence=[],
            )
        )

    return hypotheses, log


def _build_remove_clause_hypothesis(
    base: ModelSpec,
    properties: List[PropertySpec],
    trans: TransitionSpec,
    clause: str,
) -> Optional[RiskHypothesis]:
    clauses = split_top_conjuncts(trans.guard)
    norm_clause = " ".join(clause.split())
    new_clauses = [c for c in clauses if " ".join(c.split()) != norm_clause]
    if len(new_clauses) == len(clauses):
        return None
    new_guard = " and ".join(new_clauses) if new_clauses else "true"
    mutated = base.model_copy(deep=True)
    for t in mutated.transitions:
        if t.name == trans.name:
            t.guard = new_guard
            break
    mutation_id = f"remove_{trans.name}_{uuid.uuid4().hex[:6]}"
    mutation = CandidateMutation(
        id=mutation_id,
        title=f"Remove `{clause}` from `{trans.name}`",
        transition=trans.name,
        kind="remove_guard_clause",
        removed_clause=clause,
        new_guard=new_guard,
        mutated_model=mutated,
    )
    target_mode = trans.updates.get("mode") or "the post-state"
    return RiskHypothesis(
        id=f"hyp_{mutation_id}",
        title=f"Drop `{clause}` from `{trans.name}`",
        summary=(
            f"`{trans.name}` enters `{target_mode}`. Dropping `{clause}` "
            "checks whether the model can let the controller enter "
            f"`{target_mode}` without that precondition. Z3 will either "
            "find a reachable trace (confirming the clause was load-bearing) "
            "or show no counterexample (the clause was redundant given other "
            "structural constraints)."
        ),
        mutation=mutation,
        rationale=(
            f"`{clause}` is a non-pre-state precondition on the transition "
            f"into `{target_mode}`. If it is the only line of defence for "
            "the associated safety property, removing it should expose a "
            "concrete unsafe trace."
        ),
        expected_signal=(
            f"A safety invariant referencing `{target_mode}` together with "
            f"the variable in `{clause}` is violated; the trace shows the "
            "controller entering "
            f"`{target_mode}` through the weakened guard."
        ),
    )


def _build_disable_hypothesis(
    base: ModelSpec,
    properties: List[PropertySpec],
    trans: TransitionSpec,
) -> Optional[RiskHypothesis]:
    mutated = base.model_copy(deep=True)
    mutated.transitions = [t for t in mutated.transitions if t.name != trans.name]
    mid = f"disable_{trans.name}_{uuid.uuid4().hex[:6]}"
    mutation = CandidateMutation(
        id=mid,
        title=f"Disable `{trans.name}`",
        transition=trans.name,
        kind="disable_transition",
        mutated_model=mutated,
    )
    target_mode = trans.updates.get("mode") or "its recovery state"
    return RiskHypothesis(
        id=f"hyp_{mid}",
        title=f"Disable recovery transition `{trans.name}`",
        summary=(
            f"`{trans.name}` is the path the controller takes into "
            f"`{target_mode}`. Removing it should violate any bounded-"
            f"response property that requires the system to reach "
            f"`{target_mode}` after a trigger event."
        ),
        mutation=mutation,
        rationale=(
            f"`{trans.name}` updates `mode` to `{target_mode}`. If it is "
            "the only transition that does so, disabling it leaves the "
            "controller unable to discharge the safety obligation."
        ),
        expected_signal=(
            f"A bounded-response check whose response is `mode == "
            f"{target_mode}` fails because the response state is no longer "
            "reachable in time."
        ),
    )
