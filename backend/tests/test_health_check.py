"""Tests for the model health check and the review gate that uses it."""

import pytest
from fastapi.testclient import TestClient

from app.health_check import run_health_check
from app.main import app
from app.models import (
    ClarifyRequest,
    HealthCheckItem,
    ModelSpec,
    PropertySpec,
    SpecDraftRequest,
    SpecReviewRequest,
    TransitionSpec,
    VariableSpec,
)
from app.parser import load_model, load_properties
from app.examples import EXAMPLES_DIR
from app.review_pipeline import (
    BlockedDraftError,
    clarify_description,
    draft_from_description,
    review_model,
)


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


def _safe_baseline():
    return load_model(EXAMPLES_DIR / "mission-controller" / "safe.yaml")


# --- Health check unit tests ---------------------------------------------


def test_safe_baseline_is_checkable():
    """The bundled safe baseline must pass cleanly."""
    model = _safe_baseline()
    properties = []
    report = run_health_check(model, properties, "a field robot description")
    assert report.classification in ("checkable", "checkable_with_warnings")
    errors = [i for i in report.items if i.severity == "error"]
    assert errors == []


def test_filling_equals_false_is_blocked_as_enum_bool_misuse():
    """`Filling == false` where Filling is a mode value (not a bool variable)
    must produce an error and block review."""
    model = ModelSpec(
        name="tank",
        variables={
            "mode": VariableSpec(
                type="enum",
                values=["Idle", "Filling", "Draining"],
                initial="Idle",
            ),
        },
        transitions=[
            TransitionSpec(
                name="start_fill",
                guard="mode == Idle and Filling == false",
                updates={"mode": "Filling"},
            ),
        ],
    )
    report = run_health_check(model, [], "")
    assert report.classification == "blocked"
    cats = {i.category for i in report.items if i.severity == "error"}
    assert "enum_bool_misuse" in cats


def test_vacuous_mode_conjunction_is_warning_not_error():
    model = _safe_baseline()
    bad = PropertySpec(
        name="vacuous",
        type="invariant",
        condition="not (mode == Draining and mode == Filling)",
    )
    report = run_health_check(model, [bad], "")
    cats_by_sev = {
        "warning": {i.category for i in report.items if i.severity == "warning"},
        "error": {i.category for i in report.items if i.severity == "error"},
    }
    # The vacuous lint must be surfaced as a warning, never an error.
    assert "vacuous_properties" in cats_by_sev["warning"]
    assert "vacuous_properties" not in cats_by_sev["error"]


def test_empty_guard_is_hard_error():
    model = ModelSpec(
        name="tank",
        variables={
            "mode": VariableSpec(type="enum", values=["A", "B"], initial="A"),
        },
        transitions=[
            TransitionSpec(name="bad", guard=" ", updates={"mode": "B"}),
        ],
    )
    report = run_health_check(model, [], "")
    assert report.classification == "blocked"
    # 'transition_effects' or 'guard_syntax' both acceptable; we accept either
    err_cats = {i.category for i in report.items if i.severity == "error"}
    assert err_cats & {"transition_effects", "guard_syntax"}


def test_missing_variable_reference_is_hard_error():
    model = ModelSpec(
        name="tank",
        variables={
            "mode": VariableSpec(type="enum", values=["A", "B"], initial="A"),
        },
        transitions=[
            TransitionSpec(
                name="bad",
                guard="undeclared_var == true",
                updates={"mode": "B"},
            ),
        ],
    )
    report = run_health_check(model, [], "")
    err_cats = {i.category for i in report.items if i.severity == "error"}
    assert "referenced_symbols" in err_cats


def test_review_endpoint_rejects_blocked_draft():
    model = ModelSpec(
        name="tank",
        variables={
            "mode": VariableSpec(
                type="enum", values=["Idle", "Filling"], initial="Idle"
            ),
        },
        transitions=[
            TransitionSpec(
                name="start_fill",
                guard="mode == Idle and Filling == false",
                updates={"mode": "Filling"},
            ),
        ],
    )
    with pytest.raises(BlockedDraftError) as exc:
        review_model(SpecReviewRequest(model=model, properties=[]))
    assert exc.value.items, "BlockedDraftError should carry the failing items"


