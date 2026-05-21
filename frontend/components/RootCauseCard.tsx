"use client";

import { Disclosure } from "./Disclosure";

interface Props {
  transitionName: string;
  missingPredicate: string;
  safeGuard: string;
  newGuard: string;
}

export function RootCauseCard({
  transitionName,
  missingPredicate,
  safeGuard,
  newGuard,
}: Props) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-line pb-2">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">
          Where it broke
        </h3>
        <span className="font-mono text-[11px] text-ink-400">{transitionName}</span>
      </div>

      <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-800">
        The changed guard no longer checks{" "}
        <code className="font-mono text-ink-900">human_authorized</code>. Once
        the system is in <code className="font-mono text-ink-900">DegradedComms</code>,
        the actuation transition can fire with comms lost and no current
        operator approval. That violates the safety rule.
      </p>

      <div className="mt-3 rounded border border-line bg-ink-50 px-3 py-2 font-mono text-[12.5px] text-ink-800">
        missing: {missingPredicate}
      </div>

      <Disclosure label="transition guards">
        <div className="grid gap-2">
          <pre className="overflow-x-auto rounded border border-line bg-paper p-3 font-mono text-[12px] leading-5 text-ink-800">
{`safe:      ${safeGuard}`}
          </pre>
          <pre className="overflow-x-auto rounded border border-line bg-paper p-3 font-mono text-[12px] leading-5 text-ink-800">
{`regressed: ${newGuard}`}
          </pre>
        </div>
      </Disclosure>
    </section>
  );
}
