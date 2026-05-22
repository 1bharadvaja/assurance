"use client";

import clsx from "clsx";
import { useState } from "react";
import {
  type Clause,
  type TransitionEdit,
  type VariableChoice,
  buildClausesFromGuard,
  buildGuard,
  formatPredicate,
  variableChoices,
} from "../lib/playground";
import type { ModelSpec, TransitionSpec } from "../lib/types";

interface Props {
  model: ModelSpec;
  transition: TransitionSpec;
  edit: TransitionEdit;
  onChange: (next: TransitionEdit) => void;
  onResetThisTransition: () => void;
}

export function TransitionEditor({
  model,
  transition,
  edit,
  onChange,
  onResetThisTransition,
}: Props) {
  const choices = variableChoices(model);
  const generated = edit.disabled
    ? "false  (transition disabled)"
    : buildGuard(edit);

  const dirty =
    edit.disabled ||
    edit.clauses.some((c) => !c.original || !c.active);

  return (
    <div className="space-y-4 rounded border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[12px] text-ink-500">
            {transition.name}.guard
          </div>
          <div className="mt-1 text-[12.5px] text-ink-500">
            {edit.disabled
              ? "Transition is disabled. The verifier will ignore it."
              : "Toggle clauses or add new ones. The generated guard is shown below."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DisableToggle
            on={edit.disabled}
            onChange={(v) =>
              onChange({ ...edit, disabled: v })
            }
          />
          <button
            type="button"
            onClick={onResetThisTransition}
            disabled={!dirty}
            className={clsx(
              "rounded border border-line px-2.5 py-1 text-[12px] transition",
              dirty
                ? "bg-paper text-ink-700 hover:bg-ink-50"
                : "bg-ink-50 text-ink-400 cursor-not-allowed"
            )}
          >
            Reset this transition
          </button>
        </div>
      </div>

      <fieldset
        disabled={edit.disabled}
        className={clsx("space-y-1.5", edit.disabled && "opacity-50")}
      >
        {edit.clauses.map((c, i) => (
          <ClauseRow
            key={`${i}-${c.text}`}
            clause={c}
            onToggle={(v) =>
              onChange({
                ...edit,
                clauses: edit.clauses.map((x, j) =>
                  j === i ? { ...x, active: v } : x
                ),
              })
            }
            onRemove={
              c.original
                ? undefined
                : () =>
                    onChange({
                      ...edit,
                      clauses: edit.clauses.filter((_, j) => j !== i),
                    })
            }
          />
        ))}
        <AddClause
          choices={choices}
          onAdd={(p) =>
            onChange({
              ...edit,
              clauses: [
                ...edit.clauses,
                { text: formatPredicate(p), active: true, original: false },
              ],
            })
          }
        />
      </fieldset>

      <div className="rounded border border-line bg-ink-50 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wider text-ink-500">
          Generated guard
        </div>
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12.5px] text-ink-800">
          {generated}
        </pre>
      </div>
    </div>
  );
}

function ClauseRow({
  clause,
  onToggle,
  onRemove,
}: {
  clause: Clause;
  onToggle: (v: boolean) => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded border px-3 py-1.5 font-mono text-[12.5px] transition",
        clause.active
          ? "border-line bg-paper text-ink-800"
          : "border-line bg-ink-50 text-ink-400 line-through"
      )}
    >
      <input
        type="checkbox"
        checked={clause.active}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-3.5 w-3.5"
      />
      <span className="flex-1 truncate">{clause.text}</span>
      {!clause.original && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
          added
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded text-[11px] text-ink-400 transition hover:text-ink-700"
        >
          remove
        </button>
      )}
    </div>
  );
}

function AddClause({
  choices,
  onAdd,
}: {
  choices: VariableChoice[];
  onAdd: (p: { variable: string; operator: "==" | "!="; value: string; text: string }) => void;
}) {
  const [variable, setVariable] = useState(choices[0]?.name ?? "");
  const [operator, setOperator] = useState<"==" | "!=">("==");
  const choice = choices.find((c) => c.name === variable) ?? choices[0];
  const [value, setValue] = useState(choice?.values[0] ?? "");

  // Reset the value dropdown when the variable changes.
  function onVarChange(v: string) {
    setVariable(v);
    const next = choices.find((c) => c.name === v);
    setValue(next?.values[0] ?? "");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-dashed border-line bg-paper px-3 py-1.5 text-[12.5px]">
      <span className="text-ink-400">add</span>
      <select
        value={variable}
        onChange={(e) => onVarChange(e.target.value)}
        className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[12px] text-ink-800"
      >
        {choices.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        value={operator}
        onChange={(e) => setOperator(e.target.value as "==" | "!=")}
        className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[12px] text-ink-800"
      >
        <option value="==">==</option>
        <option value="!=">!=</option>
      </select>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[12px] text-ink-800"
      >
        {(choice?.values ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() =>
          choice &&
          onAdd({
            variable,
            operator,
            value,
            text: `${variable} ${operator} ${value}`,
          })
        }
        className="ml-1 rounded border border-line bg-ink-50 px-2 py-0.5 text-[12px] text-ink-700 transition hover:bg-ink-100"
      >
        Add predicate
      </button>
    </div>
  );
}

function DisableToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={clsx(
        "inline-flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1 text-[12px] transition",
        on
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-line bg-paper text-ink-600 hover:bg-ink-50"
      )}
    >
      <span
        className={clsx(
          "relative inline-flex h-3 w-6 items-center rounded-full transition",
          on ? "bg-red-500" : "bg-ink-200"
        )}
      >
        <span
          className={clsx(
            "inline-block h-2.5 w-2.5 transform rounded-full bg-white transition",
            on ? "translate-x-3" : "translate-x-0.5"
          )}
        />
      </span>
      Disable transition
      <input
        type="checkbox"
        className="hidden"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export { buildClausesFromGuard };
