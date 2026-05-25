"""Tests for the LLM-first drafting policy and the validation-driven
repair loop.

These tests mock ``_llm_draft`` and ``_llm_repair_draft`` at the
function level rather than the OpenAI SDK level — the OpenAI client is
called inside those helpers, and we want the tests to be deterministic
without a live API key.

The contract we're locking in:

- When a key IS configured and the LLM call succeeds with a clean
  draft, ``draft_source == "llm"`` and no template is touched.
- When the first LLM draft is blocked but the repair LLM produces a
  clean draft, ``draft_source == "llm_repaired"`` and
  ``repair_attempts == 1``.
- When repair retries are exhausted, ``draft_source == "blocked"`` and
  the draft is returned (so the UI can show the failing rows) but
  marked unsafe for review.
- When the LLM call throws, ``draft_source == "template_fallback"``
  and ``fallback_reason`` carries the truncated error.
- When no key is configured, ``draft_source == "deterministic_fallback"``.
- Template paths never claim LLM provenance.
"""

from __future__ import annotations

import pytest

from app.models import (
    ModelSpec,
    PropertySpec,
    SpecDraftRequest,
    SpecDraftResponse,
    TransitionSpec,
    VariableSpec,
)
from app import review_pipeline as rp


@pytest.fixture
def with_llm_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    yield


@pytest.fixture
def without_llm_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    yield


@pytest.fixture(autouse=True)
def _stub_phase1(monkeypatch):
    """Default Phase-1 stub: returns (None, None) so the drafter falls
    through to the legacy single-shot prompt. Individual tests that care
    about Phase 1 override this explicitly.

    This keeps the pre-two-phase tests valid: they only mock Phase 2 /
    repair and don't want a real network call from Phase 1.
    """
    monkeypatch.setattr(rp, "_llm_abstraction_plan", lambda req: (None, None))
    yield


def _clean_llm_draft() -> SpecDraftResponse:
    """A small, fully-modeled draft that will pass the health check.

    Intentionally NOT a copy of any deterministic template — it's a
    tiny dummy controller so a test failure points at the LLM-first
    routing rather than at a template being returned by accident."""
    return SpecDraftResponse(
        model=ModelSpec(
            name="dummy_llm_drafted",
            title="LLM-drafted dummy",
            variables={
                "mode": VariableSpec(
                    type="enum", values=["Idle", "Active"], initial="Idle"
                ),
                "armed": VariableSpec(type="bool", initial=False),
            },
            transitions=[
                TransitionSpec(
                    name="arm",
                    guard="armed == false",
                    updates={"armed": True},
                ),
                TransitionSpec(
                    name="activate",
                    guard="mode == Idle and armed == true",
                    updates={"mode": "Active"},
                ),
            ],
        ),
        properties=[
            PropertySpec(
                name="no_active_without_arming",
                type="invariant",
                condition="not (mode == Active and armed == false)",
            )
        ],
        assumptions=[],
        review_log=[],
        used_llm=True,
        llm_model_name="mock-frontier",
        warnings=[],
    )


def _under_modeled_llm_draft() -> SpecDraftResponse:
    """Mirrors the canonical LLM failure mode: declares a bool used
    positively but never sets it true (event_reachability warning is
    soft, so this is `checkable_with_warnings`)."""
    return SpecDraftResponse(
        model=ModelSpec(
            name="dummy_under_modeled",
            variables={
                "mode": VariableSpec(
                    type="enum", values=["Idle", "Active"], initial="Idle"
                ),
                "train_detected": VariableSpec(type="bool", initial=False),
            },
            transitions=[
                TransitionSpec(
                    name="activate",
                    guard="mode == Idle and train_detected == true",
                    updates={"mode": "Active"},
                ),
            ],
        ),
        properties=[],
        assumptions=[],
        review_log=[],
        used_llm=True,
        llm_model_name="mock-frontier",
        warnings=[],
    )


def _blocked_llm_draft() -> SpecDraftResponse:
    """Triggers a HARD error (enum-as-bool misuse) so the draft is
    classified ``blocked`` and the repair loop fires."""
    return SpecDraftResponse(
        model=ModelSpec(
            name="dummy_blocked",
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
        ),
        properties=[],
        assumptions=[],
        review_log=[],
        used_llm=True,
        llm_model_name="mock-frontier",
        warnings=[],
    )


# ---------------------------------------------------------------------------
# Happy path: clean first draft
# ---------------------------------------------------------------------------


def test_clean_llm_draft_is_labeled_llm(monkeypatch, with_llm_key):
    monkeypatch.setattr(
        rp, "_llm_draft", lambda req, **kw: (_clean_llm_draft(), None)
    )
    # If repair were ever called something is wrong — make it explode.
    monkeypatch.setattr(
        rp,
        "_llm_repair_draft",
        lambda *a, **kw: pytest.fail("repair must not run on a clean draft"),
    )
    resp = rp.draft_from_description(
        SpecDraftRequest(description="describe a small controller")
    )
    assert resp.draft_source == "llm"
    assert resp.repair_attempts == 0
    assert resp.fallback_reason is None
    assert resp.llm_model_name == "mock-frontier"
    assert resp.health is not None
    assert resp.health.classification != "blocked"


# ---------------------------------------------------------------------------
# Repair loop: blocked → clean
# ---------------------------------------------------------------------------


