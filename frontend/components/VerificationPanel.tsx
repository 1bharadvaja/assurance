"use client";

import clsx from "clsx";
import { Loader2, Play } from "lucide-react";
import type { VerifyResponse } from "../lib/types";

interface Props {
  bound: number;
  onRun: () => void;
  isRunning: boolean;
  result: VerifyResponse | null;
  message?: string | null;
}

export function VerificationPanel({
  bound,
  onRun,
  isRunning,
  result,
  message,
}: Props) {
  const passed = result?.summary.passed ?? 0;
  const failed = result?.summary.failed ?? 0;
  const total = result ? passed + failed : 0;
  const allPass = result !== null && failed === 0 && passed > 0;

  return (
    <section id="verify" className="rounded-xl border border-ink-800 bg-ink-900/60 p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm uppercase tracking-widest text-ink-400">Verification</div>
          <h3 className="mt-1 text-lg font-semibold text-ink-100">
            Bounded model checking
            <span className="ml-2 rounded bg-ink-800 px-2 py-0.5 font-mono text-xs text-ink-300">
              bound = {bound}
            </span>
          </h3>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70",
          )}
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isRunning ? "Verifying..." : "Run Verification"}
        </button>
      </div>

      {result && (
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <Tile label="Guarantees passed" value={passed.toString()} tone="ok" />
          <Tile label="Guarantees failed" value={failed.toString()} tone={failed ? "bad" : "neutral"} />
          <Tile label="Properties checked" value={total.toString()} tone="neutral" />
          <Tile label="Verification horizon" value={`k = ${bound}`} tone="neutral" />
        </div>
      )}

      {message && (
        <div
          className={clsx(
            "mt-4 rounded-md border px-3 py-2 text-sm",
            allPass
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-amber-500/40 bg-amber-500/10 text-amber-200"
          )}
        >
          {message}
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "bad" | "neutral";
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200"
      : tone === "bad"
      ? "border-rose-500/40 bg-rose-500/[0.08] text-rose-200"
      : "border-ink-800 bg-ink-900/40 text-ink-200";
  return (
    <div className={clsx("rounded-lg border p-3", cls)}>
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
