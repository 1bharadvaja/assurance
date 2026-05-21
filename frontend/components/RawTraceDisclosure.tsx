"use client";

import { Disclosure } from "./Disclosure";
import type { TraceStep } from "../lib/types";
import clsx from "clsx";

interface Props {
  trace: TraceStep[];
  columns: string[];
  violationTime?: number | null;
}

export function RawTraceDisclosure({ trace, columns, violationTime }: Props) {
  return (
    <Disclosure label="full solver trace">
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
              const isViol =
                violationTime !== undefined &&
                violationTime !== null &&
                step.t === violationTime;
              return (
                <tr
                  key={i}
                  className={clsx(
                    isViol
                      ? "bg-rose-500/15 text-rose-100"
                      : "odd:bg-ink-900/40"
                  )}
                >
                  <td className="px-3 py-2 font-mono text-ink-300">{step.t}</td>
                  {columns.map((c) => {
                    const raw = step[c];
                    const v =
                      raw === undefined
                        ? ""
                        : typeof raw === "boolean"
                        ? raw
                          ? "true"
                          : "false"
                        : String(raw);
                    return (
                      <td key={c} className="px-3 py-2 font-mono text-ink-100">
                        {v}
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
    </Disclosure>
  );
}
