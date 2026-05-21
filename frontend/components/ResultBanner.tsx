"use client";

import clsx from "clsx";

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
  continueLabel = "See the failing execution",
}: Props) {
  const isFail = status === "fail";
  return (
    <div
      role="status"
      className={clsx(
        "rounded border px-4 py-3",
        isFail
          ? "border-red-200 bg-red-50/60"
          : "border-emerald-200 bg-emerald-50/60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-[14px] leading-relaxed">
          <div
            className={clsx(
              "font-semibold",
              isFail ? "text-red-800" : "text-emerald-800"
            )}
          >
            {isFail
              ? "Unsafe execution found"
              : "No counterexample found"}
          </div>
          <div className={clsx("mt-1", isFail ? "text-red-900/80" : "text-emerald-900/80")}>
            {isFail
              ? `${failed} check failed (${failingTitle || "human approval"}). ${passed} other checks still pass.`
              : `All ${passed} checks pass.`}
          </div>
        </div>
        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
            className={clsx(
              "rounded border px-3 py-1.5 text-[12.5px] font-medium transition",
              isFail
                ? "border-red-300 bg-paper text-red-800 hover:bg-red-100/40"
                : "border-emerald-300 bg-paper text-emerald-800 hover:bg-emerald-100/40"
            )}
          >
            {continueLabel} →
          </button>
        )}
      </div>
    </div>
  );
}
