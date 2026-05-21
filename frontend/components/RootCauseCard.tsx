"use client";

import { AlertOctagon } from "lucide-react";
import { Disclosure } from "./Disclosure";

interface Props {
  transitionName: string;
  missingPredicate: string;
  safeGuard: string;
  newGuard: string;
}

export function RootCauseCard({
  transitionName,
  missingPredicate,
  safeGuard,
  newGuard,
}: Props) {
  return (
    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.05] p-6 shadow-card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-rose-300">
        <AlertOctagon className="h-4 w-4" />
        Root cause
      </div>
      <h3 className="mt-2 text-2xl font-semibold text-rose-50">
        Missing human-authorization guard
      </h3>

      <p className="mt-3 max-w-3xl leading-relaxed text-rose-100">
        The transition <span className="font-mono text-rose-200">{transitionName}</span>{" "}
        can now fire in <span className="font-mono">DegradedComms</span> whenever
        sensors agree, even if no human has authorized the action.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-4">
          <div className="text-xs uppercase tracking-wide text-amber-300">
            Missing condition
          </div>
          <code className="mt-2 block break-words font-mono text-base text-amber-100">
            {missingPredicate}
          </code>
        </div>
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
          <div className="text-xs uppercase tracking-wide text-emerald-300">
            Why this fixes it
          </div>
          <p className="mt-2 text-emerald-50">
            Adding this guard makes{" "}
            <span className="font-mono">Actuate</span> unreachable unless the
            operator has explicitly approved.
          </p>
        </div>
      </div>

      <Disclosure label="transition details">
        <div className="grid gap-2">
          <pre className="overflow-x-auto rounded border border-ink-800 bg-ink-950 p-3 font-mono text-[12px] leading-5 text-ink-100">
{`safe guard:      ${safeGuard}`}
          </pre>
          <pre className="overflow-x-auto rounded border border-ink-800 bg-ink-950 p-3 font-mono text-[12px] leading-5 text-ink-100">
{`regressed guard: ${newGuard}`}
          </pre>
        </div>
      </Disclosure>
    </div>
  );
}
