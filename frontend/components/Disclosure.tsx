"use client";

import clsx from "clsx";
import { useState, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Disclosure({ label, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] text-ink-500 transition hover:text-ink-700"
      >
        <span
          aria-hidden
          className={clsx(
            "inline-block transition-transform",
            open ? "rotate-90" : "rotate-0"
          )}
        >
          ›
        </span>
        {open ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
