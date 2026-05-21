"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

interface Props {
  status: "fail" | "pass";
  passed: number;
  failed: number;
  failingTitle?: string | null;
  onContinue?: () => void;
  continueLabel?: string;
}

export function ResultBanner({
  status,
  passed,
  failed,
  failingTitle,
  onContinue,
  continueLabel = "See the unsafe path",
}: Props) {
  const isFail = status === "fail";
  return (
    <div
      className={clsx(
        "rounded-2xl border p-6 shadow-card",
        isFail
          ? "border-rose-500/50 bg-rose-500/[0.07]"
          : "border-emerald-500/50 bg-emerald-500/[0.06]"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {isFail ? (
            <AlertTriangle className="mt-1 h-7 w-7 flex-none text-rose-300" />
          ) : (
            <ShieldCheck className="mt-1 h-7 w-7 flex-none text-emerald-300" />
          )}
          <div>
            <h3
              className={clsx(
                "text-2xl font-semibold leading-tight",
                isFail ? "text-rose-50" : "text-emerald-50"
              )}
            >
              {isFail ? "Unsafe reachable path found" : "All mission guarantees pass"}
            </h3>
            <p
              className={clsx(
                "mt-1 max-w-xl text-sm",
                isFail ? "text-rose-100" : "text-emerald-100"
              )}
            >
              {isFail
                ? `${passed} guarantees still pass, but ${failingTitle || "one guarantee"} fails. The verifier produced a concrete execution that reaches the violation.`
                : `${passed} mission guarantees hold under the checked horizon.`}
            </p>
          </div>
        </div>
        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
            className={clsx(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition",
              isFail
                ? "bg-rose-500 text-white hover:bg-rose-400"
                : "bg-emerald-500 text-ink-950 hover:bg-emerald-400"
            )}
          >
            {continueLabel}
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide">
        <Pill tone="ok">{passed} passed</Pill>
        <Pill tone={failed ? "bad" : "neutral"}>{failed} failed</Pill>
      </div>
    </div>
  );
}

function Pill({ tone, children }: { tone: "ok" | "bad" | "neutral"; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "rounded-full px-2.5 py-0.5 font-mono font-medium",
        tone === "ok" && "bg-emerald-500/15 text-emerald-300",
        tone === "bad" && "bg-rose-500/15 text-rose-300",
        tone === "neutral" && "bg-ink-900 text-ink-400"
      )}
    >
      {children}
    </span>
  );
}
