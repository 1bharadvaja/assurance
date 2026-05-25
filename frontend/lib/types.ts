// Mirrors the backend pydantic models, kept loose so we can pass data through.

export type EnumValue = string;
export type BoolValue = boolean;
export type VarValue = EnumValue | BoolValue;

export interface VariableSpec {
  type: "enum" | "bool";
  values?: string[];
  initial: VarValue;
}

export interface TransitionSpec {
  name: string;
  guard: string;
  updates: Record<string, VarValue>;
  reactive?: boolean;
}

export interface ModelSpec {
  name: string;
  title?: string | null;
  description?: string | null;
  variables: Record<string, VariableSpec>;
  transitions: TransitionSpec[];
}

export type PropertyType = "invariant" | "bounded_response";

export interface PropertySpec {
  name: string;
  title?: string | null;
  description?: string | null;
  type: PropertyType;
  condition?: string | null;
  trigger?: string | null;
  response?: string | null;
  bound?: number | null;
}

export interface TraceStep {
  t: number;
  transition?: string;
  [variable: string]: VarValue | string | number | undefined;
}

export interface VerificationResult {
  property: string;
  title?: string | null;
  type: PropertyType;
  status: "pass" | "fail" | "timeout";
  bound: number;
  counterexample?: TraceStep[] | null;
  violation_time?: number | null;
  elapsed_ms?: number | null;
  note?: string | null;
}

export interface VerifySummary {
  passed: number;
  failed: number;
  timed_out?: number;
}

export interface VerifyResponse {
  results: VerificationResult[];
  summary: VerifySummary;
}

export interface RepairSpec {
  kind: "strengthen_guard";
  transition: string;
  add_predicate: string;
  new_guard: string;
  rationale: string;
}

export interface RegressionEntry {
  property: string;
  title?: string | null;
  counterexample: TraceStep[];
  culprit_transition?: {
    name: string;
    guard: string;
    updates: Record<string, VarValue>;
    reactive: boolean;
  } | null;
  explanation: string;
  suggested_repair?: RepairSpec | null;
}

export interface DiffSummary {
  preserved: number;
  regressions: number;
  fixed: number;
  existing_failures: number;
}

export interface AssuranceDiffResponse {
  summary: DiffSummary;
  results: VerificationResult[];
  regressions: RegressionEntry[];
}

export interface GraphNode {
  id: string;
  label: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  reactive: boolean;
}

export interface ScenarioBundle {
  id: string;
  name: string;
  title: string;
  description: string;
  safe_model: ModelSpec;
  regressed_model: ModelSpec;
  properties: PropertySpec[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

// --- Review Pipeline ---------------------------------------------------------

export interface ReviewLogItem {
  title: string;
  summary: string;
  evidence: string[];
  generated_artifact?: string | null;
}

export type MutationKind =
  | "remove_guard_clause"
  | "disable_transition"
  | "strengthen_or_weaken_guard";

export interface CandidateMutation {
  id: string;
  title: string;
  transition: string;
  kind: MutationKind;
  removed_clause?: string | null;
  new_guard?: string | null;
  mutated_model: ModelSpec;
}

export interface RiskHypothesis {
  id: string;
  title: string;
  summary: string;
  property?: PropertySpec | null;
  mutation?: CandidateMutation | null;
  rationale: string;
  expected_signal: string;
}

export type HealthSeverity = "pass" | "warning" | "error";
export type HealthClassification =
  | "checkable"
  | "checkable_with_warnings"
  | "blocked";

export interface HealthCheckItem {
  category: string;
  title: string;
  severity: HealthSeverity;
  message: string;
  suggested_fix?: string | null;
}

export interface HealthCoverage {
  requirements_mentioned: number;
  requirements_mapped: number;
  properties_generated: number;
  transitions_count: number;
  variables_count: number;
}

export interface HealthReport {
  classification: HealthClassification;
  items: HealthCheckItem[];
  coverage: HealthCoverage;
}

export interface SpecDraftResponse {
  model: ModelSpec;
  properties: PropertySpec[];
  assumptions: string[];
  review_log: ReviewLogItem[];
  used_llm: boolean;
  llm_model_name?: string | null;
  warnings: string[];
  health?: HealthReport | null;
}

export interface ClarifyRequest {
  description: string;
  health_items: HealthCheckItem[];
}

export interface ClarifyResponse {
  questions: string[];
  suggested_rewrite?: string | null;
  used_llm: boolean;
}

export interface SpecReviewResponse {
  review_log: ReviewLogItem[];
  hypotheses: RiskHypothesis[];
  used_llm: boolean;
  llm_model_name?: string | null;
  warnings: string[];
}

export type HypothesisClassification =
  | "confirmed_failure"
  | "no_counterexample"
  | "timeout"
  | "invalid";

export interface HypothesisCheckResult {
  hypothesis: RiskHypothesis;
  classification: HypothesisClassification;
  diff?: AssuranceDiffResponse | null;
  verify?: VerifyResponse | null;
  error?: string | null;
}

export interface HypothesisCheckResponse {
  results: HypothesisCheckResult[];
}
