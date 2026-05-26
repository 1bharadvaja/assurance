"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { FailureExplanation } from "./FailureExplanation";
import { GenericTraceTimeline } from "./GenericTraceTimeline";
import { RawTraceDisclosure } from "./RawTraceDisclosure";
import { WhereItBrokeCard } from "./WhereItBrokeCard";
import type {
  HypothesisCheckResult,
  ModelSpec,
  PropertySpec,
  RegressionEntry,
  VerifyResponse,
} from "../lib/types";

export interface PostRepairOutcome {
  verify: VerifyResponse | null;
  inFlight: boolean;
  error: string | null;
}

interface Props {
  results: HypothesisCheckResult[];
  baseModel: ModelSpec;
  properties: PropertySpec[];
  bound: number;
  /** Per-hypothesis-id outcome of "apply repair and re-verify". */
  postRepair: Record<string, PostRepairOutcome>;
  onApplyRepair: (result: HypothesisCheckResult, regression: RegressionEntry) => void;
}

export function HypothesisResults({
  results,
  baseModel,
  properties,
  bound,
  postRepair,
  onApplyRepair,
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
          postRepair={postRepair[r.hypothesis.id]}
          onApplyRepair={onApplyRepair}
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
  postRepair,
  onApplyRepair,
}: {
  result: HypothesisCheckResult;
  baseModel: ModelSpec;
  properties: PropertySpec[];
  bound: number;
  postRepair?: PostRepairOutcome;
  onApplyRepair: (result: HypothesisCheckResult, regression: RegressionEntry) => void;
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
            hypothesis={hypothesis}
          />
        )}

        {classification === "confirmed_failure" && verify && (
          <ConfirmedFromVerify
            verify={verify}
            bound={bound}
            baseModel={baseModel}
            hypothesis={hypothesis}
          />
        )}

        {classification === "confirmed_failure" && diff && (
          <RepairPanel
            result={result}
            diff={diff}
            postRepair={postRepair}
            onApplyRepair={onApplyRepair}
            properties={properties}
            bound={bound}
          />
        )}
      </div>
    </article>
  );
}

function RepairPanel({
  result,
  diff,
  postRepair,
  onApplyRepair,
  properties,
  bound,
}: {
  result: HypothesisCheckResult;
  diff: import("../lib/types").AssuranceDiffResponse;
  postRepair?: PostRepairOutcome;
  onApplyRepair: (result: HypothesisCheckResult, regression: RegressionEntry) => void;
  properties: PropertySpec[];
  bound: number;
}) {
  const reg = diff.regressions[0];
  if (!reg) return null;

  const repair = reg.suggested_repair;
  const applied = postRepair?.verify != null;
  const inFlight = postRepair?.inFlight ?? false;
  const error = postRepair?.error ?? null;

  if (!repair) {
    return (
      <div className="mt-4 rounded border border-line bg-ink-50 px-3 py-2 text-[12.5px] text-ink-700">
        No automatic repair template matched this failure. Edit the model in
        Stage 2 and run review again to iterate.
      </div>
    );
  }

  const copy = repairCopy(repair, result);

  return (
    <div className="mt-4 space-y-3 rounded border border-line bg-ink-50 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-500">
            {copy.header}
          </div>
          <p className="mt-1 text-[12.5px] text-ink-700">{repair.rationale}</p>
        </div>
        <button
          type="button"
          onClick={() => onApplyRepair(result, reg)}
          disabled={inFlight || applied}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-[12.5px] font-medium transition",
            applied
              ? "border-emerald-700 bg-emerald-700 text-white"
              : "border-accent bg-accent text-white hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
          )}
        >
          {inFlight && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {applied ? copy.appliedLabel : inFlight ? copy.inFlightLabel : copy.idleLabel}
        </button>
      </div>

      <pre className="overflow-x-auto rounded border border-line bg-paper p-2 font-mono text-[11.5px] text-ink-800">
        {copy.preview}
      </pre>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900">
          {error}
        </div>
      )}

      {postRepair?.verify && (
        <PostRepairVerifyView verify={postRepair.verify} bound={bound} properties={properties} />
      )}
    </div>
  );
}

interface RepairCopy {
  header: string;
  idleLabel: string;
  inFlightLabel: string;
  appliedLabel: string;
  preview: string;
}

