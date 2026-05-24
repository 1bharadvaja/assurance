# Assurance Studio

**Check whether a controller change broke a safety rule.**

Live demo: https://1bharadvaja.github.io/assurance/

Assurance Studio is a small research-engineering prototype that connects
mission requirements to a finite state-machine model of a controller,
checks the model against safety rules with an SMT-backed bounded model
checker, surfaces counterexamples with operational explanations, and
re-verifies after a targeted fix. The verifier core is real: it uses Z3
to perform bounded reachability and bounded-response checks over models
loaded from YAML.

The site has four clearly separated experiences:

1. **Guided Review** — a polished walkthrough of one concrete bug
   (a one-line guard change that removes human authorization from the
   actuation transition) ending in a one-click repair. This is what the
   landing page opens to.
2. **Playground** — once you understand the demo, edit transition guards
   yourself (toggle clauses, add predicates, disable transitions, change
   the verification bound) and ask the live FastAPI + Z3 backend what
   breaks. Backed by `/api/assurance-diff`; no canned data.
3. **Review Pipeline** — type a plain-English system description, have a
   reviewer draft a finite state-machine model and a small set of safety
   checks, see a structured audit log of observations and risk
   hypotheses, then hand the hypotheses to Z3 for concrete confirmation
   or refutation. **AI proposes. Z3 checks.** Falls back to a
   deterministic reviewer when no `OPENAI_API_KEY` is configured, so the
   demo is reproducible offline.
4. **Technical Notes** — what the checker can and cannot say, what the
   public backend's structural and timeout limits are, and where the
   source lives.

> The hosted GitHub Pages build runs in **static demo mode** — verifier
> responses are pre-computed at build time and bundled into the page, so
> the Guided Review is fully interactive. The Playground requires the
> live backend; pointing the frontend at a running FastAPI service makes
> it work for arbitrary edits.

---

## 1. Modes

There are two runtime modes the frontend understands. They are
controlled by environment variables read at build time:

| Mode | Toggled by | What it does |
| --- | --- | --- |
| **Static demo** | `NEXT_PUBLIC_DEMO_MODE=true` | All API calls return pre-computed JSON from `frontend/public/canned/`. Guided Review works without a backend. Playground reports an honest "needs live backend" message. The top-nav badge reads **Static demo mode**. |
| **Live** | `NEXT_PUBLIC_DEMO_MODE` unset and `NEXT_PUBLIC_API_BASE` pointing at a real backend | All API calls hit the FastAPI service. Playground is fully usable. Badge reads **Live verifier connected** (or **Verifier backend unavailable** if the health probe fails). |

The frontend never silently falls back between the two — if a live call
fails, the UI says so honestly rather than pretending the result is real.

---

## 2. Overview

| Layer       | Stack                                                     |
| ----------- | --------------------------------------------------------- |
| Frontend    | Next.js 14 (App Router) · TypeScript · Tailwind · React Flow |
| Backend     | Python 3.11+ · FastAPI · Pydantic · PyYAML · `z3-solver`  |
| Solver core | Z3 bounded model checking                                 |

Backend endpoints:

- `GET  /api/health` — service health + the structural limits in force
- `GET  /api/scenarios` — list bundled scenarios
- `GET  /api/scenarios/{id}` — fetch a scenario (safe model, regressed model, properties, graph)
- `POST /api/verify` — check a model against a set of properties at a given bound
- `POST /api/assurance-diff` — compare two models; classify each property as preserved / regression / fixed / existing-failure, with culprit transition and suggested repair attached to each regression
- `POST /api/apply-repair` — return a new model with the repair applied
- `POST /api/review-pipeline/draft` — draft a model + safety checks + audit log from a plain-English description (uses an LLM if `OPENAI_API_KEY` is set, otherwise a deterministic field-robot / warehouse-robot template)
- `POST /api/review-pipeline/review` — given a model + properties, return observations and risk hypotheses (each a candidate mutation or property worth checking)
- `POST /api/review-pipeline/check` — run each hypothesis through the existing Z3 verifier; classifies each result as `confirmed_failure`, `no_counterexample`, `timeout`, or `invalid`

---

## 3. Demo flow (Guided Review)

The on-screen flow is shaped like a code review:

1. **Setup and safety rule** — what we're modelling and the contract
   we want to check.
2. **Changed transition** — a real line-level diff of `authorized_actuation`
   with the operator-approval clause struck through, plus a "why this
   might look like a clean change" note framing the proposed edit as a
   plausible simplification.
3. **Check this change** — compact checklist of the five safety rules
   and a Z3 bound badge.
4. **Unsafe execution** — narrative timeline of the path the checker
   found, a state graph with the path highlighted, the Violation
   callout (`mode = Actuate / comms = Lost / human_authorized = false`),
   and the *Where it broke* card.
