"use client";

import clsx from "clsx";
import type { TraceStep } from "../lib/types";

interface Props {
  trace: TraceStep[];
  columns: string[]; // variable names to show
  violationTime?: number | null;
  propertyName: string;
}

export function CounterexampleTrace({
  trace,
  columns,
  violationTime,
  propertyName,
}: Props) {
  return (
    <section id="trace" className="rounded-xl border border-rose-500/30 bg-rose-500/[0.04] p-5 shadow-card">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-rose-200">
          Counterexample trace
        </h3>
        <span className="font-mono text-xs text-rose-300/80">{propertyName}</span>
      </div>

      <p className="mb-3 text-sm text-ink-200">
        The verifier produced this execution of length {trace.length - 1} that
        ends in a state violating the invariant.
      </p>

      <div className="overflow-x-auto rounded-lg border border-ink-800 bg-ink-950">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="bg-ink-900 text-[11px] uppercase tracking-wide text-ink-400">
              <th className="border-b border-ink-800 px-3 py-2">t</th>
              {columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-ink-800 px-3 py-2 font-mono"
                >
                  {c}
                </th>
              ))}
              <th className="border-b border-ink-800 px-3 py-2">transition</th>
            </tr>
          </thead>
          <tbody>
            {trace.map((step, i) => {
              const isViolation =
                violationTime !== undefined &&
                violationTime !== null &&
                step.t === violationTime;
              return (
                <tr
                  key={i}
                  className={clsx(
                    "transition",
                    isViolation
                      ? "bg-rose-500/15 text-rose-100"
                      : "odd:bg-ink-900/40"
                  )}
                >
                  <td className="px-3 py-2 font-mono text-ink-300">{step.t}</td>
                  {columns.map((c) => {
                    const raw = step[c];
                    return (
                      <td
                        key={c}
                        className="px-3 py-2 font-mono text-ink-100"
                      >
                        {formatValue(raw)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 font-mono text-accent">
                    {typeof step.transition === "string" && step.transition !== "stutter"
                      ? step.transition
                      : (step.transition as string) || ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatValue(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}
