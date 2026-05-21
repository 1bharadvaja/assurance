"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { PropertySpec, VerificationResult } from "../lib/types";
import { SectionHeader } from "./MissionRuleCard";

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
    <section>
      <SectionHeader step="03" label="Check this change" />

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[14px] text-ink-600">
          Ask the checker: under the patched model, can we reach any state
          that violates one of the safety rules?
        </p>
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white shadow-sm transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
          )}
        >
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isRunning ? "Checking…" : "Check this change"}
        </button>
      </div>

      <ul className="mt-4 divide-y divide-line rounded border border-line bg-paper">
        {properties.map((p) => {
          const r = byName.get(p.name);
          return <Row key={p.name} prop={p} result={r} />;
        })}
      </ul>

      <p className="mt-3 text-[12px] text-ink-400">
        Z3 bounded model checking · bound = {bound} transitions
      </p>
    </section>
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
    <li className="flex items-center justify-between gap-4 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <StatusGlyph status={status} />
        <div className="min-w-0">
          <div className="truncate text-[14px] text-ink-900">
            {humanizeTitle(prop.title || prop.name)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 font-mono text-[11px] text-ink-400">
        {result?.elapsed_ms !== undefined && result.elapsed_ms !== null && (
          <span>{result.elapsed_ms.toFixed(0)}ms</span>
        )}
        <StatusText status={status} />
      </div>
    </li>
  );
}

function StatusGlyph({ status }: { status: "pass" | "fail" | "unchecked" }) {
  if (status === "pass") {
    return (
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"
      >
        ✓
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-50 text-[10px] font-semibold text-red-700 ring-1 ring-inset ring-red-200"
      >
        ✕
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-full border border-ink-300 bg-paper"
    />
  );
}

function StatusText({ status }: { status: "pass" | "fail" | "unchecked" }) {
  if (status === "pass") return <span className="text-emerald-700">passed</span>;
  if (status === "fail") return <span className="text-red-700">failed</span>;
  return <span className="text-ink-400">unchecked</span>;
}

/**
 * Reword the engineering titles into the labels we use in the checklist.
 */
function humanizeTitle(t: string): string {
  switch (t) {
    case "Human Oversight":
      return "Human approval before actuation";
    case "Sensor Safety":
      return "Sensor agreement before actuation";
    case "Low Battery Recovery":
      return "Low battery reaches recovery";
    case "Armed Before Mission":
      return "Mission requires arming";
    case "GPS Safety":
      return "GPS required for mission";
    default:
      return t;
  }
}
