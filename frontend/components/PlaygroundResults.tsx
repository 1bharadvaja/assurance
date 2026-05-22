"use client";

import { CounterexampleReplay } from "./CounterexampleReplay";
import { GuaranteeChecklist } from "./GuaranteeChecklist";
import { RawTraceDisclosure } from "./RawTraceDisclosure";
import { ResultBanner } from "./ResultBanner";
import { RootCauseCard } from "./RootCauseCard";
import type {
  AssuranceDiffResponse,
  ModelSpec,
  PropertySpec,
  RegressionEntry,
} from "../lib/types";

interface Props {
  diff: AssuranceDiffResponse;
  properties: PropertySpec[];
  baseModel: ModelSpec;
  bound: number;
  onApplyRepair?: (reg: RegressionEntry) => void;
  isApplyingRepair: boolean;
}

export function PlaygroundResults({
  diff,
  properties,
  baseModel,
  bound,
  onApplyRepair,
  isApplyingRepair,
}: Props) {
  const passed = diff.results.filter((r) => r.status === "pass").length;
  const failed = diff.results.filter((r) => r.status === "fail").length;
  const timedOut = diff.results.filter((r) => r.status === "timeout").length;
  const firstReg = diff.regressions[0] ?? null;
  const failingTitle = firstReg
    ? findPrettyTitle(properties, firstReg.property)
    : findPrettyTitle(properties, diff.results.find((r) => r.status === "fail")?.property ?? "");

  return (
    <div className="space-y-5">
      <ResultBanner
        status={failed > 0 ? "fail" : "pass"}
        passed={passed}
        failed={failed}
        failingTitle={failingTitle}
      />

      {timedOut > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          {timedOut} check{timedOut === 1 ? "" : "s"} timed out at this bound. Try a smaller
          bound or a simpler edit.
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] uppercase tracking-wider text-ink-500">
          Mission rules
        </div>
        <GuaranteeChecklist properties={properties} results={diff.results} />
      </div>

      {diff.regressions.map((reg) => (
        <Regression
          key={reg.property}
          reg={reg}
          baseModel={baseModel}
          properties={properties}
          bound={bound}
          onApplyRepair={onApplyRepair}
          isApplyingRepair={isApplyingRepair}
        />
      ))}
    </div>
  );
}

function Regression({
  reg,
  baseModel,
  properties,
  bound,
  onApplyRepair,
  isApplyingRepair,
}: {
  reg: RegressionEntry;
  baseModel: ModelSpec;
  properties: PropertySpec[];
  bound: number;
  onApplyRepair?: (reg: RegressionEntry) => void;
  isApplyingRepair: boolean;
}) {
  const safeTransition = baseModel.transitions.find(
    (t) => t.name === reg.culprit_transition?.name
  );
  return (
    <div className="space-y-4">
      <CounterexampleReplay
        trace={reg.counterexample}
        propertyTitle={findPrettyTitle(properties, reg.property)}
      />

      {reg.culprit_transition && (
        <RootCauseCard
          transitionName={reg.culprit_transition.name}
          missingPredicate={reg.suggested_repair?.add_predicate ?? "—"}
          safeGuard={safeTransition?.guard ?? "—"}
          newGuard={reg.culprit_transition.guard}
        />
      )}

      {reg.suggested_repair ? (
        <div className="rounded border border-line bg-paper p-4">
          <div className="text-[12px] uppercase tracking-wider text-ink-500">
            Suggested fix
          </div>
          <p className="mt-2 text-[14px] text-ink-800">{reg.suggested_repair.rationale}</p>
          <pre className="mt-3 overflow-x-auto rounded border border-line bg-ink-50 p-3 font-mono text-[12.5px] leading-6 text-ink-800">
            {reg.suggested_repair.new_guard}
          </pre>
          {onApplyRepair && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => onApplyRepair(reg)}
                disabled={isApplyingRepair}
                className="rounded border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
              >
                {isApplyingRepair ? "Applying…" : "Apply repair and check again"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded border border-line bg-ink-50 px-4 py-3 text-[13px] text-ink-700">
          No automatic repair available for this edit. Try toggling clauses
          back on, or restore the safe baseline from the presets.
        </div>
      )}

      <RawTraceDisclosure
        trace={reg.counterexample}
        columns={Object.keys(baseModel.variables)}
        violationTime={reg.counterexample.length - 1}
      />
    </div>
  );
}

function findPrettyTitle(properties: PropertySpec[], name: string): string {
  const p = properties.find((x) => x.name === name);
  switch (p?.title) {
    case "Human Oversight":
      return "Human approval before actuation";
    case "Sensor Safety":
      return "Sensor agreement before actuation";
    case "Low Battery Recovery":
      return "Low battery reaches recovery";
    case "Armed Before Mission":
      return "Mission requires arming";
    case "GPS Safety":
      return "GPS required for mission";
    default:
      return p?.title || p?.name || name;
  }
}
