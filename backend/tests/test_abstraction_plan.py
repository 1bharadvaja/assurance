"""Tests for the two-phase LLM drafting pipeline and the plan-aware
reviewer.

These tests mock both `_llm_abstraction_plan` (Phase 1) and `_llm_draft`
(Phase 2) so we can verify wiring without burning real OpenAI calls.

The contract we lock in:

- Phase 1 is invoked exactly once per drafting session. The plan is
  threaded into Phase 2 and into the repair LLM call.
- The plan is round-tripped to the response as `abstraction_plan`.
- The reviewer treats `plan.dangerous_modes` as the source of truth for
  which transitions are critical — even when those modes are NOT in the
  hardcoded keyword list. Same for `plan.recovery_modes`.
- When the plan classifies a mode as recovery, the reviewer never
  proposes `remove_guard_clause` for a transition entering that mode.
"""

from __future__ import annotations

import pytest

from app.models import (
    AbstractionPlan,
    ModelSpec,
    PropertySpec,
    SafetyPreconditionPlan,
    SpecDraftRequest,
    SpecDraftResponse,
    SpecReviewRequest,
    TransitionSpec,
    VariableSpec,
    VariablePlan,
)
from app import review_pipeline as rp


@pytest.fixture
def with_llm_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    yield


# ---------------------------------------------------------------------------
# Fixtures: plan + draft for a tiny infusion-pump style controller. Names
# are deliberately outside the hardcoded keyword sets so a passing test
# proves the reviewer is consulting the plan, not the keyword list.
# ---------------------------------------------------------------------------


def _infusion_plan() -> AbstractionPlan:
    return AbstractionPlan(
        controller_modes=[
            "Idle",
            "Primed",
            "Infusing",
            "OcclusionAlarm",
            "AirInLineAlarm",
            "Stopped",
        ],
        environment_inputs=[
            VariablePlan(
                name="occlusion_detected",
                type="bool",
                initial=False,
                rationale="Sensor reports a downstream blockage.",
            ),
            VariablePlan(
                name="air_in_line",
                type="bool",
                initial=False,
                rationale="Bubble sensor reports an air column.",
            ),
        ],
        latched_state_variables=[
            VariablePlan(
                name="line_primed",
                type="bool",
                initial=False,
                rationale="Set once the line has been primed before infusion.",
            ),
            VariablePlan(
                name="dose_confirmed",
                type="bool",
                initial=False,
                rationale="Set after the clinician confirms the dose.",
            ),
        ],
        dangerous_modes=["Infusing"],
        recovery_modes=["OcclusionAlarm", "AirInLineAlarm", "Stopped"],
        safety_preconditions=[
            SafetyPreconditionPlan(
                mode="Infusing",
                required_conditions=[
                    "dose_confirmed == true",
                    "line_primed == true",
                    "air_in_line == false",
                ],
                source_text="must not infuse without dose confirmation, primed line, and no air",
            )
        ],
        response_obligations=[],
        requirement_mapping=[],
        ambiguities=[],
    )


