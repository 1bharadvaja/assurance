"""Tests for the generic 'undo the mutation' repairs synthesised by
``check_hypotheses`` for ``disable_transition`` and ``remove_guard_clause``
hypotheses.

The contract:

- A confirmed ``disable_transition`` failure gets a ``restore_transition``
  suggested_repair that carries the original TransitionSpec.
- A confirmed ``remove_guard_clause`` failure gets a
  ``restore_guard_clause`` suggested_repair that carries the removed
  clause.
- ``apply_repair`` for those kinds round-trips the mutated model back to
  the baseline (transition re-inserted; clause restored).
- Re-verifying the patched model against the original properties
  matches what the baseline does.
"""

from __future__ import annotations

import copy

import pytest

from app.models import (
    HypothesisCheckRequest,
    ModelSpec,
    PropertySpec,
    RepairSpec,
    SpecDraftRequest,
    SpecReviewRequest,
    TransitionSpec,
    VariableSpec,
)
from app.repair import apply_repair
from app.review_pipeline import check_hypotheses, draft_from_description, review_model
from app.verifier import Verifier


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


# ---------------------------------------------------------------------------
# Restore disabled transition
# ---------------------------------------------------------------------------


def _railway_like_model() -> ModelSpec:
    """A tiny railway-shaped model whose only path into Fault is the
    reactive `gate_sensor_fault_to_fault` transition. Disabling it must
    break the bounded-response and surface a restore_transition repair."""
    return ModelSpec(
        name="railway_like",
        variables={
            "mode": VariableSpec(
                type="enum",
                values=["Idle", "Fault"],
                initial="Idle",
            ),
            "gate_sensor_fault": VariableSpec(type="bool", initial=False),
        },
        transitions=[
            TransitionSpec(
                name="gate_sensor_fails",
                guard="gate_sensor_fault == false",
                updates={"gate_sensor_fault": True},
            ),
            TransitionSpec(
                name="gate_sensor_fault_to_fault",
                reactive=True,
                guard="gate_sensor_fault == true and mode != Fault",
                updates={"mode": "Fault"},
            ),
        ],
    )


def _fault_obligation_property() -> PropertySpec:
    return PropertySpec(
        name="sensor_fault_reaches_fault_mode",
        title="Gate Sensor Fault Leads To Fault Mode",
        type="bounded_response",
        trigger="gate_sensor_fault == true",
        response="mode == Fault",
        bound=1,
    )


def test_disable_transition_failure_yields_restore_transition_repair():
    model = _railway_like_model()
    prop = _fault_obligation_property()

    # Build the hypothesis by hand (mirrors what the reviewer would emit).
    mutated = model.model_copy(deep=True)
    mutated.transitions = [
        t for t in mutated.transitions if t.name != "gate_sensor_fault_to_fault"
    ]
    from app.models import CandidateMutation, RiskHypothesis

    hyp = RiskHypothesis(
        id="hyp_test_disable",
        title="Disable gate_sensor_fault_to_fault",
        summary="...",
        rationale="...",
        expected_signal="...",
        mutation=CandidateMutation(
            id="mut_test_disable",
            title="Disable",
            transition="gate_sensor_fault_to_fault",
            kind="disable_transition",
            mutated_model=mutated,
        ),
    )

    resp = check_hypotheses(
        HypothesisCheckRequest(
            base_model=model,
            properties=[prop],
            hypotheses=[hyp],
            bound=4,
        )
    )
    assert len(resp.results) == 1
    result = resp.results[0]
    assert result.classification == "confirmed_failure"
    assert result.diff is not None
    assert result.diff.regressions, "expected at least one regression entry"

    repair = result.diff.regressions[0].suggested_repair
    assert repair is not None
    assert repair.kind == "restore_transition"
    assert repair.transition == "gate_sensor_fault_to_fault"
    # The original transition spec is round-tripped on the repair so the
    # UI can re-insert it without consulting the base model again.
    assert repair.original_transition is not None
    assert repair.original_transition.name == "gate_sensor_fault_to_fault"
    assert repair.original_transition.reactive is True


