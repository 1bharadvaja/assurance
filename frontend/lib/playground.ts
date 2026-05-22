// Playground state model and helpers.
//
// The playground edits transition guards through a constrained UI rather
// than letting users write arbitrary text. We represent each edit as:
//
//   - a list of clauses parsed out of the original guard, each of which
//     can be toggled on or off
//   - a list of user-added clauses
//   - a `disabled` flag for the whole transition (the backend just drops
//     the transition when this is set)
//
// `buildEditedModel` produces a fresh ModelSpec to send to the verifier.

import type { ModelSpec, TransitionSpec, VariableSpec } from "./types";
import { splitConjuncts } from "./narrative";

export interface Clause {
  /** Display text and the value we send back to the verifier. */
  text: string;
  /** Inactive clauses are dropped from the guard. */
  active: boolean;
  /** Came from the safe baseline (true) vs. added by the user (false). */
  original: boolean;
}

export interface TransitionEdit {
  clauses: Clause[];
  disabled: boolean;
}

export interface PredicateOption {
  variable: string;
  operator: "==" | "!=";
  value: string;
  /** Pre-formatted clause text, e.g. `battery == Low`. */
  text: string;
}

export function buildClausesFromGuard(guard: string): Clause[] {
  return splitConjuncts(guard).map((text) => ({
    text,
    active: true,
    original: true,
  }));
}

export function buildEditFromTransition(t: TransitionSpec): TransitionEdit {
  return { clauses: buildClausesFromGuard(t.guard), disabled: false };
}

/** Combine the active clauses for a single transition back into a guard. */
export function buildGuard(edit: TransitionEdit): string {
  const active = edit.clauses.filter((c) => c.active).map((c) => c.text);
  if (active.length === 0) return "true";
  return active.join(" and ");
}

/**
 * Apply the edit map to a base model and produce a fresh ModelSpec.
 * - Disabled transitions are dropped entirely (their guard never fires).
 * - Edited transitions get a rebuilt guard from their active clauses.
 * - Unedited transitions are copied as-is.
 */
export function buildEditedModel(
  base: ModelSpec,
  edits: Record<string, TransitionEdit>
): ModelSpec {
  return {
    ...base,
    transitions: base.transitions
      .filter((t) => !edits[t.name]?.disabled)
      .map((t) => {
        const edit = edits[t.name];
        if (!edit) return t;
        return { ...t, guard: buildGuard(edit) };
      }),
  };
}

/** Every variable in the model the user can target with a new predicate. */
export interface VariableChoice {
  name: string;
  type: "enum" | "bool";
  values: string[];
}

export function variableChoices(model: ModelSpec): VariableChoice[] {
  const out: VariableChoice[] = [];
  for (const [name, spec] of Object.entries(model.variables)) {
    out.push({
      name,
      type: spec.type,
      values:
        spec.type === "enum" ? spec.values ?? [] : ["true", "false"],
    });
  }
  return out;
}

export function formatPredicate(p: PredicateOption): string {
  return `${p.variable} ${p.operator} ${p.value}`;
}

/** Has the user changed anything? */
export function hasEdits(edits: Record<string, TransitionEdit>): boolean {
  for (const e of Object.values(edits)) {
    if (e.disabled) return true;
    if (e.clauses.some((c) => !c.original || !c.active)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface PresetChange {
  transition: string;
  /** Deactivate any clause matching this normalized text. */
  deactivate?: string;
  /** Disable the transition entirely. */
  disable?: boolean;
}

export interface Preset {
  id: string;
  label: string;
  description: string;
  /** Optional — if set, switching to this preset selects the named
   *  transition in the editor. */
  focusTransition?: string;
  /** "reset" wipes all edits. Otherwise: apply each change. */
  changes: PresetChange[] | "reset";
}

export const PRESETS: Preset[] = [
  {
    id: "remove_human_approval",
    label: "Remove human approval",
    description: "Strip the human-authorization check from authorized_actuation.",
    focusTransition: "authorized_actuation",
    changes: [
      { transition: "authorized_actuation", deactivate: "human_authorized == true" },
    ],
  },
  {
    id: "remove_sensor_agreement",
    label: "Remove sensor agreement",
    description: "Drop the sensor-agreement check from authorized_actuation.",
    focusTransition: "authorized_actuation",
    changes: [
      { transition: "authorized_actuation", deactivate: "sensor_agreement == true" },
    ],
  },
  {
    id: "allow_mission_without_gps",
    label: "Allow mission without GPS",
    description: "Remove the GPS precondition from start_mission.",
    focusTransition: "start_mission",
    changes: [{ transition: "start_mission", deactivate: "gps == OK" }],
  },
  {
    id: "weaken_low_battery_recovery",
    label: "Weaken low-battery recovery",
    description:
      "Disable the reactive low_battery_recovery transition entirely.",
    focusTransition: "low_battery_recovery",
    changes: [{ transition: "low_battery_recovery", disable: true }],
  },
  {
    id: "reset",
    label: "Reset to safe baseline",
    description: "Throw away all edits and return to the unmodified controller.",
    changes: "reset",
  },
];

function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function applyPreset(
  preset: Preset,
  edits: Record<string, TransitionEdit>,
  base: ModelSpec
): Record<string, TransitionEdit> {
  if (preset.changes === "reset") return {};
  const next = { ...edits };
  for (const change of preset.changes) {
    const t = base.transitions.find((tr) => tr.name === change.transition);
    if (!t) continue;
    const current: TransitionEdit =
      next[change.transition] ?? buildEditFromTransition(t);
    if (change.disable) {
      next[change.transition] = { ...current, disabled: true };
      continue;
    }
    if (change.deactivate) {
      const target = normalise(change.deactivate);
      next[change.transition] = {
        ...current,
        disabled: false,
        clauses: current.clauses.map((c) =>
          normalise(c.text) === target ? { ...c, active: false } : c
        ),
      };
    }
  }
  return next;
}

/** Pretty mapping from transition names to a one-line description for the picker. */
export const TRANSITION_DESCRIPTIONS: Record<string, string> = {
  arm: "Idle → Armed when the operator approves.",
  start_mission: "Armed → Mission when GPS is OK and battery is high.",
  comms_degrade: "Reactive: Mission → DegradedComms when comms are lost.",
  low_battery_recovery:
    "Reactive: Mission/DegradedComms → Recovery when battery is low.",
  emergency_land: "Recovery → EmergencyLand.",
  authorized_actuation:
    "DegradedComms → Actuate; the operator-approved fallback path.",
  operator_authorize: "Operator grants approval.",
  operator_revoke: "Operator withdraws approval.",
  comms_loss: "Communications drop.",
  comms_restore: "Communications return.",
  gps_loss: "GPS becomes unavailable.",
  gps_restore: "GPS returns.",
  battery_drain: "Battery falls from High to Low.",
  sensor_disagree: "Sensors start disagreeing.",
  sensor_agree: "Sensors agree again.",
};
