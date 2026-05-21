"use client";

import clsx from "clsx";
import { splitConjuncts } from "../lib/narrative";
import { SectionHeader } from "./MissionRuleCard";

interface Props {
  transitionName: string;
  safeGuard: string;
  regressedGuard: string;
  activeGuard: string;
  changeActive: boolean;
  repaired: boolean;
  onToggle: (next: boolean) => void;
}

export function OneLineDiffCard({
  transitionName,
  safeGuard,
  regressedGuard,
  activeGuard,
  changeActive,
  repaired,
  onToggle,
}: Props) {
  const safeClauses = dedupe(splitConjuncts(safeGuard));
  const regressedClauses = new Set(
    splitConjuncts(regressedGuard).map(norm)
  );
  // Lines that are in the safe version but not the regressed one are the
  // ones the code review removes. We render them inline at their original
  // position with a `-` marker.
  const lines = safeClauses.map((clause) => ({
    clause,
    deleted: !regressedClauses.has(norm(clause)),
  }));

  const activeClauses = dedupe(splitConjuncts(activeGuard));

  return (
    <section>
      <SectionHeader step="02" label="Changed transition" />

      <p className="mt-3 text-[14px] text-ink-600">
        The code review modifies the guard on{" "}
        <code className="font-mono text-ink-800">{transitionName}</code>.
      </p>

      <div className="mt-4 overflow-hidden rounded border border-line bg-paper">
        <div className="flex items-center justify-between border-b border-line bg-ink-50 px-3 py-2 font-mono text-[12px] text-ink-500">
          <span>{transitionName}.guard</span>
          <span className="text-[11px] text-ink-400">
            {lines.filter((l) => l.deleted).length} removed
          </span>
        </div>
        <pre className="overflow-x-auto p-0 font-mono text-[13px] leading-6">
          {lines.map((l, i) => (
            <div
              key={i}
              className={clsx(
                "flex items-center gap-3 px-3",
                l.deleted
                  ? "bg-diff-removed text-diff-removedText"
                  : "text-ink-800"
              )}
            >
              <span className="w-3 select-none text-ink-300">
                {l.deleted ? "-" : " "}
              </span>
              <span>{l.clause}</span>
            </div>
          ))}
        </pre>
      </div>

      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-600">
        This removes the only check that the operator approved actuation. The
        other three clauses look unchanged; the impact is not obvious from the
        local diff.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <ApplyToggle on={changeActive} disabled={repaired} onChange={onToggle} />
        <span className="text-[12px] text-ink-500">
          {repaired
            ? "Guard restored. The checker is now running against the patched model."
            : changeActive
            ? "Checker is running against the changed model."
            : "Apply the change to send the patched model to the checker."}
        </span>
      </div>

      {repaired && (
        <pre className="mt-3 overflow-x-auto rounded border border-line bg-ink-50 p-3 font-mono text-[12.5px] leading-6 text-ink-800">
          {activeClauses.map((c, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-3 select-none text-ink-300"> </span>
              <span>{c}</span>
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}

function ApplyToggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        "inline-flex cursor-pointer select-none items-center gap-2 rounded border px-3 py-1.5 text-[13px] transition",
        on && !disabled
          ? "border-accent bg-accent/[0.08] text-ink-900"
          : "border-line bg-paper text-ink-700 hover:bg-ink-50",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      <span
        className={clsx(
          "relative inline-flex h-4 w-7 items-center rounded-full transition",
          on ? "bg-accent" : "bg-ink-200"
        )}
      >
        <span
          className={clsx(
            "inline-block h-3 w-3 transform rounded-full bg-white shadow transition",
            on ? "translate-x-3.5" : "translate-x-0.5"
          )}
        />
      </span>
      Apply this change
      <input
        type="checkbox"
        className="hidden"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const n = norm(x);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(x);
  }
  return out;
}
