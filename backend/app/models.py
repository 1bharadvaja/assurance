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


# ---------------------------------------------------------------------------
# Review Pipeline (AI draft + Z3 check)
#
# The pipeline endpoints take a plain-English system description, draft a
# state-machine model + safety checks, propose risk hypotheses, and hand the
# hypotheses to the existing Z3 verifier. The AI part is optional — if no
# OPENAI_API_KEY is set the backend falls back to deterministic heuristics
# for the bundled scenarios. The Z3 step is always real.
# ---------------------------------------------------------------------------


class ReviewLogItem(BaseModel):
    """One auditable observation in the review log.

    These are short externally-checkable rationale bullets, *not* raw
    chain-of-thought. The LLM prompt explicitly asks for evidence rather
    than private reasoning.
    """

    model_config = ConfigDict(extra="forbid")

    title: str
    summary: str
    evidence: List[str] = Field(default_factory=list)
    generated_artifact: Optional[str] = None


class CandidateMutation(BaseModel):
    """A specific local edit the reviewer wants the solver to check."""

    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    transition: str
    kind: Literal[
        "remove_guard_clause",
        "disable_transition",
        "strengthen_or_weaken_guard",
    ]
    removed_clause: Optional[str] = None
    new_guard: Optional[str] = None
    mutated_model: ModelSpec


class RiskHypothesis(BaseModel):
    """A reviewer-proposed unsafe behavior worth handing to the solver."""

    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    summary: str
    property: Optional[PropertySpec] = None
    mutation: Optional[CandidateMutation] = None
    rationale: str
    expected_signal: str


class SpecDraftRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=8000)
    domain_hint: Optional[str] = None


HealthSeverity = Literal["pass", "warning", "error"]
HealthClassification = Literal["checkable", "checkable_with_warnings", "blocked"]


class HealthCheckItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: str
    title: str
    severity: HealthSeverity
    message: str
    suggested_fix: Optional[str] = None


class HealthCoverage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirements_mentioned: int = 0
    requirements_mapped: int = 0
    properties_generated: int = 0
    transitions_count: int = 0
    variables_count: int = 0


class HealthReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    classification: HealthClassification
    items: List[HealthCheckItem] = Field(default_factory=list)
    coverage: HealthCoverage


class SpecDraftResponse(BaseModel):
    model: ModelSpec
    properties: List[PropertySpec] = Field(..., max_length=MAX_PROPERTIES)
    assumptions: List[str] = Field(default_factory=list)
    review_log: List[ReviewLogItem] = Field(default_factory=list)
    used_llm: bool = False
    # When `used_llm` is true, the OpenAI model name actually used. Surfaced
    # so the UI can label provenance honestly ("Drafted by LLM: gpt-4o").
    llm_model_name: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    health: Optional[HealthReport] = None


class SpecReviewRequest(BaseModel):
    model: ModelSpec
    properties: List[PropertySpec] = Field(..., max_length=MAX_PROPERTIES)
    description: Optional[str] = None


class SpecReviewResponse(BaseModel):
    review_log: List[ReviewLogItem] = Field(default_factory=list)
    hypotheses: List[RiskHypothesis] = Field(default_factory=list)
    used_llm: bool = False
    llm_model_name: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class HypothesisCheckRequest(BaseModel):
    base_model: ModelSpec
    properties: List[PropertySpec] = Field(..., max_length=MAX_PROPERTIES)
    hypotheses: List[RiskHypothesis] = Field(..., max_length=10)
    bound: int = Field(default=10, ge=1, le=MAX_BOUND)


class HypothesisCheckResult(BaseModel):
    hypothesis: RiskHypothesis
    classification: Literal[
        "confirmed_failure",
        "no_counterexample",
        "timeout",
        "invalid",
    ]
    diff: Optional[AssuranceDiffResponse] = None
    verify: Optional[VerifyResponse] = None
    error: Optional[str] = None


class HypothesisCheckResponse(BaseModel):
    results: List[HypothesisCheckResult] = Field(default_factory=list)


class ClarifyRequest(BaseModel):
    description: str = Field(..., min_length=0, max_length=8000)
    health_items: List[HealthCheckItem] = Field(default_factory=list)


class ClarifyResponse(BaseModel):
    questions: List[str] = Field(default_factory=list)
    suggested_rewrite: Optional[str] = None
    used_llm: bool = False
