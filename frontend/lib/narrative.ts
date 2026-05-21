// Turn a raw Z3 counterexample trace into a small, human-readable replay.
//
// The solver often interleaves transitions that don't matter for the story
// (sensor_agree, sensor_disagree, gps_loss, stutter, etc.). The investigator
// pane only needs the path beats that explain how the platform got from Idle
// to the unsafe Actuate state.

import type { TraceStep } from "./types";

export interface ReplayStep {
  /** 1-based display index. */
  index: number;
  /** Index of the trace step this card describes (the state AFTER the transition fires). */
  rawIndex: number;
  /** Short title shown in the card header. */
  title: string;
  /** Optional short narrative shown below the title. */
  narrative: string;
  /** Display state snippet. */
  mode: string;
  comms: string;
  human_authorized: boolean;
  /** Name of the transition that produced this beat ("" for the initial state). */
  transition: string;
  /** True for the unsafe step that violates the invariant. */
  isViolation: boolean;
}

type NarrativeFn = (after: TraceStep) => { title: string; narrative: string };

const NARRATIVE: Record<string, NarrativeFn> = {
  operator_authorize: () => ({
    title: "Operator approves",
    narrative: "An operator grants authorization.",
  }),
  arm: () => ({
    title: "Armed",
    narrative: "Platform leaves Idle for Armed.",
  }),
  start_mission: () => ({
    title: "Mission begins",
    narrative: "Platform enters Mission.",
  }),
  operator_revoke: () => ({
    title: "Authorization revoked",
    narrative: "Operator withdraws approval.",
  }),
  comms_loss: () => ({
    title: "Lost comms",
    narrative: "Platform loses contact with the operator.",
  }),
  comms_degrade: () => ({
    title: "Degraded comms",
    narrative: "Controller drops to DegradedComms.",
  }),
  low_battery_recovery: () => ({
    title: "Battery low",
    narrative: "Controller diverts to Recovery.",
  }),
  emergency_land: () => ({
    title: "Emergency land",
    narrative: "Controller lands.",
  }),
  authorized_actuation: () => ({
    title: "Unsafe actuation",
    narrative:
      "Controller enters Actuate with comms lost and no operator approval.",
  }),
};

const KEEP = new Set(Object.keys(NARRATIVE));

export function buildReplay(trace: TraceStep[]): ReplayStep[] {
  if (!trace || trace.length === 0) return [];
  const out: ReplayStep[] = [];

  out.push({
    index: 1,
    rawIndex: 0,
    title: "Idle",
    narrative: "Platform is on the ground.",
    mode: trace[0].mode as string,
    comms: trace[0].comms as string,
    human_authorized: Boolean(trace[0].human_authorized),
    transition: "",
    isViolation: false,
  });

  for (let i = 0; i < trace.length - 1; i++) {
    const trans = trace[i].transition as string | undefined;
    if (!trans || !KEEP.has(trans)) continue;
    const after = trace[i + 1];
    const n = NARRATIVE[trans](after);
    const isViolation = trans === "authorized_actuation";
    out.push({
      index: out.length + 1,
      rawIndex: i + 1,
      title: n.title,
      narrative: n.narrative,
      mode: after.mode as string,
      comms: after.comms as string,
      human_authorized: Boolean(after.human_authorized),
      transition: trans,
      isViolation,
    });
  }

  return out;
}

/**
 * Build the ordered list of edges traversed by the counterexample, suitable
 * for highlighting on the state graph.
 */
export function pathEdges(
  trace: TraceStep[]
): { source: string; target: string; transition: string }[] {
  if (!trace || trace.length < 2) return [];
  const edges: { source: string; target: string; transition: string }[] = [];
  for (let i = 0; i < trace.length - 1; i++) {
    const trans = trace[i].transition as string | undefined;
    if (!trans || trans === "stutter") continue;
    const src = trace[i].mode as string;
    const dst = trace[i + 1].mode as string;
    if (src && dst && src !== dst) {
      edges.push({ source: src, target: dst, transition: trans });
    }
  }
  return edges;
}

/**
 * Split a top-level conjunctive guard string into its component clauses.
 * Recursively flattens parenthesised conjunctions.
 */
export function splitConjuncts(guard: string): string[] {
  const raw: string[] = [];
  let depth = 0;
  let start = 0;
  const lower = guard.toLowerCase();
  for (let i = 0; i <= guard.length; i++) {
    const c = guard[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (depth === 0) {
      if (i + 5 <= guard.length && lower.slice(i, i + 5) === " and ") {
        raw.push(guard.slice(start, i).trim());
        start = i + 5;
        i += 4;
      } else if (i === guard.length) {
        raw.push(guard.slice(start, i).trim());
      }
    }
  }
  const out: string[] = [];
  for (const p of raw) {
    if (!p) continue;
    if (p.startsWith("(") && p.endsWith(")")) {
      out.push(...splitConjuncts(p.slice(1, -1).trim()));
    } else {
      out.push(p);
    }
  }
  return out;
}
