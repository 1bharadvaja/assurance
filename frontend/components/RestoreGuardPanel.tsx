"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { RepairSpec } from "../lib/types";
import { SectionHeader } from "./MissionRuleCard";

interface Props {
  repair: RepairSpec;
  isApplying: boolean;
  applied: boolean;
  onApply: () => void;
}

export function RestoreGuardPanel({ repair, isApplying, applied, onApply }: Props) {
  return (
    <section>
      <SectionHeader step="05" label="Fix" />

      <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-800">
        Put <code className="font-mono text-ink-900">human_authorized == true</code>{" "}
        back into the guard. This blocks the failing path because{" "}
        <code className="font-mono text-ink-900">Actuate</code> is no longer
        reachable from <code className="font-mono text-ink-900">DegradedComms</code>{" "}
        unless operator approval is true.
      </p>

      <div className="mt-3 overflow-hidden rounded border border-line bg-paper">
        <div className="border-b border-line bg-ink-50 px-3 py-2 font-mono text-[12px] text-ink-500">
          patch
        </div>
        <pre className="overflow-x-auto font-mono text-[13px] leading-6">
          <div className="flex items-center gap-3 bg-diff-added px-3 text-emerald-800">
            <span className="w-3 select-none text-ink-300">+</span>
            <span>{repair.add_predicate}</span>
          </div>
        </pre>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-ink-500">
          Re-conjoins the missing predicate onto{" "}
          <code className="font-mono text-ink-700">{repair.transition}.guard</code>.
        </span>
        <button
          type="button"
          onClick={onApply}
          disabled={isApplying || applied}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-[13px] font-medium transition",
            applied
              ? "border-emerald-700 bg-emerald-700 text-white"
              : "border-accent bg-accent text-white hover:bg-accent-dark disabled:cursor-wait"
          )}
        >
          {isApplying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {applied
            ? "Guard restored"
            : isApplying
            ? "Restoring & re-checking…"
            : "Restore guard and check again"}
        </button>
      </div>
    </section>
  );
}
