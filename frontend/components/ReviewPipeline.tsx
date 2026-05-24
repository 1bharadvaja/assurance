"use client";

import { useEffect, useMemo, useState } from "react";

import { AIDraftView } from "./AIDraftView";
import { AIReviewLog } from "./AIReviewLog";
import { FormalCheckProgress, type ProgressEvent } from "./FormalCheckProgress";
import { HypothesisResults } from "./HypothesisResults";
import { PipelineStageCard } from "./PipelineStageCard";
import { RiskHypothesisList } from "./RiskHypothesisList";
import { SpecIntentInput } from "./SpecIntentInput";
import {
  checkHypotheses,
  draftSpec,
  isDemoMode,
  reviewSpec,
} from "../lib/api";
import type {
  HypothesisCheckResponse,
  SpecDraftResponse,
  SpecReviewResponse,
} from "../lib/types";

const DEFAULT_DESCRIPTION = `A field robot has modes Idle, Armed, Mission, DegradedComms, Recovery, EmergencyStop, and Actuate. Actuate means the robot performs an irreversible command. The robot may lose communications during a mission. It should only actuate if a human operator approved the action and sensors agree. If battery is low, it should enter Recovery or EmergencyStop.`;

type Stage = 1 | 2 | 3 | 4 | 5;

const PROGRESS_STEPS: string[] = [
  "Validating model",
  "Encoding bounded model checking query",
  "Running Z3",
  "Extracting counterexample",
];