def test_apply_restore_transition_yields_baseline_then_property_holds():
    model = _railway_like_model()
    prop = _fault_obligation_property()

    # Sanity: baseline holds.
    assert Verifier(model).check_property(prop, 4).status == "pass"

    # Mutated model (transition removed): property fails.
    mutated = model.model_copy(deep=True)
    mutated.transitions = [
        t for t in mutated.transitions if t.name != "gate_sensor_fault_to_fault"
    ]
    assert Verifier(mutated).check_property(prop, 4).status == "fail"

    # Apply the restore_transition repair: property should pass again.
    original = next(
        t for t in model.transitions if t.name == "gate_sensor_fault_to_fault"
    )
    repair = RepairSpec(
        kind="restore_transition",
        transition="gate_sensor_fault_to_fault",
        original_transition=original,
        rationale="test",
    )
    patched = apply_repair(mutated, repair)
    assert any(t.name == "gate_sensor_fault_to_fault" for t in patched.transitions)
    assert Verifier(patched).check_property(prop, 4).status == "pass"


def test_restore_transition_is_idempotent_when_already_present():
    """Applying restore_transition to the baseline (where the transition
    is already there) must NOT duplicate it."""
    model = _railway_like_model()
    original = next(
        t for t in model.transitions if t.name == "gate_sensor_fault_to_fault"
    )
    repair = RepairSpec(
        kind="restore_transition",
        transition="gate_sensor_fault_to_fault",
        original_transition=original,
        rationale="test",
    )
    patched = apply_repair(model, repair)
    names = [t.name for t in patched.transitions]
    assert names.count("gate_sensor_fault_to_fault") == 1


# ---------------------------------------------------------------------------
# Restore removed guard clause
# ---------------------------------------------------------------------------


def test_remove_guard_clause_failure_yields_restore_guard_clause_repair():
    """End-to-end: take the bundled field-robot model, ask the reviewer
    to propose hypotheses, run the checker, and verify that any
    confirmed remove_guard_clause hypothesis gets a generic restore
    repair when the template-driven path didn't produce one."""
    draft = draft_from_description(
        SpecDraftRequest(description="A field robot needs authorization.")
    )
    review = review_model(
        SpecReviewRequest(model=draft.model, properties=draft.properties)
    )
    resp = check_hypotheses(
        HypothesisCheckRequest(
            base_model=draft.model,
            properties=draft.properties,
            hypotheses=review.hypotheses,
            bound=10,
        )
    )
    # Every confirmed remove_guard_clause failure must come back with a
    # repair (either a hand-written strengthen_guard from the template,
    # or our synthesised restore_guard_clause).
    bad = []
    for r in resp.results:
        if (
            r.classification == "confirmed_failure"
            and r.hypothesis.mutation is not None
            and r.hypothesis.mutation.kind == "remove_guard_clause"
        ):
            regs = (r.diff.regressions if r.diff else []) or []
            for reg in regs:
                if reg.suggested_repair is None:
                    bad.append((r.hypothesis.id, reg.property))
    assert not bad, f"confirmed remove_guard_clause findings without a repair: {bad}"


def test_apply_restore_guard_clause_re_adds_predicate():
    model = ModelSpec(
        name="tiny",
        variables={
            "mode": VariableSpec(type="enum", values=["A", "B"], initial="A"),
            "ok": VariableSpec(type="bool", initial=True),
        },
        transitions=[
            TransitionSpec(
                name="go",
                # The clause `ok == true` has been removed by a mutation.
                guard="mode == A",
                updates={"mode": "B"},
            )
        ],
    )
    repair = RepairSpec(
        kind="restore_guard_clause",
        transition="go",
        add_predicate="ok == true",
        rationale="test",
    )
    patched = apply_repair(model, repair)
    guard = patched.transitions[0].guard
    assert "mode == A" in guard
    assert "ok == true" in guard


def test_restore_guard_clause_is_idempotent_when_already_present():
    model = ModelSpec(
        name="tiny",
        variables={
            "mode": VariableSpec(type="enum", values=["A", "B"], initial="A"),
            "ok": VariableSpec(type="bool", initial=True),
        },
        transitions=[
            TransitionSpec(
                name="go",
                guard="mode == A and ok == true",
                updates={"mode": "B"},
            )
        ],
    )
    repair = RepairSpec(
        kind="restore_guard_clause",
        transition="go",
        add_predicate="ok == true",
        rationale="test",
    )
    patched = apply_repair(copy.deepcopy(model), repair)
    # Guard should not gain a duplicate `ok == true`.
    assert patched.transitions[0].guard.count("ok == true") == 1
