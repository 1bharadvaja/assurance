"use client";

import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  align?: "left" | "right";
}

export function Disclosure({ label, children, defaultOpen = false, align = "left" }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded text-xs uppercase tracking-wide text-ink-400 transition hover:text-ink-200",
          align === "right" && "ml-auto"
        )}
      >
        <ChevronRight
          className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
        />
        {open ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
