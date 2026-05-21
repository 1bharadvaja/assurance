"""FastAPI entrypoint for the Assurance Studio backend."""

from __future__ import annotations

from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .diff import diff_results
from .examples import list_scenarios, load_scenario
from .models import (
    ApplyRepairRequest,
    ApplyRepairResponse,
    AssuranceDiffRequest,
    AssuranceDiffResponse,
    VerifyRequest,
    VerifyResponse,
    VerifySummary,
)
from .repair import apply_repair
from .verifier import Verifier


app = FastAPI(
    title="Assurance Studio",
    version="0.1.0",
    description="Bounded model checking for mission-critical autonomy.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/scenarios")
def get_scenarios():
    return {"scenarios": list_scenarios()}


@app.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str):
    data = load_scenario(scenario_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id!r} not found.")
    return data


@app.post("/api/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
    v = Verifier(req.model)
    results = [v.check_property(p, req.bound) for p in req.properties]
    summary = VerifySummary(
        passed=sum(1 for r in results if r.status == "pass"),
        failed=sum(1 for r in results if r.status == "fail"),
    )
    return VerifyResponse(results=results, summary=summary)


@app.post("/api/assurance-diff", response_model=AssuranceDiffResponse)
def assurance_diff(req: AssuranceDiffRequest):
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
    new_model = apply_repair(req.model, req.repair)
    return ApplyRepairResponse(model=new_model)
