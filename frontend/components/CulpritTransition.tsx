"use client";

import { AlertOctagon } from "lucide-react";

interface Props {
  transitionName: string;
  safeGuard: string;
  newGuard: string;
  missing: string;
  explanation: string;
}

export function CulpritTransition({
  transitionName,
  safeGuard,
  newGuard,
  missing,
  explanation,
}: Props) {
  return (
    <section id="culprit" className="rounded-xl border border-rose-500/40 bg-rose-500/[0.05] p-5 shadow-card">
      <div className="flex items-center gap-2 text-sm uppercase tracking-widest text-rose-300">
        <AlertOctagon className="h-4 w-4" />
        Culprit transition
      </div>
      <h3 className="mt-1 text-lg font-semibold text-rose-100">
        <span className="font-mono">{transitionName}</span>
      </h3>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <GuardBlock label="Safe baseline guard" tone="ok" guard={safeGuard} />
        <GuardBlock label="Regressed guard" tone="bad" guard={newGuard} />
      </div>

      <div className="mt-4 rounded-md border border-ink-800 bg-ink-950 p-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-ink-400">Missing predicate</div>
        <code className="mt-1 block font-mono text-amber-200">{missing}</code>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-200">{explanation}</p>
    </section>
  );
}

function GuardBlock({
  label,
  tone,
  guard,
}: {
  label: string;
  tone: "ok" | "bad";
  guard: string;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/[0.06]"
      : "border-rose-500/40 bg-rose-500/[0.08]";
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5 text-ink-100">
        {guard}
      </pre>
    </div>
  );
}
