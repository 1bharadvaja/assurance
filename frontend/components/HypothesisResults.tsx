"use client";

import clsx from "clsx";
import { CounterexampleReplay } from "./CounterexampleReplay";
import { RawTraceDisclosure } from "./RawTraceDisclosure";
import { RootCauseCard } from "./RootCauseCard";
import type {
  HypothesisCheckResult,
  ModelSpec,
  PropertySpec,
} from "../lib/types";

interface Props {
  results: HypothesisCheckResult[];
  baseModel: ModelSpec;
  properties: PropertySpec[];
  bound: number;
}

export function HypothesisResults({
  results,
  baseModel,
  properties,
  bound,
}: Props) {
  if (results.length === 0) {
    return (
      <div className="rounded border border-line bg-ink-50 px-3 py-2 text-[12.5px] text-ink-600">
        No hypothesis results returned.
      </div>
    );
  }

  const confirmed = results.filter((r) => r.classification === "confirmed_failure");
  const noCE = results.filter((r) => r.classification === "no_counterexample");
  const timeouts = results.filter((r) => r.classification === "timeout");
  const invalid = results.filter((r) => r.classification === "invalid");

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-4">
        <Tile label="Confirmed" count={confirmed.length} tone="bad" />
        <Tile label="No counterexample" count={noCE.length} tone="ok" />
        <Tile label="Timeout" count={timeouts.length} tone="warn" />
        <Tile label="Invalid" count={invalid.length} tone="muted" />
      </div>

      {results.map((r, i) => (
        <ResultBlock
          key={r.hypothesis.id || i}
          result={r}
          baseModel={baseModel}
          properties={properties}
          bound={bound}
        />
      ))}
    </div>
  );
}

function Tile({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "bad" | "ok" | "warn" | "muted";
}) {
  return (
    <div
      className={clsx(
        "rounded border px-3 py-2",
        tone === "bad" && "border-red-200 bg-red-50/50",
        tone === "ok" && "border-emerald-200 bg-emerald-50/40",
        tone === "warn" && "border-amber-200 bg-amber-50/50",
        tone === "muted" && "border-line bg-ink-50"
      )}
    >
      <div className="text-[11px] uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-ink-900">
        {count}
      </div>
    </div>
  );
}

function ResultBlock({
  result,
  baseModel,
  properties,
  bound,
}: {
  result: HypothesisCheckResult;
  baseModel: ModelSpec;
  properties: PropertySpec[];
  bound: number;
}) {
  const { hypothesis, classification, diff, verify, error } = result;
  const tone =
    classification === "confirmed_failure"
      ? "bad"
      : classification === "no_counterexample"
      ? "ok"
      : classification === "timeout"
      ? "warn"
      : "muted";

  return (
    <article
      className={clsx(
        "rounded border bg-paper",
        tone === "bad" && "border-red-200",
        tone === "ok" && "border-emerald-200",
        tone === "warn" && "border-amber-200",
        tone === "muted" && "border-line"
      )}
    >
      <header
        className={clsx(
          "flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-2.5",
          tone === "bad" && "border-red-100 bg-red-50/40",
          tone === "ok" && "border-emerald-100 bg-emerald-50/30",
          tone === "warn" && "border-amber-100 bg-amber-50/40",
          tone === "muted" && "border-line bg-ink-50"
        )}
      >
        <div>
          <div className="font-medium text-ink-900">{hypothesis.title}</div>
          <p className="mt-0.5 text-[12.5px] text-ink-600">{hypothesis.summary}</p>
        </div>
        <ClassificationBadge classification={classification} />
      </header>

      <div className="px-4 py-3">
        {classification === "invalid" && (
          <div className="rounded border border-line bg-ink-50 px-3 py-2 text-[12.5px] text-ink-700">
            {error || "The solver could not act on this hypothesis."}
          </div>
        )}

        {classification === "timeout" && (
          <p className="text-[12.5px] text-amber-900">
            The solver did not decide within the time limit. Try a smaller bound
            or a simpler edit.
          </p>
        )}

        {classification === "no_counterexample" && (
          <p className="text-[12.5px] text-emerald-900">
            No counterexample found up to bound {bound}. The reviewer&apos;s
            suspicion was not confirmed within this horizon.
          </p>
        )}

        {classification === "confirmed_failure" && diff && (
          <ConfirmedFailure
            diff={diff}
            baseModel={baseModel}
            properties={properties}
            bound={bound}
          />
        )}

        {classification === "confirmed_failure" && verify && (
          <ConfirmedFromVerify verify={verify} bound={bound} baseModel={baseModel} />
        )}
      </div>
    </article>
  );
}

