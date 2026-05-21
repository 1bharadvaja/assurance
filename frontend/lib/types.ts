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
  status: "pass" | "fail";
  bound: number;
  counterexample?: TraceStep[] | null;
  violation_time?: number | null;
  elapsed_ms?: number | null;
}

export interface VerifySummary {
  passed: number;
  failed: number;
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
