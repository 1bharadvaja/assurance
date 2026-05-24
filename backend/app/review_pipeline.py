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
import uuid
from typing import Any, Iterable, List, Optional, Tuple

from .counterexample import find_culprit
from .diff import diff_results
from .explain import explain_failure
from .guards import parse_guard
from .models import (
    AssuranceDiffResponse,
    CandidateMutation,
    HypothesisCheckRequest,
    HypothesisCheckResponse,
    HypothesisCheckResult,
    ModelSpec,
    PropertySpec,
    RegressionEntry,
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
    warnings: List[str] = []
    if _have_llm():
        llm_result = _llm_draft(req)
        if llm_result is not None:
            return llm_result
        warnings.append(
            "OpenAI call did not return a valid model. Falling back to the "
            "deterministic reviewer."
        )
    return _deterministic_draft(req, warnings=warnings)


def review_model(req: SpecReviewRequest) -> SpecReviewResponse:
    warnings: List[str] = []
    if _have_llm():
        llm_result = _llm_review(req)
        if llm_result is not None:
            return llm_result
        warnings.append(
            "OpenAI call did not return a valid review. Falling back to the "
            "deterministic reviewer."
        )
    return _deterministic_review(req, warnings=warnings)


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


# ---------------------------------------------------------------------------
# LLM hook
# ---------------------------------------------------------------------------


def _have_llm() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


_SYSTEM_PROMPT = """\
You are drafting a small finite state-machine model for a formal model
checker. Return ONLY a JSON object. Do not include chain-of-thought.
Do include an audit log with concise externally-checkable observations and
evidence, not private reasoning.

Constraints:
- Variables are enum or bool only. Each variable has an `initial` value.
- Guards use only this grammar: ==, !=, and, or, not, parentheses, the
  literal `in [..]` list form, and the boolean keywords `true` / `false`.
- Keep the model small: at most 10 variables, at most 25 transitions, at
  most 10 properties.
- Each property is either `invariant` (with a `condition`) or
  `bounded_response` (with `trigger`, `response`, and an integer `bound`).
- Do not claim anything is proven. The solver decides.

Return shape (JSON):
{
  "model": ModelSpec,
  "properties": [PropertySpec, ...],
  "assumptions": ["plain text", ...],
  "review_log": [
    {"title": "...", "summary": "...", "evidence": ["...", ...]},
    ...
  ]
}
"""


_REVIEW_SYSTEM_PROMPT = """\
You are an auditor reviewing a finite state-machine model and its safety
properties. Return ONLY a JSON object. Do not include chain-of-thought.
Each review item must be a concise, externally-checkable observation with
evidence drawn from the model — not private reasoning.

Constraints:
- Do not claim a property holds or fails. The solver decides.
- Each hypothesis must have either a `property` or a `mutation` (a small
  edit to one transition's guard, or disabling a transition).
- Mutations must produce a model that is still valid (≤10 vars, ≤25
  transitions). The `mutated_model` field must contain the full model
  with the edit applied.

Return shape (JSON):
{
  "review_log": [{"title": "...", "summary": "...", "evidence": ["..."]}],
  "hypotheses": [
    {
      "id": "...",
      "title": "...",
      "summary": "...",
      "rationale": "...",
      "expected_signal": "...",
      "property": PropertySpec | null,
      "mutation": {
        "id": "...", "title": "...", "transition": "...",
        "kind": "remove_guard_clause" | "disable_transition" | "strengthen_or_weaken_guard",
        "removed_clause": "..." | null,
        "new_guard": "..." | null,
        "mutated_model": ModelSpec
      } | null
    }
  ]
}
"""


def _llm_draft(req: SpecDraftRequest) -> Optional[SpecDraftResponse]:
    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI()
        resp = client.chat.completions.create(
            model=os.getenv("ASSURANCE_LLM_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        "Draft a model for this system description.\n\n"
                        + req.description
                        + (f"\n\nDomain hint: {req.domain_hint}" if req.domain_hint else "")
                    ),
                },
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        # Validate against our pydantic schema. If the LLM produced something
        # we can't parse safely, return None so the caller falls back.
        parsed = SpecDraftResponse.model_validate(
            {
                "model": data.get("model"),
                "properties": data.get("properties", []),
                "assumptions": data.get("assumptions", []),
                "review_log": data.get("review_log", []),
                "used_llm": True,
                "warnings": [],
            }
        )
        # Defensive: validate the drafted model with our structural checks.
        validate_model(parsed.model)
        for p in parsed.properties:
            validate_property(p)
        return parsed
    except Exception:
        return None


def _llm_review(req: SpecReviewRequest) -> Optional[SpecReviewResponse]:
    try:
        from openai import OpenAI  # type: ignore

        client = OpenAI()
        user_msg = (
            "Here is the model and the safety properties:\n\n"
            + json.dumps({"model": req.model.model_dump(), "properties": [p.model_dump() for p in req.properties]}, indent=2)
        )
        if req.description:
            user_msg += f"\n\nOriginal description:\n{req.description}"
        resp = client.chat.completions.create(
            model=os.getenv("ASSURANCE_LLM_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": _REVIEW_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        parsed = SpecReviewResponse.model_validate(
            {
                "review_log": data.get("review_log", []),
                "hypotheses": data.get("hypotheses", []),
                "used_llm": True,
                "warnings": [],
            }
        )
        # Defensive validation of each hypothesis's mutated model / property.
        for hyp in parsed.hypotheses:
            if hyp.mutation is not None:
                validate_model(hyp.mutation.mutated_model)
            if hyp.property is not None:
                validate_property(hyp.property)
        return parsed
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Deterministic draft + review
# ---------------------------------------------------------------------------


def _deterministic_draft(
    req: SpecDraftRequest, warnings: List[str]
) -> SpecDraftResponse:
    kind = _classify_description(req.description, req.domain_hint)
    if kind == "warehouse_robot":
        model, properties, assumptions, review_log = _warehouse_robot_draft()
    else:
        model, properties, assumptions, review_log = _field_robot_draft()
    note = "Using deterministic demo reviewer. Set OPENAI_API_KEY to enable AI drafting."
    if not _have_llm():
        warnings = [note] + warnings
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
    hypotheses, review_log = _propose_hypotheses(req.model, req.properties)
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
# Deterministic hypothesis generation
#
# We focus on the canonical pattern: a guard on a transition to a "critical"
# state contains an oversight predicate (e.g. `human_authorized == true`).
# Removing that predicate is a one-line edit that the solver can confirm or
# refute by finding a reachable trace.
# ---------------------------------------------------------------------------


# (variable, value) pairs that we treat as "critical mode" markers when we
# see them as a transition's `mode` update target.
_CRITICAL_MODES = {"Actuate", "Loading", "Moving"}


# Predicate substrings we treat as oversight clauses worth probing.
_OVERSIGHT_TOKENS = [
    "human_authorized",
    "supervisor_override",
    "sensor_agreement",
    "sensors_agree",
    "operator_authorized",
]


def _propose_hypotheses(
    model: ModelSpec, properties: List[PropertySpec]
) -> Tuple[List[RiskHypothesis], List[ReviewLogItem]]:
    hypotheses: List[RiskHypothesis] = []
    log: List[ReviewLogItem] = []

    # Identify candidate critical transitions.
    critical = [
        t for t in model.transitions if t.updates.get("mode") in _CRITICAL_MODES
    ]
    if critical:
        log.append(
            ReviewLogItem(
                title="Critical action transitions",
                summary=(
                    "Found transitions that drive the controller into a "
                    "critical mode: "
                    + ", ".join(f"`{t.name}` → {t.updates.get('mode')}" for t in critical)
                ),
                evidence=[
                    f"Transition `{t.name}` updates mode to `{t.updates.get('mode')}`."
                    for t in critical
                ],
            )
        )

    seen_predicates: List[Tuple[str, str]] = []
    for trans in critical:
        clauses = split_top_conjuncts(trans.guard)
        for clause in clauses:
            for token in _OVERSIGHT_TOKENS:
                if token in clause and (trans.name, clause) not in seen_predicates:
                    seen_predicates.append((trans.name, clause))
                    hyp = _build_remove_clause_hypothesis(
                        model, properties, trans, clause
                    )
                    if hyp is not None:
                        hypotheses.append(hyp)
                        log.append(
                            ReviewLogItem(
                                title=f"Oversight predicate on `{trans.name}`",
                                summary=(
                                    f"`{clause}` looks like an oversight check. "
                                    "Generated a mutation that removes it to "
                                    "see whether the critical state becomes "
                                    "reachable without operator consent."
                                ),
                                evidence=[
                                    f"Clause `{clause}` mentions an oversight predicate.",
                                    f"It guards transition `{trans.name}` whose updates set mode = `{trans.updates.get('mode')}`.",
                                ],
                                generated_artifact=f"remove `{clause}` from `{trans.name}.guard`",
                            )
                        )

    # If a `low_battery_*` style reactive transition exists, also propose
    # disabling it as a separate hypothesis — the bounded-response check
    # for battery recovery is a natural target for this.
    for trans in model.transitions:
        if trans.reactive and "battery" in trans.guard:
            hyp = _build_disable_hypothesis(model, properties, trans)
            if hyp is not None:
                hypotheses.append(hyp)
                log.append(
                    ReviewLogItem(
                        title=f"Reactive recovery transition `{trans.name}`",
                        summary=(
                            "Disabling this reactive transition should leave "
                            "the robot in a high-risk mode after the battery "
                            "drops. Sent to the solver to confirm."
                        ),
                        evidence=[
                            f"Transition `{trans.name}` is reactive and references battery in its guard.",
                        ],
                        generated_artifact=f"disable transition `{trans.name}`",
                    )
                )
            break  # one is enough

    if not hypotheses:
        log.append(
            ReviewLogItem(
                title="No oversight predicates spotted",
                summary=(
                    "Did not find oversight clauses on transitions that enter "
                    "a critical mode. Re-running the bundled properties "
                    "against the model unchanged."
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
    return RiskHypothesis(
        id=f"hyp_{mutation_id}",
        title=f"Drop `{clause}` from `{trans.name}`",
        summary=(
            f"If `{clause}` is removed from the guard on `{trans.name}`, the "
            "critical mode may become reachable without that precondition. "
            "Ask the solver to find such an execution."
        ),
        mutation=mutation,
        rationale=(
            f"`{clause}` looks like an oversight predicate. The solver should "
            "show whether removing it creates a reachable counterexample."
        ),
        expected_signal=(
            "If a safety property fails, the trace will reach the critical "
            "state through the weakened guard."
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
    return RiskHypothesis(
        id=f"hyp_{mid}",
        title=f"Disable reactive recovery `{trans.name}`",
        summary=(
            f"If the reactive transition `{trans.name}` cannot fire, the "
            "battery-recovery contract may be violated."
        ),
        mutation=mutation,
        rationale=(
            f"`{trans.name}` is the only transition that handles battery "
            "low while in flight. Disabling it should break the recovery "
            "bounded-response property if one is defined."
        ),
        expected_signal=(
            "The Low Battery Recovery property fails because the response "
            "state is no longer reachable in time."
        ),
    )
