"use client";

import { Download } from "lucide-react";
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
    <section id="report" className="rounded-xl border border-ink-800 bg-ink-900/60 p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm uppercase tracking-widest text-ink-400">Export</div>
          <h3 className="mt-1 text-lg font-semibold text-ink-100">Assurance report</h3>
          <p className="mt-1 text-sm text-ink-300">
            Bundle the current model, properties, and verification outcome into a
            reviewable artifact.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadJSON(props)}
            className="inline-flex items-center gap-2 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 hover:bg-ink-800"
          >
            <Download className="h-4 w-4" />
            JSON
          </button>
          <button
            type="button"
            onClick={() => downloadMarkdown(props)}
            className="inline-flex items-center gap-2 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 hover:bg-ink-800"
          >
            <Download className="h-4 w-4" />
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
  lines.push(`# Assurance Report — ${payload.scenario}`);
  lines.push("");
  lines.push(`- Model: ${payload.model_title}`);
  lines.push(`- Bound: ${payload.bound}`);
  lines.push(`- Generated at: ${payload.generated_at}`);
  if (payload.applied_repair) {
    lines.push(`- Repair applied: \`${payload.applied_repair.transition}\` += \`${payload.applied_repair.add_predicate}\``);
  }
  lines.push("");
  lines.push("## Guarantees");
  for (const r of payload.verification?.results ?? []) {
    lines.push(
      `- **${r.title || r.property}** (\`${r.property}\`): ${r.status} (${r.elapsed_ms?.toFixed(0) ?? "?"} ms)`
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
        lines.push(`Culprit transition: \`${reg.culprit_transition.name}\``);
        lines.push("");
        lines.push("```");
        lines.push(`guard: ${reg.culprit_transition.guard}`);
        lines.push("```");
      }
      if (reg.suggested_repair) {
        lines.push(
          `Suggested repair: add \`${reg.suggested_repair.add_predicate}\` to \`${reg.suggested_repair.transition}\``
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
