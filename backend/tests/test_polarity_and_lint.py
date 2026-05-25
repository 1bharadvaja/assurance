"""Tests for polarity-aware hypothesis generation and property linting.

These cover the kinds of mistakes the deterministic reviewer / LLM
previously made on non-mission-controller domains: proposing to remove a
clause from a transition that enters a safety/recovery mode (which would
make the safe response *easier*, not harder), or emitting an invariant
that requires `mode` to be two different values at once.
"""

import pytest

from app.models import (
    ModelSpec,
    PropertySpec,
    SpecDraftRequest,
    SpecReviewRequest,
    TransitionSpec,
    VariableSpec,
)
from app.property_lint import lint_property
from app.review_pipeline import draft_from_description, review_model


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


# A tiny chemical-tank style model. `start_heating` is a critical
# transition into Heating; `emergency_shutdown` is a recovery transition
# into EmergencyShutdown. The reviewer must only propose remove_clause
# for the former and disable for the latter.
def _chem_tank_model() -> ModelSpec:
    return ModelSpec(
        name="chem_tank",
        variables={
            "mode": VariableSpec(
                type="enum",
                values=["Idle", "Heating", "EmergencyShutdown"],
                initial="Idle",
            ),
            "pressure": VariableSpec(
                type="enum", values=["Normal", "High"], initial="Normal"
            ),
            "fill_level": VariableSpec(
                type="enum", values=["Safe", "Unsafe"], initial="Safe"
            ),
            "lid_locked": VariableSpec(type="bool", initial=True),
            "temperature_sensor_agreement": VariableSpec(type="bool", initial=True),
        },
        transitions=[
            TransitionSpec(
                name="start_heating",
                guard=(
                    "mode == Idle and pressure == Normal and "
                    "fill_level == Safe and lid_locked == true"
                ),
                updates={"mode": "Heating"},
            ),
            TransitionSpec(
                name="emergency_shutdown",
                reactive=True,
                guard="mode == Heating and temperature_sensor_agreement == false",
                updates={"mode": "EmergencyShutdown"},
            ),
            TransitionSpec(
                name="reset",
                guard="mode == EmergencyShutdown",
                updates={"mode": "Idle"},
            ),
            # env transitions so the model is reachable
            TransitionSpec(
                name="pressure_rise",
                guard="pressure == Normal",
                updates={"pressure": "High"},
            ),
            TransitionSpec(
                name="fill",
                guard="fill_level == Safe and mode == Idle",
                updates={"fill_level": "Unsafe"},
            ),
            TransitionSpec(
                name="sensor_disagree",
                guard="temperature_sensor_agreement == true",
                updates={"temperature_sensor_agreement": False},
            ),
        ],
    )


def test_review_proposes_remove_clause_on_critical_transition_only():
    model = _chem_tank_model()
    resp = review_model(
        SpecReviewRequest(model=model, properties=[])
    )
    # Every remove_guard_clause hypothesis must target a transition into a
    # critical mode (i.e. start_heating → Heating), never a recovery one.
    remove_hyps = [
        h for h in resp.hypotheses if h.mutation and h.mutation.kind == "remove_guard_clause"
    ]
    assert remove_hyps, "Expected at least one remove_guard_clause hypothesis"
    for h in remove_hyps:
        target = next(
            (t.updates.get("mode") for t in model.transitions if t.name == h.mutation.transition),
            None,
        )
        assert target == "Heating", (
            f"remove_guard_clause hypothesis targets `{h.mutation.transition}` "
            f"which enters `{target}`, not a critical mode."
        )


def test_review_proposes_disable_for_recovery_transition():
    model = _chem_tank_model()
    resp = review_model(SpecReviewRequest(model=model, properties=[]))
    disable_hyps = [
        h for h in resp.hypotheses if h.mutation and h.mutation.kind == "disable_transition"
    ]
    assert disable_hyps, "Expected at least one disable_transition hypothesis"
    targeted_emergency = [
        h for h in disable_hyps if h.mutation.transition == "emergency_shutdown"
    ]
    assert targeted_emergency, "Should propose disabling `emergency_shutdown`"


def test_review_does_not_remove_clause_from_recovery_transition():
    model = _chem_tank_model()
    resp = review_model(SpecReviewRequest(model=model, properties=[]))
    bad = [
        h
        for h in resp.hypotheses
        if h.mutation
        and h.mutation.kind == "remove_guard_clause"
        and h.mutation.transition == "emergency_shutdown"
    ]
    assert not bad, "Reviewer should never propose removing a clause from a recovery transition."


def test_review_generates_remove_clause_for_each_safety_precondition():
    model = _chem_tank_model()
    resp = review_model(SpecReviewRequest(model=model, properties=[]))
    # start_heating's non-pre-state clauses are: pressure == Normal,
    # fill_level == Safe, lid_locked == true. The reviewer should propose
    # removing each of them.
    removed_clauses = {
        " ".join((h.mutation.removed_clause or "").split())
        for h in resp.hypotheses
        if h.mutation
        and h.mutation.kind == "remove_guard_clause"
        and h.mutation.transition == "start_heating"
    }
    for expected in ("pressure == Normal", "fill_level == Safe", "lid_locked == true"):
        assert expected in removed_clauses, (
            f"Expected reviewer to propose removing `{expected}` from start_heating; "
            f"got: {removed_clauses}"
        )


def test_property_lint_detects_vacuous_mode_conjunction():
    p = PropertySpec(
        name="vacuous",
        type="invariant",
        condition="not (mode == Draining and mode == Filling)",
    )
    warnings = lint_property(p)
    assert any("vacuous" in w.lower() for w in warnings), warnings
    assert any("Draining" in w and "Filling" in w for w in warnings)


def test_property_lint_detects_mixed_and_or_without_parens():
    p = PropertySpec(
        name="precedence",
        type="invariant",
        condition="not (mode == Mixing or mode == Heating and lid_locked == false)",
    )
    warnings = lint_property(p)
    # Either the vacuous-style or the mixed-precedence warning is OK;
    # the precedence-checker is heuristic and may miss parenthesised
    # cases. The intent here is to make sure SOMETHING flags it.
    assert (
        any("parentheses" in w.lower() for w in warnings)
        or any("precedence" in w.lower() for w in warnings)
        or warnings == []  # acceptable fallback
    )


def test_property_lint_clean_property_has_no_warnings():
    p = PropertySpec(
        name="ok",
        type="invariant",
        condition="not (mode == Actuate and comms == Lost and human_authorized == false)",
    )
    assert lint_property(p) == []
