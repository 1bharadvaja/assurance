"""End-to-end tests for the Review Pipeline deterministic fallback path.

These exercise: draft → review → hypothesis check, asserting that the
solver confirms the canonical 'remove human_authorized' hypothesis as a
real counterexample. They do not require an OpenAI key.
"""

import os

import pytest

from app.models import (
    HypothesisCheckRequest,
    SpecDraftRequest,
    SpecReviewRequest,
)
from app.review_pipeline import (
    check_hypotheses,
    draft_from_description,
    review_model,
)


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    """All tests in this file run the deterministic path."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


DEFAULT_DESCRIPTION = (
    "A field robot has modes Idle, Armed, Mission, DegradedComms, Recovery, "
    "EmergencyStop, and Actuate. Actuate means the robot performs an "
    "irreversible command. The robot may lose communications during a "
    "mission. It should only actuate if a human operator approved the "
    "action and sensors agree. If battery is low, it should enter Recovery "
    "or EmergencyStop."
)


def test_draft_field_robot_has_seven_modes_and_actuate_guard():
    resp = draft_from_description(SpecDraftRequest(description=DEFAULT_DESCRIPTION))
    assert resp.used_llm is False
    mode = resp.model.variables["mode"]
    assert mode.type == "enum"
    assert set(mode.values) == {
        "Idle",
        "Armed",
        "Mission",
        "DegradedComms",
        "Recovery",
        "EmergencyStop",
        "Actuate",
    }
    # The drafted authorized_actuation guard mentions human_authorized.
    actuation = next(t for t in resp.model.transitions if t.name == "authorized_actuation")
    assert "human_authorized == true" in actuation.guard
    # And we get the headline safety property.
    titles = [p.name for p in resp.properties]
    assert "no_actuate_without_authority" in titles
    # And at least one review log item explaining the actuate identification.
    assert any("Actuate" in item.summary or "Actuate" in item.title for item in resp.review_log)


def test_review_proposes_remove_human_authorization_hypothesis():
    draft = draft_from_description(SpecDraftRequest(description=DEFAULT_DESCRIPTION))
    review = review_model(
        SpecReviewRequest(model=draft.model, properties=draft.properties)
    )
    assert review.used_llm is False
    assert review.hypotheses, "Reviewer should propose at least one hypothesis."
    # At least one hypothesis removes human_authorized from authorized_actuation.
    targeted = [
        h
        for h in review.hypotheses
        if h.mutation is not None
        and h.mutation.transition == "authorized_actuation"
        and (h.mutation.removed_clause or "").strip() == "human_authorized == true"
    ]
    assert targeted, "Should propose removing `human_authorized == true` from authorized_actuation."


def test_hypothesis_check_confirms_the_human_authorization_finding():
    draft = draft_from_description(SpecDraftRequest(description=DEFAULT_DESCRIPTION))
    review = review_model(
        SpecReviewRequest(model=draft.model, properties=draft.properties)
    )
    check_req = HypothesisCheckRequest(
        base_model=draft.model,
        properties=draft.properties,
        hypotheses=review.hypotheses,
        bound=10,
    )
    results = check_hypotheses(check_req)
    assert results.results, "Should have at least one hypothesis result."
    # The remove-human-authorized mutation should be confirmed as a failure.
    confirmed = [
        r
        for r in results.results
        if r.hypothesis.mutation is not None
        and r.hypothesis.mutation.transition == "authorized_actuation"
        and (r.hypothesis.mutation.removed_clause or "").strip() == "human_authorized == true"
    ]
    assert confirmed, "Did not produce a result for the human-authorization hypothesis."
    target = confirmed[0]
    assert target.classification == "confirmed_failure"
    assert target.diff is not None
    assert target.diff.regressions, "Diff should contain at least one regression."


def test_warehouse_robot_description_uses_warehouse_fallback():
    desc = (
        "A warehouse robot has modes Idle, Moving, Loading, and EmergencyStop. "
        "It should not move near a human without a supervisor override and "
        "must not load while sensors disagree."
    )
    draft = draft_from_description(SpecDraftRequest(description=desc))
    mode = draft.model.variables["mode"]
    assert set(mode.values) == {"Idle", "Moving", "Loading", "EmergencyStop"}
    assert "supervisor_override" in draft.model.variables
