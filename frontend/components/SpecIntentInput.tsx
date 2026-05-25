"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";

interface Props {
  description: string;
  onChange: (next: string) => void;
  onDraft: () => void;
  isDrafting: boolean;
  disabled?: boolean;
}

interface Starter {
  id: string;
  label: string;
  prompt: string;
}

// Vetted starter prompts. Each is shaped to pass the model health check
// when run through the deterministic drafter or an LLM that follows the
// system prompt.
const STARTERS: Starter[] = [
  {
    id: "field_robot",
    label: "Field robot",
    prompt:
      "A field robot has modes Idle, Armed, Mission, DegradedComms, Recovery, EmergencyStop, and Actuate. Actuate means the robot performs an irreversible command. The robot may lose communications during a mission. It should only actuate if a human operator approved the action and sensors agree. If battery is low, it should enter Recovery or EmergencyStop.",
  },
  {
    id: "railway_crossing",
    label: "Railway crossing",
    prompt:
      "A railway crossing has modes Idle, Warning, LoweringGate, GateDown, TrainPassing, RaisingGate, and Fault. A train is detected via a sensor. The crossing must enter Warning when a train is detected, then LoweringGate, and must reach GateDown before TrainPassing. The gate must never be Raised while TrainPassing. On sensor failure, it must enter Fault within 1 step.",
  },
  {
    id: "chemical_tank",
    label: "Chemical tank",
    prompt:
      "A chemical tank controller has modes Idle, Filling, Mixing, Heating, Draining, Venting, and EmergencyShutdown. The lid must be locked before Heating. Pressure must be Normal before Heating. The fill level must be Safe before Heating. If temperature sensors disagree while Heating, the system must enter EmergencyShutdown within 2 steps. The system must never be Heating with the lid unlocked.",
  },
  {
    id: "warehouse_robot",
    label: "Warehouse robot",
    prompt:
      "A warehouse robot has modes Idle, Moving, Loading, and EmergencyStop. The robot must not be Moving with a human nearby unless a supervisor override is active. The robot must not be Loading while safety sensors disagree. If battery is low while Moving or Loading, it must reach EmergencyStop within 2 steps.",
  },
  {
    id: "blank",
    label: "Blank",
    prompt: "",
  },
];

export function SpecIntentInput({
  description,
  onChange,
  onDraft,
  isDrafting,
  disabled,
}: Props) {
  return (
    <div className="space-y-3">
      <p className="text-[13.5px] leading-relaxed text-ink-600">
        Plain-English description of the system you want checked. The
        reviewer will draft a finite state-machine model and a small set of
        safety checks. <strong>Drafted by AI; checked by Z3.</strong> AI
        drafts are untrusted until they pass validation.
      </p>

      <ScopeGuidance />

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
          Start from an example
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STARTERS.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={isDrafting || disabled}
              onClick={() => onChange(s.prompt)}
              className="rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink-700 transition hover:bg-ink-100 disabled:cursor-wait disabled:opacity-60"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={description}
        onChange={(e) => onChange(e.target.value)}
        rows={9}
        disabled={isDrafting || disabled}
        placeholder="Describe the controller's modes, the conditions that gate transitions between them, and the safety rules…"
        className="w-full resize-y rounded border border-line bg-paper px-3 py-2 font-mono text-[12.5px] leading-5 text-ink-800 focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-400">
          {description.length} chars
        </span>
        <button
          type="button"
          onClick={onDraft}
          disabled={isDrafting || disabled || description.trim().length === 0}
          className={clsx(
            "inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-70"
          )}
        >
          {isDrafting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isDrafting ? "Drafting…" : "Draft formal model"}
        </button>
      </div>
    </div>
  );
}

function ScopeGuidance() {
  return (
    <div className="rounded border border-ink-200 bg-ink-50 px-3 py-2.5 text-[12.5px] text-ink-700">
      <div className="font-medium text-ink-900">
        Works best for small discrete controllers
      </div>
      <p className="mt-1 leading-snug">
        Modes, boolean/enum conditions, guarded transitions, and safety
        rules expressed with words like <em>must</em>, <em>never</em>,{" "}
        <em>only if</em>, or <em>within N steps</em>.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11.5px] text-emerald-900">
          <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-700">
            Good
          </div>
          <p className="mt-0.5 leading-snug">
            “A railway crossing has modes Idle, Warning, LoweringGate,
            GateDown, TrainPassing, Fault…”
          </p>
        </div>
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11.5px] text-red-900">
          <div className="text-[10px] font-medium uppercase tracking-wider text-red-700">
            Poor
          </div>
          <p className="mt-0.5 leading-snug">
            “The robot should be safe in all situations.”
          </p>
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-500">
        Not supported yet: arbitrary source code, continuous physics,
        real-valued dynamics, probability, or open-ended requirements
        without modes/conditions.
      </p>
    </div>
  );
}