function repairCopy(
  repair: import("../lib/types").RepairSpec,
  result: HypothesisCheckResult,
): RepairCopy {
  switch (repair.kind) {
    case "restore_transition":
      return {
        header: "Undo the disabled-transition mutation",
        idleLabel: "Restore transition and check again",
        inFlightLabel: "Restoring & re-verifying…",
        appliedLabel: "Transition restored",
        preview: `+ restore transition \`${repair.transition}\` from baseline`,
      };
    case "restore_guard_clause":
      return {
        header: "Undo the removed-clause mutation",
        idleLabel: "Restore guard and check again",
        inFlightLabel: "Restoring & re-verifying…",
        appliedLabel: "Guard restored",
        preview: `+ ${repair.add_predicate ?? "<clause>"}\n  on ${repair.transition}.guard`,
      };
    case "strengthen_guard":
    default:
      // `result` is reserved for future per-hypothesis hints; unused for
      // now but kept in the signature so callers can pass it uniformly.
      void result;
      return {
        header: "Iterate on this model",
        idleLabel: "Apply repair and re-verify",
        inFlightLabel: "Applying & re-verifying…",
        appliedLabel: "Repair applied",
        preview: `+ ${repair.add_predicate ?? ""}\n  on ${repair.transition}.guard`,
      };
  }
}

function PostRepairVerifyView({
  verify,
  bound,
  properties,
}: {
  verify: VerifyResponse;
  bound: number;
  properties: PropertySpec[];
}) {
  const passed = verify.results.filter((r) => r.status === "pass").length;
  const failed = verify.results.filter((r) => r.status === "fail").length;
  const timeouts = verify.results.filter((r) => r.status === "timeout").length;
  const ok = failed === 0 && timeouts === 0;
  void properties;
  return (
    <div
      className={clsx(
        "rounded border px-3 py-2 text-[12.5px]",
        ok ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/50"
      )}
    >
      <div className={clsx("font-medium", ok ? "text-emerald-900" : "text-red-900")}>
        Re-verification: {passed}/{verify.results.length} pass
        {failed > 0 ? ` · ${failed} fail` : ""}
        {timeouts > 0 ? ` · ${timeouts} timeout` : ""}
      </div>
      <ul className="mt-1 space-y-0.5">
        {verify.results.map((r) => (
          <li key={r.property} className="flex items-center justify-between gap-3 font-mono text-[11.5px]">
            <span className="text-ink-700">{r.title || r.property}</span>
            <span
              className={
                r.status === "pass"
                  ? "text-emerald-700"
                  : r.status === "fail"
                  ? "text-red-700"
                  : "text-amber-700"
              }
            >
              {r.status}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-ink-500">
        Verified the patched model against the original safety checks up to
        bound {bound}.
      </p>
    </div>
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
  hypothesis,
}: {
  diff: import("../lib/types").AssuranceDiffResponse;
  baseModel: ModelSpec;
  properties: PropertySpec[];
  bound: number;
  hypothesis: HypothesisCheckResult["hypothesis"];
}) {
  const reg = diff.regressions[0];
  if (!reg) {
    return (
      <p className="text-[12.5px] text-ink-700">
        The diff reports a failure but no regression entry was attached.
      </p>
    );
  }
  const failedProp = properties.find((p) => p.name === reg.property) ?? null;
  const baseTransition =
    baseModel.transitions.find((t) => t.name === reg.culprit_transition?.name) ??
    (hypothesis.mutation
      ? baseModel.transitions.find((t) => t.name === hypothesis.mutation?.transition)
      : null) ??
    null;

  return (
    <div className="space-y-4">
      <FailureExplanation hypothesis={hypothesis} property={failedProp} />
      <GenericTraceTimeline
        trace={reg.counterexample}
        model={baseModel}
        property={failedProp}
        title={failedProp?.title || reg.property}
      />
      <WhereItBrokeCard
        mutation={hypothesis.mutation ?? null}
        property={failedProp}
        baseTransition={baseTransition}
        newGuard={
          hypothesis.mutation?.new_guard ??
          reg.culprit_transition?.guard ??
          null
        }
      />
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
  hypothesis,
}: {
  verify: import("../lib/types").VerifyResponse;
  bound: number;
  baseModel: ModelSpec;
  hypothesis: HypothesisCheckResult["hypothesis"];
}) {
  const failed = verify.results.find((r) => r.status === "fail");
  if (!failed || !failed.counterexample) {
    return null;
  }
  // Resolve the PropertySpec — verify results only carry the name/title.
  const failedProp: PropertySpec | null =
    (hypothesis.property && hypothesis.property.name === failed.property
      ? hypothesis.property
      : null) ?? null;
  return (
    <div className="space-y-4">
      <FailureExplanation hypothesis={hypothesis} property={failedProp} />
      <GenericTraceTimeline
        trace={failed.counterexample}
        model={baseModel}
        property={failedProp}
        title={failed.title || failed.property}
        violationIndex={
          failed.violation_time ?? failed.counterexample.length - 1
        }
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
