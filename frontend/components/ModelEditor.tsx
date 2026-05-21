"use client";

import clsx from "clsx";
import { GitBranch } from "lucide-react";
import type { TransitionSpec } from "../lib/types";

interface Props {
  transitionName: string;
  safeTransition: TransitionSpec | undefined;
  currentTransition: TransitionSpec | undefined;
  regressionOn: boolean;
  repaired: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
}

export function ModelEditor({
  transitionName,
  safeTransition,
  currentTransition,
  regressionOn,
  repaired,
  onToggle,
  disabled,
}: Props) {
  const rightLabel = repaired
    ? "Repaired model (active)"
    : regressionOn
    ? "Regressed model (active)"
    : "Regressed model";
  const rightTone: "ok" | "bad" | "neutral" = repaired
    ? "ok"
    : regressionOn
    ? "bad"
    : "neutral";
  return (
    <section id="model-editor" className="rounded-xl border border-ink-800 bg-ink-900/60 p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm uppercase tracking-widest text-ink-400">
            <GitBranch className="h-4 w-4" />
            Model change
          </div>
          <h3 className="mt-1 text-lg font-semibold text-ink-100">
            Transition <span className="font-mono text-accent">{transitionName}</span>
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-300">
            The regression removes the human-authorization clause from the
            actuation guard. Toggle to introduce or remove the regression.
          </p>
        </div>
        <RegressionToggle on={regressionOn} onChange={onToggle} disabled={disabled} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <GuardCard
          label="Safe baseline"
          tone="ok"
          guard={safeTransition?.guard ?? "—"}
        />
        <GuardCard
          label={rightLabel}
          tone={rightTone}
          guard={currentTransition?.guard ?? "—"}
        />
      </div>
    </section>
  );
}

function GuardCard({
  label,
  tone,
  guard,
}: {
  label: string;
  tone: "ok" | "bad" | "neutral";
  guard: string;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/[0.04]"
      : tone === "bad"
      ? "border-rose-500/40 bg-rose-500/[0.06]"
      : "border-ink-800 bg-ink-900/40";
  return (
    <div className={clsx("rounded-lg border p-4", cls)}>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5 text-ink-100">
        {guard}
      </pre>
    </div>
  );
}

function RegressionToggle({
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
        "flex cursor-pointer select-none items-center gap-3 rounded-full border px-3 py-1.5 text-sm",
        on
          ? "border-rose-500/50 bg-rose-500/10 text-rose-200"
          : "border-ink-700 bg-ink-900 text-ink-200",
        disabled && "pointer-events-none opacity-50"
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
      Introduce regression
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
