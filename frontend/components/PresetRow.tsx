"use client";

import clsx from "clsx";
import { PRESETS, type Preset } from "../lib/playground";

interface Props {
  onApply: (p: Preset) => void;
  activeId: string | null;
}

export function PresetRow({ onApply, activeId }: Props) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[14px] font-semibold tracking-tight text-ink-900">
          Try a preset
        </h3>
        <span className="text-[11px] text-ink-400">
          Loads an edit into the editor. Click <em>Check this model</em> to run it.
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onApply(p)}
            title={p.description}
            className={clsx(
              "rounded border px-2.5 py-1 text-[12.5px] transition",
              p.id === "reset"
                ? "border-line bg-paper text-ink-600 hover:bg-ink-50"
                : activeId === p.id
                ? "border-accent bg-accent/[0.08] text-ink-900"
                : "border-line bg-paper text-ink-700 hover:bg-ink-50"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
