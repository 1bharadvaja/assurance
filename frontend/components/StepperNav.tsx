"use client";

import clsx from "clsx";

export type StepId = 1 | 2 | 3 | 4 | 5;

export const STEPS: { id: StepId; label: string }[] = [
  { id: 1, label: "Mission" },
  { id: 2, label: "Change" },
  { id: 3, label: "Verify" },
  { id: 4, label: "Investigate" },
  { id: 5, label: "Repair" },
];

interface Props {
  active: StepId;
  completed: Set<StepId>;
  available: Set<StepId>;
  onSelect: (s: StepId) => void;
}

export function StepperNav({ active, completed, available, onSelect }: Props) {
  return (
    <nav className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-6 py-3 text-sm">
        {STEPS.map((s, i) => {
          const isActive = s.id === active;
          const isDone = completed.has(s.id);
          const isReachable = available.has(s.id);
          return (
            <div key={s.id} className="flex items-center">
              <button
                type="button"
                disabled={!isReachable}
                onClick={() => onSelect(s.id)}
                className={clsx(
                  "group flex items-center gap-2 rounded-full px-3 py-1.5 transition",
                  isActive && "bg-accent/15 text-ink-50",
                  !isActive && isReachable && "text-ink-200 hover:bg-ink-900",
                  !isReachable && "text-ink-600 cursor-not-allowed"
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={clsx(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                    isActive && "bg-accent text-white",
                    !isActive && isDone && "bg-emerald-500/80 text-white",
                    !isActive && !isDone && isReachable && "bg-ink-800 text-ink-300",
                    !isActive && !isDone && !isReachable && "bg-ink-900 text-ink-600"
                  )}
                >
                  {isDone && !isActive ? "✓" : s.id}
                </span>
                <span className="font-medium tracking-wide">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={clsx(
                    "mx-1 h-px w-6",
                    isDone ? "bg-emerald-500/40" : "bg-ink-800"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
