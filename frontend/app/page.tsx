"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AssuranceReport } from "../components/AssuranceReport";
import { CounterexampleReplay } from "../components/CounterexampleReplay";
import { GuaranteeCheckPanel } from "../components/GuaranteeCheckPanel";
import { MissionRuleCard, SectionHeader } from "../components/MissionRuleCard";
import { OneLineDiffCard } from "../components/OneLineDiffCard";
import { RawTraceDisclosure } from "../components/RawTraceDisclosure";
import { RestoreGuardPanel } from "../components/RestoreGuardPanel";
import { ResultBanner } from "../components/ResultBanner";
import { RootCauseCard } from "../components/RootCauseCard";
import { StateGraph } from "../components/StateGraph";
import { StepperNav, type StepId } from "../components/StepperNav";
import { StoryHero } from "../components/StoryHero";
import { SuccessCard } from "../components/SuccessCard";
import {
  applyRepair as applyRepairApi,
  assuranceDiff,
} from "../lib/api";
import { getScenario } from "../lib/api";
import type {
  AssuranceDiffResponse,
  ModelSpec,
  RegressionEntry,
  RepairSpec,
  ScenarioBundle,
  VerificationResult,
  VerifyResponse,
} from "../lib/types";

const SCENARIO_ID = "mission-controller";
const BOUND = 10;
const KEY_TRANSITION = "authorized_actuation";
const HEADLINE_PROPERTY = "no_actuate_without_authority";
const HEADLINE_LABEL = "Human approval before actuation";

