"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { RiskHypothesis } from "../lib/types";

interface Props {
  hypotheses: RiskHypothesis[];
  bound: number;
  onBoundChange: (n: number) => void;
  onSend: () => void;
  isChecking: boolean;
}

const BOUNDS = [4, 6, 8, 10, 12, 16, 20];

export function RiskHypothesisList({
  hypotheses,
  bound,
  onBoundChange,
  onSend,
  isChecking,
}: Props) {
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-ink-500">
        Each hypothesis is a candidate edit or property the reviewer thinks is
        worth checking. The solver is the source of truth for whether the
        edit produces a reachable counterexample.
      </p>

      {hypotheses.length === 0 ? (
        <div className="rounded border border-line bg-ink-50 px-3 py-2 text-[12.5px] text-ink-600">
          No hypotheses were generated for this model.
        </div>
      ) : (
        <ol className="space-y-2">
          {hypotheses.map((h) => (
            <Item key={h.id} hyp={h} />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-600">
          Bound
          <select
            value={bound}
            onChange={(e) => onBoundChange(parseInt(e.target.value, 10))}
            disabled={isChecking}
            className="rounded border border-line bg-paper px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900"
            title="Higher bounds search longer executions but take longer."
          >
            {BOUNDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onSend}
          disabled={isChecking || hypotheses.length === 0}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
          )}
        >
          {isChecking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isChecking ? "Sending to Z3…" : "Send hypotheses to formal checker"}
        </button>
      </div>
    </div>
  );
}

function Item({ hyp }: { hyp: RiskHypothesis }) {
  return (
    <li className="rounded border border-line bg-paper px-3 py-2 text-[12.5px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-ink-900">{hyp.title}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
          {hyp.mutation?.kind ?? (hyp.property ? "property" : "hypothesis")}
        </span>
      </div>
      <p className="mt-1 text-ink-700">{hyp.summary}</p>
      <div className="mt-1.5 grid gap-1 text-[11.5px] text-ink-600">
        <div>
          <span className="text-ink-400">Rationale: </span>
          {hyp.rationale}
        </div>
        <div>
          <span className="text-ink-400">Expected signal: </span>
          {hyp.expected_signal}
        </div>
        {hyp.mutation && (
          <div className="mt-1 rounded border border-line bg-ink-50 px-2 py-1 font-mono text-[11px]">
            <div className="text-ink-500">
              mutate <span className="text-ink-800">{hyp.mutation.transition}</span>
            </div>
            {hyp.mutation.removed_clause && (
              <div className="mt-0.5 text-red-700">- {hyp.mutation.removed_clause}</div>
            )}
            {hyp.mutation.new_guard && (
              <div className="mt-0.5 text-emerald-800">guard: {hyp.mutation.new_guard}</div>
            )}
            {hyp.mutation.kind === "disable_transition" && (
              <div className="mt-0.5 text-red-700">disable transition</div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