def _infusion_model() -> ModelSpec:
    """A minimal but-coherent infusion model that matches the plan."""
    return ModelSpec(
        name="infusion_pump_llm",
        variables={
            "mode": VariableSpec(
                type="enum",
                values=[
                    "Idle",
                    "Primed",
                    "Infusing",
                    "OcclusionAlarm",
                    "AirInLineAlarm",
                    "Stopped",
                ],
                initial="Idle",
            ),
            "occlusion_detected": VariableSpec(type="bool", initial=False),
            "air_in_line": VariableSpec(type="bool", initial=False),
            "line_primed": VariableSpec(type="bool", initial=False),
            "dose_confirmed": VariableSpec(type="bool", initial=False),
        },
        transitions=[
            TransitionSpec(
                name="detect_occlusion",
                guard="occlusion_detected == false",
                updates={"occlusion_detected": True},
            ),
            TransitionSpec(
                name="detect_air",
                guard="air_in_line == false",
                updates={"air_in_line": True},
            ),
            TransitionSpec(
                name="prime_line",
                guard="mode == Idle and line_primed == false",
                updates={"mode": "Primed", "line_primed": True},
            ),
            TransitionSpec(
                name="confirm_dose",
                guard="dose_confirmed == false and mode == Primed",
                updates={"dose_confirmed": True},
            ),
            TransitionSpec(
                name="start_infusing",
                guard=(
                    "mode == Primed and dose_confirmed == true and "
                    "line_primed == true and air_in_line == false"
                ),
                updates={"mode": "Infusing"},
            ),
            TransitionSpec(
                name="occlusion_alarm",
                reactive=True,
                guard="occlusion_detected == true and mode == Infusing",
                updates={"mode": "OcclusionAlarm"},
            ),
            TransitionSpec(
                name="air_alarm",
                reactive=True,
                guard="air_in_line == true and mode == Infusing",
                updates={"mode": "AirInLineAlarm"},
            ),
            TransitionSpec(
                name="emergency_stop",
                guard="mode == Infusing",
                updates={"mode": "Stopped"},
            ),
        ],
    )


def _infusion_draft(plan: AbstractionPlan) -> SpecDraftResponse:
    return SpecDraftResponse(
        model=_infusion_model(),
        properties=[
            PropertySpec(
                name="no_infuse_with_air",
                type="invariant",
                condition="not (mode == Infusing and air_in_line == true)",
            )
        ],
        assumptions=[],
        review_log=[],
        used_llm=True,
        llm_model_name="mock-frontier",
        warnings=[],
        abstraction_plan=plan,
    )


# ---------------------------------------------------------------------------
# Phase wiring: plan flows into draft response and into repair call
# ---------------------------------------------------------------------------


def test_phase1_runs_once_and_plan_threads_into_response(
    monkeypatch, with_llm_key
):
    plan = _infusion_plan()
    plan_calls = {"n": 0}

    def fake_plan(req):
        plan_calls["n"] += 1
        return plan, None

    def fake_draft(req, **kw):
        # Phase 2 must receive the plan as a kwarg.
        assert kw.get("plan") is plan, "Phase 2 must receive the Phase-1 plan"
        return _infusion_draft(plan), None

    monkeypatch.setattr(rp, "_llm_abstraction_plan", fake_plan)
    monkeypatch.setattr(rp, "_llm_draft", fake_draft)
    monkeypatch.setattr(
        rp,
        "_llm_repair_draft",
        lambda *a, **kw: pytest.fail("repair must not run on a clean draft"),
    )
    resp = rp.draft_from_description(
        SpecDraftRequest(description="describe an infusion pump")
    )
    assert plan_calls["n"] == 1
    assert resp.draft_source == "llm"
    assert resp.abstraction_plan is plan


def test_repair_call_receives_the_plan(monkeypatch, with_llm_key):
    """When the first draft is blocked, the repair LLM call must be
    given the same Phase-1 plan so it can preserve modeling decisions."""
    plan = _infusion_plan()
    # Phase-2 returns a blocked draft (use the canonical
    # enum-bool-misuse model from the other test module).
    from tests.test_llm_repair_loop import _blocked_llm_draft, _clean_llm_draft

    monkeypatch.setattr(rp, "_llm_abstraction_plan", lambda req: (plan, None))
    monkeypatch.setattr(
        rp, "_llm_draft", lambda req, **kw: (_blocked_llm_draft(), None)
    )

    repair_calls: list[dict] = []

    def fake_repair(req, prior, errors, **kw):
        repair_calls.append({"plan": kw.get("plan"), "n_errors": len(errors)})
        return _clean_llm_draft(), None

    monkeypatch.setattr(rp, "_llm_repair_draft", fake_repair)

    resp = rp.draft_from_description(
        SpecDraftRequest(description="describe an infusion pump")
    )
    assert resp.draft_source == "llm_repaired"
    assert len(repair_calls) == 1
    assert repair_calls[0]["plan"] is plan, "repair must receive the Phase-1 plan"
    assert repair_calls[0]["n_errors"] >= 1


