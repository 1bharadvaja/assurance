"""Pydantic data models for Assurance Studio."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class VariableSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["enum", "bool"]
    values: Optional[List[str]] = None
    initial: Union[str, bool]


class TransitionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    guard: str
    updates: Dict[str, Union[str, bool]] = Field(default_factory=dict)
    reactive: bool = False


class ModelSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    title: Optional[str] = None
    description: Optional[str] = None
    variables: Dict[str, VariableSpec]
    transitions: List[TransitionSpec]


class PropertySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    title: Optional[str] = None
    description: Optional[str] = None
    type: Literal["invariant", "bounded_response"]
    condition: Optional[str] = None
    trigger: Optional[str] = None
    response: Optional[str] = None
    bound: Optional[int] = None


class TraceStep(BaseModel):
    t: int
    values: Dict[str, Union[str, bool]]
    transition: Optional[str] = None


class VerificationResult(BaseModel):
    property: str
    title: Optional[str] = None
    type: Literal["invariant", "bounded_response"]
    status: Literal["pass", "fail"]
    bound: int
    counterexample: Optional[List[Dict[str, Any]]] = None
    violation_time: Optional[int] = None
    elapsed_ms: Optional[float] = None


class VerifyRequest(BaseModel):
    model: ModelSpec
    properties: List[PropertySpec]
    bound: int = 8


class VerifySummary(BaseModel):
    passed: int
    failed: int


class VerifyResponse(BaseModel):
    results: List[VerificationResult]
    summary: VerifySummary


class RepairSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["strengthen_guard"]
    transition: str
    add_predicate: str
    new_guard: str
    rationale: str


class RegressionEntry(BaseModel):
    property: str
    title: Optional[str] = None
    counterexample: List[Dict[str, Any]]
    culprit_transition: Optional[Dict[str, Any]] = None
    explanation: str
    suggested_repair: Optional[RepairSpec] = None


class DiffSummary(BaseModel):
    preserved: int
    regressions: int
    fixed: int
    existing_failures: int


class AssuranceDiffRequest(BaseModel):
    old_model: ModelSpec
    new_model: ModelSpec
    properties: List[PropertySpec]
    bound: int = 8


class AssuranceDiffResponse(BaseModel):
    summary: DiffSummary
    results: List[VerificationResult]
    regressions: List[RegressionEntry]


class ApplyRepairRequest(BaseModel):
    model: ModelSpec
    repair: RepairSpec


class ApplyRepairResponse(BaseModel):
    model: ModelSpec
