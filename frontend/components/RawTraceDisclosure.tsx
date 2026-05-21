"use client";

import clsx from "clsx";
import { Disclosure } from "./Disclosure";
import type { TraceStep } from "../lib/types";

interface Props {
  trace: TraceStep[];
  columns: string[];
  violationTime?: number | null;
}

export function RawTraceDisclosure({ trace, columns, violationTime }: Props) {
  return (
    <Disclosure label="full solver trace">
      <div className="overflow-x-auto rounded border border-line bg-paper">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-ink-50 text-[11px] text-ink-500">
              <th className="px-3 py-1.5">t</th>
              {columns.map((c) => (
                <th key={c} className="px-3 py-1.5 font-mono">
                  {c}
                </th>
              ))}
              <th className="px-3 py-1.5">transition</th>
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
                    "border-b border-line last:border-b-0",
                    isViol ? "bg-red-50 text-red-900" : ""
                  )}
                >
                  <td className="px-3 py-1.5 font-mono text-ink-500">{step.t}</td>
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
                      <td key={c} className="px-3 py-1.5 font-mono text-ink-800">
                        {v}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 font-mono text-accent">
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
