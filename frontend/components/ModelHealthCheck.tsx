"use client";

import clsx from "clsx";
import type {
  HealthClassification,
  HealthCheckItem,
  HealthReport,
} from "../lib/types";

interface Props {
  report: HealthReport;
}

export function ModelHealthCheck({ report }: Props) {
  const { classification, items, coverage } = report;
  const errorCount = items.filter((i) => i.severity === "error").length;
  const warningCount = items.filter((i) => i.severity === "warning").length;

  return (
    <section className="rounded border border-line bg-paper">
      <header
        className={clsx(
          "flex flex-wrap items-baseline justify-between gap-2 rounded-t border-b px-4 py-2.5",
          classification === "blocked"
            ? "border-red-200 bg-red-50"
            : classification === "checkable_with_warnings"
            ? "border-amber-200 bg-amber-50"
            : "border-emerald-200 bg-emerald-50"
        )}
      >
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
            Model health check
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium text-ink-900">
            {classificationLabel(classification)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-ink-700">
          <span>{errorCount} error{errorCount === 1 ? "" : "s"}</span>
          <span className="text-ink-300">·</span>
          <span>{warningCount} warning{warningCount === 1 ? "" : "s"}</span>
        </div>
      </header>

      {/* Coverage summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-[11.5px] text-ink-700 sm:grid-cols-4">
        <CoverageStat label="Variables" value={coverage.variables_count} />
        <CoverageStat
          label="Transitions"
          value={coverage.transitions_count}
        />
        <CoverageStat
          label="Properties"
          value={coverage.properties_generated}
        />
        <CoverageStat
          label="Req. mapped"
          value={
            coverage.requirements_mentioned > 0
              ? `${coverage.requirements_mapped}/${coverage.requirements_mentioned}`
              : `${coverage.requirements_mapped}`
          }
          hint={
            coverage.requirements_mentioned > coverage.requirements_mapped
              ? "Some description sentences may not be in the model."
              : undefined
          }
        />
      </div>

      <ul className="divide-y divide-line">
        {items.map((it, idx) => (
          <HealthRow key={`${it.category}-${idx}`} item={it} />
        ))}
      </ul>
    </section>
  );
}

function classificationLabel(c: HealthClassification): string {
  if (c === "blocked") return "Draft blocked by validation";
  if (c === "checkable_with_warnings")
    return "Checkable — some modeling assumptions may be wrong";
  return "Checkable";
}

function CoverageStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div className="text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div
        className={clsx(
          "font-mono text-[12.5px] text-ink-900",
          hint && "text-amber-800"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function HealthRow({ item }: { item: HealthCheckItem }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <SeverityBadge severity={item.severity} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[12.5px] font-medium text-ink-900">
            {item.title}
          </span>
          <span className="font-mono text-[10.5px] text-ink-400">
            {item.category}
          </span>
        </div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-ink-700">
          {item.message}
        </div>
        {item.suggested_fix && (
          <div className="mt-1 text-[11.5px] leading-snug text-ink-500">
            <span className="font-medium text-ink-600">Suggested fix:</span>{" "}
            {item.suggested_fix}
          </div>
        )}
      </div>
    </li>
  );
}

function SeverityBadge({ severity }: { severity: HealthCheckItem["severity"] }) {
  const cfg =
    severity === "error"
      ? { label: "error", cls: "bg-red-100 text-red-800 border-red-200" }
      : severity === "warning"
      ? { label: "warning", cls: "bg-amber-100 text-amber-800 border-amber-200" }
      : { label: "pass", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
  return (
    <span
      className={clsx(
        "mt-0.5 inline-flex h-5 shrink-0 items-center rounded border px-1.5 font-mono text-[10px] uppercase tracking-wider",
        cfg.cls
      )}
    >
      {cfg.label}
    </span>
  );
}