# ---------------------------------------------------------------------------
# Reviewer uses the plan, not the keyword set
# ---------------------------------------------------------------------------


def test_reviewer_uses_plan_dangerous_modes(monkeypatch, with_llm_key):
    """Reviewer must consult `plan.dangerous_modes` — proven here by
    blanking the hardcoded keyword set so the plan is the ONLY signal."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(rp, "_CRITICAL_MODES", set())
    monkeypatch.setattr(rp, "_RECOVERY_MODES", set())
    plan = _infusion_plan()

    model = _infusion_model()
    resp = rp.review_model(
        SpecReviewRequest(
            model=model,
            properties=_infusion_draft(plan).properties,
            abstraction_plan=plan,
        )
    )
    # Reviewer must have proposed at least one remove_guard_clause on the
    # critical transition `start_infusing`.
    removed_on_critical = [
        h for h in resp.hypotheses
        if h.mutation
        and h.mutation.kind == "remove_guard_clause"
        and h.mutation.transition == "start_infusing"
    ]
    assert removed_on_critical, (
        "Reviewer should propose dropping clauses from start_infusing because "
        "the plan marks Infusing as dangerous (keyword set was emptied)."
    )


def test_reviewer_treats_plan_recovery_modes_as_recovery(
    monkeypatch, with_llm_key
):
    """`OcclusionAlarm` / `AirInLineAlarm` are NOT in the hardcoded
    _RECOVERY_MODES set. Without the plan, the reviewer would mis-classify
    them as neither critical nor recovery. With the plan, it must treat
    them as recovery and propose `disable_transition`, never
    `remove_guard_clause`."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    plan = _infusion_plan()
    # Sanity: neither alarm name should be in the bundled recovery set,
    # so the plan is the only thing telling the reviewer they're recovery.
    assert "OcclusionAlarm" not in rp._RECOVERY_MODES
    assert "AirInLineAlarm" not in rp._RECOVERY_MODES

    model = _infusion_model()
    resp = rp.review_model(
        SpecReviewRequest(
            model=model,
            properties=_infusion_draft(plan).properties,
            abstraction_plan=plan,
        )
    )

    bad = [
        h for h in resp.hypotheses
        if h.mutation
        and h.mutation.kind == "remove_guard_clause"
        and h.mutation.transition in ("occlusion_alarm", "air_alarm")
    ]
    assert not bad, (
        f"Reviewer must not remove clauses from recovery transitions; got: "
        f"{[h.mutation.transition for h in bad]}"
    )

    disable_recovery = [
        h for h in resp.hypotheses
        if h.mutation
        and h.mutation.kind == "disable_transition"
        and h.mutation.transition in ("occlusion_alarm", "air_alarm")
    ]
    assert disable_recovery, (
        "Reviewer should propose disabling at least one alarm transition "
        "because the plan classifies those targets as recovery modes."
    )


def test_reviewer_without_plan_still_works(monkeypatch, with_llm_key):
    """No plan → reviewer falls back to the keyword heuristic. The
    deterministic templates rely on this path."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    model = ModelSpec(
        name="keyword_path",
        variables={
            "mode": VariableSpec(
                type="enum", values=["Idle", "Actuate"], initial="Idle"
            ),
            "approved": VariableSpec(type="bool", initial=False),
        },
        transitions=[
            TransitionSpec(
                name="approve", guard="approved == false", updates={"approved": True}
            ),
            TransitionSpec(
                name="actuate",
                guard="mode == Idle and approved == true",
                updates={"mode": "Actuate"},
            ),
        ],
    )
    resp = rp.review_model(
        SpecReviewRequest(model=model, properties=[])
        # no abstraction_plan
    )
    # `Actuate` IS in the keyword critical set, so a remove_guard_clause
    # on the `actuate` transition is expected.
    assert any(
        h.mutation
        and h.mutation.kind == "remove_guard_clause"
        and h.mutation.transition == "actuate"
        for h in resp.hypotheses
    )
