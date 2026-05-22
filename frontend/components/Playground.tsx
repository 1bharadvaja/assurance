"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PlaygroundResults } from "./PlaygroundResults";
import { PresetRow } from "./PresetRow";
import { TransitionEditor } from "./TransitionEditor";
import { Disclosure } from "./Disclosure";
import {
  applyRepair as applyRepairApi,
  assuranceDiff,
  getScenario,
  isDemoMode,
} from "../lib/api";
import type {
  AssuranceDiffResponse,
  ModelSpec,
  RegressionEntry,
  ScenarioBundle,
} from "../lib/types";
import {
  PRESETS,
  type Preset,
  type TransitionEdit,
  TRANSITION_DESCRIPTIONS,
  applyPreset,
  buildEditFromTransition,
  buildEditedModel,
  hasEdits,
} from "../lib/playground";

const SCENARIO_ID = "mission-controller";
const BOUNDS = [4, 6, 8, 10, 12, 16, 20];

export function Playground() {
  const [scenario, setScenario] = useState<ScenarioBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, TransitionEdit>>({});
  const [selected, setSelected] = useState<string>("authorized_actuation");
  const [bound, setBound] = useState<number>(10);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const [diff, setDiff] = useState<AssuranceDiffResponse | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isApplyingRepair, setIsApplyingRepair] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getScenario(SCENARIO_ID)
      .then((s) => {
        if (cancelled) return;
        setScenario(s);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Whenever the user switches transitions in the picker, make sure we
  // have an edit entry for it so the editor has something to render
  // (initialised to the safe baseline guard).
  useEffect(() => {
    if (!scenario || edits[selected]) return;
    const t = scenario.safe_model.transitions.find((x) => x.name === selected);
    if (!t) return;
    setEdits((cur) => ({ ...cur, [selected]: buildEditFromTransition(t) }));
  }, [scenario, selected, edits]);

  const editedModel: ModelSpec | null = useMemo(() => {
    if (!scenario) return null;
    return buildEditedModel(scenario.safe_model, edits);
  }, [scenario, edits]);

  const allTransitions = useMemo(
    () => scenario?.safe_model.transitions.map((t) => t.name) ?? [],
    [scenario]
  );

  const transitionSpec =
    scenario?.safe_model.transitions.find((t) => t.name === selected) ?? null;
  const currentEdit =
    edits[selected] ??
    (transitionSpec ? buildEditFromTransition(transitionSpec) : null);

  function onPreset(p: Preset) {
    if (!scenario) return;
    const next = applyPreset(p, edits, scenario.safe_model);
    setEdits(next);
    setActivePreset(p.id === "reset" ? null : p.id);
    setDiff(null);
    setError(null);
    if (p.focusTransition) setSelected(p.focusTransition);
  }

  async function runCheck() {
    if (!scenario || !editedModel) return;
    if (isDemoMode()) {
      setError(
        "Playground requires the live verifier backend. Set NEXT_PUBLIC_DEMO_MODE=false and point NEXT_PUBLIC_API_BASE at a running backend."
      );
      return;
    }
    setIsChecking(true);
    setError(null);
    try {
      const res = await assuranceDiff({
        old_model: scenario.safe_model,
        new_model: editedModel,
        properties: scenario.properties,
        bound,
      });
      setDiff(res);
    } catch (err) {
      setError((err as Error).message);
      setDiff(null);
    } finally {
      setIsChecking(false);
    }
  }

  async function onApplyRepair(reg: RegressionEntry) {
    if (!scenario || !editedModel || !reg.suggested_repair) return;
    setIsApplyingRepair(true);
    setError(null);
    try {
      const { model: patched } = await applyRepairApi(
        editedModel,
        reg.suggested_repair
      );
      // Re-derive edits from the patched model so the editor reflects the fix.
      const newEdits: Record<string, TransitionEdit> = {};
      for (const t of patched.transitions) {
        newEdits[t.name] = buildEditFromTransition(t);
      }
      setEdits(newEdits);
      const res = await assuranceDiff({
        old_model: scenario.safe_model,
        new_model: patched,
        properties: scenario.properties,
        bound,
      });
      setDiff(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsApplyingRepair(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h2 className="text-xl font-semibold text-ink-900">Playground</h2>
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-[14px] text-red-900">
          <p className="font-semibold">Cannot load scenario.</p>
          <p className="mt-1">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      <header>
        <div className="text-[12px] uppercase tracking-wider text-ink-500">
          Self-exploration
        </div>
        <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-ink-900">
          Edit a transition. Ask the verifier what breaks.
        </h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-600">
          Pick a transition, toggle clauses on or off, add a new predicate, or
          disable the transition entirely. When you click <em>Check this
          model</em> the edited spec is sent to the live FastAPI backend and
          Z3 looks for an execution that violates one of the safety rules.
        </p>
        {isDemoMode() && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            Static demo mode is on — the Playground needs the live backend. The
            Guided Review tab still works with bundled snapshots.
          </div>
        )}
      </header>

      <PresetRow onApply={onPreset} activeId={activePreset} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-600">
          Transition
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border border-line bg-paper px-2.5 py-1.5 font-mono text-[13px] text-ink-900"
          >
            {allTransitions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-600">
          Bound
          <select
            value={bound}
            onChange={(e) => setBound(parseInt(e.target.value, 10))}
            className="rounded border border-line bg-paper px-2.5 py-1.5 font-mono text-[13px] text-ink-900"
            title="Higher bounds search longer executions but take longer."
          >
            {BOUNDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={runCheck}
          disabled={isChecking || !editedModel}
          className={clsx(
            "inline-flex h-[34px] items-center gap-2 rounded-md border border-accent bg-accent px-3.5 text-[13px] font-medium text-white transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
          )}
        >
          {isChecking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isChecking ? "Checking…" : "Check this model"}
        </button>
      </div>

      {transitionSpec && currentEdit && (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-500">
            {TRANSITION_DESCRIPTIONS[selected] || "Transition in the safe baseline."}
          </p>
          <TransitionEditor
            model={scenario!.safe_model}
            transition={transitionSpec}
            edit={currentEdit}
            onChange={(next) => {
              setEdits((cur) => ({ ...cur, [selected]: next }));
              setActivePreset(null);
            }}
            onResetThisTransition={() => {
              if (!transitionSpec) return;
              setEdits((cur) => ({
                ...cur,
                [selected]: buildEditFromTransition(transitionSpec),
              }));
              setActivePreset(null);
            }}
          />
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
          {error}
        </div>
      )}

      {diff && scenario && (
        <PlaygroundResults
          diff={diff}
          properties={scenario.properties}
          baseModel={scenario.safe_model}
          bound={bound}
          onApplyRepair={onApplyRepair}
          isApplyingRepair={isApplyingRepair}
        />
      )}

      {scenario && (
        <Disclosure label="raw model (JSON)">
          <pre className="overflow-x-auto rounded border border-line bg-ink-50 p-3 font-mono text-[11.5px] leading-5 text-ink-800">
            {JSON.stringify(editedModel, null, 2)}
          </pre>
          {hasEdits(edits) && (
            <p className="mt-2 text-[12px] text-ink-500">
              The above is what gets POSTed to{" "}
              <code className="font-mono">/api/assurance-diff</code> when you
              press <em>Check this model</em>.
            </p>
          )}
        </Disclosure>
      )}
    </div>
  );
}