def test_draft_includes_health_report():
    """A normal deterministic draft must come back with a health report."""
    desc = (
        "A field robot has modes Idle, Armed, Mission, DegradedComms, "
        "Recovery, EmergencyStop, and Actuate. It should only actuate if a "
        "human operator approved the action and sensors agree. If battery "
        "is low, it should enter Recovery or EmergencyStop."
    )
    resp = draft_from_description(SpecDraftRequest(description=desc))
    assert resp.health is not None
    assert resp.health.classification != "blocked"
    assert resp.health.coverage.transitions_count > 0


# --- Clarify -------------------------------------------------------------


def test_clarify_returns_questions_for_vague_input():
    resp = clarify_description(
        ClarifyRequest(description="make it safe", health_items=[])
    )
    assert resp.used_llm is False
    assert 2 <= len(resp.questions) <= 4
    # Questions should be specific (mention modes, recovery, or a rule
    # keyword), not generic "what do you mean?".
    blob = " ".join(resp.questions).lower()
    assert any(k in blob for k in ("mode", "recovery", "must", "never", "shutdown"))


def test_clarify_works_with_health_errors():
    err = HealthCheckItem(
        category="enum_bool_misuse",
        title="Enum / boolean misuse",
        severity="error",
        message="Filling == false treats enum value Filling as a bool.",
    )
    resp = clarify_description(
        ClarifyRequest(description="filling", health_items=[err])
    )
    assert len(resp.questions) >= 1


# --- Extra checks per spec ----------------------------------------------


def test_mixed_and_or_is_warning_not_error():
    """Mixed `and` / `or` without parentheses should warn, not block."""
    model = _safe_baseline()
    bad = PropertySpec(
        name="ambiguous",
        type="invariant",
        condition="mode == Mission and comms == OK or human_authorized == false",
    )
    report = run_health_check(model, [bad], "")
    err_cats = {i.category for i in report.items if i.severity == "error"}
    warn_cats = {i.category for i in report.items if i.severity == "warning"}
    assert "mixed_and_or" not in err_cats
    assert "mixed_and_or" in warn_cats
    # And the overall classification must not be `blocked` just because
    # of a paren ambiguity.
    assert report.classification != "blocked"


def test_bundled_mission_controller_passes_health_check():
    """The bundled mission-controller example is the golden reference. It
    must pass the health check with no hard errors so demos stay clean."""
    model = load_model(EXAMPLES_DIR / "mission-controller" / "safe.yaml")
    properties = load_properties(
        EXAMPLES_DIR / "mission-controller" / "properties.yaml"
    )
    report = run_health_check(model, properties, "")
    errors = [i for i in report.items if i.severity == "error"]
    assert errors == [], f"Bundled example produced errors: {errors}"
    assert report.classification != "blocked"


def test_event_reachability_warns_on_positive_use_without_setter():
    """Bool initialized false, used as `==true`, and no transition ever sets
    it true. The downstream check would be vacuous because the trigger state
    is unreachable from the initial state."""
    model = ModelSpec(
        name="under_modeled",
        variables={
            "mode": VariableSpec(type="enum", values=["Idle", "Go"], initial="Idle"),
            "train_detected": VariableSpec(type="bool", initial=False),
        },
        transitions=[
            TransitionSpec(
                name="go",
                guard="mode == Idle and train_detected == true",
                updates={"mode": "Go"},
            ),
        ],
    )
    report = run_health_check(model, [], "")
    cats = {
        (i.category, i.severity) for i in report.items if i.severity != "pass"
    }
    assert ("event_reachability", "warning") in cats
    # Soft, not blocking — this should still be `checkable_with_warnings`.
    assert report.classification == "checkable_with_warnings"


