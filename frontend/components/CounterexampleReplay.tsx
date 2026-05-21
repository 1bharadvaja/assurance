"use client";

import clsx from "clsx";
import { buildReplay, type ReplayStep } from "../lib/narrative";
import type { TraceStep } from "../lib/types";

interface Props {
  trace: TraceStep[];
  propertyTitle: string;
}

export function CounterexampleReplay({ trace, propertyTitle }: Props) {
  const replay = buildReplay(trace);
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-line pb-2">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink-900">
          Path the checker found
        </h3>
        <span className="font-mono text-[11px] text-ink-400">{propertyTitle}</span>
      </div>

      <ol className="mt-4 space-y-1.5">
        {replay.map((step) => (
          <Row key={step.index} step={step} />
        ))}
      </ol>

      {replay.length > 0 && replay[replay.length - 1].isViolation && (
        <FinalCallout step={replay[replay.length - 1]} />
      )}
    </div>
  );
}

function Row({ step }: { step: ReplayStep }) {
  const isViolation = step.isViolation;
  return (
    <li
      className={clsx(
        "grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded border px-3 py-2 text-[13px]",
        isViolation
          ? "border-red-200 bg-red-50/50"
          : "border-line bg-paper"
      )}
    >
      <span
        className={clsx(
          "flex h-5 w-5 items-center justify-center rounded font-mono text-[11px]",
          isViolation
            ? "bg-red-700 text-white"
            : "bg-ink-100 text-ink-500"
        )}
      >
        {step.index}
      </span>
      <div className="min-w-0">
        <div
          className={clsx(
            "truncate",
            isViolation ? "font-medium text-red-900" : "text-ink-900"
          )}
        >
          {step.title}
          <span className="ml-2 text-ink-400">{step.narrative}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-500">
        <Pill label={step.mode} highlight={isViolation && step.mode === "Actuate"} />
        <Pill
          label={`comms=${step.comms}`}
          highlight={step.comms === "Lost"}
        />
        <Pill
          label={`human_authorized=${step.human_authorized ? "true" : "false"}`}
          highlight={isViolation && !step.human_authorized}
        />
      </div>
    </li>
  );
}

function Pill({ label, highlight = false }: { label: string; highlight?: boolean }) {
  return (
    <span
      className={clsx(
        "rounded border px-1.5 py-0.5",
        highlight
          ? "border-red-300 bg-red-100/50 text-red-800"
          : "border-line bg-ink-50 text-ink-600"
      )}
    >
      {label}
    </span>
  );
}

function FinalCallout({ step }: { step: ReplayStep }) {
  return (
    <div
      role="region"
      aria-label="Violation summary"
      className="mt-4 rounded border border-red-200 bg-red-50/60 px-4 py-3"
    >
      <div className="text-[12px] font-semibold uppercase tracking-wider text-red-800">
        Violation
      </div>
      <pre className="mt-2 font-mono text-[13.5px] leading-6 text-red-900">
{`mode             = ${step.mode}
comms            = ${step.comms}
human_authorized = ${step.human_authorized ? "true" : "false"}`}
      </pre>
    </div>
  );
}
