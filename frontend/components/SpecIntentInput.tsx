"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";

interface Props {
  description: string;
  onChange: (next: string) => void;
  onDraft: () => void;
  isDrafting: boolean;
  disabled?: boolean;
}

export function SpecIntentInput({
  description,
  onChange,
  onDraft,
  isDrafting,
  disabled,
}: Props) {
  return (
    <div className="space-y-3">
      <p className="text-[13.5px] leading-relaxed text-ink-600">
        Plain-English description of the system you want checked. The
        reviewer will draft a finite state-machine model and a small set of
        safety checks. Drafted by AI; checked by Z3.
      </p>
      <textarea
        value={description}
        onChange={(e) => onChange(e.target.value)}
        rows={9}
        disabled={isDrafting || disabled}
        className="w-full resize-y rounded border border-line bg-paper px-3 py-2 font-mono text-[12.5px] leading-5 text-ink-800 focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-400">
          {description.length} chars
        </span>
        <button
          type="button"
          onClick={onDraft}
          disabled={isDrafting || disabled || description.trim().length === 0}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
          )}
        >
          {isDrafting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isDrafting ? "Drafting…" : "Draft formal model"}
        </button>
      </div>
    </div>
  );
}
