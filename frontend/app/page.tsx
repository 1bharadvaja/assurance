"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown, Cpu, ShieldCheck, Sparkles } from "lucide-react";

import { AssuranceReport } from "../components/AssuranceReport";
import { CounterexampleTrace } from "../components/CounterexampleTrace";
import { CulpritTransition } from "../components/CulpritTransition";
import { MissionBrief } from "../components/MissionBrief";
import { ModelEditor } from "../components/ModelEditor";
import { RepairPanel } from "../components/RepairPanel";
import { RequirementCards } from "../components/RequirementCards";
import { StateGraph } from "../components/StateGraph";
import { VerificationPanel } from "../components/VerificationPanel";
import {
  applyRepair as applyRepairApi,
  assuranceDiff,
  getScenario,
} from "../lib/api";
import type {
  AssuranceDiffResponse,
  ModelSpec,
  PropertySpec,
  RegressionEntry,
  RepairSpec,
  ScenarioBundle,
  TransitionSpec,
  VerificationResult,
  VerifyResponse,
} from "../lib/types";

const SCENARIO_ID = "mission-controller";
const BOUND = 10;
const KEY_TRANSITION = "authorized_actuation";

export default function Page() {
  const [scenario, setScenario] = useState<ScenarioBundle | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [regressionOn, setRegressionOn] = useState(false);
  const [activeModel, setActiveModel] = useState<ModelSpec | null>(null);
  const [appliedRepair, setAppliedRepair] = useState<RepairSpec | null>(null);

  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);
  const [diff, setDiff] = useState<AssuranceDiffResponse | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load scenario on mount.
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
        if (cancelled) return;
        setScenarioError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When regression toggle changes, swap the active model and reset results.
  useEffect(() => {
    if (!scenario) return;
    setActiveModel(regressionOn ? scenario.regressed_model : scenario.safe_model);
    setVerifyResult(null);
    setDiff(null);
    setAppliedRepair(null);
    setStatusMessage(null);
    setErrorMessage(null);
  }, [regressionOn, scenario]);

  const resultsByName = useMemo(() => {
    const m: Record<string, VerificationResult | undefined> = {};
    for (const r of verifyResult?.results ?? []) {
      m[r.property] = r;
    }
    return m;
  }, [verifyResult]);

  const regressionEntry: RegressionEntry | null = useMemo(() => {
    if (!diff || diff.regressions.length === 0) return null;
    // Prefer the human-oversight regression, which is the demo focus.
    const preferred = diff.regressions.find(
      (r) => r.property === "no_actuate_without_authority"
    );
    return preferred ?? diff.regressions[0];
  }, [diff]);

  const safeTransition = useMemo(
    () => scenario?.safe_model.transitions.find((t) => t.name === KEY_TRANSITION),
    [scenario]
  );
  const activeTransition = useMemo(
    () => activeModel?.transitions.find((t) => t.name === KEY_TRANSITION),
    [activeModel]
  );

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
      const verify: VerifyResponse = {
        results: response.results,
        summary: {
          passed: response.results.filter((r) => r.status === "pass").length,
          failed: response.results.filter((r) => r.status === "fail").length,
        },
      };
      setVerifyResult(verify);
      if (verify.summary.failed === 0) {
        setStatusMessage(
          `All ${verify.summary.passed} guarantees pass up to bound ${BOUND}.`
        );
      } else {
        setStatusMessage(
          `${verify.summary.failed} guarantee(s) failed. The counterexample trace shows a concrete execution that violates a property.`
        );
      }
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
      const { model } = await applyRepairApi(
        activeModel,
        regressionEntry.suggested_repair
      );
      setActiveModel(model);
      setAppliedRepair(regressionEntry.suggested_repair);
      await runVerification(model);
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsApplying(false);
    }
  }

  if (scenarioError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-3xl font-semibold">Assurance Studio</h1>
        <div className="mt-6 rounded-md border border-rose-500/40 bg-rose-500/[0.08] p-4 text-rose-200">
          <p className="font-semibold">Cannot reach the verification backend.</p>
          <p className="mt-1 text-sm">{scenarioError}</p>
          <p className="mt-3 text-sm text-rose-300">
            Start the backend with:
          </p>
          <pre className="mt-1 rounded bg-ink-950 p-3 font-mono text-xs">
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
      <Hero />

      <div className="mx-auto max-w-6xl px-6">
        <div className="space-y-10">
          {scenario && (
            <MissionBrief
              title={scenario.title}
              description={scenario.description}
            />
          )}

          {scenario && (
            <RequirementCards
              properties={scenario.properties}
              resultsByName={resultsByName}
            />
          )}

          {scenario && (
            <StateGraph
              nodes={scenario.graph.nodes}
              edges={scenario.graph.edges}
              counterexample={regressionEntry?.counterexample ?? null}
              culpritName={regressionEntry?.culprit_transition?.name ?? null}
            />
          )}

          {scenario && (
            <ModelEditor
              transitionName={KEY_TRANSITION}
              safeTransition={safeTransition as TransitionSpec | undefined}
              currentTransition={activeTransition as TransitionSpec | undefined}
              regressionOn={regressionOn}
              repaired={appliedRepair !== null}
              onToggle={(next) => {
                if (appliedRepair) return; // lock toggle after repair
                setRegressionOn(next);
              }}
              disabled={appliedRepair !== null}
            />
          )}

          {activeModel && (
            <VerificationPanel
              bound={BOUND}
              onRun={() => runVerification(activeModel)}
              isRunning={isVerifying}
              result={verifyResult}
              message={errorMessage ?? statusMessage}
            />
          )}

          {regressionEntry && regressionEntry.culprit_transition && safeTransition && (
            <CulpritTransition
              transitionName={regressionEntry.culprit_transition.name}
              safeGuard={safeTransition.guard}
              newGuard={regressionEntry.culprit_transition.guard}
              missing={regressionEntry.suggested_repair?.add_predicate ?? "—"}
              explanation={regressionEntry.explanation}
            />
          )}

          {regressionEntry && (
            <CounterexampleTrace
              trace={regressionEntry.counterexample}
              columns={
                scenario
                  ? Object.keys(scenario.safe_model.variables)
                  : []
              }
              violationTime={
                verifyResult?.results.find(
                  (r) => r.property === regressionEntry.property
                )?.violation_time ?? null
              }
              propertyName={regressionEntry.property}
            />
          )}

          {regressionEntry?.suggested_repair && (
            <RepairPanel
              repair={regressionEntry.suggested_repair}
              applied={appliedRepair !== null}
              isApplying={isApplying}
              onApply={onApplyRepair}
            />
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

function Hero() {
  return (
    <header className="border-b border-ink-800 bg-gradient-to-b from-ink-900/60 to-transparent">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-ink-400">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" />
          Assurance Studio
        </div>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-ink-50 sm:text-5xl">
          Interactive proof regression testing for mission-critical autonomy.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-ink-300">
          Connect mission requirements to a system model, verify formal
          guarantees against an SMT-backed bounded model checker, surface
          counterexamples with explanations, and re-verify after a targeted fix.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <a
            href="#mission-brief"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-accent-dark"
          >
            <Sparkles className="h-4 w-4" />
            Start demo
            <ChevronDown className="h-4 w-4" />
          </a>
          <div className="flex items-center gap-4 text-xs text-ink-400">
            <span className="inline-flex items-center gap-1">
              <Cpu className="h-3.5 w-3.5" /> Z3 SMT solver
            </span>
            <span className="inline-flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" /> bounded model checking
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
