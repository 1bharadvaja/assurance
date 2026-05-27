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
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Set, Tuple

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
    # Properties confirmed-failed by SOME strategy but not by this one.
    # Filled in after all strategies have run; empty until then.
    missed_properties: List[str] = field(default_factory=list)


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
# Property-coverage augmentation
#
# Guided search is a triage strategy. The reviewer prioritises the
# clearest unsafe weakenings, but it can miss properties whose response
# path the reviewer never thought to disable. This augmentation walks
# each property and — only if no existing candidate already touches it
# — emits at most ONE extra candidate per property, capped at
# ``max_total`` overall. This improves recall without blowing the
# guided budget out toward exhaustive search.
# ---------------------------------------------------------------------------


_MODE_EQ_RE = re.compile(r"\bmode\s*==\s*([A-Za-z_][A-Za-z0-9_]*)")
_PRE_STATE_RE = re.compile(r"^\s*mode\s*==\s*[A-Za-z_][A-Za-z0-9_]*\s*$")


def _property_modes(p: PropertySpec) -> Set[str]:
    out: Set[str] = set()
    for expr in (p.condition, p.trigger, p.response):
        if expr:
            out.update(_MODE_EQ_RE.findall(expr))
    return out


def _response_modes(p: PropertySpec) -> Set[str]:
    if p.type != "bounded_response" or not p.response:
        return set()
    return set(_MODE_EQ_RE.findall(p.response))


def _property_variables(p: PropertySpec, known: Set[str]) -> Set[str]:
    out: Set[str] = set()
    for expr in (p.condition, p.trigger, p.response):
        if not expr:
            continue
        for v in known:
            if re.search(rf"\b{re.escape(v)}\b", expr):
                out.add(v)
    return out


def _candidate_touches_property(
    c: CandidateResult,
    p: PropertySpec,
    base: ModelSpec,
    known_vars: Set[str],
) -> bool:
    """Per-candidate heuristic — used only for invariant coverage.

    For invariants, a single candidate is enough to "touch" the property
    if it enters a named bad-mode or mutates a relevant non-mode
    variable. `mode` itself is excluded from variable-overlap checks
    because every mode transition mutates it, which would trivially
    cover every property.

    For bounded_response see ``_is_property_covered`` — disjunctive
    responses need every disjunct accounted for, which is a set-level
    check rather than a per-candidate one.
    """
    trans = next((t for t in base.transitions if t.name == c.transition), None)
    if trans is None:
        return False
    target_mode = trans.updates.get("mode")
    prop_modes = _property_modes(p)
    non_mode_vars = {v for v in known_vars if v != "mode"}
    prop_vars = _property_variables(p, non_mode_vars)
    if target_mode and target_mode in prop_modes:
        return True
    if set(trans.updates.keys()) & prop_vars:
        return True
    if c.removed_clause:
        for v in prop_vars:
            if re.search(rf"\b{re.escape(v)}\b", c.removed_clause):
                return True
    return False


def _is_property_covered(
    candidates: List[CandidateResult],
    p: PropertySpec,
    base: ModelSpec,
    known_vars: Set[str],
) -> bool:
    """Set-level coverage check.

    Bounded-response responses can be disjunctive (e.g.
    ``mode == GateDown or mode == Fault``). A single mutation that
    blocks one disjunct doesn't actually exercise the property — the
    other disjunct can still satisfy it. So we require EVERY response
    mode to be covered by at least one candidate before treating the
    property as covered.

    Invariants are checked per-candidate (any matching candidate
    suffices).
    """
    if p.type == "bounded_response":
        response_modes = _response_modes(p)
        if not response_modes:
            # Response doesn't reference any concrete mode — fall back
            # to per-candidate to avoid blocking on something we can't
            # decompose.
            return any(
                _candidate_touches_property(c, p, base, known_vars)
                for c in candidates
            )
        covered: Set[str] = set()
        for c in candidates:
            trans = next(
                (t for t in base.transitions if t.name == c.transition),
                None,
            )
            if trans is None:
                continue
            tm = trans.updates.get("mode")
            if tm in response_modes:
                covered.add(tm)
        return response_modes.issubset(covered)

    # Invariants: per-candidate touches check is sufficient.
    return any(
        _candidate_touches_property(c, p, base, known_vars) for c in candidates
    )


