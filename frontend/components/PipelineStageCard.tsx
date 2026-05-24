"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

interface Props {
  step: number;
  title: string;
  caption?: string;
  state: "idle" | "active" | "done" | "blocked";
  children: ReactNode;
}

export function PipelineStageCard({
  step,
  title,
  caption,
  state,
  children,
}: Props) {
  return (
    <section
      className={clsx(
        "rounded border bg-paper",
        state === "active" && "border-accent shadow-sm",
        state === "done" && "border-emerald-300",
        state === "blocked" && "border-line opacity-70",
        state === "idle" && "border-line"
      )}
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span
            className={clsx(
              "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
              state === "done" && "bg-emerald-600 text-white",
              state === "active" && "bg-accent text-white",
              state === "idle" && "bg-ink-100 text-ink-600",
              state === "blocked" && "bg-ink-100 text-ink-400"
            )}
          >
            {state === "done" ? "✓" : step.toString().padStart(2, "0")}
          </span>
          <h3 className="text-[14px] font-semibold tracking-tight text-ink-900">
            {title}
          </h3>
        </div>
        {caption && (
          <span className="text-[11px] uppercase tracking-wider text-ink-400">
            {caption}
          </span>
        )}
      </header>
      <div className={clsx("px-4 py-4", state === "blocked" && "pointer-events-none")}>
        {children}
      </div>
    </section>
  );
}
