"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { Disclosure } from "./Disclosure";
import type { SpecDraftResponse } from "../lib/types";

interface Props {
  draft: SpecDraftResponse;
  isReviewing: boolean;
  onAccept: () => void;
  showAcceptButton: boolean;
}

export function AIDraftView({ draft, isReviewing, onAccept, showAcceptButton }: Props) {
  const modes = (draft.model.variables.mode?.values ?? []) as string[];
  const otherVars = Object.entries(draft.model.variables).filter(([k]) => k !== "mode");

  return (
    <div className="space-y-4">
      <ProvenanceBadge usedLlm={draft.used_llm} warnings={draft.warnings} />

      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <SectionTitle>Modes</SectionTitle>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {modes.map((m) => (
              <li
                key={m}
                className="rounded border border-line bg-ink-50 px-2 py-0.5 font-mono text-[11.5px] text-ink-800"
              >
                {m}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <SectionTitle>Variables</SectionTitle>
          <ul className="mt-1 space-y-0.5 font-mono text-[11.5px] text-ink-700">
            {otherVars.map(([name, spec]) => (
              <li key={name}>
                <span className="text-ink-500">{name}</span>:{" "}
                <span>{spec.type}</span>{" "}
                <span className="text-ink-400">
                  {spec.type === "enum"
                    ? `(${(spec.values ?? []).join(", ")})`
                    : ""}
                </span>{" "}
                <span className="text-ink-400">
                  = {String(spec.initial)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <SectionTitle>Transitions ({draft.model.transitions.length})</SectionTitle>
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto rounded border border-line bg-paper px-3 py-2 font-mono text-[11.5px] leading-5 text-ink-800">
          {draft.model.transitions.map((t) => (
            <li key={t.name} className="flex flex-wrap items-baseline gap-2">
              <span className="text-accent">{t.name}</span>
              {t.reactive && (
                <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-800">
                  reactive
                </span>
              )}
              <span className="text-ink-500">guard:</span>
              <span className="text-ink-700">{t.guard}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>Safety checks ({draft.properties.length})</SectionTitle>
        <ul className="mt-1 space-y-1.5">
          {draft.properties.map((p) => (
            <li
              key={p.name}
              className="rounded border border-line bg-paper px-3 py-2 text-[12.5px]"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-medium text-ink-900">{p.title || p.name}</span>
                <span className="font-mono text-[11px] text-ink-400">{p.type}</span>
              </div>
              {p.description && (
                <p className="mt-1 text-[12.5px] text-ink-600">{p.description}</p>
              )}
              <pre className="mt-1 overflow-x-auto font-mono text-[11.5px] text-ink-700">
                {p.condition || `trigger: ${p.trigger}\nresponse: ${p.response}\nbound: ${p.bound}`}
              </pre>
            </li>
          ))}
        </ul>
      </section>

      {draft.assumptions.length > 0 && (
        <section>
          <SectionTitle>Assumptions</SectionTitle>
          <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink-700">
            {draft.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <Disclosure label="raw model JSON">
        <pre className="overflow-x-auto rounded border border-line bg-ink-50 p-3 font-mono text-[11px] leading-5 text-ink-800">
          {JSON.stringify(
            { model: draft.model, properties: draft.properties },
            null,
            2
          )}
        </pre>
      </Disclosure>

      {showAcceptButton && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={isReviewing}
            className={clsx(
              "inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
            )}
          >
            {isReviewing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isReviewing ? "Reviewing…" : "Accept draft and review weak points"}
          </button>
        </div>
      )}
    </div>
  );
}

function ProvenanceBadge({
  usedLlm,
  warnings,
}: {
  usedLlm: boolean;
  warnings: string[];
}) {
  return (
    <div
      className={clsx(
        "rounded border px-3 py-2 text-[12.5px]",
        usedLlm
          ? "border-violet-200 bg-violet-50 text-violet-900"
          : "border-amber-200 bg-amber-50 text-amber-900"
      )}
    >
      <div className="font-medium">
        {usedLlm ? "Drafted by LLM" : "Drafted by deterministic reviewer"}
      </div>
      {warnings.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-[11.5px]">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
      {children}
    </div>
  );
}
