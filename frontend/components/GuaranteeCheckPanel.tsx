"use client";

import clsx from "clsx";
import { CheckCircle2, Circle, Cpu, Loader2, Play, XCircle } from "lucide-react";
import type { PropertySpec, VerificationResult } from "../lib/types";

interface Props {
  bound: number;
  properties: PropertySpec[];
  results: VerificationResult[] | null;
  onRun: () => void;
  isRunning: boolean;
}

export function GuaranteeCheckPanel({
  bound,
  properties,
  results,
  onRun,
  isRunning,
}: Props) {
  const byName = new Map<string, VerificationResult>();
  if (results) for (const r of results) byName.set(r.property, r);

  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-400">
            <Cpu className="h-4 w-4 text-accent" />
            Step 3 · Verify
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-ink-50">
            Check mission guarantees
          </h2>
          <p className="mt-2 text-ink-300">
            The verifier asks: under the current model, can we reach any state
            that violates one of the mission rules?
          </p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
          )}
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isRunning ? "Checking…" : "Check mission guarantees"}
        </button>
      </div>

      <ul className="mt-5 space-y-2">
        {properties.map((p) => {
          const r = byName.get(p.name);
          return <Row key={p.name} prop={p} result={r} />;
        })}
      </ul>

      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-ink-800 bg-ink-950/50 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink-400">
        <Cpu className="h-3 w-3" />
        Z3 bounded model checker · bound = {bound}
      </div>
    </div>
  );
}

function Row({
  prop,
  result,
}: {
  prop: PropertySpec;
  result?: VerificationResult;
}) {
  const status = result?.status ?? "unchecked";
  return (
    <li
      className={clsx(
        "flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition",
        status === "pass" && "border-emerald-500/40 bg-emerald-500/[0.05]",
        status === "fail" && "border-rose-500/40 bg-rose-500/[0.06]",
        status === "unchecked" && "border-ink-800 bg-ink-950/40"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <StatusIcon status={status} />
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-50">
            {prop.title || prop.name}
          </div>
          <div className="truncate text-xs text-ink-400">{prop.description}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide">
        {result?.elapsed_ms !== undefined && result.elapsed_ms !== null && (
          <span className="font-mono text-ink-500">
            {result.elapsed_ms.toFixed(0)}ms
          </span>
        )}
        <StatusBadge status={status} />
      </div>
    </li>
  );
}

function StatusIcon({ status }: { status: "pass" | "fail" | "unchecked" }) {
  if (status === "pass")
    return <CheckCircle2 className="h-5 w-5 flex-none text-emerald-400" />;
  if (status === "fail")
    return <XCircle className="h-5 w-5 flex-none text-rose-400" />;
  return <Circle className="h-5 w-5 flex-none text-ink-600" />;
}

function StatusBadge({ status }: { status: "pass" | "fail" | "unchecked" }) {
  if (status === "pass")
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">
        passed
      </span>
    );
  if (status === "fail")
    return (
      <span className="rounded-full bg-rose-500/15 px-2 py-0.5 font-medium text-rose-300">
        failed
      </span>
    );
  return (
    <span className="rounded-full bg-ink-800 px-2 py-0.5 text-ink-400">unchecked</span>
  );
}