def test_blocked_then_repaired_is_labeled_llm_repaired(
    monkeypatch, with_llm_key
):
    monkeypatch.setattr(
        rp, "_llm_draft", lambda req, **kw: (_blocked_llm_draft(), None)
    )

    call_count = {"n": 0}

    def fake_repair(req, prior, errors, **kw):
        call_count["n"] += 1
        assert errors, "repair must be called with the failing items"
        return _clean_llm_draft(), None

    monkeypatch.setattr(rp, "_llm_repair_draft", fake_repair)

    resp = rp.draft_from_description(
        SpecDraftRequest(description="describe a small tank")
    )
    assert resp.draft_source == "llm_repaired"
    assert resp.repair_attempts == 1
    assert call_count["n"] == 1, "repair should have been called exactly once"
    assert resp.health is not None
    assert resp.health.classification != "blocked"


# ---------------------------------------------------------------------------
# Repair loop: blocked all the way through
# ---------------------------------------------------------------------------


def test_blocked_throughout_returns_blocked_source(monkeypatch, with_llm_key):
    monkeypatch.setattr(
        rp, "_llm_draft", lambda req, **kw: (_blocked_llm_draft(), None)
    )
    # Every repair attempt also returns a blocked draft.
    monkeypatch.setattr(
        rp,
        "_llm_repair_draft",
        lambda req, prior, errors, **kw: (_blocked_llm_draft(), None),
    )
    resp = rp.draft_from_description(
        SpecDraftRequest(description="describe something")
    )
    assert resp.draft_source == "blocked"
    assert resp.repair_attempts == rp._MAX_REPAIR_ATTEMPTS
    assert resp.health is not None
    assert resp.health.classification == "blocked"
    assert resp.fallback_reason is not None  # explanation for the user


def test_blocked_draft_cannot_be_reviewed(monkeypatch, with_llm_key):
    """End-to-end: a blocked draft must not advance to the review step."""
    monkeypatch.setattr(
        rp, "_llm_draft", lambda req, **kw: (_blocked_llm_draft(), None)
    )
    monkeypatch.setattr(
        rp,
        "_llm_repair_draft",
        lambda req, prior, errors, **kw: (_blocked_llm_draft(), None),
    )
    draft = rp.draft_from_description(
        SpecDraftRequest(description="describe something")
    )
    assert draft.draft_source == "blocked"

    from app.models import SpecReviewRequest

    with pytest.raises(rp.BlockedDraftError):
        rp.review_model(
            SpecReviewRequest(model=draft.model, properties=draft.properties)
        )


# ---------------------------------------------------------------------------
# Catastrophic LLM failure → template_fallback, NOT silently mislabelled
# ---------------------------------------------------------------------------


def test_catastrophic_llm_failure_uses_template_fallback(
    monkeypatch, with_llm_key
):
    monkeypatch.setattr(
        rp,
        "_llm_draft",
        lambda req, **kw: (None, "ConnectionError: network unreachable"),
    )
    monkeypatch.setattr(
        rp,
        "_llm_repair_draft",
        lambda *a, **kw: pytest.fail("repair must not run when initial call failed"),
    )
    resp = rp.draft_from_description(
        SpecDraftRequest(description="describe a small controller")
    )
    assert resp.draft_source == "template_fallback"
    assert resp.repair_attempts == 0
    assert resp.fallback_reason and "network unreachable" in resp.fallback_reason


# ---------------------------------------------------------------------------
# No LLM key → deterministic_fallback (and only this path)
# ---------------------------------------------------------------------------


def test_no_llm_key_uses_deterministic_fallback(monkeypatch, without_llm_key):
    monkeypatch.setattr(
        rp,
        "_llm_draft",
        lambda req: pytest.fail("_llm_draft must not run without a key"),
    )
    resp = rp.draft_from_description(
        SpecDraftRequest(description="describe a small controller")
    )
    assert resp.draft_source == "deterministic_fallback"
    assert resp.used_llm is False
    assert resp.llm_model_name is None


# ---------------------------------------------------------------------------
# The railway crossing prompt must NOT route to the railway template when
# the LLM is available — that was the exact regression the user flagged.
# ---------------------------------------------------------------------------


_RAILWAY_PROMPT = (
    "A railway crossing controller has modes Idle, Warning, "
    "LoweringGate, GateDown, TrainPassing, RaisingGate, and Fault. "
    "A train must not enter TrainPassing unless the gate is fully down "
    "and the warning lights are active."
)


def test_railway_prompt_with_llm_does_not_use_template(
    monkeypatch, with_llm_key
):
    """The whole point of Review Pipeline: with an LLM key, every
    description goes through the LLM. A railway prompt must NOT silently
    return the bundled `railway_crossing` template."""
    monkeypatch.setattr(
        rp, "_llm_draft", lambda req, **kw: (_clean_llm_draft(), None)
    )
    monkeypatch.setattr(
        rp,
        "_llm_repair_draft",
        lambda *a, **kw: pytest.fail("repair must not run on a clean draft"),
    )
    resp = rp.draft_from_description(SpecDraftRequest(description=_RAILWAY_PROMPT))
    assert resp.draft_source == "llm"
    assert resp.model.name == "dummy_llm_drafted"
    assert resp.model.name != "railway_crossing"


def test_railway_prompt_without_llm_can_use_railway_template(
    without_llm_key,
):
    """The deterministic fallback IS allowed to keyword-route — that's
    its job. Confirms the no-LLM path still produces the railway template,
    and labels it as a fallback (never as LLM output)."""
    resp = rp.draft_from_description(SpecDraftRequest(description=_RAILWAY_PROMPT))
    assert resp.draft_source == "deterministic_fallback"
    assert resp.model.name == "railway_crossing"
    assert resp.used_llm is False