export default function Page() {
  const [scenario, setScenario] = useState<ScenarioBundle | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [regressionOn, setRegressionOn] = useState(false);
  const [activeModel, setActiveModel] = useState<ModelSpec | null>(null);
  const [appliedRepair, setAppliedRepair] = useState<RepairSpec | null>(null);

  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);
  const [diff, setDiff] = useState<AssuranceDiffResponse | null>(null);
  const [investigatedRegression, setInvestigatedRegression] =
    useState<RegressionEntry | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [currentStep, setCurrentStep] = useState<StepId>(1);

  const stepRefs: Record<StepId, React.RefObject<HTMLDivElement>> = {
    1: useRef<HTMLDivElement>(null),
    2: useRef<HTMLDivElement>(null),
    3: useRef<HTMLDivElement>(null),
    4: useRef<HTMLDivElement>(null),
    5: useRef<HTMLDivElement>(null),
  };

  const scrollToStep = useCallback(
    (s: StepId) => {
      stepRefs[s].current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setCurrentStep((cur) => (s > cur ? s : cur));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    let cancelled = false;
    getScenario(SCENARIO_ID)
      .then((s) => {
        if (cancelled) return;
        setScenario(s);
        setActiveModel(s.safe_model);
        setRegressionOn(false);
      })
      .catch((err: Error) => {
        if (!cancelled) setScenarioError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!scenario) return;
    setActiveModel(regressionOn ? scenario.regressed_model : scenario.safe_model);
    setVerifyResult(null);
    setDiff(null);
    setInvestigatedRegression(null);
    setAppliedRepair(null);
    setErrorMessage(null);
  }, [regressionOn, scenario]);

  const resultsByName = useMemo(() => {
    const m = new Map<string, VerificationResult>();
    for (const r of verifyResult?.results ?? []) m.set(r.property, r);
    return m;
  }, [verifyResult]);

  const liveRegression: RegressionEntry | null = useMemo(() => {
    if (!diff || diff.regressions.length === 0) return null;
    const preferred = diff.regressions.find((r) => r.property === HEADLINE_PROPERTY);
    return preferred ?? diff.regressions[0];
  }, [diff]);

  const regressionEntry: RegressionEntry | null =
    investigatedRegression ?? liveRegression;

  const headlineProp = scenario?.properties.find((p) => p.name === HEADLINE_PROPERTY);

  const safeTransition = useMemo(
    () => scenario?.safe_model.transitions.find((t) => t.name === KEY_TRANSITION),
    [scenario]
  );
  const activeTransition = useMemo(
    () => activeModel?.transitions.find((t) => t.name === KEY_TRANSITION),
    [activeModel]
  );
  const regressedTransition = useMemo(
    () =>
      scenario?.regressed_model.transitions.find((t) => t.name === KEY_TRANSITION),
    [scenario]
  );

  const completed = useMemo(() => {
    const s = new Set<StepId>();
    if (currentStep > 1) s.add(1);
    if (currentStep > 2) s.add(2);
    if (verifyResult) s.add(3);
    if (regressionEntry && (appliedRepair || currentStep > 4)) s.add(4);
    if (appliedRepair) s.add(5);
    return s;
  }, [currentStep, verifyResult, regressionEntry, appliedRepair]);

  const available = useMemo(() => {
    const s = new Set<StepId>([1, 2, 3]);
    if (regressionEntry || appliedRepair) {
      s.add(4);
      s.add(5);
    }
    return s;
  }, [regressionEntry, appliedRepair]);

  async function runVerification(model: ModelSpec) {
    if (!scenario) return;
    setIsVerifying(true);
    setErrorMessage(null);
    try {
      const response = await assuranceDiff({
        old_model: scenario.safe_model,
        new_model: model,
        properties: scenario.properties,
        bound: BOUND,
      });
      setDiff(response);
      const summary = {
        passed: response.results.filter((r) => r.status === "pass").length,
        failed: response.results.filter((r) => r.status === "fail").length,
      };
      setVerifyResult({ results: response.results, summary });
      if (!investigatedRegression && response.regressions.length > 0) {
        const preferred =
          response.regressions.find((r) => r.property === HEADLINE_PROPERTY) ??
          response.regressions[0];
        setInvestigatedRegression(preferred);
      }
      setCurrentStep((cur) => (cur < 3 ? 3 : cur));
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsVerifying(false);
    }
  }

  async function onApplyRepair() {
    if (!activeModel || !regressionEntry?.suggested_repair) return;
    setIsApplying(true);
    setErrorMessage(null);
    try {
      const repairToApply = regressionEntry.suggested_repair;
      const { model } = await applyRepairApi(activeModel, repairToApply);
      setActiveModel(model);
      await runVerification(model);
      setAppliedRepair(repairToApply);
      setCurrentStep(5);
      setTimeout(() => scrollToStep(5), 60);
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsApplying(false);
    }
  }

  if (scenarioError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-ink-900">Assurance Studio</h1>
        <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-[14px] text-red-900">
          <p className="font-semibold">Cannot reach the verification backend.</p>
          <p className="mt-1">{scenarioError}</p>
          <pre className="mt-3 rounded border border-line bg-paper p-3 font-mono text-[12px] text-ink-800">
{`cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000`}
          </pre>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-24">
      <StoryHero onStart={() => scrollToStep(1)} />

      <StepperNav
        active={currentStep}
        completed={completed}
        available={available}
        onSelect={scrollToStep}
      />

      <div className="mx-auto max-w-4xl px-6">
        <div className="space-y-14 pt-10">
          <section ref={stepRefs[1]} className="scroll-mt-16">
            {scenario && headlineProp?.condition && (
              <MissionRuleCard formalProperty={headlineProp.condition} />
            )}
          </section>

          <section ref={stepRefs[2]} className="scroll-mt-16">
            {scenario && safeTransition && regressedTransition && activeTransition && (
              <OneLineDiffCard
                transitionName={KEY_TRANSITION}
                safeGuard={safeTransition.guard}
                regressedGuard={regressedTransition.guard}
                activeGuard={activeTransition.guard}
                changeActive={regressionOn}
                repaired={appliedRepair !== null}
                onToggle={(next) => {
                  if (appliedRepair) return;
                  setRegressionOn(next);
                  if (next) {
                    setTimeout(() => scrollToStep(3), 120);
                  }
                }}
              />
            )}
          </section>

          <section ref={stepRefs[3]} className="scroll-mt-16 space-y-4">
            {scenario && activeModel && (
              <GuaranteeCheckPanel
                bound={BOUND}
                properties={scenario.properties}
                results={verifyResult?.results ?? null}
                isRunning={isVerifying}
                onRun={() => runVerification(activeModel)}
              />
            )}
            {errorMessage && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
                {errorMessage}
              </div>
            )}
            {verifyResult && (
              <ResultBanner
                status={verifyResult.summary.failed > 0 ? "fail" : "pass"}
                passed={verifyResult.summary.passed}
                failed={verifyResult.summary.failed}
                failingTitle={
                  regressionEntry ? HEADLINE_LABEL : HEADLINE_LABEL
                }
                onContinue={regressionEntry ? () => scrollToStep(4) : undefined}
                continueLabel="See the failing execution"
              />
            )}
          </section>

          {regressionEntry && (
            <section ref={stepRefs[4]} className="scroll-mt-16 space-y-6">
              <SectionHeader step="04" label="Unsafe execution" />
              <CounterexampleReplay
                trace={regressionEntry.counterexample}
                propertyTitle={HEADLINE_LABEL}
              />
              {scenario && (
                <StateGraph
                  nodes={scenario.graph.nodes}
                  edges={scenario.graph.edges}
                  counterexample={regressionEntry.counterexample}
                  culpritName={regressionEntry.culprit_transition?.name ?? null}
                />
              )}
              {regressionEntry.culprit_transition && safeTransition && (
                <RootCauseCard
                  transitionName={regressionEntry.culprit_transition.name}
                  missingPredicate={
                    regressionEntry.suggested_repair?.add_predicate || "—"
                  }
                  safeGuard={safeTransition.guard}
                  newGuard={regressionEntry.culprit_transition.guard}
                />
              )}
              {scenario && (
                <RawTraceDisclosure
                  trace={regressionEntry.counterexample}
                  columns={Object.keys(scenario.safe_model.variables)}
                  violationTime={
                    resultsByName.get(regressionEntry.property)?.violation_time ??
                    regressionEntry.counterexample.length - 1
                  }
                />
              )}
            </section>
          )}

          {regressionEntry?.suggested_repair && (
            <section ref={stepRefs[5]} className="scroll-mt-16 space-y-4">
              <RestoreGuardPanel
                repair={regressionEntry.suggested_repair}
                isApplying={isApplying}
                applied={appliedRepair !== null}
                onApply={onApplyRepair}
              />
              {appliedRepair && (
                <SuccessCard
                  propertyTitle={HEADLINE_LABEL}
                  beforeStatus="failed"
                  afterStatus="passed"
                  bound={BOUND}
                />
              )}
            </section>
          )}

          {scenario && activeModel && (
            <AssuranceReport
              scenarioTitle={scenario.title}
              modelTitle={activeModel.title || activeModel.name}
              bound={BOUND}
              properties={scenario.properties}
              results={verifyResult}
              diff={diff}
              appliedRepair={appliedRepair}
              activeModel={activeModel}
            />
          )}
        </div>
      </div>
    </main>
  );
}
