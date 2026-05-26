"""Compare exhaustive mutation search against hypothesis-guided search.

Goal
====

Show that the hypothesis layer reduces the *number of formal checks*
needed to find meaningful failures. The claim is NOT that Z3 itself
runs faster — both strategies feed the same Verifier and diff. The
claim is:

    Hypothesis guidance does not make Z3 faster per query. It reduces
    how many candidate mutations we ask Z3 to check.

Methodology
-----------

Two search strategies are run against the same scenario (model +
properties + bound):

1. **Exhaustive mutation search.** Mechanically enumerate one candidate
   per (transition, top-level guard clause) by removing each clause,
   plus one candidate per transition by disabling it entirely. Each
   candidate is validated; valid ones are sent through the same
   verifier + diff pipeline the live app uses.

2. **Hypothesis-guided search.** Use the deterministic Review Pipeline
   reviewer (``_propose_hypotheses``) — the same routine that powers
   the live app when no LLM key is set, and the source of grounded
   mutation suggestions in the LLM path. Each hypothesis is run
   through the same verifier + diff pipeline.

Both strategies report:

- candidate count
- valid candidate count (a mutation can be syntactically rejected)
- solver-call count
- total solver wall-clock time
- time to first confirmed failure
- confirmed-failure count + the failed property names

LLM drafting / planning time is deliberately excluded: this benchmark
is about reducing formal-check search, not end-to-end latency.

Usage
-----

::

    cd backend
    source .venv/bin/activate
    python evals/compare_search_strategies.py --scenario railway_crossing --bound 10

The script writes a JSON artifact to ``backend/evals/outputs/``.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

# Make ``app`` importable when run as a script from the backend dir.
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.diff import diff_results  # noqa: E402
from app.models import (  # noqa: E402
    ModelSpec,
    PropertySpec,
    RiskHypothesis,
)
from app.narrative_helpers import split_top_conjuncts  # noqa: E402
from app.parser import validate_model  # noqa: E402
from app.review_pipeline import (  # noqa: E402
    _field_robot_draft,
    _propose_hypotheses,
    _railway_crossing_draft,
    _warehouse_robot_draft,
)
from app.verifier import Verifier  # noqa: E402


# Reproducible scenarios. Each loader returns (model, properties). We
# deliberately use the deterministic templates so the benchmark runs
# without an LLM key and produces stable numbers across machines.
ScenarioLoader = Callable[[], Tuple[ModelSpec, List[PropertySpec]]]

SCENARIOS: Dict[str, ScenarioLoader] = {
    "railway_crossing": lambda: _railway_crossing_draft()[:2],
    "warehouse_robot": lambda: _warehouse_robot_draft()[:2],
    "field_robot": lambda: _field_robot_draft()[:2],
}


@dataclass
class CandidateResult:
    """One candidate mutation + its solver outcome."""

    kind: str  # "remove_guard_clause" | "disable_transition"
    transition: str
    removed_clause: Optional[str] = None
    valid: bool = False
    classification: Optional[str] = None  # confirmed_failure | no_counterexample | timeout | invalid
    failed_properties: List[str] = field(default_factory=list)
    longest_trace: int = 0
    solver_time_s: float = 0.0
    validation_error: Optional[str] = None


@dataclass
class StrategyMeta:
    candidates: int
    valid_candidates: int
    solver_calls: int
    total_solver_time_s: float
    time_to_first_confirmed_s: Optional[float]
    confirmed_failures: int
    confirmed_property_names: List[str]


# ---------------------------------------------------------------------------
# Mutation generation
# ---------------------------------------------------------------------------


def generate_exhaustive_candidates(base: ModelSpec) -> List[CandidateResult]:
    """One candidate per (transition, top-level clause removed) plus one
    candidate per transition for the disable case. We do NOT pre-filter
    structurally-broken mutations — they go through validation at run
    time and are counted as invalid candidates, since the user's claim
    is about the unfiltered exhaustive budget."""
    cands: List[CandidateResult] = []
    for t in base.transitions:
        clauses = (
            split_top_conjuncts(t.guard) if t.guard and t.guard.strip() else []
        )
        for clause in clauses:
            cands.append(
                CandidateResult(
                    kind="remove_guard_clause",
                    transition=t.name,
                    removed_clause=clause,
                )
            )
        cands.append(
            CandidateResult(kind="disable_transition", transition=t.name)
        )
    return cands


def generate_guided_candidates(
    base: ModelSpec, properties: List[PropertySpec]
) -> Tuple[List[CandidateResult], List[RiskHypothesis]]:
    """Use the deterministic reviewer (also used by the live app in
    no-LLM mode and as the grounded-mutation generator in the LLM
    path)."""
    hyps, _log = _propose_hypotheses(base, properties)
    out: List[CandidateResult] = []
    for h in hyps:
        if h.mutation is None:
            continue
        out.append(
            CandidateResult(
                kind=h.mutation.kind,
                transition=h.mutation.transition,
                removed_clause=h.mutation.removed_clause,
            )
        )
    return out, hyps


# ---------------------------------------------------------------------------
# Strategy execution (same verifier + diff for both)
# ---------------------------------------------------------------------------


def apply_mutation(base: ModelSpec, c: CandidateResult) -> ModelSpec:
    new = base.model_copy(deep=True)
    if c.kind == "remove_guard_clause":
        norm_target = " ".join((c.removed_clause or "").split())
        for t in new.transitions:
            if t.name != c.transition:
                continue
            clauses = [
                cl
                for cl in split_top_conjuncts(t.guard)
                if " ".join(cl.split()) != norm_target
            ]
            t.guard = " and ".join(clauses) if clauses else "true"
            break
    elif c.kind == "disable_transition":
        new.transitions = [t for t in new.transitions if t.name != c.transition]
    else:
        raise ValueError(f"Unknown mutation kind: {c.kind}")
    return new


def run_strategy(
    base_model: ModelSpec,
    properties: List[PropertySpec],
    candidates: List[CandidateResult],
    bound: int,
    baseline_results,
) -> Tuple[List[CandidateResult], StrategyMeta]:
    """Apply each candidate, validate, then run the same Z3 check + diff
    used by the live app. Returns the (mutated) candidate list with
    per-candidate outcomes filled in, plus the aggregate StrategyMeta."""
    overall_start = time.perf_counter()
    time_to_first: Optional[float] = None
    solver_calls = 0
    confirmed_count = 0
    confirmed_names: set[str] = set()

    for c in candidates:
        mutated = apply_mutation(base_model, c)
        try:
            validate_model(mutated)
            c.valid = True
        except Exception as exc:  # noqa: BLE001 — any validation failure is "invalid"
            c.valid = False
            c.classification = "invalid"
            c.validation_error = str(exc)
            continue

        mut_verifier = Verifier(mutated)
        t0 = time.perf_counter()
        new_results = [mut_verifier.check_property(p, bound) for p in properties]
        c.solver_time_s = time.perf_counter() - t0
        solver_calls += len(new_results)

        _summary, regressions = diff_results(
            baseline_results, new_results, properties, mutated
        )

        c.failed_properties = [r.property for r in regressions]
        if regressions:
            c.classification = "confirmed_failure"
            c.longest_trace = max(
                (len(r.counterexample) for r in regressions), default=0
            )
            confirmed_count += 1
            confirmed_names.update(c.failed_properties)
            if time_to_first is None:
                time_to_first = time.perf_counter() - overall_start
        elif any(r.status == "timeout" for r in new_results):
            c.classification = "timeout"
        else:
            c.classification = "no_counterexample"

    total = time.perf_counter() - overall_start
    meta = StrategyMeta(
        candidates=len(candidates),
        valid_candidates=sum(1 for c in candidates if c.valid),
        solver_calls=solver_calls,
        total_solver_time_s=round(total, 4),
        time_to_first_confirmed_s=(
            round(time_to_first, 4) if time_to_first is not None else None
        ),
        confirmed_failures=confirmed_count,
        confirmed_property_names=sorted(confirmed_names),
    )
    return candidates, meta


# ---------------------------------------------------------------------------
# Top-level driver
# ---------------------------------------------------------------------------


def run_eval(scenario: str, bound: int) -> dict:
    if scenario not in SCENARIOS:
        raise SystemExit(
            f"Unknown scenario: {scenario!r}; choose from {sorted(SCENARIOS)}"
        )
    base_model, properties = SCENARIOS[scenario]()
    base_verifier = Verifier(base_model)
    baseline = [base_verifier.check_property(p, bound) for p in properties]
    baseline_failures = [r.property for r in baseline if r.status != "pass"]

    exhaustive_candidates = generate_exhaustive_candidates(base_model)
    guided_candidates, _guided_hyps = generate_guided_candidates(
        base_model, properties
    )

    exhaustive_results, exhaustive_meta = run_strategy(
        base_model, properties, exhaustive_candidates, bound, baseline
    )
    guided_results, guided_meta = run_strategy(
        base_model, properties, guided_candidates, bound, baseline
    )

    return {
        "scenario": scenario,
        "bound": bound,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "claim": (
            "Hypothesis guidance does not make Z3 faster per query. It "
            "reduces how many candidate mutations we ask Z3 to check."
        ),
        "baseline": {
            "total_properties": len(properties),
            "preexisting_failures": baseline_failures,
        },
        "exhaustive": {
            "meta": asdict(exhaustive_meta),
            "candidates": [asdict(c) for c in exhaustive_results],
        },
        "guided": {
            "meta": asdict(guided_meta),
            "candidates": [asdict(c) for c in guided_results],
        },
    }


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def print_table(artifact: dict) -> None:
    e = artifact["exhaustive"]["meta"]
    g = artifact["guided"]["meta"]
    header = (
        f"{'Strategy':<22}{'Candidates':>12}{'Solver calls':>14}"
        f"{'Confirmed':>11}{'Time to first':>17}{'Total time':>13}"
    )
    print(header)
    print("-" * len(header))
    for label, meta in (("Exhaustive mutations", e), ("Hypothesis-guided", g)):
        ttf = (
            f"{meta['time_to_first_confirmed_s']:.3f}s"
            if meta["time_to_first_confirmed_s"] is not None
            else "n/a"
        )
        total = f"{meta['total_solver_time_s']:.3f}s"
        print(
            f"{label:<22}"
            f"{meta['candidates']:>12}"
            f"{meta['solver_calls']:>14}"
            f"{meta['confirmed_failures']:>11}"
            f"{ttf:>17}"
            f"{total:>13}"
        )


def print_honest_summary(artifact: dict) -> None:
    e = artifact["exhaustive"]["meta"]
    g = artifact["guided"]["meta"]
    print()
    print(artifact["claim"])
    print()
    if e["solver_calls"] > 0:
        ratio = g["solver_calls"] / e["solver_calls"]
        print(
            f"Hypothesis-guided used {g['solver_calls']} solver calls "
            f"vs {e['solver_calls']} exhaustive "
            f"({ratio:.1%} of the exhaustive budget)."
        )
    if e["confirmed_failures"] > g["confirmed_failures"]:
        missed = sorted(
            set(e["confirmed_property_names"])
            - set(g["confirmed_property_names"])
        )
        print(
            f"Note: exhaustive search found {e['confirmed_failures']} "
            f"confirmed failures vs {g['confirmed_failures']} guided. "
            f"Properties found only by exhaustive: {missed}"
        )
    elif g["confirmed_failures"] > 0 and e["confirmed_failures"] == 0:
        print(
            "Note: guided found a confirmed failure that exhaustive did "
            "not — verify the exhaustive mutation set hits the relevant "
            "transition before drawing conclusions."
        )


def write_artifact(artifact: dict, scenario: str) -> Path:
    out_dir = Path(__file__).resolve().parent / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = out_dir / f"{ts}_{scenario}_search_compare.json"
    path.write_text(json.dumps(artifact, indent=2, default=str))
    return path


def main() -> None:
    ap = argparse.ArgumentParser(
        description=(
            "Compare exhaustive mutation search against hypothesis-guided "
            "search on a bundled scenario. Reports table + JSON artifact."
        )
    )
    ap.add_argument(
        "--scenario",
        default="railway_crossing",
        choices=sorted(SCENARIOS.keys()),
    )
    ap.add_argument("--bound", type=int, default=10)
    ap.add_argument(
        "--no-write",
        action="store_true",
        help="Skip JSON artifact write (useful in tests).",
    )
    args = ap.parse_args()

    artifact = run_eval(args.scenario, args.bound)

    print(
        f"=== {args.scenario} (bound={args.bound}) ===  "
        f"properties={artifact['baseline']['total_properties']}, "
        f"preexisting failures={artifact['baseline']['preexisting_failures']}"
    )
    print()
    print_table(artifact)
    print_honest_summary(artifact)

    if not args.no_write:
        path = write_artifact(artifact, args.scenario)
        print(f"\nartifact: {path}")


if __name__ == "__main__":
    main()
