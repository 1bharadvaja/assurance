"use client";

import { SectionHeader } from "./MissionRuleCard";

export function TechnicalNotes() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 py-10 text-[14.5px] leading-relaxed text-ink-800">
      <section>
        <SectionHeader step="01" label="What this is" />
        <p className="mt-3">
          Assurance Studio is a small verification workbench. It models a
          mission controller as a finite state machine — enum and boolean
          variables, guarded transitions — and asks Z3 whether any safety rule
          is violated within a bounded number of steps.
        </p>
        <p className="mt-3">
          The Guided Review walks one concrete bug end-to-end. The Playground
          lets you change a guard yourself and hand the modified model to the
          live verifier.
        </p>
      </section>

      <section>
        <SectionHeader step="02" label="How the Playground talks to the solver" />
        <p className="mt-3">
          When the Playground is live, an edit produces a fresh{" "}
          <code className="font-mono text-ink-900">ModelSpec</code> on the
          client. That spec is POSTed to the FastAPI service at{" "}
          <code className="font-mono text-ink-900">/api/assurance-diff</code>,
          where it is validated, encoded as a bounded model-checking query,
          and handed to Z3. The service compares the result against the safe
          baseline and returns which checks now fail, the counterexample for
          each failure, and (where we have a hand-written template) a
          suggested repair.
        </p>
      </section>

      <section>
        <SectionHeader step="03" label="What the checker can and cannot say" />
        <p className="mt-3">
          The checker is sound but bounded. A{" "}
          <span className="font-medium">pass</span> means no counterexample
          exists within the chosen bound — not a proof for every possible run.
          A <span className="font-medium">failure</span> is concrete: the
          returned trace is an actual execution of the model.
        </p>
        <p className="mt-3">
          The model is an abstraction. Variables are enums and booleans; there
          is no continuous time, no real-valued sensor noise, and no source
          code under verification. Connecting a model like this to actual
          flight stack code is a separate (and hard) problem.
        </p>
      </section>

      <section>
        <SectionHeader step="04" label="Limits on the public backend" />
        <p className="mt-3">
          The deployed service enforces structural limits on each request so
          that a single edit cannot pin the solver:
        </p>
        <ul className="mt-3 list-disc pl-6 text-[13.5px] text-ink-700">
          <li>at most 12 variables, with at most 12 enum values each</li>
          <li>at most 40 transitions per model</li>
          <li>at most 20 properties per request</li>
          <li>verification bound ≤ 20 transitions</li>
          <li>
            per-query Z3 timeout (5 s by default, configurable via{" "}
            <code className="font-mono text-ink-800">
              ASSURANCE_SOLVER_TIMEOUT_MS
            </code>
            ). A timeout is reported as a distinct outcome, not as a pass.
          </li>
          <li>
            CORS is restricted to{" "}
            <code className="font-mono text-ink-800">
              CORS_ALLOWED_ORIGINS
            </code>{" "}
            (defaults to the local dev frontend).
          </li>
        </ul>
      </section>

      <section>
        <SectionHeader step="05" label="Repository" />
        <p className="mt-3">
          Source at{" "}
          <a
            className="text-accent underline-offset-2 hover:underline"
            href="https://github.com/1bharadvaja/assurance"
            target="_blank"
            rel="noreferrer"
          >
            github.com/1bharadvaja/assurance
          </a>
          . README covers running locally, deploying the backend, and the
          static-vs-live distinction in detail.
        </p>
      </section>
    </div>
  );
}
