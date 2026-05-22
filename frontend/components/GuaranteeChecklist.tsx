"use client";

import clsx from "clsx";
import type { PropertySpec, VerificationResult } from "../lib/types";

interface Props {
  properties: PropertySpec[];
  results: VerificationResult[] | null;
}

export function GuaranteeChecklist({ properties, results }: Props) {
  const byName = new Map<string, VerificationResult>();
  if (results) for (const r of results) byName.set(r.property, r);

  return (
    <ul className="divide-y divide-line rounded border border-line bg-paper">
      {properties.map((p) => {
        const r = byName.get(p.name);
        return <Row key={p.name} prop={p} result={r} />;
      })}
    </ul>
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
        <span className="truncate text-[14px] text-ink-900">
          {humanizeTitle(prop.title || prop.name)}
        </span>
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

function StatusGlyph({
  status,
}: {
  status: "pass" | "fail" | "timeout" | "unchecked";
}) {
  const cls = {
    pass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    fail: "bg-red-50 text-red-700 ring-red-200",
    timeout: "bg-amber-50 text-amber-700 ring-amber-200",
  } as const;
  if (status === "pass" || status === "fail" || status === "timeout") {
    return (
      <span
        aria-hidden
        className={clsx(
          "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-inset",
          cls[status]
        )}
      >
        {status === "pass" ? "✓" : status === "fail" ? "✕" : "?"}
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

function StatusText({
  status,
}: {
  status: "pass" | "fail" | "timeout" | "unchecked";
}) {
  if (status === "pass") return <span className="text-emerald-700">passed</span>;
  if (status === "fail") return <span className="text-red-700">failed</span>;
  if (status === "timeout") return <span className="text-amber-700">timed out</span>;
  return <span className="text-ink-400">unchecked</span>;
}

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
