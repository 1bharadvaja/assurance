"""Pydantic data models for Assurance Studio."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ----- Public-facing limits --------------------------------------------------
#
# These exist mainly to keep the deployed backend's solver workload bounded.
# They are intentionally generous — every bundled scenario is well inside them
# — but tight enough that a hostile request can't pin the SMT solver.
MAX_VARIABLES = 12
MAX_ENUM_VALUES = 12
MAX_TRANSITIONS = 40
MAX_PROPERTIES = 20
MAX_BOUND = 20


class VariableSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["enum", "bool"]
    values: Optional[List[str]] = None
    initial: Union[str, bool]

    @field_validator("values")
    @classmethod
    def _check_values_size(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None and len(v) > MAX_ENUM_VALUES:
            raise ValueError(
                f"Too many enum values ({len(v)}); the public demo allows at most "
                f"{MAX_ENUM_VALUES} per variable."
            )
        return v


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

    @field_validator("variables")
    @classmethod
    def _check_var_count(
        cls, v: Dict[str, "VariableSpec"]
    ) -> Dict[str, "VariableSpec"]:
        if len(v) > MAX_VARIABLES:
            raise ValueError(
                f"Too many variables ({len(v)}); the public demo allows at most "
                f"{MAX_VARIABLES}."
            )
        return v

    @field_validator("transitions")
    @classmethod
    def _check_trans_count(
        cls, v: List["TransitionSpec"]
    ) -> List["TransitionSpec"]:
        if len(v) > MAX_TRANSITIONS:
            raise ValueError(
                f"Too many transitions ({len(v)}); the public demo allows at most "
                f"{MAX_TRANSITIONS}."
            )
        return v


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
    # ``timeout`` means the solver gave up before deciding. We do not silently
    # fold it into pass or fail — the UI surfaces it as a distinct outcome.
    status: Literal["pass", "fail", "timeout"]
    bound: int
    counterexample: Optional[List[Dict[str, Any]]] = None
    violation_time: Optional[int] = None
    elapsed_ms: Optional[float] = None
    note: Optional[str] = None


class VerifyRequest(BaseModel):
    model: ModelSpec
    properties: List[PropertySpec] = Field(..., max_length=MAX_PROPERTIES)
    bound: int = Field(default=8, ge=1, le=MAX_BOUND)


class VerifySummary(BaseModel):
    passed: int
    failed: int
    timed_out: int = 0


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
    properties: List[PropertySpec] = Field(..., max_length=MAX_PROPERTIES)
    bound: int = Field(default=8, ge=1, le=MAX_BOUND)


class AssuranceDiffResponse(BaseModel):
    summary: DiffSummary
    results: List[VerificationResult]
    regressions: List[RegressionEntry]


class ApplyRepairRequest(BaseModel):
    model: ModelSpec
    repair: RepairSpec


class ApplyRepairResponse(BaseModel):
    model: ModelSpec
