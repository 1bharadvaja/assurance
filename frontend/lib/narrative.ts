// Turn a raw Z3 counterexample trace into a small, human-readable replay.
//
// The solver often interleaves transitions that don't matter for the story
// (sensor_agree, sensor_disagree, gps_loss, stutter, etc.). The investigator
// pane only needs the path beats that explain how the platform got from Idle
// to the unsafe Actuate state — operator authorization, arming, comms loss,
// mode changes — terminating in the violation.

import type { TraceStep } from "./types";

export interface ReplayStep {
  /** 1-based display index. */
  index: number;
  /** Index of the trace step this card describes (the state AFTER the transition fires). */
  rawIndex: number;
  /** Short title shown in the card header. */
  title: string;
  /** One-sentence narrative shown below the title. */
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
    title: "Operator authorizes",
    narrative: "A human operator grants authorization for the upcoming mission.",
  }),
  arm: () => ({
    title: "Platform armed",
    narrative: "With authorization in hand, the platform transitions from Idle to Armed.",
  }),
  start_mission: () => ({
    title: "Mission starts",
    narrative: "GPS is good and battery is high. The platform enters Mission.",
  }),
  operator_revoke: () => ({
    title: "Authorization revoked",
    narrative: "The operator's authorization is withdrawn.",
  }),
  comms_loss: () => ({
    title: "Communications drop",
    narrative: "The platform loses contact with its operator mid-flight.",
  }),
  comms_degrade: () => ({
    title: "Degraded operation",
    narrative: "The controller reactively shifts to DegradedComms.",
  }),
  low_battery_recovery: () => ({
    title: "Battery recovery",
    narrative: "Battery is low — the controller reactively diverts to Recovery.",
  }),
  emergency_land: () => ({
    title: "Emergency landing",
    narrative: "The platform performs an emergency landing.",
  }),
  authorized_actuation: () => ({
    title: "Unsafe actuation",
    narrative:
      "The platform actuates while communications are lost and no human has authorized the command.",
  }),
};

const KEEP = new Set(Object.keys(NARRATIVE));

export function buildReplay(trace: TraceStep[]): ReplayStep[] {
  if (!trace || trace.length === 0) return [];
  const out: ReplayStep[] = [];

  // Always emit the initial state.
  out.push({
    index: 1,
    rawIndex: 0,
    title: "System idle",
    narrative: "The platform is on the ground, awaiting an authorized arming command.",
    mode: trace[0].mode as string,
    comms: trace[0].comms as string,
    human_authorized: Boolean(trace[0].human_authorized),
    transition: "",
    isViolation: false,
  });

  // Walk transitions in order; emit a beat for each meaningful one.
  for (let i = 0; i < trace.length - 1; i++) {
    const trans = trace[i].transition as string | undefined;
    if (!trans || !KEEP.has(trans)) continue;
    const after = trace[i + 1];
    const fn = NARRATIVE[trans];
    const n = fn(after);
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

/** Split a top-level conjunctive guard string into its component clauses. */
export function splitConjuncts(guard: string): string[] {
  // Naive top-level split on " and " — robust enough for our guards which use
  // parentheses only inside individual clauses, not around the connectives.
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const lower = guard.toLowerCase();
  for (let i = 0; i <= guard.length; i++) {
    const c = guard[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (depth === 0) {
      // Look for the literal " and " token starting at position i.
      if (i + 5 <= guard.length && lower.slice(i, i + 5) === " and ") {
        parts.push(guard.slice(start, i).trim());
        start = i + 5;
        i += 4;
      } else if (i === guard.length) {
        parts.push(guard.slice(start, i).trim());
      }
    }
  }
  // Strip a single outer pair of parens around each part for cleaner display.
  return parts
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith("(") && p.endsWith(")") ? p.slice(1, -1).trim() : p));
}
