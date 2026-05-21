"use client";

import { AlertTriangle, ShieldCheck, Target } from "lucide-react";
import { Disclosure } from "./Disclosure";

interface Props {
  formalProperty: string;
}

export function MissionRuleCard({ formalProperty }: Props) {
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6 shadow-card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-400">
        <Target className="h-4 w-4 text-accent" />
        Step 1 · Mission
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-ink-50">
        Autonomous platform operating with intermittent communications.
      </h2>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-ink-800 bg-ink-950/40 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            Critical rule
          </div>
          <p className="mt-3 text-lg leading-snug text-ink-50">
            Never actuate while disconnected unless a human approved it.
          </p>
          <Disclosure label="formal property">
            <pre className="overflow-x-auto rounded-md border border-ink-800 bg-ink-950 p-3 font-mono text-[12.5px] leading-5 text-ink-100">
{formalProperty}
            </pre>
          </Disclosure>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-950/40 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Why it matters
          </div>
          <p className="mt-3 leading-relaxed text-ink-200">
            <span className="font-mono text-amber-200">Actuate</span> is an
            irreversible command (e.g. payload release). If communications are
            lost, the system must preserve human oversight — the operator
            should be the one deciding whether to fire.
          </p>
        </div>
      </div>
    </div>
  );
}
