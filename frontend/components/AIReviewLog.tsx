"use client";

import type { ReviewLogItem } from "../lib/types";

interface Props {
  items: ReviewLogItem[];
}

export function AIReviewLog({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-[12.5px] text-ink-500">No observations were emitted.</p>
    );
  }
  return (
    <ol className="space-y-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="rounded border border-line bg-paper px-3 py-2 text-[12.5px]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-ink-900">{item.title}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
              note {String(i + 1).padStart(2, "0")}
            </span>
          </div>
          <p className="mt-1 leading-relaxed text-ink-700">{item.summary}</p>
          {item.evidence.length > 0 && (
            <div className="mt-1.5 border-t border-line pt-1.5">
              <div className="text-[10.5px] uppercase tracking-wider text-ink-400">
                Evidence
              </div>
              <ul className="mt-0.5 list-disc pl-5 text-[11.5px] text-ink-600">
                {item.evidence.map((e, j) => (
                  <li key={j}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {item.generated_artifact && (
            <pre className="mt-1.5 overflow-x-auto rounded border border-line bg-ink-50 px-2 py-1 font-mono text-[11px] text-ink-700">
              {item.generated_artifact}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}
