"use client";

import clsx from "clsx";
import { AlertOctagon, ArrowDown, ChevronRight } from "lucide-react";
import { buildReplay } from "../lib/narrative";
import type { TraceStep } from "../lib/types";

interface Props {
  trace: TraceStep[];
  propertyTitle: string;
}

export function CounterexampleReplay({ trace, propertyTitle }: Props) {
  const replay = buildReplay(trace);
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ink-50">
          Unsafe execution found
        </h3>
        <span className="font-mono text-xs text-ink-400">{propertyTitle}</span>
      </div>
      <p className="mt-1 text-sm text-ink-300">
        The verifier produced this reachable sequence ending in a state that
        violates the mission rule.
      </p>

      <ol className="mt-5 space-y-3">
        {replay.map((step, i) => (
          <li key={step.index} className="relative">
            <Card step={step} />
            {i < replay.length - 1 && (
              <div className="my-1 flex justify-center text-ink-700">
                <ArrowDown className="h-4 w-4" />
              </div>
            )}
          </li>
        ))}
      </ol>

      {replay.length > 0 && replay[replay.length - 1].isViolation && (
        <FinalCallout step={replay[replay.length - 1]} />
      )}
    </div>
  );
}

function Card({ step }: { step: ReturnType<typeof buildReplay>[number] }) {
  const isViolation = step.isViolation;
  return (
    <div
      className={clsx(
        "flex items-start gap-4 rounded-xl border px-4 py-3.5 shadow-card",
        isViolation
          ? "border-rose-500/60 bg-rose-500/[0.09]"
          : "border-ink-800 bg-ink-900/60"
      )}
    >
      <div
        className={clsx(
          "flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-semibold",
          isViolation
            ? "bg-rose-500 text-white"
            : "bg-ink-800 text-ink-200"
        )}
      >
        {step.index}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div
            className={clsx(
              "text-base font-semibold",
              isViolation ? "text-rose-50" : "text-ink-50"
            )}
          >
            {step.title}
          </div>
          {step.transition && (
            <div className="font-mono text-[11px] uppercase tracking-wide text-ink-500">
              <ChevronRight className="-mt-0.5 mr-0.5 inline h-3 w-3" />
              {step.transition}
            </div>
          )}
        </div>
        <p
          className={clsx(
            "mt-1 text-sm",
            isViolation ? "text-rose-100" : "text-ink-300"
          )}
        >
          {step.narrative}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px]">
          <StatePill label="mode" value={step.mode} highlight={isViolation && step.mode === "Actuate"} />
          <StatePill
            label="comms"
            value={step.comms}
            highlight={step.comms === "Lost"}
          />
          <StatePill
            label="human_authorized"
            value={step.human_authorized ? "true" : "false"}
            highlight={isViolation && !step.human_authorized}
          />
        </div>
      </div>
    </div>
  );
}

function StatePill({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5",
        highlight
          ? "border-rose-500/40 bg-rose-500/[0.12] text-rose-100"
          : "border-ink-700 bg-ink-950/70 text-ink-200"
      )}
    >
      <span className="text-ink-500">{label}=</span>
      <span>{value}</span>
    </span>
  );
}

function FinalCallout({ step }: { step: ReturnType<typeof buildReplay>[number] }) {
  return (
    <div
      role="region"
      aria-label="Violation summary"
      className="mt-5 rounded-2xl border-2 border-rose-500/60 bg-rose-500/[0.10] p-5 shadow-card"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-rose-300">
        <AlertOctagon className="h-4 w-4" />
        Violation reached
      </div>
      <div className="mt-2 font-mono text-base leading-relaxed text-rose-50">
        <div>
          mode = <span className="font-semibold">{step.mode}</span>
        </div>
        <div>
          comms = <span className="font-semibold">{step.comms}</span>
        </div>
        <div>
          human_authorized ={" "}
          <span className="font-semibold">
            {step.human_authorized ? "true" : "false"}
          </span>
        </div>
      </div>
      <p className="mt-3 text-sm text-rose-100">
        The mission rule says actuation must never happen with comms lost and
        no human approval — and yet this state is reachable.
      </p>
    </div>
  );
}
