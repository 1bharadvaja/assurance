"""FastAPI entrypoint for the Assurance Studio backend."""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

# Load backend/.env (if present) BEFORE anything reads env vars. The
# file is gitignored — see backend/.env.example for the supported keys.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # pragma: no cover — dotenv is in requirements but optional
    pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .diff import diff_results
from .examples import list_scenarios, load_scenario
from .guards import GuardSyntaxError
from .models import (
    MAX_BOUND,
    MAX_PROPERTIES,
    MAX_TRANSITIONS,
    ApplyRepairRequest,
    ApplyRepairResponse,
    AssuranceDiffRequest,
    AssuranceDiffResponse,
    ClarifyRequest,
    ClarifyResponse,
    HypothesisCheckRequest,
    HypothesisCheckResponse,
    SpecDraftRequest,
    SpecDraftResponse,
    SpecReviewRequest,
    SpecReviewResponse,
    VerifyRequest,
    VerifyResponse,
    VerifySummary,
)
from .parser import validate_model
from .repair import apply_repair
from .review_pipeline import (
    BlockedDraftError,
    check_hypotheses,
    clarify_description,
    draft_from_description,
    review_model,
)
from .verifier import Verifier


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(
    title="Assurance Studio",
    version="0.2.0",
    description=(
        "Bounded model checking for mission-critical autonomy. "
        "This service is intentionally small: it verifies finite "
        "state-machine models against invariant and bounded-response "
        "properties using Z3."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "limits": {
            "max_transitions": MAX_TRANSITIONS,
            "max_properties": MAX_PROPERTIES,
            "max_bound": MAX_BOUND,
        },
    }


@app.get("/api/scenarios")
def get_scenarios():
    return {"scenarios": list_scenarios()}


@app.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str):
    data = load_scenario(scenario_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id!r} not found.")
    return data


def _validate_or_raise(req_model) -> None:
    """Run our structural validators on the model payload and translate
    parser / guard errors into HTTP 400s instead of 500s."""
    try:
        validate_model(req_model)
    except GuardSyntaxError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid guard: {exc}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValidationError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
    _validate_or_raise(req.model)
    v = Verifier(req.model)
    results = [v.check_property(p, req.bound) for p in req.properties]
    summary = VerifySummary(
        passed=sum(1 for r in results if r.status == "pass"),
        failed=sum(1 for r in results if r.status == "fail"),
        timed_out=sum(1 for r in results if r.status == "timeout"),
    )
    return VerifyResponse(results=results, summary=summary)


@app.post("/api/assurance-diff", response_model=AssuranceDiffResponse)
def assurance_diff(req: AssuranceDiffRequest):
    _validate_or_raise(req.old_model)
    _validate_or_raise(req.new_model)
    old_v = Verifier(req.old_model)
    new_v = Verifier(req.new_model)
    old_results = [old_v.check_property(p, req.bound) for p in req.properties]
    new_results = [new_v.check_property(p, req.bound) for p in req.properties]
    summary, regressions = diff_results(
        old_results, new_results, req.properties, req.new_model
    )
    return AssuranceDiffResponse(
        summary=summary, results=new_results, regressions=regressions
    )


@app.post("/api/apply-repair", response_model=ApplyRepairResponse)
def apply_repair_endpoint(req: ApplyRepairRequest):
    _validate_or_raise(req.model)
    new_model = apply_repair(req.model, req.repair)
    _validate_or_raise(new_model)
    return ApplyRepairResponse(model=new_model)


# ---------------------------------------------------------------------------
# Review Pipeline
# ---------------------------------------------------------------------------


@app.post("/api/review-pipeline/draft", response_model=SpecDraftResponse)
def review_pipeline_draft(req: SpecDraftRequest):
    return draft_from_description(req)


@app.post("/api/review-pipeline/review", response_model=SpecReviewResponse)
def review_pipeline_review(req: SpecReviewRequest):
    _validate_or_raise(req.model)
    try:
        return review_model(req)
    except BlockedDraftError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "kind": "draft_blocked_by_health_check",
                "message": str(exc),
                "items": [i.model_dump() for i in exc.items],
            },
        )


@app.post("/api/review-pipeline/check", response_model=HypothesisCheckResponse)
def review_pipeline_check(req: HypothesisCheckRequest):
    _validate_or_raise(req.base_model)
    return check_hypotheses(req)


@app.post("/api/review-pipeline/clarify", response_model=ClarifyResponse)
def review_pipeline_clarify(req: ClarifyRequest):
    return clarify_description(req)