5. **Fix** — restore the missing guard, re-check, see the
   before/after, and an "Open Playground" CTA inviting self-exploration.

---

## 4. Review Pipeline

A five-stage event log, each rendered as its own card:

1. **User intent** — a textarea seeded with a default field-robot
   description.
2. **AI draft** — modes, variables, transitions, and safety checks, with
   the raw JSON behind a disclosure. The badge is honest about whether
   the response came from an LLM or the deterministic fallback.
3. **AI review log** — a list of short, externally-checkable
   observations (each with evidence and an optional generated artifact)
   plus a list of risk hypotheses. Each hypothesis is either a candidate
   *mutation* (`remove_guard_clause`, `disable_transition`,
   `strengthen_or_weaken_guard`) or a candidate *property* to check.
4. **Formal check (Z3)** — progress events for the work the backend is
   doing while the hypotheses are sent to `/api/review-pipeline/check`.
   The progress events describe what the solver is doing in order; the
   actual outcomes come from the API response.
5. **Finding** — per-hypothesis result. Each is classified as
   `confirmed_failure` (with a real counterexample, root cause, and
   optional repair), `no_counterexample` ("no counterexample found up
   to bound K", not "the system is safe"), `timeout`, or `invalid`.
   Counterexamples reuse the Guided Review's timeline, root-cause card,
   and raw-trace disclosure.

The framing is deliberate: **AI proposes, Z3 checks**. The review log is
never treated as a proof, and the audit cards never contain raw
chain-of-thought — every observation is a short auditable claim with
evidence drawn from the model itself.

### Enabling LLM drafting + review

Set `OPENAI_API_KEY` on the backend (as an HF Space secret or local env
var). The backend will call `gpt-4o-mini` by default; override with
`ASSURANCE_LLM_MODEL`. The LLM is asked for strict JSON matching our
pydantic schema, with audit-log entries instead of private reasoning.
If the response fails validation we fall back to the deterministic
reviewer and surface a warning in the response.

Leave the key unset and you'll get the deterministic field-robot /
warehouse-robot templates — enough for the demo to be reproducible
without any external service.

## 5. Playground

The Playground is structured around a constrained guard editor — no
raw-text formula entry as a first-class action.

- **Try a preset** row: *Remove human approval*, *Remove sensor
  agreement*, *Allow mission without GPS*, *Weaken low-battery
  recovery*, *Reset to safe baseline*. Presets only modify editor
  state; they do not auto-run the verifier.
- **Transition selector** — pick from every transition in the model.
- **Conjunct toggles** — each top-level clause of the chosen guard is a
  checkbox. Unchecked clauses are dropped from the guard that gets sent
  to the verifier.
- **Add predicate** — variable / operator / value dropdowns. Values are
  constrained to the variable's domain (enum members or `true`/`false`).
- **Disable transition** — toggle that drops the transition entirely
  before sending to the verifier.
- **Bound selector** — `{4, 6, 8, 10, 12, 16, 20}`.
- **Generated guard** preview always shows what will be sent.
- **Check this model** calls `/api/assurance-diff` with old=safe baseline,
  new=edited. Results show: a banner, the guarantee checklist, a
  per-regression narrative, root-cause card, optional repair, and a
  collapsible raw solver trace.
- **Advanced — raw model (JSON)** disclosure shows the exact payload
  for transparency.

---

## 6. Formal model

YAML; enums and booleans only. Each variable has an explicit `initial`.
Transitions are guarded updates:

```yaml
- name: authorized_actuation
  guard: "mode == DegradedComms and comms == Lost and human_authorized == true and sensor_agreement == true"
  updates:
    mode: Actuate
```

Reactive transitions (`reactive: true`) fire automatically when their
guard holds, in file order. This is how we encode safety responses
like `low_battery_recovery` and `comms_degrade`.

Guards use a small subset of Python expressions (so we get the parser
for free) and the AST is then validated against an allow-list — no
`eval`, no attribute access, no function calls. Bool keywords `true` and
`false` are first-class, so an empty playground edit reduces cleanly to
the literal `true`.

Properties come in two flavours:

| Type                | Shape                                                        |
| ------------------- | ------------------------------------------------------------ |
| `invariant`         | `condition` must hold at every reachable state up to bound *K*. |
| `bounded_response`  | If `trigger` at time `t`, then `response` at some `t' ∈ [t, t+bound]`. |

---

## 7. Verification semantics

For a model `M`, properties `Φ`, and bound *K*:

1. Each variable is given a fresh Z3 sort: enums use Z3 `EnumSort`,
   bools use Z3 `Bool`. Constants are time-indexed.
2. The initial state is asserted at time 0.
3. At each step `t → t+1`, an integer chooser picks which transition
   fires (or stutter). Frame conditions copy unupdated variables.
   Reactive transitions are forced by a priority constraint.
4. Properties are checked by SAT-ing the negation:
   - **Invariant** — `∃ t ∈ [0, K] : ¬condition(t)`. SAT → counterexample.
   - **Bounded response** — `∃ t₀ : trigger(t₀) ∧ ∀ t' ∈ [t₀, t₀+B] : ¬response(t')`.
5. Culprit-transition detection walks the trace backwards for the most
   recent transition whose `updates` set the violating state's `mode`.
6. Repair (when a template matches the failing property) strengthens
   the culprit's guard with the missing predicate.

A `pass` certifies the absence of counterexamples up to *K*. A
`timeout` is reported as a distinct outcome — it is **not** silently
treated as a pass.

---

## 8. Running locally

You need Python 3.11+ and Node.js 18+.

**Backend** (terminal 1):

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Tests:

```bash
cd backend
source .venv/bin/activate
pytest
```

**Frontend** (terminal 2):

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. The frontend defaults to
`NEXT_PUBLIC_API_BASE=http://localhost:8000`.

If you change the dev port (e.g. `npm run dev -- -p 3001`), set the
backend's `CORS_ALLOWED_ORIGINS` to match:

```bash
CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001" \
  uvicorn app.main:app --reload --port 8000
```

**Docker Compose** (single command, both services):

```bash
docker compose up --build
```

---

## 9. Deploying

The two services deploy independently.

### Backend (FastAPI + Z3)

`backend/Dockerfile` is provided. Render, Railway, Fly.io, and Cloud
Run all work. Bind to `$PORT` (or `8000`). Environment variables:

| Var | Purpose | Default |
| --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origins allowed by CORS. Set to your deployed frontend URL in production. | `http://localhost:3000` |
| `ASSURANCE_SOLVER_TIMEOUT_MS` | Per-query Z3 timeout. Timeouts are reported as a distinct outcome, not a pass. | `5000` |
| `OPENAI_API_KEY` | Optional. Enables LLM drafting/review in the Review Pipeline. If unset, the deterministic field-robot / warehouse-robot templates are used. | unset |
| `ASSURANCE_LLM_MODEL` | OpenAI model name used by the Review Pipeline when LLM drafting is enabled. | `gpt-4o-mini` |

Structural limits on every request (compiled in via pydantic, not env):

- ≤ 12 variables, ≤ 12 enum values per variable
- ≤ 40 transitions per model
- ≤ 20 properties per request
- bound ∈ `[1, 20]`

If a request exceeds a limit the backend returns HTTP 400 with a
human-readable message; the frontend surfaces it verbatim.

### Frontend (Next.js)

Vercel is the natural target:

1. Point Vercel at `frontend/`.
2. Set `NEXT_PUBLIC_API_BASE=https://your-backend.example.com`.
3. Leave `NEXT_PUBLIC_DEMO_MODE` unset (or `false`). The Playground
   needs the live backend.

### Static GitHub Pages build

If you just want the Guided Review online without standing up a
backend, the `.github/workflows/deploy-pages.yml` workflow does it:

1. Runs `backend/app/canned.py` to generate the three JSON snapshots
   the Guided Review needs (`scenario`, `safe diff`, `regressed diff`,
   `repaired diff`).
2. Builds the frontend with `STATIC_EXPORT=1`,
   `NEXT_PUBLIC_DEMO_MODE=true`, `NEXT_PUBLIC_BASE_PATH=/assurance`.
3. Uploads `frontend/out` to Pages.

The deployed site shows a yellow **Static demo mode** badge in the top
nav. The Playground in that build will tell the user it needs the live
backend instead of pretending the responses are real.

---

## 10. Limitations

- **Bounded only.** A passing result certifies the absence of
  counterexamples up to bound *K*. There is no inductive invariant
  generation.
- **Finite abstract domain.** Variables are enums and booleans; no
  continuous time, no real-valued sensor noise.
- **No code-level verification.** We verify the *model*, not flight-stack
  source.
- **Targeted repair only.** The repair suggester re-introduces a single
  missing predicate per failing property using a hand-written template.
- **No environment-assumption language.** Operator and environment
  events are themselves modelled as guarded transitions; there is no
  separate assume/guarantee contract layer.

---

## 11. Future work

- k-induction / IC3 for unbounded proofs.
- Inductive invariant inference.
- Generic guard strengthening by abductive reasoning, not templates.
- LTL / CTL beyond bounded response.
- Probabilistic or hybrid models for noisy sensors.
- Verified refinement linking the YAML model to real source.
- Assume / guarantee contracts as first-class objects.
- More scenarios.
