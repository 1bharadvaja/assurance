"use client";

import { Disclosure } from "./Disclosure";

interface Props {
  formalProperty: string;
}

export function MissionRuleCard({ formalProperty }: Props) {
  return (
    <section>
      <SectionHeader step="01" label="Safety rule" />
      <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-900">
        The controller must not enter <code className="font-mono text-ink-900">Actuate</code>{" "}
        while communications are lost unless a human operator has approved the
        action.
      </p>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-500">
        <code className="font-mono text-ink-700">Actuate</code> stands in for
        an irreversible command. If the operator is unreachable, the decision
        to fire should not be the controller&apos;s alone.
      </p>
      <Disclosure label="formal property">
        <pre className="overflow-x-auto rounded border border-line bg-ink-50 p-3 font-mono text-[12.5px] leading-5 text-ink-800">
{formalProperty}
        </pre>
      </Disclosure>
    </section>
  );
}

export function SectionHeader({ step, label }: { step: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line pb-2">
      <span className="font-mono text-[12px] text-ink-400">{step}</span>
      <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
        {label}
      </h2>
    </div>
  );
}
