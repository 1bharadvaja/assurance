"use client";

import { Disclosure } from "./Disclosure";
import type {
  CandidateMutation,
  PropertySpec,
  TransitionSpec,
} from "../lib/types";

interface Props {
  mutation?: CandidateMutation | null;
  property?: PropertySpec | null;
  /** The transition in the BASE model — used to diff guards for the
   * remove_clause case. */
  baseTransition?: TransitionSpec | null;
  /** The mutated guard (post-edit). Optional; for disable_transition
   * there is no replacement guard. */
  newGuard?: string | null;
}

/**
 * Domain-general "where it broke" card. Reads from (mutation kind,
 * transition name, failed property, before/after guards) — no
 * hardcoded copy about DegradedComms, human_authorized, or operator
 * approval. Replaces the drone-specific RootCauseCard for the Review
 * Pipeline path.
 */
export function WhereItBrokeCard({
  mutation,
  property,
  baseTransition,
  newGuard,
}: Props) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-line pb-2">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">
          Where it broke
        </h3>
        {mutation && (
          <span className="font-mono text-[11px] text-ink-400">
            {mutation.transition}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-1.5 text-[13px] text-ink-800">
        <Row label="Failed property">
          <span className="text-ink-900">
            {property?.title || property?.name || "(unknown)"}
          </span>
          {property?.type && (
            <span className="ml-2 rounded border border-line bg-ink-50 px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-600">
              {property.type === "bounded_response"
                ? "bounded response"
                : property.type}
            </span>
          )}
        </Row>

        {mutation && (
          <>
            <Row label="Mutation kind">
              <code className="font-mono text-[12px] text-ink-900">
                {mutation.kind}
              </code>
            </Row>
            <Row label="Transition">
              <code className="font-mono text-[12px] text-ink-900">
                {mutation.transition}
              </code>
            </Row>
            {mutation.kind === "remove_guard_clause" && mutation.removed_clause && (
              <Row label="Removed clause">
                <code className="font-mono text-[12px] text-red-700">
                  {mutation.removed_clause}
                </code>
              </Row>
            )}
            {mutation.kind === "disable_transition" && (
              <Row label="Effect">
                <span className="text-ink-700">
                  Transition removed entirely; cannot fire in the mutated model.
                </span>
              </Row>
            )}
          </>
        )}
      </div>

      {(baseTransition?.guard || newGuard) && (
        <Disclosure label="transition guards">
          <div className="grid gap-2">
            {baseTransition?.guard && (
              <pre className="overflow-x-auto rounded border border-line bg-paper p-3 font-mono text-[12px] leading-5 text-ink-800">
                {`baseline:  ${baseTransition.guard}`}
              </pre>
            )}
            {newGuard && (
              <pre className="overflow-x-auto rounded border border-line bg-paper p-3 font-mono text-[12px] leading-5 text-ink-800">
                {`mutated:   ${newGuard}`}
              </pre>
            )}
          </div>
        </Disclosure>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="min-w-[140px] text-[11px] font-medium uppercase tracking-wider text-ink-500">
        {label}
      </span>
      <span className="flex flex-wrap items-baseline gap-2">{children}</span>
    </div>
  );
}
