"use client";

import clsx from "clsx";
import { GitBranch, MinusCircle } from "lucide-react";
import { splitConjuncts } from "../lib/narrative";
import { Disclosure } from "./Disclosure";

interface Props {
  transitionName: string;
  safeGuard: string;
  regressedGuard: string;
  changeActive: boolean;
  repaired: boolean;
  onToggle: (next: boolean) => void;
}

export function OneLineDiffCard({
  transitionName,
  safeGuard,
  regressedGuard,
  changeActive,
  repaired,
  onToggle,
}: Props) {
  const safeClauses = splitConjuncts(safeGuard);
  const regressedClauses = splitConjuncts(regressedGuard);
  const regressedSet = new Set(regressedClauses.map((c) => c.replace(/\s+/g, " ").trim()));
  // Predicates present in safe but missing from regressed are the "deleted" ones.
  const deleted = safeClauses.filter(
    (c) => !regressedSet.has(c.replace(/\s+/g, " ").trim())
  );

  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-400">
            <GitBranch className="h-4 w-4 text-accent" />
            Step 2 · Change under review
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-ink-50">
            One line was removed from{" "}
            <span className="font-mono text-accent">{transitionName}</span>.
          </h2>
          <p className="mt-2 max-w-2xl text-ink-300">
            This looks like a small local simplification, but it changes which
            states the system can reach.
          </p>
        </div>
        <Toggle
          on={changeActive}
          disabled={repaired}
          onChange={onToggle}
        />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <GuardColumn
          label="Before — safe baseline"
          tone="ok"
          clauses={safeClauses}
          highlightedAsDeleted={[]}
        />
        <GuardColumn
          label={repaired ? "After — guard restored" : "After — proposed change"}
          tone={repaired ? "ok" : changeActive ? "bad" : "neutral"}
          clauses={regressedClauses}
          highlightedAsDeleted={deleted}
        />
      </div>

      {deleted.length > 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/[0.07] p-3">
          <MinusCircle className="mt-0.5 h-4 w-4 flex-none text-rose-300" />
          <div className="text-sm text-rose-100">
            <div className="font-semibold">Removed human approval requirement</div>
            <div className="mt-1 text-rose-200">
              <code className="rounded bg-ink-950/60 px-1.5 py-0.5 font-mono text-[12px] text-rose-100">
                {deleted.join("  ·  ")}
              </code>{" "}
              was deleted from the actuation guard.
            </div>
          </div>
        </div>
      )}

      {changeActive && !repaired && (
        <p className="mt-3 text-sm text-amber-200">
          Change active: human authorization removed from the actuation guard.
        </p>
      )}

      <Disclosure label="raw guard strings">
        <div className="space-y-2">
          <pre className="overflow-x-auto rounded border border-ink-800 bg-ink-950 p-3 font-mono text-[12px] leading-5 text-ink-200">
{`safe:      ${safeGuard}`}
          </pre>
          <pre className="overflow-x-auto rounded border border-ink-800 bg-ink-950 p-3 font-mono text-[12px] leading-5 text-ink-200">
{`regressed: ${regressedGuard}`}
          </pre>
        </div>
      </Disclosure>
    </div>
  );
}

function GuardColumn({
  label,
  tone,
  clauses,
  highlightedAsDeleted,
}: {
  label: string;
  tone: "ok" | "bad" | "neutral";
  clauses: string[];
  highlightedAsDeleted: string[];
}) {
  const wrapperCls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/[0.05]"
      : tone === "bad"
      ? "border-rose-500/40 bg-rose-500/[0.06]"
      : "border-ink-800 bg-ink-950/40";
  return (
    <div className={clsx("rounded-xl border p-4", wrapperCls)}>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-3 space-y-1.5">
        {clauses.map((c, i) => (
          <ClausePill key={i} text={c} />
        ))}
        {highlightedAsDeleted.length > 0 &&
          highlightedAsDeleted.map((c, i) => (
            <ClausePill key={`del-${i}`} text={c} deleted />
          ))}
      </div>
    </div>
  );
}

function ClausePill({ text, deleted = false }: { text: string; deleted?: boolean }) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-[12.5px]",
        deleted
          ? "border-rose-500/40 bg-rose-500/[0.07] text-rose-300 line-through"
          : "border-ink-700 bg-ink-900/70 text-ink-100"
      )}
    >
      {deleted && <MinusCircle className="h-3.5 w-3.5 flex-none text-rose-300" />}
      <span className="truncate">{text}</span>
    </div>
  );
}

function Toggle({
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
        "flex cursor-pointer select-none items-center gap-3 rounded-full border px-3 py-2 text-sm shadow-card",
        on && !disabled
          ? "border-rose-500/50 bg-rose-500/10 text-rose-100"
          : "border-ink-700 bg-ink-900 text-ink-200",
        disabled && "pointer-events-none opacity-60"
      )}
    >
      <span
        className={clsx(
          "relative inline-flex h-5 w-9 items-center rounded-full transition",
          on ? "bg-rose-500/70" : "bg-ink-700"
        )}
      >
        <span
          className={clsx(
            "inline-block h-4 w-4 transform rounded-full bg-white transition",
            on ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </span>
      Simulate this code review change
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