export function ReviewPipeline() {
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [draft, setDraft] = useState<SpecDraftResponse | null>(null);
  const [review, setReview] = useState<SpecReviewResponse | null>(null);
  const [checkResults, setCheckResults] = useState<HypothesisCheckResponse | null>(
    null
  );
  const [bound, setBound] = useState(10);
  const [stage, setStage] = useState<Stage>(1);

  const [isDrafting, setIsDrafting] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Run the deterministic progress animation while the actual API call is
  // in flight. The events are intentionally side-effect-free — they describe
  // what the backend is doing, in the same order, but the real outcome
  // comes from the API response.
  useEffect(() => {
    if (!isChecking) return;
    setProgress(
      PROGRESS_STEPS.map((label, i) => ({
        label,
        status: i === 0 ? "active" : "pending",
      }))
    );
    let i = 1;
    const t = setInterval(() => {
      setProgress((cur) => {
        if (i >= PROGRESS_STEPS.length) return cur;
        const next = cur.map((e, idx) =>
          idx === i - 1
            ? { ...e, status: "done" as const }
            : idx === i
            ? { ...e, status: "active" as const }
            : e
        );
        i += 1;
        return next;
      });
    }, 350);
    return () => clearInterval(t);
  }, [isChecking]);

  const stageState = (s: Stage) => {
    if (stage === s) return "active" as const;
    if (stage > s) return "done" as const;
    return "blocked" as const;
  };

  async function onDraft() {
    setIsDrafting(true);
    setError(null);
    setDraft(null);
    setReview(null);
    setCheckResults(null);
    try {
      const resp = await draftSpec({ description });
      setDraft(resp);
      setStage(2);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDrafting(false);
    }
  }

  async function onAcceptDraft() {
    if (!draft) return;
    setIsReviewing(true);
    setError(null);
    try {
      const resp = await reviewSpec({
        model: draft.model,
        properties: draft.properties,
        description,
      });
      setReview(resp);
      setStage(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsReviewing(false);
    }
  }

  async function onSendToChecker() {
    if (!draft || !review) return;
    setIsChecking(true);
    setError(null);
    setStage(4);
    try {
      const resp = await checkHypotheses({
        base_model: draft.model,
        properties: draft.properties,
        hypotheses: review.hypotheses,
        bound,
      });
      setCheckResults(resp);
      // Mark all progress steps done before flipping to the Finding stage.
      setProgress((cur) => cur.map((e) => ({ ...e, status: "done" })));
      setStage(5);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsChecking(false);
    }
  }

  function reset() {
    setDraft(null);
    setReview(null);
    setCheckResults(null);
    setStage(1);
    setError(null);
    setProgress([]);
  }

  const findingSummary = useMemo(() => {
    if (!checkResults) return null;
    const c = checkResults.results.filter(
      (r) => r.classification === "confirmed_failure"
    ).length;
    const n = checkResults.results.filter(
      (r) => r.classification === "no_counterexample"
    ).length;
    const t = checkResults.results.filter(
      (r) => r.classification === "timeout"
    ).length;
    return { confirmed: c, clean: n, timeout: t };
  }, [checkResults]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
      <header>
        <div className="text-[12px] uppercase tracking-wider text-ink-500">
          Spec-to-formal-check pipeline
        </div>
        <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900">
          AI proposes. Z3 checks.
        </h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-600">
          The reviewer drafts a state-machine model and a small set of safety
          checks from your description, then proposes risk hypotheses. Z3
          confirms or refutes each one by finding a concrete reachable trace.
          The review log is not a proof; the solver is the source of truth
          for reachability.
        </p>
        {isDemoMode() && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            Static demo mode is on — the Review Pipeline needs the live
            backend. The Guided Review tab still works with bundled
            snapshots.
          </div>
        )}
      </header>

      <Stepper stage={stage} />

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
          {error}
        </div>
      )}

      <PipelineStageCard
        step={1}
        title="User intent"
        caption="plain English"
        state={stage === 1 ? "active" : "done"}
      >
        <SpecIntentInput
          description={description}
          onChange={setDescription}
          onDraft={onDraft}
          isDrafting={isDrafting}
          disabled={stage > 1}
        />
        {stage > 1 && (
          <p className="mt-3 text-[11.5px] text-ink-400">
            Edit the description and{" "}
            <button
              type="button"
              onClick={reset}
              className="underline-offset-2 hover:underline"
            >
              restart the pipeline
            </button>{" "}
            to draft again.
          </p>
        )}
      </PipelineStageCard>

      <PipelineStageCard
        step={2}
        title="AI draft"
        caption={draft?.used_llm ? "from LLM" : draft ? "deterministic" : ""}
        state={stageState(2)}
      >
        {!draft ? (
          <p className="text-[12.5px] text-ink-500">
            Drafting will populate this stage with the modes, variables,
            transitions, and safety checks the reviewer pulled from your
            description.
          </p>
        ) : (
          <AIDraftView
            draft={draft}
            isReviewing={isReviewing}
            onAccept={onAcceptDraft}
            showAcceptButton={stage === 2}
          />
        )}
      </PipelineStageCard>

      <PipelineStageCard
        step={3}
        title="AI review log"
        caption={
          review?.used_llm ? "from LLM" : review ? "deterministic" : ""
        }
        state={stageState(3)}
      >
        {!review ? (
          <p className="text-[12.5px] text-ink-500">
            After you accept the draft, the reviewer emits short auditable
            observations and risk hypotheses. The hypotheses go to the solver
            in stage 4.
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <SectionLabel>Observations</SectionLabel>
              <div className="mt-2">
                <AIReviewLog items={review.review_log} />
              </div>
            </div>
            <div>
              <SectionLabel>Risk hypotheses</SectionLabel>
              <div className="mt-2">
                <RiskHypothesisList
                  hypotheses={review.hypotheses}
                  bound={bound}
                  onBoundChange={setBound}
                  onSend={onSendToChecker}
                  isChecking={isChecking}
                />
              </div>
            </div>
          </div>
        )}
      </PipelineStageCard>

      <PipelineStageCard
        step={4}
        title="Formal check (Z3)"
        caption={isChecking ? "running" : checkResults ? "complete" : ""}
        state={stageState(4)}
      >
        {progress.length === 0 ? (
          <p className="text-[12.5px] text-ink-500">
            When you send hypotheses to the checker, the solver builds the
            bounded model checking query and runs Z3. Progress events appear
            here in real time.
          </p>
        ) : (
          <FormalCheckProgress events={progress} />
        )}
      </PipelineStageCard>

      <PipelineStageCard
        step={5}
        title="Finding"
        caption={
          findingSummary
            ? `${findingSummary.confirmed} confirmed · ${findingSummary.clean} clean · ${findingSummary.timeout} timeout`
            : ""
        }
        state={stageState(5)}
      >
        {!checkResults ? (
          <p className="text-[12.5px] text-ink-500">
            Each finding is a concrete answer from Z3. Confirmed findings come
            with a reachable trace; absence of a counterexample is reported
            honestly as &quot;no counterexample found up to bound K&quot;.
          </p>
        ) : draft ? (
          <HypothesisResults
            results={checkResults.results}
            baseModel={draft.model}
            properties={draft.properties}
            bound={bound}
          />
        ) : null}
      </PipelineStageCard>
    </div>
  );
}

function Stepper({ stage }: { stage: Stage }) {
  const items: { id: Stage; label: string }[] = [
    { id: 1, label: "Intent" },
    { id: 2, label: "Draft" },
    { id: 3, label: "Review" },
    { id: 4, label: "Check" },
    { id: 5, label: "Finding" },
  ];
  return (
    <nav className="flex flex-wrap items-center gap-1 text-[12.5px]">
      {items.map((it, i) => (
        <div key={it.id} className="flex items-center">
          <span
            className={
              it.id === stage
                ? "rounded bg-ink-100 px-2 py-1 font-medium text-ink-900"
                : it.id < stage
                ? "rounded px-2 py-1 text-emerald-700"
                : "rounded px-2 py-1 text-ink-400"
            }
          >
            <span className="mr-1.5 font-mono text-[11px] text-ink-400">
              {String(it.id).padStart(2, "0")}
            </span>
            {it.label}
          </span>
          {i < items.length - 1 && <span className="mx-1 text-ink-300">→</span>}
        </div>
      ))}
    </nav>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
      {children}
    </div>
  );
}
