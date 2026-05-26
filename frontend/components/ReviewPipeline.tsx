"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AIDraftView } from "./AIDraftView";
import { AIReviewLog } from "./AIReviewLog";
import { ClarificationPanel } from "./ClarificationPanel";
import { DraftEditPanel } from "./DraftEditPanel";
import { FormalCheckProgress, type ProgressEvent } from "./FormalCheckProgress";
import {
  HypothesisResults,
  type PostRepairOutcome,
} from "./HypothesisResults";
import { PipelineStageCard } from "./PipelineStageCard";
import { RiskHypothesisList } from "./RiskHypothesisList";
import { SpecIntentInput } from "./SpecIntentInput";
import {
  applyRepair as applyRepairApi,
  checkHypotheses,
  clarifyDescription,
  draftSpec,
  DraftBlockedError,
  isDemoMode,
  reviewSpec,
  verify as verifyApi,
} from "../lib/api";
import type {
  ClarifyResponse,
  HypothesisCheckResponse,
  HypothesisCheckResult,
  ModelSpec,
  RegressionEntry,
  SpecDraftResponse,
  SpecReviewResponse,
} from "../lib/types";
import {
  type TransitionEdit,
  buildEditFromTransition,
  buildEditedModel,
  hasEdits as hasAnyEdits,
} from "../lib/playground";

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

  // The original AI-drafted spec — keeps its provenance (used_llm,
  // warnings) and serves as the base for any edits.
  const [draft, setDraft] = useState<SpecDraftResponse | null>(null);

  // Per-transition edits the user has applied to the draft. The "active"
  // model that gets sent to review and to the solver is derived from
  // (draft.model, edits).
  const [edits, setEdits] = useState<Record<string, TransitionEdit>>({});
  const [editorTransition, setEditorTransition] = useState<string>("");

  const [review, setReview] = useState<SpecReviewResponse | null>(null);
  const [checkResults, setCheckResults] = useState<HypothesisCheckResponse | null>(
    null
  );
  const [postRepair, setPostRepair] = useState<Record<string, PostRepairOutcome>>(
    {}
  );

  const [bound, setBound] = useState(10);
  const [stage, setStage] = useState<Stage>(1);

  const [isDrafting, setIsDrafting] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Clarification flow state. The panel only appears once the user
  // explicitly asks for it (or when the backend rejects review with a
  // blocked-draft error).
  const [clarify, setClarify] = useState<ClarifyResponse | null>(null);
  const [clarifyLoading, setClarifyLoading] = useState(false);
  const [clarifyError, setClarifyError] = useState<string | null>(null);
  const [clarifyOpen, setClarifyOpen] = useState(false);

  // Track which model and hypothesis set the current review and check
  // belong to. If the user edits the model after running review/check,
  // those panels should display a "stale" banner.
  const [reviewedModelSig, setReviewedModelSig] = useState<string | null>(null);
  const [checkedModelSig, setCheckedModelSig] = useState<string | null>(null);

  // Refs for smooth-scroll between stages.
  const stageRefs: Record<Stage, React.RefObject<HTMLDivElement>> = {
    1: useRef<HTMLDivElement>(null),
    2: useRef<HTMLDivElement>(null),
    3: useRef<HTMLDivElement>(null),
    4: useRef<HTMLDivElement>(null),
    5: useRef<HTMLDivElement>(null),
  };
  const scrollToStage = (s: Stage) => {
    stageRefs[s].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Drive the Stage-4 progress events animation while the actual API call
  // is in flight.
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

  // Derived: current working model (draft + edits).
  const activeModel: ModelSpec | null = useMemo(() => {
    if (!draft) return null;
    return buildEditedModel(draft.model, edits);
  }, [draft, edits]);

  const modelSignature = (m: ModelSpec | null) =>
    m ? JSON.stringify(m) : "";

  const activeSig = useMemo(() => modelSignature(activeModel), [activeModel]);
  const hasEdits = hasAnyEdits(edits);
  const reviewStale =
    review !== null && reviewedModelSig !== null && reviewedModelSig !== activeSig;
  const checkStale =
    checkResults !== null && checkedModelSig !== null && checkedModelSig !== activeSig;

  const stageState = (s: Stage) => {
    if (!draft && s >= 2) return "blocked" as const;
    if (s === 1 && stage > 1) return "done" as const;
    if (s === stage) return "active" as const;
    if (s < stage) return "done" as const;
    // Once the draft exists, Stage 2 is always active (the user can
    // re-edit at any time). The other stages remain blocked until their
    // upstream artifact exists.
    if (s === 2 && draft) return "active" as const;
    return "blocked" as const;
  };

  // -----------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------

  async function onDraft() {
    setIsDrafting(true);
    setError(null);
    setDraft(null);
    setEdits({});
    setReview(null);
    setCheckResults(null);
    setPostRepair({});
    setReviewedModelSig(null);
    setCheckedModelSig(null);
    setClarify(null);
    setClarifyError(null);
    setClarifyOpen(false);
    try {
      const resp = await draftSpec({ description });
      setDraft(resp);
      setEditorTransition(resp.model.transitions[0]?.name ?? "");
      setStage(2);
      setTimeout(() => scrollToStage(2), 60);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDrafting(false);
    }
  }

  async function onAskClarification() {
    setClarifyOpen(true);
    setClarifyLoading(true);
    setClarifyError(null);
    setClarify(null);
    try {
      const resp = await clarifyDescription({
        description,
        health_items: draft?.health?.items ?? [],
      });
      setClarify(resp);
    } catch (err) {
      setClarifyError((err as Error).message);
    } finally {
      setClarifyLoading(false);
    }
  }

  function onApplyRewrite(rewrite: string) {
    setDescription(rewrite);
    setClarifyOpen(false);
    setClarify(null);
    scrollToStage(1);
  }

  function onUseExample() {
    setClarifyOpen(false);
    setClarify(null);
    scrollToStage(1);
  }

  function onFixDraft() {
    // The transition editor lives behind a disclosure on Stage 2; we
    // can't auto-open it from here, but jumping to Stage 2 puts the
    // user in the right place.
    scrollToStage(2);
  }

  async function onAcceptDraft() {
    if (!draft || !activeModel) return;
    setIsReviewing(true);
    setError(null);
    // Re-running review supersedes any previous check + post-repair state.
    setCheckResults(null);
    setPostRepair({});
    setCheckedModelSig(null);
    try {
      const resp = await reviewSpec({
        model: activeModel,
        properties: draft.properties,
        description,
        abstraction_plan: draft.abstraction_plan,
      });
      setReview(resp);
      setReviewedModelSig(activeSig);
      setStage(3);
      setTimeout(() => scrollToStage(3), 60);
    } catch (err) {
      if (err instanceof DraftBlockedError) {
        // The backend re-ran the health check and rejected the (edited)
        // draft. Surface a short banner — the per-item details already
        // live in the Stage 2 health panel.
        setError(
          "Draft blocked by validation. Fix the highlighted errors in Stage 2 before reviewing."
        );
        scrollToStage(2);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setIsReviewing(false);
    }
  }

  async function onSendToChecker() {
    if (!draft || !review || !activeModel) return;
    setIsChecking(true);
    setError(null);
    setPostRepair({});
    setStage(4);
    setTimeout(() => scrollToStage(4), 60);
    try {
      const resp = await checkHypotheses({
        base_model: activeModel,
        properties: draft.properties,
        hypotheses: review.hypotheses,
        bound,
      });
      setCheckResults(resp);
      setCheckedModelSig(activeSig);
      setProgress((cur) => cur.map((e) => ({ ...e, status: "done" })));
      setStage(5);
      setTimeout(() => scrollToStage(5), 60);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsChecking(false);
    }
  }

  async function onApplyRepair(
    result: HypothesisCheckResult,
    regression: RegressionEntry
  ) {
    if (!draft || !activeModel || !regression.suggested_repair) return;
    const hypId = result.hypothesis.id;
    const repair = regression.suggested_repair;
    const isUndoMutation =
      repair.kind === "restore_transition" || repair.kind === "restore_guard_clause";

    setPostRepair((cur) => ({
      ...cur,
      [hypId]: { verify: null, inFlight: true, error: null },
    }));
    try {
      // For "undo the mutation" repairs we apply against the hypothesis's
      // mutated_model (so the result rolls the mutation back) and we
      // verify in-place without replacing the user's active model — the
      // active model already has the original transition / clause.
      // For strengthen_guard we keep the legacy flow: apply to the
      // active model and adopt the patched version going forward.
      const targetModel =
        isUndoMutation && result.hypothesis.mutation?.mutated_model
          ? result.hypothesis.mutation.mutated_model
          : activeModel;

      const { model: patched } = await applyRepairApi(targetModel, repair);

      if (!isUndoMutation) {
        // strengthen_guard path: adopt the patched model as the new
        // working model so Stage 2's editor reflects the fix.
        const newEdits: Record<string, TransitionEdit> = {};
        for (const t of patched.transitions) {
          newEdits[t.name] = buildEditFromTransition(t);
        }
        setEdits(newEdits);
        setDraft((cur) => (cur ? { ...cur, model: patched } : cur));
      }

      const v = await verifyApi({
        model: patched,
        properties: draft.properties,
        bound,
      });
      setPostRepair((cur) => ({
        ...cur,
        [hypId]: { verify: v, inFlight: false, error: null },
      }));
    } catch (err) {
      setPostRepair((cur) => ({
        ...cur,
        [hypId]: {
          verify: null,
          inFlight: false,
          error: (err as Error).message,
        },
      }));
    }
  }

  function resetAll() {
    setDraft(null);
    setEdits({});
    setReview(null);
    setCheckResults(null);
    setPostRepair({});
    setReviewedModelSig(null);
    setCheckedModelSig(null);
    setStage(1);
    setError(null);
    setProgress([]);
  }

  function resetTransition(name: string) {
    setEdits((cur) => {
      const { [name]: _, ...rest } = cur;
      return rest;
    });
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

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

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
          The LLM first chooses a finite-state abstraction — modes,
          environment inputs, latched state, dangerous and recovery
          modes — and only then writes the formal model. Validation
          checks the model like a compiler; invalid drafts get repaired
          using the validation errors or the user is asked to clarify.{" "}
          <strong>Z3 only sees validated models.</strong>
        </p>
        {isDemoMode() && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            Static demo mode is on — the Review Pipeline needs the live
            backend. The Guided Review tab still works with bundled
            snapshots.
          </div>
        )}
      </header>

      <Stepper stage={stage} onJump={(s) => scrollToStage(s)} draftExists={!!draft} />

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
          {error}
        </div>
      )}

      <div ref={stageRefs[1]} className="scroll-mt-16">
        <PipelineStageCard
          step={1}
          title="User intent"
          caption="plain English"
          state={stage === 1 && !draft ? "active" : "done"}
        >
          <SpecIntentInput
            description={description}
            onChange={setDescription}
            onDraft={onDraft}
            isDrafting={isDrafting}
            disabled={false}
          />
          {draft && (
            <p className="mt-3 text-[11.5px] text-ink-400">
              Editing the description and re-drafting will{" "}
              <button
                type="button"
                onClick={resetAll}
                className="underline-offset-2 hover:underline"
              >
                discard the current draft and start over
              </button>
              .
            </p>
          )}
        </PipelineStageCard>
      </div>

      <div ref={stageRefs[2]} className="scroll-mt-16">
        <PipelineStageCard
          step={2}
          title="AI draft"
          caption={
            draft
              ? `${captionFor(draft.draft_source, draft.repair_attempts)}${
                  hasEdits ? " · edited" : ""
                }`
              : ""
          }
          state={stageState(2)}
        >
          {!draft ? (
            <p className="text-[12.5px] text-ink-500">
              Drafting will populate this stage with the modes, variables,
              transitions, and safety checks the reviewer pulled from your
              description.
            </p>
          ) : activeModel ? (
            <>
              <AIDraftView
                usedLlm={draft.used_llm}
                draftSource={draft.draft_source}
                repairAttempts={draft.repair_attempts}
                fallbackReason={draft.fallback_reason}
                llmModelName={draft.llm_model_name}
                warnings={draft.warnings}
                model={activeModel}
                properties={draft.properties}
                assumptions={draft.assumptions}
                hasEdits={hasEdits}
                isReviewing={isReviewing}
                onAccept={onAcceptDraft}
                acceptLabel={review ? "Re-run review" : "Accept draft and review weak points"}
                showAcceptButton
                abstractionPlan={draft.abstraction_plan}
                health={draft.health}
                onAskClarification={onAskClarification}
                onFixDraft={onFixDraft}
                onUseExample={onUseExample}
                editPanel={
                  <DraftEditPanel
                    baseModel={draft.model}
                    selected={editorTransition}
                    onSelectedChange={setEditorTransition}
                    edits={edits}
                    onChange={(t, edit) =>
                      setEdits((cur) => ({ ...cur, [t]: edit }))
                    }
                    onResetTransition={resetTransition}
                    onResetAll={() => setEdits({})}
                  />
                }
              />
              {clarifyOpen && (
                <div className="mt-4">
                  <ClarificationPanel
                    result={clarify}
                    loading={clarifyLoading}
                    error={clarifyError}
                    onAsk={onAskClarification}
                    onApplyRewrite={onApplyRewrite}
                    onUseExample={onUseExample}
                  />
                </div>
              )}
            </>
          ) : null}
        </PipelineStageCard>
      </div>

      <div ref={stageRefs[3]} className="scroll-mt-16">
        <PipelineStageCard
          step={3}
          title="AI review log"
          caption={
            review
              ? review.used_llm
                ? `from LLM${review.llm_model_name ? `: ${review.llm_model_name}` : ""}`
                : "deterministic"
              : ""
          }
          state={stageState(3)}
        >
          {!review ? (
            <p className="text-[12.5px] text-ink-500">
              After you accept the draft, the reviewer emits short auditable
              observations and risk hypotheses. The hypotheses go to the
              solver in stage 4.
            </p>
          ) : (
            <div className="space-y-5">
              {reviewStale && (
                <StaleBanner
                  label="Model has been edited since this review was generated."
                  action="Re-run review"
                  onAction={onAcceptDraft}
                  loading={isReviewing}
                />
              )}
              {review.warnings.length > 0 && (
                <ReviewWarnings warnings={review.warnings} />
              )}
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
      </div>

      <div ref={stageRefs[4]} className="scroll-mt-16">
        <PipelineStageCard
          step={4}
          title="Formal check (Z3)"
          caption={isChecking ? "running" : checkResults ? "complete" : ""}
          state={stageState(4)}
        >
          {progress.length === 0 ? (
            <p className="text-[12.5px] text-ink-500">
              When you send hypotheses to the checker, the solver builds the
              bounded model checking query and runs Z3. Progress events
              appear here in real time.
            </p>
          ) : (
            <FormalCheckProgress events={progress} />
          )}
        </PipelineStageCard>
      </div>

      <div ref={stageRefs[5]} className="scroll-mt-16">
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
              Each finding is a concrete answer from Z3. Confirmed findings
              come with a reachable trace; absence of a counterexample is
              reported honestly as &quot;no counterexample found up to bound
              K&quot;.
            </p>
          ) : draft && activeModel ? (
            <div className="space-y-4">
              {checkStale && (
                <StaleBanner
                  label="Model has been edited since this check was run. Re-run the review and the check to see updated findings."
                  action="Re-run review"
                  onAction={onAcceptDraft}
                  loading={isReviewing}
                />
              )}
              <HypothesisResults
                results={checkResults.results}
                baseModel={activeModel}
                properties={draft.properties}
                bound={bound}
                postRepair={postRepair}
                onApplyRepair={onApplyRepair}
              />
              <div className="rounded border border-line bg-ink-50 px-4 py-3">
                <div className="text-[12px] uppercase tracking-wider text-ink-500">
                  Continue iterating
                </div>
                <p className="mt-1 text-[12.5px] text-ink-700">
                  Edit the model in Stage 2 (transition picker → toggle
                  clauses / add predicates) and re-run review to see how the
                  hypotheses change.
                </p>
                <button
                  type="button"
                  onClick={() => scrollToStage(2)}
                  className="mt-2 inline-flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-800 transition hover:bg-ink-100"
                >
                  Edit the model →
                </button>
              </div>
            </div>
          ) : null}
        </PipelineStageCard>
      </div>
    </div>
  );
}

