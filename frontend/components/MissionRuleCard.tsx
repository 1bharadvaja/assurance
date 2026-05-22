"use client";

import { Disclosure } from "./Disclosure";

interface Props {
  formalProperty: string;
}

export function MissionRuleCard({ formalProperty }: Props) {
  return (
    <section>
      <SectionHeader step="01" label="Setup and safety rule" />

      <div className="mt-3 max-w-2xl space-y-3 text-[14.5px] leading-relaxed text-ink-700">
        <p>
          Assume an autonomous platform operating with intermittent
          communications — a small UAV beyond line of sight, a marine vehicle
          on a multi-hour survey. The operator approves the mission before
          launch and can be reached when comms are up, but contact is not
          guaranteed in flight.
        </p>
        <p>
          The controller has an{" "}
          <code className="font-mono text-ink-900">Actuate</code> mode that
          stands in for an irreversible action: a payload release, a manoeuvre
          commit, a weapon-grade decision. Once entered it cannot be undone in
          time.
        </p>
        <p>
          We model the controller as a finite state machine — seven modes and
          a small set of env variables (comms, gps, battery, operator approval,
          sensor agreement). The checker explores its reachable states.
        </p>
      </div>

      <div className="mt-6 rounded border border-line bg-ink-50 px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
          Safety rule
        </div>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-900">
          The controller must not enter{" "}
          <code className="font-mono text-ink-900">Actuate</code> while
          communications are lost unless a human operator has approved the
          action.
        </p>
      </div>

      <Disclosure label="formal property">
        <pre className="overflow-x-auto rounded border border-line bg-paper p-3 font-mono text-[12.5px] leading-5 text-ink-800">
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
