"use client";

import clsx from "clsx";

export interface ProgressEvent {
  label: string;
  status: "pending" | "active" | "done";
}

interface Props {
  events: ProgressEvent[];
}

export function FormalCheckProgress({ events }: Props) {
  return (
    <ol className="space-y-1.5">
      {events.map((e, i) => (
        <li
          key={i}
          className={clsx(
            "flex items-center gap-3 rounded border px-3 py-1.5 text-[12.5px]",
            e.status === "done" && "border-emerald-200 bg-emerald-50/40 text-emerald-900",
            e.status === "active" && "border-accent/40 bg-accent/[0.05] text-ink-900",
            e.status === "pending" && "border-line bg-paper text-ink-500"
          )}
        >
          <span
            aria-hidden
            className={clsx(
              "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
              e.status === "done" && "bg-emerald-600 text-white",
              e.status === "active" && "bg-accent text-white",
              e.status === "pending" && "border border-ink-300 bg-paper text-ink-400"
            )}
          >
            {e.status === "done" ? "✓" : e.status === "active" ? "·" : ""}
          </span>
          <span>{e.label}</span>
        </li>
      ))}
    </ol>
  );
}