function StaleBanner({
  label,
  action,
  onAction,
  loading,
}: {
  label: string;
  action: string;
  onAction: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
      <span>{label}</span>
      <button
        type="button"
        onClick={onAction}
        disabled={loading}
        className="rounded border border-amber-400 bg-paper px-2.5 py-1 text-[12px] text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Running…" : action}
      </button>
    </div>
  );
}

function Stepper({
  stage,
  onJump,
  draftExists,
}: {
  stage: Stage;
  onJump: (s: Stage) => void;
  draftExists: boolean;
}) {
  const items: { id: Stage; label: string }[] = [
    { id: 1, label: "Intent" },
    { id: 2, label: "Draft" },
    { id: 3, label: "Review" },
    { id: 4, label: "Check" },
    { id: 5, label: "Finding" },
  ];
  return (
    <nav className="flex flex-wrap items-center gap-1 text-[12.5px]">
      {items.map((it, i) => {
        const reachable = it.id === 1 || draftExists;
        return (
          <div key={it.id} className="flex items-center">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onJump(it.id)}
              className={
                it.id === stage
                  ? "rounded bg-ink-100 px-2 py-1 font-medium text-ink-900"
                  : it.id < stage
                  ? "rounded px-2 py-1 text-emerald-700 hover:bg-ink-50"
                  : reachable
                  ? "rounded px-2 py-1 text-ink-500 hover:bg-ink-50"
                  : "rounded px-2 py-1 text-ink-300 cursor-not-allowed"
              }
            >
              <span className="mr-1.5 font-mono text-[11px] text-ink-400">
                {String(it.id).padStart(2, "0")}
              </span>
              {it.label}
            </button>
            {i < items.length - 1 && <span className="mx-1 text-ink-300">→</span>}
          </div>
        );
      })}
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

function captionFor(
  source: SpecDraftResponse["draft_source"] | null | undefined,
  repairs: number | null | undefined,
): string {
  const r = repairs ?? 0;
  switch (source) {
    case "llm":
      return "from LLM";
    case "llm_repaired":
      return r === 1 ? "LLM + 1 repair pass" : `LLM + ${r} repair passes`;
    case "template_fallback":
      return "template fallback (LLM failed)";
    case "deterministic_fallback":
      return "template fallback (no LLM key)";
    case "blocked":
      return "blocked by validation";
    default:
      return "";
  }
}

function ReviewWarnings({ warnings }: { warnings: string[] }) {
  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
      <div className="font-medium">Reviewer caveats</div>
      <ul className="mt-1 list-disc pl-5">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