function ClassificationBadge({
  classification,
}: {
  classification: HypothesisCheckResult["classification"];
}) {
  const label = {
    confirmed_failure: "Confirmed by Z3",
    no_counterexample: "No counterexample",
    timeout: "Solver timed out",
    invalid: "Invalid",
  }[classification];
  const cls = {
    confirmed_failure: "border-red-300 bg-red-100/60 text-red-900",
    no_counterexample: "border-emerald-300 bg-emerald-100/60 text-emerald-900",
    timeout: "border-amber-300 bg-amber-100/60 text-amber-900",
    invalid: "border-ink-300 bg-ink-100 text-ink-700",
  }[classification];
  return (
    <span
      className={clsx(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider",
        cls
      )}
    >
      {label}
    </span>
  );
}

function ConfirmedFailure({
  diff,
  baseModel,
  properties,
  bound,
}: {
  diff: import("../lib/types").AssuranceDiffResponse;
  baseModel: ModelSpec;
  properties: PropertySpec[];
  bound: number;
}) {
  const reg = diff.regressions[0];
  if (!reg) {
    return (
      <p className="text-[12.5px] text-ink-700">
        The diff reports a failure but no regression entry was attached.
      </p>
    );
  }
  const failedProp = properties.find((p) => p.name === reg.property);
  const safeTransition = baseModel.transitions.find(
    (t) => t.name === reg.culprit_transition?.name
  );

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-red-900">
        The solver found a reachable execution that violates{" "}
        <span className="font-medium">{failedProp?.title || reg.property}</span>.
      </p>
      <CounterexampleReplay
        trace={reg.counterexample}
        propertyTitle={failedProp?.title || reg.property}
      />
      {reg.culprit_transition && (
        <RootCauseCard
          transitionName={reg.culprit_transition.name}
          missingPredicate={reg.suggested_repair?.add_predicate || "—"}
          safeGuard={safeTransition?.guard || "—"}
          newGuard={reg.culprit_transition.guard}
        />
      )}
      <RawTraceDisclosure
        trace={reg.counterexample}
        columns={Object.keys(baseModel.variables)}
        violationTime={reg.counterexample.length - 1}
      />
      <p className="text-[11.5px] text-ink-500">
        Checked up to bound {bound}. The trace above is a concrete execution
        of the mutated model.
      </p>
    </div>
  );
}

function ConfirmedFromVerify({
  verify,
  bound,
  baseModel,
}: {
  verify: import("../lib/types").VerifyResponse;
  bound: number;
  baseModel: ModelSpec;
}) {
  const failed = verify.results.find((r) => r.status === "fail");
  if (!failed || !failed.counterexample) {
    return null;
  }
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-red-900">
        The property <span className="font-medium">{failed.title || failed.property}</span>{" "}
        fails on the base model.
      </p>
      <CounterexampleReplay
        trace={failed.counterexample}
        propertyTitle={failed.title || failed.property}
      />
      <RawTraceDisclosure
        trace={failed.counterexample}
        columns={Object.keys(baseModel.variables)}
        violationTime={failed.violation_time ?? failed.counterexample.length - 1}
      />
      <p className="text-[11.5px] text-ink-500">
        Checked up to bound {bound}.
      </p>
    </div>
  );
}
