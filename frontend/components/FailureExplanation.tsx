"use client";

import type {
  CandidateMutation,
  PropertySpec,
  RiskHypothesis,
} from "../lib/types";

interface Props {
  hypothesis: RiskHypothesis;
  /** The property that the solver found violated. */
  property?: PropertySpec | null;
}

/**
 * Domain-general explanation for a confirmed Z3 failure. Combines the
 * hypothesis (mutation kind) with the failed property (invariant vs
 * bounded_response) to produce a short, accurate paragraph — no
 * hardcoded drone/autonomy copy.
 *
 * Falls back to a generic but correct sentence when we can't say
 * anything more specific.
 */
export function FailureExplanation({ hypothesis, property }: Props) {
  const lines = buildExplanationLines(hypothesis, property ?? null);
  return (
    <div className="rounded border border-red-200 bg-red-50/40 px-3 py-2 text-[12.5px] leading-relaxed text-red-900">
      {lines.map((line, i) => (
        <p key={i} className={i > 0 ? "mt-1" : undefined}>
          {line}
        </p>
      ))}
    </div>
  );
}

function buildExplanationLines(
  hyp: RiskHypothesis,
  property: PropertySpec | null,
): string[] {
  const out: string[] = [];

  // First line: what the candidate edit did.
  out.push(describeMutation(hyp.mutation, property));

  // Second line: what the property requires, restated from the spec.
  if (property) {
    if (property.type === "bounded_response" && property.trigger && property.response) {
      const bound = property.bound ?? 1;
      out.push(
        `The trace reaches a state where \`${property.trigger}\`, but the ` +
          `mutated model does not reach \`${property.response}\` within ${bound} ` +
          `step${bound === 1 ? "" : "s"}.`,
      );
    } else if (property.type === "invariant" && property.condition) {
      const negation = invertCondition(property.condition);
      out.push(
        `The trace reaches a state where ${negation}, violating ` +
          `\`${property.title || property.name}\`.`,
      );
    } else {
      out.push(genericFallback(property));
    }
  } else {
    out.push("The mutated model violates the failed property; see the trace below.");
  }

  return out;
}

function describeMutation(
  mut: CandidateMutation | null | undefined,
  property: PropertySpec | null,
): string {
  if (!mut) {
    if (property) {
      return `The candidate property \`${property.title || property.name}\` failed against the base model.`;
    }
    return "The solver returned a failure for this hypothesis.";
  }
  switch (mut.kind) {
    case "disable_transition":
      return (
        `The candidate edit disabled \`${mut.transition}\`. In the original ` +
        `model this transition is on the path that satisfies ` +
        `\`${property?.title || property?.name || "the failed property"}\`; ` +
        `after disabling it, that obligation can no longer be met.`
      );
    case "remove_guard_clause":
      return (
        `The candidate edit removed \`${mut.removed_clause ?? "a clause"}\` ` +
        `from the guard on \`${mut.transition}\`. The solver checked ` +
        `whether any safety property became reachable as a result.`
      );
    case "strengthen_or_weaken_guard":
      return (
        `The candidate edit replaced the guard on \`${mut.transition}\` with ` +
        `\`${mut.new_guard ?? "a modified guard"}\`. The solver checked ` +
        `whether the new guard exposes a counterexample.`
      );
    default:
      return `The candidate edit modified \`${mut.transition}\`.`;
  }
}

/**
 * For an invariant `not (...)` we can negate cleanly into the violation
 * statement. Otherwise just quote the condition as-is.
 */
function invertCondition(condition: string): string {
  const trimmed = condition.trim();
  const m = trimmed.match(/^not\s*\((.*)\)$/s);
  if (m) return `\`${m[1].trim()}\``;
  return `\`${trimmed}\` does not hold`;
}

function genericFallback(p: PropertySpec): string {
  return `The mutated model violates \`${p.title || p.name}\`. See the trace and property below.`;
}
