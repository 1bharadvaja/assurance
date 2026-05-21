"use client";

import { AlertTriangle, ShieldCheck, Target } from "lucide-react";

interface Props {
  title: string;
  description: string;
}

export function MissionBrief({ title, description }: Props) {
  return (
    <section
      id="mission-brief"
      className="rounded-xl border border-ink-800 bg-ink-900/60 p-6 shadow-card"
    >
      <div className="flex items-center gap-2 text-sm uppercase tracking-widest text-ink-400">
        <Target className="h-4 w-4" />
        Mission Brief
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-ink-50">{title}</h2>
      <p className="mt-3 max-w-3xl text-ink-300">{description}</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <BriefCard
          icon={<Target className="h-4 w-4 text-accent" />}
          label="Operational context"
          body="An autonomous platform that may need to actuate an irreversible payload while disconnected from its operator."
        />
        <BriefCard
          icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
          label="What could go wrong"
          body="Removing a human-authorization clause from a single transition silently lets the platform actuate without operator consent."
        />
        <BriefCard
          icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
          label="Why formal verification"
          body="Bounded model checking exhaustively explores reachable states up to a horizon and surfaces counterexamples, not anecdotes."
        />
      </div>
    </section>
  );
}

function BriefCard({
  icon,
  label,
  body,
}: {
  icon: React.ReactNode;
  label: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-400">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-sm text-ink-200">{body}</p>
    </div>
  );
}