def test_event_reachability_clean_when_setter_present():
    """Same shape but with an environment transition that flips the bool."""
    model = ModelSpec(
        name="well_modeled",
        variables={
            "mode": VariableSpec(type="enum", values=["Idle", "Go"], initial="Idle"),
            "train_detected": VariableSpec(type="bool", initial=False),
        },
        transitions=[
            TransitionSpec(
                name="detect",
                guard="train_detected == false",
                updates={"train_detected": True},
            ),
            TransitionSpec(
                name="go",
                guard="mode == Idle and train_detected == true",
                updates={"mode": "Go"},
            ),
        ],
    )
    report = run_health_check(model, [], "")
    err_or_warn = {
        i.category for i in report.items if i.severity in ("warning", "error")
    }
    assert "event_reachability" not in err_or_warn


def test_event_reachability_warns_on_negative_use_without_clearer():
    """Bool initialized true, checked as `==false`, but nothing ever flips
    it back to false. The check that depends on it can never be triggered."""
    model = ModelSpec(
        name="sticky_true",
        variables={
            "mode": VariableSpec(type="enum", values=["Idle", "Alarm"], initial="Idle"),
            "lid_locked": VariableSpec(type="bool", initial=True),
        },
        transitions=[
            TransitionSpec(
                name="alarm",
                guard="mode == Idle and lid_locked == false",
                updates={"mode": "Alarm"},
            ),
        ],
    )
    report = run_health_check(model, [], "")
    cats = {
        (i.category, i.severity) for i in report.items if i.severity != "pass"
    }
    assert ("event_reachability", "warning") in cats


def test_railway_template_passes_health_check_cleanly():
    """The bundled railway-crossing deterministic template must be fully
    checkable — no event-reachability warnings and no errors."""
    from app.review_pipeline import _railway_crossing_draft

    model, properties, _, _ = _railway_crossing_draft()
    report = run_health_check(model, properties, "")
    errors = [i for i in report.items if i.severity == "error"]
    warnings = [i for i in report.items if i.severity == "warning"]
    assert errors == [], f"railway template has errors: {errors}"
    cats = {w.category for w in warnings}
    assert "event_reachability" not in cats, (
        f"railway template still has event-reachability warnings: {warnings}"
    )


def test_railway_reviewer_proposes_key_train_passing_mutations():
    """The deterministic reviewer (which mirrors the LLM reviewer's intent)
    must propose at least one of the three `enter_train_passing`
    weakenings the demo relies on."""
    from app.review_pipeline import _railway_crossing_draft, review_model

    model, properties, _, _ = _railway_crossing_draft()
    resp = review_model(
        SpecReviewRequest(model=model, properties=properties)
    )
    target_clauses = {
        "gate_fully_down == true",
        "warning_lights_active == true",
        "gate_sensor_fault == false",
    }
    seen = {
        " ".join((h.mutation.removed_clause or "").split())
        for h in resp.hypotheses
        if h.mutation
        and h.mutation.kind == "remove_guard_clause"
        and h.mutation.transition == "enter_train_passing"
    }
    assert target_clauses & seen, (
        "Reviewer should propose at least one of "
        f"{target_clauses}; got: {seen}"
    )


def test_review_endpoint_returns_structured_400_for_blocked_draft():
    """The HTTP endpoint must surface blocked drafts with kind=
    `draft_blocked_by_health_check` and an `items` list, so the frontend
    can render the failing rows inline rather than as a wall of text."""
    client = TestClient(app)
    body = {
        "model": {
            "name": "tank",
            "variables": {
                "mode": {
                    "type": "enum",
                    "values": ["Idle", "Filling"],
                    "initial": "Idle",
                },
            },
            "transitions": [
                {
                    "name": "start_fill",
                    "guard": "mode == Idle and Filling == false",
                    "updates": {"mode": "Filling"},
                },
            ],
        },
        "properties": [],
    }
    res = client.post("/api/review-pipeline/review", json=body)
    assert res.status_code == 400, res.text
    detail = res.json()["detail"]
    assert detail["kind"] == "draft_blocked_by_health_check"
    assert isinstance(detail["items"], list) and len(detail["items"]) >= 1
    cats = {i["category"] for i in detail["items"]}
    assert "enum_bool_misuse" in cats
