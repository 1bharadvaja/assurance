import type {
  AssuranceDiffResponse,
  ModelSpec,
  PropertySpec,
  RepairSpec,
  ScenarioBundle,
  VerifyResponse,
} from "./types";

// In demo mode the frontend is shipped statically and reads pre-computed
// verifier responses from the bundled /canned directory. The live backend is
// still used when running locally with NEXT_PUBLIC_API_BASE pointed at it
// (or by simply running `uvicorn` on port 8000 with demo mode off).

function isDemoMode(): boolean {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEMO_MODE) {
    return process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
      process.env.NEXT_PUBLIC_DEMO_MODE === "1";
  }
  return false;
}

function basePath(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH) {
    return process.env.NEXT_PUBLIC_BASE_PATH;
  }
  return "";
}

function apiBase(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE;
  }
  return "http://localhost:8000";
}

async function fetchCanned<T>(name: string): Promise<T> {
  const url = `${basePath()}/canned/${name}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not load canned ${name}: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function postLive<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function getLive<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
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
  if (!isDemoMode()) {
    return postLive<VerifyResponse>("/api/verify", req);
  }
  // In demo mode we approximate /verify by reusing the bundled diff data.
  const diff = await fetchCanned<AssuranceDiffResponse>(
    `diff.${classifyModel(req.model)}.json`
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
  // Apply the strengthening locally: deep-clone and rewrite the named
  // transition's guard. Matches the backend's `apply_repair` semantics.
  const next: ModelSpec = JSON.parse(JSON.stringify(model));
  if (repair.kind !== "strengthen_guard") {
    throw new Error(`Unsupported repair kind in demo mode: ${repair.kind}`);
  }
  const t = next.transitions.find((tr) => tr.name === repair.transition);
  if (!t) throw new Error(`Transition not found: ${repair.transition}`);
  t.guard = repair.new_guard;
  return { model: next };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify the in-memory model so we know which canned response to return.
 * - "safe" — guard contains `human_authorized == true` and no extra clause
 * - "repaired" — guard contains the suffix we add during repair
 * - "regressed" — guard is the weakened version
 */
function classifyModel(model: ModelSpec): "safe" | "regressed" | "repaired" {
  const t = model.transitions.find((tr) => tr.name === "authorized_actuation");
  if (!t) return "safe";
  const g = t.guard;
  const hasAuth = /human_authorized\s*==\s*true/.test(g);
  if (!hasAuth) return "regressed";
  // Repair concatenates with parens: "(<old>) and human_authorized == true".
  if (g.trim().startsWith("(") && g.includes(") and human_authorized")) {
    return "repaired";
  }
  return "safe";
}
