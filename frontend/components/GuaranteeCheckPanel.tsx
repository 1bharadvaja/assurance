"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { PropertySpec, VerificationResult } from "../lib/types";
import { SectionHeader } from "./MissionRuleCard";
import { GuaranteeChecklist } from "./GuaranteeChecklist";

interface Props {
  bound: number;
  properties: PropertySpec[];
  results: VerificationResult[] | null;
  onRun: () => void;
  isRunning: boolean;
}

export function GuaranteeCheckPanel({
  bound,
  properties,
  results,
  onRun,
  isRunning,
}: Props) {
  return (
    <section>
      <SectionHeader step="03" label="Check this change" />

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[14px] text-ink-600">
          Ask the checker: under the patched model, can we reach any state
          that violates one of the safety rules?
        </p>
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white shadow-sm transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
          )}
        >
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isRunning ? "Checking…" : "Check this change"}
        </button>
      </div>

      <div className="mt-4">
        <GuaranteeChecklist properties={properties} results={results} />
      </div>

      <p className="mt-3 text-[12px] text-ink-400">
        Z3 bounded model checking · bound = {bound} transitions
      </p>
    </section>
  );
}
