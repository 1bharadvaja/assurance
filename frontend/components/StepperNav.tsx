"use client";

import clsx from "clsx";

export type StepId = 1 | 2 | 3 | 4 | 5;

export const STEPS: { id: StepId; label: string }[] = [
  { id: 1, label: "Rule" },
  { id: 2, label: "Change" },
  { id: 3, label: "Check" },
  { id: 4, label: "Execution" },
  { id: 5, label: "Fix" },
];

interface Props {
  active: StepId;
  completed: Set<StepId>;
  available: Set<StepId>;
  onSelect: (s: StepId) => void;
}

export function StepperNav({ active, completed, available, onSelect }: Props) {
  return (
    <nav className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-6 py-2.5 text-[13px]">
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
                  "flex items-center gap-2 rounded px-2.5 py-1 transition",
                  isActive && "bg-ink-100 text-ink-900",
                  !isActive && isReachable && "text-ink-600 hover:bg-ink-50",
                  !isReachable && "text-ink-300 cursor-not-allowed"
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={clsx(
                    "flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-medium",
                    isActive && "border-ink-900 bg-ink-900 text-white",
                    !isActive && isDone && "border-ink-400 bg-ink-400 text-white",
                    !isActive && !isDone && isReachable && "border-ink-300 bg-paper text-ink-500",
                    !isActive && !isDone && !isReachable && "border-ink-200 bg-paper text-ink-300"
                  )}
                >
                  {isDone && !isActive ? "✓" : s.id}
                </span>
                <span>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <span aria-hidden className="mx-1 h-px w-4 bg-ink-200" />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
