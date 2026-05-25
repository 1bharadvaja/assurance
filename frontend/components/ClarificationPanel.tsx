"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { ClarifyResponse } from "../lib/types";

interface Props {
  result: ClarifyResponse | null;
  loading: boolean;
  error: string | null;
  onAsk: () => void;
  onApplyRewrite: (rewrite: string) => void;
  onUseExample: () => void;
}

/**
 * Renders the "Could not draft a reliable model yet" panel. Shows
 * concrete clarifying questions and (optionally) a tightened rewrite
 * suggestion the user can apply with one click.
 */
export function ClarificationPanel({
  result,
  loading,
  error,
  onAsk,
  onApplyRewrite,
  onUseExample,
}: Props) {
  return (
    <section className="rounded border border-line bg-paper">
      <header className="border-b border-line bg-ink-50 px-4 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
          Clarification
        </div>
        <div className="mt-0.5 text-[13.5px] font-medium text-ink-900">
          Could not draft a reliable model yet
        </div>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-700">
          Answer these questions and re-draft, or start from a vetted
          example. Z3 only runs on validated finite-state models — we will
          not pretend a broken draft is formal.
        </p>
      </header>

      <div className="px-4 py-3 space-y-3">
        {!result && !loading && !error && (
          <button
            type="button"
            onClick={onAsk}
            className="inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-accent-dark"
          >
            Ask clarifying questions
          </button>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generating clarifying questions…
          </div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-900">
            {error}
          </div>
        )}

        {result && (
          <>
            {result.questions.length === 0 ? (
              <p className="text-[12.5px] text-ink-600">
                No clarifying questions were generated. Try starting from
                an example or edit your description.
              </p>
            ) : (
              <ol className="list-decimal space-y-1.5 pl-5 text-[12.5px] leading-snug text-ink-800">
                {result.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            )}

            {result.suggested_rewrite && (
              <div className="rounded border border-line bg-ink-50 px-3 py-2 text-[12.5px] text-ink-800">
                <div className="text-[10px] font-medium uppercase tracking-wider text-ink-500">
                  Suggested rewrite
                </div>
                <p className="mt-1 leading-snug">{result.suggested_rewrite}</p>
                <button
                  type="button"
                  onClick={() =>
                    onApplyRewrite(result.suggested_rewrite ?? "")
                  }
                  className="mt-2 inline-flex items-center gap-2 rounded border border-line bg-paper px-2.5 py-1 text-[12px] text-ink-800 transition hover:bg-ink-100"
                >
                  Replace description with this rewrite
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={onAsk}
                className="rounded border border-line bg-paper px-2.5 py-1 text-[12px] text-ink-800 transition hover:bg-ink-100"
              >
                Regenerate questions
              </button>
              <button
                type="button"
                onClick={onUseExample}
                className="rounded border border-line bg-paper px-2.5 py-1 text-[12px] text-ink-800 transition hover:bg-ink-100"
              >
                Use an example instead
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
