"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { Disclosure } from "./Disclosure";
import { ModelHealthCheck } from "./ModelHealthCheck";
import type {
  DraftSource,
  HealthReport,
  ModelSpec,
  PropertySpec,
} from "../lib/types";

interface Props {
  /** Original AI-drafted response — used for the provenance badge. */
  usedLlm: boolean;
  /** Explicit provenance — drives the badge copy. */
  draftSource: DraftSource;
  /** Number of LLM repair round trips. 0 for clean / template drafts. */
  repairAttempts: number;
  /** Optional human-readable reason for any non-LLM source. */
  fallbackReason?: string | null;
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
  draftSource,
  repairAttempts,
  fallbackReason,
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
        draftSource={draftSource}
        llmModelName={llmModelName}
        fallbackReason={fallbackReason}
        repairAttempts={repairAttempts}
        warnings={warnings}
        hasEdits={hasEdits}
      />

      {(repairAttempts > 0 || draftSource === "blocked") && (
        <RepairTimeline
          draftSource={draftSource}
          repairAttempts={repairAttempts}
        />
      )}

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
  draftSource,
  llmModelName,
  fallbackReason,
  repairAttempts,
  warnings,
  hasEdits,
}: {
  draftSource: DraftSource;
  llmModelName?: string | null;
  fallbackReason?: string | null;
  repairAttempts: number;
  warnings: string[];
  hasEdits: boolean;
}) {
  const { label, tone } = describeSource(draftSource, {
    llmModelName,
    repairAttempts,
  });
  const toneClass = {
    llm: "border-violet-200 bg-violet-50 text-violet-900",
    template: "border-amber-200 bg-amber-50 text-amber-900",
    blocked: "border-red-200 bg-red-50 text-red-900",
  }[tone];
  return (
    <div className={clsx("rounded border px-3 py-2 text-[12.5px]", toneClass)}>
      <div className="flex flex-wrap items-baseline gap-2 font-medium">
        <span>{label}</span>
        {hasEdits && (
          <span className="rounded bg-ink-900/10 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider">
            edited
          </span>
        )}
      </div>
      {fallbackReason && (
        <p className="mt-1 text-[11.5px] leading-snug">{fallbackReason}</p>
      )}
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

function describeSource(
  source: DraftSource,
  ctx: { llmModelName?: string | null; repairAttempts: number }
): { label: string; tone: "llm" | "template" | "blocked" } {
  const model = ctx.llmModelName ? `: ${ctx.llmModelName}` : "";
  switch (source) {
    case "llm":
      return { label: `Drafted by LLM${model}`, tone: "llm" };
    case "llm_repaired":
      return {
        label: `Drafted by LLM and repaired through validation feedback${model}${
          ctx.repairAttempts ? ` (${ctx.repairAttempts} repair pass${ctx.repairAttempts === 1 ? "" : "es"})` : ""
        }`,
        tone: "llm",
      };
    case "template_fallback":
      return {
        label: "Template fallback used — LLM call failed validation",
        tone: "template",
      };
    case "deterministic_fallback":
      return {
        label: "Template fallback used — no LLM configured",
        tone: "template",
      };
    case "blocked":
      return { label: "Draft blocked by validation", tone: "blocked" };
  }
}

function RepairTimeline({
  draftSource,
  repairAttempts,
}: {
  draftSource: DraftSource;
  repairAttempts: number;
}) {
  const steps: { label: string; state: "done" | "fail" }[] = [
    { label: "LLM draft", state: "done" },
  ];
  if (repairAttempts > 0 || draftSource === "blocked") {
    steps.push({ label: "Health check found issues", state: "done" });
  }
  for (let i = 1; i <= repairAttempts; i++) {
    steps.push({ label: `LLM repair attempt ${i}`, state: "done" });
  }
  if (draftSource === "llm_repaired") {
    steps.push({ label: "Health check passed", state: "done" });
    steps.push({ label: "Ready for review", state: "done" });
  } else if (draftSource === "blocked") {
    steps.push({ label: "Still blocked — review disabled", state: "fail" });
  } else if (draftSource === "llm") {
    // No repair happened — timeline won't render anyway.
    steps.push({ label: "Health check passed", state: "done" });
  }

  return (
    <section className="rounded border border-line bg-paper px-4 py-3 text-[12px]">
      <div className="text-[10px] font-medium uppercase tracking-wider text-ink-500">
        Drafting pipeline
      </div>
      <ol className="mt-2 space-y-0.5 text-ink-700">
        {steps.map((s, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span
              className={clsx(
                "inline-block min-w-[1.5rem] text-right font-mono text-[10.5px]",
                s.state === "fail" ? "text-red-700" : "text-ink-400"
              )}
            >
              {i + 1}.
            </span>
            <span
              className={
                s.state === "fail"
                  ? "text-red-800"
                  : "text-ink-800"
              }
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
      {children}
    </div>
  );
}
