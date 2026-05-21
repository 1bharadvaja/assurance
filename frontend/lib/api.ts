import type {
  AssuranceDiffResponse,
  ModelSpec,
  PropertySpec,
  RepairSpec,
  ScenarioBundle,
  VerifyResponse,
} from "./types";

const DEFAULT_API_BASE = "http://localhost:8000";

export function apiBase(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE;
  }
  return DEFAULT_API_BASE;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `API ${path} failed: ${res.status} ${res.statusText}: ${body}`
    );
  }
  return (await res.json()) as T;
}

export function getScenario(id: string): Promise<ScenarioBundle> {
  return request<ScenarioBundle>(`/api/scenarios/${id}`);
}

export interface VerifyRequest {
  model: ModelSpec;
  properties: PropertySpec[];
  bound: number;
}

export function verify(req: VerifyRequest): Promise<VerifyResponse> {
  return request<VerifyResponse>("/api/verify", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export interface AssuranceDiffRequest {
  old_model: ModelSpec;
  new_model: ModelSpec;
  properties: PropertySpec[];
  bound: number;
}

export function assuranceDiff(
  req: AssuranceDiffRequest
): Promise<AssuranceDiffResponse> {
  return request<AssuranceDiffResponse>("/api/assurance-diff", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function applyRepair(
  model: ModelSpec,
  repair: RepairSpec
): Promise<{ model: ModelSpec }> {
  return request<{ model: ModelSpec }>("/api/apply-repair", {
    method: "POST",
    body: JSON.stringify({ model, repair }),
  });
}
