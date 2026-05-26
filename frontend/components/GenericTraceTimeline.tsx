"use client";

import clsx from "clsx";
import { splitConjuncts } from "../lib/narrative";
import type { ModelSpec, PropertySpec, TraceStep, VarValue } from "../lib/types";

interface Props {
  trace: TraceStep[];
  model: ModelSpec;
  /** The property the trace violates (when known) — used to pick which
   * variables are most relevant to highlight. */
  property?: PropertySpec | null;
  /** Index of the step where the violation materialises. Defaults to the
   * last step in the trace. */
  violationIndex?: number;
  /** Optional short title rendered in the header chip. */
  title?: string;
}

/**
 * Domain-general counterexample renderer. Reads variables off the model
 * spec rather than assuming a fixed drone/autonomy schema, so it works
 * for railway crossings, infusion pumps, or anything else the LLM
 * happens to draft.
 *
 * Each row shows:
 *   - timestep index
 *   - the controller's `mode` (if the model has one)
 *   - the transition that fired to produce this state
 *   - chips for variables that *changed* on this step
 *   - chips for variables the failed property references (so the reader
 *     can see them throughout the trace)
 */
export function GenericTraceTimeline({
  trace,
  model,
  property,
  violationIndex,
  title,
}: Props) {
  if (!trace || trace.length === 0) {
    return (
      <div className="rounded border border-line bg-ink-50 px-3 py-2 text-[12.5px] text-ink-600">
        The solver returned an empty trace.
      </div>
    );
  }

  const variableNames = Object.keys(model.variables);
  const hasMode = variableNames.includes("mode");
  const violationAt = violationIndex ?? trace.length - 1;
  const focusVars = propertyVariables(property, variableNames);

  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-line pb-2">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">
          Counterexample trace
        </h3>
        {title && (
          <span className="font-mono text-[11px] text-ink-400">{title}</span>
        )}
      </div>

      <ol className="mt-4 space-y-1.5">
        {trace.map((step, i) => {
          const prev = i > 0 ? trace[i - 1] : null;
          const isViolation = i === violationAt;
          const transition = (step.transition as string | undefined) || (i === 0 ? "(initial)" : "");
          const changes = changedVars(prev, step, variableNames);
          return (
            <li
              key={i}
              className={clsx(
                "grid grid-cols-[28px_1fr] items-start gap-3 rounded border px-3 py-2 text-[12.5px]",
                isViolation
                  ? "border-red-200 bg-red-50/50"
                  : "border-line bg-paper",
              )}
            >
              <span
                className={clsx(
                  "mt-0.5 flex h-5 w-5 items-center justify-center rounded font-mono text-[11px]",
                  isViolation
                    ? "bg-red-700 text-white"
                    : "bg-ink-100 text-ink-500",
                )}
              >
                {(step.t as number | undefined) ?? i}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  {hasMode && (
                    <span
                      className={clsx(
                        "font-mono text-[12px]",
                        isViolation ? "font-semibold text-red-900" : "text-ink-900",
                      )}
                    >
                      mode={String(step.mode ?? "—")}
                    </span>
                  )}
                  {transition && (
                    <span className="text-[11.5px] text-ink-500">
                      via{" "}
                      <code className="font-mono text-ink-700">{transition}</code>
                    </span>
                  )}
                </div>

                {/* Changes since previous step */}
                {changes.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {changes.map((c) => (
                      <ChangeChip
                        key={c.name}
                        name={c.name}
                        before={c.before}
                        after={c.after}
                        highlight={isViolation && focusVars.has(c.name)}
                      />
                    ))}
                  </div>
                )}

                {/* Focus variables (always shown for the violation row so
                    the reader can see the state at the moment of failure) */}
                {isViolation && focusVars.size > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {[...focusVars]
                      .filter((v) => v !== "mode" || !hasMode)
                      .filter(
                        (v) =>
                          !changes.some((c) => c.name === v),
                      )
                      .map((v) => (
                        <Pill
                          key={v}
                          label={`${v}=${formatValue(step[v] as VarValue | undefined)}`}
                          tone="violation"
                        />
                      ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface VarChange {
  name: string;
  before: VarValue | undefined;
  after: VarValue | undefined;
}

function changedVars(
  prev: TraceStep | null,
  next: TraceStep,
  vars: string[],
): VarChange[] {
  const out: VarChange[] = [];
  for (const v of vars) {
    const a = next[v] as VarValue | undefined;
    const b = prev ? (prev[v] as VarValue | undefined) : undefined;
    if (prev === null) {
      // Initial step: show as "starts at" only for the focus variables;
      // skip generic var listing here to keep step 0 readable.
      continue;
    }
    if (!sameValue(a, b)) {
      out.push({ name: v, before: b, after: a });
    }
  }
  return out;
}

function sameValue(a: VarValue | undefined, b: VarValue | undefined): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return String(a) === String(b);
}

function formatValue(v: VarValue | undefined): string {
  if (v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * Variables referenced by the property's condition / trigger / response.
 * Used to highlight the relevant chips and to print focus pills on the
 * violation row.
 */
function propertyVariables(
  property: PropertySpec | null | undefined,
  knownVars: string[],
): Set<string> {
  const out = new Set<string>();
  if (!property) return out;
  const exprs = [property.condition, property.trigger, property.response].filter(
    (e): e is string => !!e,
  );
  for (const expr of exprs) {
    for (const clause of splitConjuncts(expr)) {
      for (const v of knownVars) {
        // crude but accurate enough — match the variable name as a word
        const re = new RegExp(`\\b${escapeRegex(v)}\\b`);
        if (re.test(clause)) out.add(v);
      }
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ChangeChip({
  name,
  before,
  after,
  highlight,
}: {
  name: string;
  before: VarValue | undefined;
  after: VarValue | undefined;
  highlight: boolean;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-baseline gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]",
        highlight
          ? "border-red-300 bg-red-100/60 text-red-800"
          : "border-line bg-ink-50 text-ink-700",
      )}
    >
      <span className="text-ink-500">{name}:</span>
      <span className="text-ink-400">{formatValue(before)}</span>
      <span className="text-ink-400">→</span>
      <span>{formatValue(after)}</span>
    </span>
  );
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "violation" | "normal";
}) {
  return (
    <span
      className={clsx(
        "rounded border px-1.5 py-0.5 font-mono text-[11px]",
        tone === "violation"
          ? "border-red-300 bg-red-100/50 text-red-800"
          : "border-line bg-ink-50 text-ink-600",
      )}
    >
      {label}
    </span>
  );
}