def _coverage_candidate_for(
    p: PropertySpec,
    base: ModelSpec,
    existing: List[CandidateResult],
    existing_keys: Set[Tuple[str, str, str]],
    known_vars: Set[str],
) -> Optional[CandidateResult]:
    """Best-effort: try to emit one candidate that exercises the
    property's response/condition path. Returns None when nothing
    sensible can be generated (e.g. property doesn't mention any mode)."""
    if p.type == "bounded_response":
        # Disable a transition that produces the FIRST response mode
        # not already covered by an existing candidate. For disjunctive
        # responses (e.g. `mode == GateDown or mode == Fault`) this
        # prefers the disjunct still lacking a candidate.
        already_covered_modes: Set[str] = set()
        for c in existing:
            trans = next(
                (t for t in base.transitions if t.name == c.transition),
                None,
            )
            if trans is not None:
                tm = trans.updates.get("mode")
                if tm in _response_modes(p):
                    already_covered_modes.add(tm)
        for target_mode in _response_modes(p):
            if target_mode in already_covered_modes:
                continue
            for t in base.transitions:
                if t.updates.get("mode") != target_mode:
                    continue
                key = ("disable_transition", t.name, "")
                if key in existing_keys:
                    continue
                return CandidateResult(
                    kind="disable_transition", transition=t.name
                )
        return None

    if p.type == "invariant":
        prop_modes = _property_modes(p)
        prop_vars = _property_variables(p, known_vars)
        # First pass: prefer remove_guard_clause on a non-pre-state
        # clause that names one of the property's variables.
        for t in base.transitions:
            if t.updates.get("mode") not in prop_modes:
                continue
            for clause in split_top_conjuncts(t.guard or ""):
                if _PRE_STATE_RE.match(clause):
                    continue
                names_a_prop_var = any(
                    re.search(rf"\b{re.escape(v)}\b", clause) for v in prop_vars
                )
                if not names_a_prop_var:
                    continue
                norm = " ".join(clause.split())
                key = ("remove_guard_clause", t.name, norm)
                if key in existing_keys:
                    continue
                return CandidateResult(
                    kind="remove_guard_clause",
                    transition=t.name,
                    removed_clause=clause,
                )
        # Fallback: disable a transition that enters the bad mode.
        for t in base.transitions:
            if t.updates.get("mode") not in prop_modes:
                continue
            key = ("disable_transition", t.name, "")
            if key in existing_keys:
                continue
            return CandidateResult(
                kind="disable_transition", transition=t.name
            )
        return None

    return None


def generate_coverage_candidates(
    base: ModelSpec,
    properties: List[PropertySpec],
    existing: List[CandidateResult],
    max_total: int = 30,
) -> List[CandidateResult]:
    """Return ``existing`` plus at most one extra candidate per property
    that no existing candidate touches, up to a global ``max_total`` cap.

    The augmentation is intentionally conservative — it never duplicates
    an existing candidate, and it never adds more than one candidate per
    property. The hard cap exists to prevent the guided strategy from
    drifting toward exhaustive search.
    """
    if max_total <= len(existing):
        return list(existing)
    known_vars = set(base.variables.keys())
    out: List[CandidateResult] = list(existing)
    existing_keys = {
        (c.kind, c.transition, " ".join((c.removed_clause or "").split()))
        for c in out
    }
    for p in properties:
        if len(out) >= max_total:
            break
        if _is_property_covered(out, p, base, known_vars):
            continue
        extra = _coverage_candidate_for(
            p, base, out, existing_keys, known_vars
        )
        if extra is None:
            continue
        out.append(extra)
        existing_keys.add(
            (
                extra.kind,
                extra.transition,
                " ".join((extra.removed_clause or "").split()),
            )
        )
    return out


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


def run_eval(
    scenario: str, bound: int, coverage_max_total: int = 30
) -> dict:
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
    coverage_candidates = generate_coverage_candidates(
        base_model,
        properties,
        guided_candidates,
        max_total=coverage_max_total,
    )

    exhaustive_results, exhaustive_meta = run_strategy(
        base_model, properties, exhaustive_candidates, bound, baseline
    )
    guided_results, guided_meta = run_strategy(
        base_model, properties, guided_candidates, bound, baseline
    )
    coverage_results, coverage_meta = run_strategy(
        base_model, properties, coverage_candidates, bound, baseline
    )

    # Fill `missed_properties` per strategy relative to the union of
    # confirmed property names across ALL strategies (so each strategy's
    # missed list is "things that some strategy demonstrated were
    # checkable but this one didn't surface").
    universe: Set[str] = set()
    for m in (exhaustive_meta, guided_meta, coverage_meta):
        universe.update(m.confirmed_property_names)
    for m in (exhaustive_meta, guided_meta, coverage_meta):
        m.missed_properties = sorted(
            universe - set(m.confirmed_property_names)
        )

    return {
        "scenario": scenario,
        "bound": bound,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "claim": (
            "Hypothesis guidance does not make Z3 faster per query. It "
            "reduces how many candidate mutations we ask Z3 to check. "
            "Coverage augmentation improves recall while keeping the "
            "guided candidate budget well below exhaustive."
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
        "guided_with_property_coverage": {
            "meta": asdict(coverage_meta),
            "candidates": [asdict(c) for c in coverage_results],
        },
    }


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


_STRATEGY_ROWS = [
    ("Exhaustive mutations", "exhaustive"),
    ("Hypothesis-guided", "guided"),
    ("Guided + coverage", "guided_with_property_coverage"),
]


def print_table(artifact: dict) -> None:
    header = (
        f"{'Strategy':<22}{'Candidates':>12}{'Solver calls':>14}"
        f"{'Confirmed':>11}{'Time to first':>17}{'Total time':>13}"
    )
    print(header)
    print("-" * len(header))
    for label, key in _STRATEGY_ROWS:
        meta = artifact[key]["meta"]
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
    c = artifact["guided_with_property_coverage"]["meta"]
    print()
    print(artifact["claim"])
    print()
    if e["solver_calls"] > 0:
        for label, meta in (
            ("Hypothesis-guided", g),
            ("Guided + coverage", c),
        ):
            ratio = meta["solver_calls"] / e["solver_calls"]
            print(
                f"{label}: {meta['solver_calls']} solver calls "
                f"vs {e['solver_calls']} exhaustive "
                f"({ratio:.1%} of the exhaustive budget)."
            )
    print()
    for label, meta in (
        ("Exhaustive", e),
        ("Hypothesis-guided", g),
        ("Guided + coverage", c),
    ):
        missed = meta.get("missed_properties") or []
        if missed:
            print(f"{label} missed: {missed}")
        else:
            print(f"{label} missed: (none — every confirmed property surfaced)")


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
