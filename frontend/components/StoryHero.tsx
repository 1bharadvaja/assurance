"use client";

import { ChevronDown, Cpu, GitCommit, Play, Sparkles } from "lucide-react";

interface Props {
  onStart: () => void;
}

export function StoryHero({ onStart }: Props) {
  return (
    <header className="relative overflow-hidden border-b border-ink-800 bg-gradient-to-b from-ink-900/70 to-transparent">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-ink-400">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Assurance Studio
        </div>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-ink-50 sm:text-5xl">
          Find the mission bug hidden in a one-line change.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-300">
          Assurance Studio turns formal verification into an interactive
          investigation: compare mission logic, find reachable unsafe
          executions, explain the root cause, and re-verify the fix.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-accent-dark"
          >
            <Play className="h-4 w-4" />
            Run the demo
            <ChevronDown className="h-4 w-4" />
          </button>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-2 text-xs text-ink-400">
            <Badge icon={<Cpu className="h-3.5 w-3.5" />}>Real Z3 solver backend</Badge>
            <Badge>Bounded model checking</Badge>
            <Badge icon={<GitCommit className="h-3.5 w-3.5" />}>Counterexample replay</Badge>
            <Badge>One-click repair</Badge>
          </div>
        </div>
      </div>
    </header>
  );
}

function Badge({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/60 px-2.5 py-0.5">
      {icon}
      {children}
    </span>
  );
}
