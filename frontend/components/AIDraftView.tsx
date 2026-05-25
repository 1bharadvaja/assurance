"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { Disclosure } from "./Disclosure";
import { ModelHealthCheck } from "./ModelHealthCheck";
import type {
  HealthReport,
  ModelSpec,
  PropertySpec,
} from "../lib/types";

interface Props {
  /** Original AI-drafted response — used for the provenance badge. */
  usedLlm: boolean;
  /** OpenAI model that produced the draft, if any. */
  llmModelName?: string | null;
  warnings: string[];
  /** Current working model (draft + any edits). */
  model: ModelSpec;
  properties: PropertySpec[];
  assumptions: string[];
  /** Whether the user has made any edits relative to the original draft. */
  hasEdits: boolean;
  isReviewing: boolean;
  onAccept: () => void;
  acceptLabel?: string;
  showAcceptButton: boolean;
  /** Optional editor slot rendered inside a disclosure on this card. */
  editPanel?: React.ReactNode;
  /** Model health check from the backend (may be null for older payloads). */
  health?: HealthReport | null;
  /** Called when the user wants clarifying questions for a blocked draft. */
  onAskClarification?: () => void;
  /** Called when the user wants to start over from an example. */
  onUseExample?: () => void;
  /** Called when the user wants to jump to the transition editor. */
  onFixDraft?: () => void;
}

export function AIDraftView({
  usedLlm,
  llmModelName,
  warnings,
  model,
  properties,
  assumptions,
  hasEdits,
  isReviewing,
  onAccept,
  acceptLabel,
  showAcceptButton,
  editPanel,
  health,
  onAskClarification,
  onUseExample,
  onFixDraft,
}: Props) {
  const modes = (model.variables.mode?.values ?? []) as string[];
  const otherVars = Object.entries(model.variables).filter(([k]) => k !== "mode");
  const blocked = health?.classification === "blocked";
  const withWarnings = health?.classification === "checkable_with_warnings";

  return (
    <div className="space-y-4">
      <ProvenanceBadge
        usedLlm={usedLlm}
        llmModelName={llmModelName}
        warnings={warnings}
        hasEdits={hasEdits}
      />

      {health && <ModelHealthCheck report={health} />}

      {blocked && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-900">
          <div className="font-medium">
            Draft blocked by validation — review and Z3 are disabled
          </div>
          <p className="mt-1 leading-snug">
            The formal checker requires this draft to be cleaned up first.
            Pick one:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {onFixDraft && (
              <button
                type="button"
                onClick={onFixDraft}
                className="rounded border border-red-300 bg-paper px-2.5 py-1 text-[12px] text-red-900 transition hover:bg-red-100"
              >
                Fix draft
              </button>
            )}
            {onAskClarification && (
              <button
                type="button"
                onClick={onAskClarification}
                className="rounded border border-red-300 bg-paper px-2.5 py-1 text-[12px] text-red-900 transition hover:bg-red-100"
              >
                Ask clarification
              </button>
            )}
            {onUseExample && (
              <button
                type="button"
                onClick={onUseExample}
                className="rounded border border-red-300 bg-paper px-2.5 py-1 text-[12px] text-red-900 transition hover:bg-red-100"
              >
                Use an example
              </button>
            )}
          </div>
        </div>
      )}

      {withWarnings && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          This draft is checkable, but some modeling assumptions may be
          wrong — review the warnings above before sending hypotheses to
          Z3.
        </div>
      )}

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
        <SectionTitle>Transitions ({model.transitions.length})</SectionTitle>
        <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto rounded border border-line bg-paper px-3 py-2 font-mono text-[11.5px] leading-5 text-ink-800">
          {model.transitions.map((t) => (
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
        <SectionTitle>Safety checks ({properties.length})</SectionTitle>
        <ul className="mt-1 space-y-1.5">
          {properties.map((p) => (
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

      {assumptions.length > 0 && (
        <section>
          <SectionTitle>Assumptions</SectionTitle>
          <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink-700">
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      {editPanel && (
        <Disclosure label="edit transitions before review">
          {editPanel}
        </Disclosure>
      )}

      <Disclosure label="raw model JSON">
        <pre className="overflow-x-auto rounded border border-line bg-ink-50 p-3 font-mono text-[11px] leading-5 text-ink-800">
          {JSON.stringify({ model, properties }, null, 2)}
        </pre>
      </Disclosure>

      {showAcceptButton && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={isReviewing || blocked}
            title={
              blocked
                ? "Fix the validation errors above before reviewing this draft."
                : undefined
            }
            className={clsx(
              "inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-[13px] font-medium transition",
              blocked
                ? "border-ink-200 bg-ink-100 text-ink-400 cursor-not-allowed"
                : "border-accent bg-accent text-white hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
            )}
          >
            {isReviewing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isReviewing
              ? "Reviewing…"
              : acceptLabel ?? "Accept draft and review weak points"}
          </button>
        </div>
      )}
    </div>
  );
}

function ProvenanceBadge({
  usedLlm,
  llmModelName,
  warnings,
  hasEdits,
}: {
  usedLlm: boolean;
  llmModelName?: string | null;
  warnings: string[];
  hasEdits: boolean;
}) {
  const baseLabel = usedLlm
    ? llmModelName
      ? `Drafted by LLM: ${llmModelName}`
      : "Drafted by LLM"
    : "Drafted by deterministic reviewer";
  return (
    <div
      className={clsx(
        "rounded border px-3 py-2 text-[12.5px]",
        usedLlm
          ? "border-violet-200 bg-violet-50 text-violet-900"
          : "border-amber-200 bg-amber-50 text-amber-900"
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2 font-medium">
        <span>{baseLabel}</span>
        {hasEdits && (
          <span className="rounded bg-ink-900/10 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider">
            edited
          </span>
        )}
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
