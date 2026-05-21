"use client";

interface Props {
  onStart: () => void;
}

export function StoryHero({ onStart }: Props) {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Assurance Studio
        </div>
        <h1 className="mt-3 max-w-3xl text-[28px] font-semibold leading-[1.2] text-ink-900 sm:text-[32px]">
          Check whether a controller change broke a safety rule.
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-500">
          A one-line edit removed{" "}
          <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[13px] text-ink-700">
            human_authorized == true
          </code>{" "}
          from the actuation guard. The checker looks for a reachable
          execution that violates the rule.
        </p>
        <p className="mt-2 text-[13px] text-ink-400">
          Z3 bounded model checking over a finite state-machine model.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark"
          >
            Check the change
          </button>
        </div>
      </div>
    </header>
  );
}
