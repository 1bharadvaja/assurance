"use client";

import clsx from "clsx";
import { BackendStatus } from "./BackendStatus";

export type TabId = "guided" | "playground" | "notes";

const TABS: { id: TabId; label: string }[] = [
  { id: "guided", label: "Guided Review" },
  { id: "playground", label: "Playground" },
  { id: "notes", label: "Technical Notes" },
];

interface Props {
  active: TabId;
  onSelect: (t: TabId) => void;
}

export function TopNav({ active, onSelect }: Props) {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-ink-700">
            Assurance Studio
          </span>
          <BackendStatus />
        </div>
        <nav className="flex items-center gap-1 text-[13px]">
          {TABS.map((t) => {
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t.id)}
                aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "rounded px-3 py-1.5 transition",
                  isActive
                    ? "bg-ink-100 text-ink-900"
                    : "text-ink-500 hover:bg-ink-50 hover:text-ink-800"
                )}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
