import type {
  AbstractionPlan,
  AssuranceDiffResponse,
  ClarifyRequest,
  ClarifyResponse,
  HealthCheckItem,
  HypothesisCheckResponse,
  ModelSpec,
  PropertySpec,
  RepairSpec,
  RiskHypothesis,
  ScenarioBundle,
  SpecDraftResponse,
  SpecReviewResponse,
  VerifyResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Modes
//
// The frontend can run in two modes:
//
//   - DEMO (NEXT_PUBLIC_DEMO_MODE=true): all API calls are answered from
//     pre-computed JSON snapshots under /canned. Used for the static
//     GitHub Pages build of the Guided Review.
//
//   - LIVE: API calls hit the FastAPI backend at NEXT_PUBLIC_API_BASE
//     (default http://localhost:8000). The Playground requires this mode.
//
// We never silently "fall back" from one to the other — if a live call
// fails the UI is told so honestly.
// ---------------------------------------------------------------------------

export function isDemoMode(): boolean {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEMO_MODE) {
    return (
      process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
      process.env.NEXT_PUBLIC_DEMO_MODE === "1"
    );
  }
  return false;
}

export function apiBase(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE;
  }
  return "http://localhost:8000";
}

function staticBasePath(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH) {
    return process.env.NEXT_PUBLIC_BASE_PATH;
  }
  return "";
}

export class BackendError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

/**
 * Thrown when the backend rejects a review request because the draft
 * failed the model health check. Carries the structured error items so
 * the UI can render the same rows it showed in Stage 2.
 */
export class DraftBlockedError extends BackendError {
  readonly items: HealthCheckItem[];
  constructor(message: string, items: HealthCheckItem[]) {
    super(message, 400);
    this.name = "DraftBlockedError";
    this.items = items;
  }
}

async function fetchCanned<T>(name: string): Promise<T> {
  const url = `${staticBasePath()}/canned/${name}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new BackendError(`Could not load canned ${name}: ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

async function getLive<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, { cache: "no-store" });
  } catch (err) {
    throw new BackendError(
      `Verifier backend unreachable at ${apiBase()} (${(err as Error).message}).`
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BackendError(
      `${path} failed: HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      res.status
    );
  }
  return (await res.json()) as T;
}

async function postLive<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new BackendError(
      `Verifier backend unreachable at ${apiBase()} (${(err as Error).message}).`
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // FastAPI surfaces structured 400s as { detail: { kind, message, items } }.
    // The review endpoint uses kind=draft_blocked_by_health_check to signal
    // that the model failed validation; surface that as a typed error so the
    // UI can rerender the failing items inline instead of as a wall of text.
    if (res.status === 400 && text) {
      try {
        const parsed = JSON.parse(text);
        const detail = parsed?.detail;
        if (
          detail &&
          typeof detail === "object" &&
          detail.kind === "draft_blocked_by_health_check"
        ) {
          throw new DraftBlockedError(
            detail.message || "Draft blocked by validation.",
            (detail.items ?? []) as HealthCheckItem[]
          );
        }
      } catch (parseErr) {
        if (parseErr instanceof DraftBlockedError) throw parseErr;
        // fall through to generic BackendError
      }
    }
    throw new BackendError(
      `${path} failed: HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      res.status
    );
  }
  return (await res.json()) as T;
}

/**
 * Lightweight reachability probe used by the backend-status badge.
 * Always live — returns false in demo mode (no backend is expected).
 */
