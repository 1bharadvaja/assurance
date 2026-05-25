"use client";

import clsx from "clsx";
import type { AbstractionPlan, VariablePlan } from "../lib/types";

interface Props {
  plan: AbstractionPlan;
}

/**
 * Renders the LLM's Phase-1 modeling decisions. This appears in Stage 2
 * BEFORE the formal-model display so the user can audit the abstraction
 * choices (dangerous modes, environment inputs, safety preconditions,
 * etc.) before any Z3 work runs.
 *
 * Per the product spec, this is auditable rationale — not chain-of-
 * thought. Every field is short, concrete, and grounded in the input.
 */
export function AbstractionPlanView({ plan }: Props) {
  return (
    <section className="rounded border border-violet-200 bg-violet-50/40">
      <header className="border-b border-violet-200 bg-violet-100/60 px-4 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-violet-700">
          AI modeling decisions
        </div>
        <div className="mt-0.5 text-[13.5px] font-medium text-violet-900">
          Phase 1: abstraction plan
        </div>
        <p className="mt-1 text-[12px] leading-snug text-violet-800">
          The LLM first decides how to abstract the spec into a finite-
          state machine. Validation and Z3 then check the formal model
          that follows from these choices.
        </p>
      </header>

      <div className="space-y-4 px-4 py-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <ModeColumn
            title="Controller modes"
            modes={plan.controller_modes}
            emptyHint="No modes proposed."
          />
          <ModeColumn
            title="Dangerous modes"
            modes={plan.dangerous_modes}
            emptyHint="No dangerous modes identified."
            tone="bad"
          />
          <ModeColumn
            title="Recovery modes"
            modes={plan.recovery_modes}
            emptyHint="No recovery modes identified."
            tone="good"
          />
        </div>

        <VariableSection
          title="Environment inputs"
          rows={plan.environment_inputs}
          emptyHint="No environment inputs identified."
        />
        <VariableSection
          title="Latched state variables"
          rows={plan.latched_state_variables}
          emptyHint="No latched state."
        />

        {plan.safety_preconditions.length > 0 && (
          <div>
            <SectionTitle>Safety preconditions</SectionTitle>
            <ul className="mt-1 space-y-1.5 text-[12.5px] text-ink-800">
              {plan.safety_preconditions.map((sp, i) => (
                <li
                  key={i}
                  className="rounded border border-line bg-paper px-3 py-1.5"
                >
                  <div className="font-mono text-[11.5px]">
                    <span className="text-accent">{sp.mode}</span>
                    {" requires "}
                    <span className="text-ink-700">
                      {sp.required_conditions.join(", ") || "(none listed)"}
                    </span>
                  </div>
                  {sp.source_text && (
                    <div className="mt-0.5 text-[11px] italic text-ink-500">
                      ↳ {sp.source_text}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.response_obligations.length > 0 && (
          <div>
            <SectionTitle>Response obligations</SectionTitle>
            <ul className="mt-1 space-y-1.5 text-[12.5px] text-ink-800">
              {plan.response_obligations.map((ro, i) => (
                <li
                  key={i}
                  className="rounded border border-line bg-paper px-3 py-1.5 font-mono text-[11.5px]"
                >
                  <span>{ro.trigger}</span>
                  <span className="px-1 text-ink-400">→</span>
                  <span>{ro.response}</span>
                  <span className="ml-2 rounded bg-ink-100 px-1.5 py-0.5 text-[10.5px] text-ink-700">
                    within {ro.bound}
                  </span>
                  {ro.source_text && (
                    <div className="mt-0.5 text-[11px] italic text-ink-500 font-sans">
                      ↳ {ro.source_text}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.requirement_mapping.length > 0 && (
          <div>
            <SectionTitle>Requirement mapping</SectionTitle>
            <ul className="mt-1 space-y-1 text-[12px] text-ink-800">
              {plan.requirement_mapping.map((rm, i) => (
                <li key={i} className="rounded border border-line bg-paper px-3 py-1.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <FormalizationBadge kind={rm.formalization_type} />
                    {rm.generated_artifact && (
                      <span className="font-mono text-[11px] text-accent">
                        {rm.generated_artifact}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12px] leading-snug text-ink-700">
                    “{rm.source_text}”
                  </div>
                  {rm.notes && (
                    <div className="mt-0.5 text-[11px] italic text-ink-500">
                      {rm.notes}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.ambiguities.length > 0 && (
          <div>
            <SectionTitle>Ambiguities</SectionTitle>
            <ul className="mt-1 list-disc pl-5 text-[12.5px] text-amber-900">
              {plan.ambiguities.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function ModeColumn({
  title,
  modes,
  emptyHint,
  tone,
}: {
  title: string;
  modes: string[];
  emptyHint: string;
  tone?: "good" | "bad";
}) {
  const chipClass =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "bad"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-line bg-ink-50 text-ink-800";
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {modes.length === 0 ? (
        <p className="mt-1 text-[11.5px] italic text-ink-500">{emptyHint}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {modes.map((m) => (
            <li
              key={m}
              className={clsx(
                "rounded border px-2 py-0.5 font-mono text-[11.5px]",
                chipClass,
              )}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VariableSection({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: VariablePlan[];
  emptyHint: string;
}) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? (
        <p className="mt-1 text-[11.5px] italic text-ink-500">{emptyHint}</p>
      ) : (
        <ul className="mt-1 space-y-1 text-[12px] text-ink-800">
          {rows.map((v, i) => (
            <li
              key={`${v.name}-${i}`}
              className="rounded border border-line bg-paper px-3 py-1.5"
            >
              <div className="font-mono text-[11.5px]">
                <span className="text-ink-500">{v.name}</span>
                <span className="text-ink-400">: </span>
                <span>{v.type}</span>
                {v.type === "enum" && v.values && (
                  <span className="text-ink-400">
                    {" (" + v.values.join(", ") + ")"}
                  </span>
                )}
                <span className="text-ink-400"> = </span>
                <span>{String(v.initial)}</span>
              </div>
              {v.rationale && (
                <div className="mt-0.5 text-[11.5px] leading-snug text-ink-600">
                  {v.rationale}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormalizationBadge({
  kind,
}: {
  kind: "transition" | "invariant" | "bounded_response" | "assumption" | "ambiguous";
}) {
  const cfg = {
    transition: { label: "transition", cls: "bg-sky-100 text-sky-900 border-sky-200" },
    invariant: { label: "invariant", cls: "bg-emerald-100 text-emerald-900 border-emerald-200" },
    bounded_response: {
      label: "bounded response",
      cls: "bg-violet-100 text-violet-900 border-violet-200",
    },
    assumption: { label: "assumption", cls: "bg-amber-100 text-amber-900 border-amber-200" },
    ambiguous: { label: "ambiguous", cls: "bg-red-100 text-red-900 border-red-200" },
  }[kind];
  return (
    <span
      className={clsx(
        "inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px] uppercase tracking-wider",
        cfg.cls,
      )}
    >
      {cfg.label}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
      {children}
    </div>
  );
}
