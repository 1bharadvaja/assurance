"use client";

import clsx from "clsx";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import type { PropertySpec, VerificationResult } from "../lib/types";

type Status = "unchecked" | "pass" | "fail";

interface Props {
  properties: PropertySpec[];
  resultsByName: Record<string, VerificationResult | undefined>;
}

export function RequirementCards({ properties, resultsByName }: Props) {
  return (
    <section id="requirements">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-ink-100">Mission requirements</h3>
        <span className="text-xs text-ink-400">
          Each guarantee is a machine-checked property.
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {properties.map((p) => {
          const r = resultsByName[p.name];
          const status: Status = r ? r.status : "unchecked";
          return <Card key={p.name} property={p} status={status} elapsedMs={r?.elapsed_ms} />;
        })}
      </div>
    </section>
  );
}

function Card({
  property,
  status,
  elapsedMs,
}: {
  property: PropertySpec;
  status: Status;
  elapsedMs?: number | null;
}) {
  const tone =
    status === "pass"
      ? "border-emerald-500/40 bg-emerald-500/[0.04]"
      : status === "fail"
      ? "border-rose-500/40 bg-rose-500/[0.06]"
      : "border-ink-800 bg-ink-900/60";

  return (
    <div className={clsx("rounded-lg border p-4 shadow-card", tone)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-400">
            {property.title || property.name}
          </div>
          <div className="mt-1 font-mono text-xs text-ink-300">
            {property.name}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      {property.description && (
        <p className="mt-2 text-sm text-ink-200">{property.description}</p>
      )}
      <div className="mt-3 flex items-center justify-between text-[11px] text-ink-500">
        <span className="font-mono uppercase tracking-wide">
          {property.type === "invariant" ? "invariant" : `bounded_response(b=${property.bound})`}
        </span>
        {elapsedMs !== undefined && elapsedMs !== null && (
          <span>{elapsedMs.toFixed(0)}ms</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "pass") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        passed
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300">
        <XCircle className="h-3 w-3" />
        failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-800 px-2 py-0.5 text-[11px] font-medium text-ink-400">
      <Circle className="h-3 w-3" />
      unchecked
    </span>
  );
}
