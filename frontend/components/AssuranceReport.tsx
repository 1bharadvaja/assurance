"use client";

import type {
  AssuranceDiffResponse,
  ModelSpec,
  PropertySpec,
  RepairSpec,
  VerifyResponse,
} from "../lib/types";

interface Props {
  scenarioTitle: string;
  modelTitle: string;
  bound: number;
  properties: PropertySpec[];
  results: VerifyResponse | null;
  diff: AssuranceDiffResponse | null;
  appliedRepair: RepairSpec | null;
  activeModel: ModelSpec;
}

export function AssuranceReport(props: Props) {
  return (
    <section className="border-t border-line pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold tracking-tight text-ink-900">
            Export evidence
          </h3>
          <p className="mt-1 max-w-xl text-[13px] text-ink-500">
            Save the model, checks, and counterexample (if any) for review or
            attaching to a PR.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadJSON(props)}
            className="rounded border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-700 transition hover:bg-ink-50"
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() => downloadMarkdown(props)}
            className="rounded border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-700 transition hover:bg-ink-50"
          >
            Markdown
          </button>
        </div>
      </div>
    </section>
  );
}

function buildPayload(p: Props) {
  return {
    scenario: p.scenarioTitle,
    model_title: p.modelTitle,
    bound: p.bound,
    properties: p.properties,
    model: p.activeModel,
    verification: p.results,
    regressions: p.diff?.regressions ?? [],
    applied_repair: p.appliedRepair,
    generated_at: new Date().toISOString(),
  };
}

function downloadJSON(p: Props) {
  const payload = buildPayload(p);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, "assurance-report.json");
}

function downloadMarkdown(p: Props) {
  const payload = buildPayload(p);
  const lines: string[] = [];
  lines.push(`# Assurance report — ${payload.scenario}`);
  lines.push("");
  lines.push(`- Model: ${payload.model_title}`);
  lines.push(`- Bound: ${payload.bound}`);
  lines.push(`- Generated: ${payload.generated_at}`);
  if (payload.applied_repair) {
    lines.push(
      `- Repair applied: \`${payload.applied_repair.transition}\` += \`${payload.applied_repair.add_predicate}\``
    );
  }
  lines.push("");
  lines.push("## Checks");
  for (const r of payload.verification?.results ?? []) {
    lines.push(
      `- ${r.status === "pass" ? "✓" : "✗"} **${r.title || r.property}** (\`${r.property}\`) — ${r.elapsed_ms?.toFixed(0) ?? "?"} ms`
    );
  }
  if ((payload.regressions ?? []).length > 0) {
    lines.push("");
    lines.push("## Regressions");
    for (const reg of payload.regressions ?? []) {
      lines.push(`### ${reg.title || reg.property}`);
      lines.push("");
      lines.push(reg.explanation);
      lines.push("");
      if (reg.culprit_transition) {
        lines.push(`Where it broke: \`${reg.culprit_transition.name}\``);
        lines.push("```");
        lines.push(`guard: ${reg.culprit_transition.guard}`);
        lines.push("```");
      }
      if (reg.suggested_repair) {
        lines.push(
          `Fix: add \`${reg.suggested_repair.add_predicate}\` to \`${reg.suggested_repair.transition}\``
        );
      }
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  triggerDownload(blob, "assurance-report.md");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
