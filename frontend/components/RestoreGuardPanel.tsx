"use client";

import clsx from "clsx";
import { CheckCircle2, Loader2, Wrench } from "lucide-react";
import type { RepairSpec } from "../lib/types";

interface Props {
  repair: RepairSpec;
  isApplying: boolean;
  applied: boolean;
  onApply: () => void;
}

export function RestoreGuardPanel({ repair, isApplying, applied, onApply }: Props) {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] p-6 shadow-card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-amber-300">
        <Wrench className="h-4 w-4" />
        Step 5 · Restore the guard
      </div>
      <h3 className="mt-2 text-2xl font-semibold text-amber-50">
        Restore human-authorization guard
      </h3>
      <p className="mt-2 max-w-2xl text-amber-100">
        Re-introduce <code className="font-mono">{repair.add_predicate}</code> as
        a precondition for <code className="font-mono">{repair.transition}</code>
        , then re-run the verifier against the patched model.
      </p>

      <div className="mt-5 rounded-md border border-ink-800 bg-ink-950 p-3">
        <div className="text-xs uppercase tracking-wide text-ink-400">New guard</div>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5 text-amber-50">
          {repair.new_guard}
        </pre>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-amber-200/80">
          The fix is targeted: it only re-introduces the missing predicate.
        </span>
        <button
          type="button"
          onClick={onApply}
          disabled={isApplying || applied}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition",
            applied
              ? "bg-emerald-600/85 text-white"
              : "bg-amber-400 text-ink-950 hover:bg-amber-300 disabled:cursor-wait"
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
            ? "Re-running verification…"
            : "Restore human-authorization guard"}
        </button>
      </div>
    </div>
  );
}
