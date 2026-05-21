"use client";

import clsx from "clsx";
import { CheckCircle2, Loader2, Wrench } from "lucide-react";
import type { RepairSpec } from "../lib/types";

interface Props {
  repair: RepairSpec | null;
  applied: boolean;
  isApplying: boolean;
  onApply: () => void;
}

export function RepairPanel({ repair, applied, isApplying, onApply }: Props) {
  if (!repair) return null;

  return (
    <section id="repair" className="rounded-xl border border-amber-500/40 bg-amber-500/[0.05] p-5 shadow-card">
      <div className="flex items-center gap-2 text-sm uppercase tracking-widest text-amber-300">
        <Wrench className="h-4 w-4" />
        Suggested repair
      </div>
      <h3 className="mt-1 text-lg font-semibold text-amber-100">
        Strengthen guard of <span className="font-mono">{repair.transition}</span>
      </h3>

      <p className="mt-2 text-sm text-ink-200">{repair.rationale}</p>

      <div className="mt-4 rounded-md border border-ink-800 bg-ink-950 p-3">
        <div className="text-xs uppercase tracking-wide text-ink-400">New guard</div>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5 text-amber-100">
          {repair.new_guard}
        </pre>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-ink-400">
          The fix is targeted: it only re-introduces a missing predicate.
        </span>
        <button
          type="button"
          disabled={isApplying || applied}
          onClick={onApply}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition",
            applied
              ? "bg-emerald-600/80 text-white"
              : "bg-amber-500 text-ink-950 hover:bg-amber-400 disabled:cursor-wait"
          )}
        >
          {isApplying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : applied ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Wrench className="h-4 w-4" />
          )}
          {applied
            ? "Applied and re-verified"
            : isApplying
            ? "Applying & re-verifying..."
            : "Apply Suggested Fix and Re-verify"}
        </button>
      </div>
    </section>
  );
}
