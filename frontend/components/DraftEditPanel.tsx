"use client";

import { TransitionEditor } from "./TransitionEditor";
import {
  type TransitionEdit,
  TRANSITION_DESCRIPTIONS,
  buildEditFromTransition,
} from "../lib/playground";
import type { ModelSpec } from "../lib/types";

interface Props {
  baseModel: ModelSpec;
  selected: string;
  onSelectedChange: (name: string) => void;
  edits: Record<string, TransitionEdit>;
  onChange: (transition: string, edit: TransitionEdit) => void;
  onResetTransition: (transition: string) => void;
  onResetAll: () => void;
}

export function DraftEditPanel({
  baseModel,
  selected,
  onSelectedChange,
  edits,
  onChange,
  onResetTransition,
  onResetAll,
}: Props) {
  const allTransitions = baseModel.transitions.map((t) => t.name);
  const transitionSpec = baseModel.transitions.find((t) => t.name === selected);
  const currentEdit: TransitionEdit | null = transitionSpec
    ? edits[selected] ?? buildEditFromTransition(transitionSpec)
    : null;
  const editedCount = Object.values(edits).filter(
    (e) => e.disabled || e.clauses.some((c) => !c.original || !c.active)
  ).length;

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-ink-600">
        Toggle a clause, add a new predicate, or disable a transition. The
        edited model is what gets sent for review and to the solver. Edits
        layer on top of the draft — use <em>Reset all edits</em> to discard
        them.
      </p>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-[12.5px] text-ink-600">
          Transition
          <select
            value={selected}
            onChange={(e) => onSelectedChange(e.target.value)}
            className="rounded border border-line bg-paper px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900"
          >
            {allTransitions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 text-[11.5px] text-ink-500">
          <span>{editedCount} transition{editedCount === 1 ? "" : "s"} edited</span>
          <button
            type="button"
            onClick={onResetAll}
            disabled={editedCount === 0}
            className="rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink-700 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset all edits
          </button>
        </div>
      </div>

      {transitionSpec && currentEdit && (
        <>
          <p className="text-[12px] text-ink-500">
            {TRANSITION_DESCRIPTIONS[selected] ||
              "Transition from the drafted model."}
          </p>
          <TransitionEditor
            model={baseModel}
            transition={transitionSpec}
            edit={currentEdit}
            onChange={(next) => onChange(selected, next)}
            onResetThisTransition={() => onResetTransition(selected)}
          />
        </>
      )}
    </div>
  );
}
