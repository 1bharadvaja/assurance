"use client";

import { ShieldCheck } from "lucide-react";

interface Props {
  beforeStatus: string;
  afterStatus: string;
  propertyTitle: string;
  bound: number;
}

export function SuccessCard({
  beforeStatus,
  afterStatus,
  propertyTitle,
  bound,
}: Props) {
  return (
    <div className="rounded-2xl border-2 border-emerald-500/55 bg-emerald-500/[0.10] p-6 shadow-card">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 h-7 w-7 flex-none text-emerald-300" />
        <div>
          <h3 className="text-2xl font-semibold text-emerald-50">
            Assurance restored
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-emerald-100">
            The unsafe path is no longer reachable under the checked model.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <BeforeAfter label="Before repair" value={beforeStatus} tone="bad" property={propertyTitle} />
        <BeforeAfter label="After repair" value={afterStatus} tone="ok" property={propertyTitle} />
      </div>

      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-emerald-200">
        Checked up to bound {bound}
      </div>
    </div>
  );
}

function BeforeAfter({
  label,
  value,
  tone,
  property,
}: {
  label: string;
  value: string;
  tone: "ok" | "bad";
  property: string;
}) {
  return (
    <div
      className={
        tone === "ok"
          ? "rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] p-4"
          : "rounded-lg border border-rose-500/30 bg-rose-500/[0.07] p-4"
      }
    >
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 text-sm text-ink-200">{property}</div>
      <div
        className={
          tone === "ok"
            ? "mt-1 text-lg font-semibold text-emerald-200"
            : "mt-1 text-lg font-semibold text-rose-200"
        }
      >
        {value}
      </div>
    </div>
  );
}