export async function pingBackend(): Promise<boolean> {
  if (isDemoMode()) return false;
  try {
    const res = await fetch(`${apiBase()}/api/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getScenario(id: string): Promise<ScenarioBundle> {
  if (isDemoMode()) return fetchCanned<ScenarioBundle>(`scenarios.${id}.json`);
  return getLive<ScenarioBundle>(`/api/scenarios/${id}`);
}

export interface VerifyRequest {
  model: ModelSpec;
  properties: PropertySpec[];
  bound: number;
}

export async function verify(req: VerifyRequest): Promise<VerifyResponse> {
  if (!isDemoMode()) return postLive<VerifyResponse>("/api/verify", req);
  const diff = await fetchCanned<AssuranceDiffResponse>(
    `diff.mission-controller.${classifyModel(req.model)}.json`
  );
  const passed = diff.results.filter((r) => r.status === "pass").length;
  const failed = diff.results.filter((r) => r.status === "fail").length;
  return { results: diff.results, summary: { passed, failed } };
}

export interface AssuranceDiffRequest {
  old_model: ModelSpec;
  new_model: ModelSpec;
  properties: PropertySpec[];
  bound: number;
}

export async function assuranceDiff(
  req: AssuranceDiffRequest
): Promise<AssuranceDiffResponse> {
  if (!isDemoMode()) {
    return postLive<AssuranceDiffResponse>("/api/assurance-diff", req);
  }
  return fetchCanned<AssuranceDiffResponse>(
    `diff.mission-controller.${classifyModel(req.new_model)}.json`
  );
}

export async function applyRepair(
  model: ModelSpec,
  repair: RepairSpec
): Promise<{ model: ModelSpec }> {
  if (!isDemoMode()) {
    return postLive<{ model: ModelSpec }>("/api/apply-repair", {
      model,
      repair,
    });
  }
  // In demo mode we apply the strengthening client-side so the static
  // build can complete the story without a backend.
  const next: ModelSpec = JSON.parse(JSON.stringify(model));
  if (repair.kind !== "strengthen_guard") {
    throw new BackendError(`Unsupported repair kind in demo mode: ${repair.kind}`);
  }
  const t = next.transitions.find((tr) => tr.name === repair.transition);
  if (!t) throw new BackendError(`Transition not found: ${repair.transition}`);
  t.guard = repair.new_guard;
  return { model: next };
}

// ---------------------------------------------------------------------------
// Review Pipeline
// ---------------------------------------------------------------------------

export interface SpecDraftRequest {
  description: string;
  domain_hint?: string;
}

export function draftSpec(req: SpecDraftRequest): Promise<SpecDraftResponse> {
  if (isDemoMode()) {
    throw new BackendError(
      "Review Pipeline requires the live verifier backend. The static demo is read-only."
    );
  }
  return postLive<SpecDraftResponse>("/api/review-pipeline/draft", req);
}

export interface SpecReviewRequest {
  model: ModelSpec;
  properties: PropertySpec[];
  description?: string;
  /** Round-tripped from the draft response so the reviewer can ground
   * hypotheses in the original abstraction. Optional for templates. */
  abstraction_plan?: AbstractionPlan | null;
}

export function reviewSpec(req: SpecReviewRequest): Promise<SpecReviewResponse> {
  if (isDemoMode()) {
    throw new BackendError(
      "Review Pipeline requires the live verifier backend."
    );
  }
  return postLive<SpecReviewResponse>("/api/review-pipeline/review", req);
}

export interface HypothesisCheckRequest {
  base_model: ModelSpec;
  properties: PropertySpec[];
  hypotheses: RiskHypothesis[];
  bound: number;
}

export function checkHypotheses(
  req: HypothesisCheckRequest
): Promise<HypothesisCheckResponse> {
  if (isDemoMode()) {
    throw new BackendError(
      "Review Pipeline requires the live verifier backend."
    );
  }
  return postLive<HypothesisCheckResponse>("/api/review-pipeline/check", req);
}

export function clarifyDescription(
  req: ClarifyRequest
): Promise<ClarifyResponse> {
  if (isDemoMode()) {
    throw new BackendError(
      "Clarification requires the live verifier backend."
    );
  }
  return postLive<ClarifyResponse>("/api/review-pipeline/clarify", req);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a model relative to the bundled safe baseline so we know which
 * pre-computed snapshot to return in demo mode. The bundled snapshots only
 * cover the three "headline" states: safe baseline, regressed actuation
 * guard, and the post-repair model.
 */
function classifyModel(model: ModelSpec): "safe" | "regressed" | "repaired" {
  const t = model.transitions.find((tr) => tr.name === "authorized_actuation");
  if (!t) return "safe";
  const g = t.guard;
  const hasAuth = /human_authorized\s*==\s*true/.test(g);
  if (!hasAuth) return "regressed";
  if (g.trim().startsWith("(") && g.includes(") and human_authorized")) {
    return "repaired";
  }
  return "safe";
}
