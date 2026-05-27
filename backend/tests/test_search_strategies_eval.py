"""Acceptance test for evals/compare_search_strategies.py.

Locks in the user-facing claim of the benchmark: hypothesis-guided
search must use strictly fewer solver calls than exhaustive mutation
search on the railway scenario, and both strategies must surface at
least one confirmed failure (otherwise the comparison says nothing).

The benchmark runs Z3 several dozen times, so it's a bit heavier than
the rest of the suite — but still well under five seconds on a
laptop. Skip if you're iterating on parser/health-check code by
selecting the rest of the suite explicitly.
"""

from __future__ import annotations

import pytest

from evals.compare_search_strategies import run_eval


@pytest.fixture(scope="module")
def railway_artifact():
    return run_eval(scenario="railway_crossing", bound=10)


def test_artifact_has_expected_shape(railway_artifact):
    a = railway_artifact
    for key in ("scenario", "bound", "claim", "baseline", "exhaustive", "guided"):
        assert key in a, f"artifact missing {key}"
    for side in ("exhaustive", "guided"):
        assert "meta" in a[side] and "candidates" in a[side]
        meta = a[side]["meta"]
        for mkey in (
            "candidates",
            "valid_candidates",
            "solver_calls",
            "total_solver_time_s",
            "time_to_first_confirmed_s",
            "confirmed_failures",
            "confirmed_property_names",
        ):
            assert mkey in meta, f"{side}.meta missing {mkey}"


def test_guided_strictly_fewer_solver_calls(railway_artifact):
    """The core empirical claim of the benchmark."""
    e = railway_artifact["exhaustive"]["meta"]
    g = railway_artifact["guided"]["meta"]
    assert g["solver_calls"] < e["solver_calls"], (
        f"Hypothesis-guided made {g['solver_calls']} solver calls vs "
        f"{e['solver_calls']} exhaustive — guided must be strictly fewer."
    )


def test_both_strategies_find_a_confirmed_failure(railway_artifact):
    """If either strategy reports zero confirmed failures we cannot
    meaningfully compare time-to-first-confirmed."""
    e = railway_artifact["exhaustive"]["meta"]
    g = railway_artifact["guided"]["meta"]
    assert e["confirmed_failures"] >= 1, "exhaustive should find at least one failure"
    assert g["confirmed_failures"] >= 1, "guided should find at least one failure"


def test_time_to_first_reported_for_both(railway_artifact):
    e = railway_artifact["exhaustive"]["meta"]
    g = railway_artifact["guided"]["meta"]
    assert e["time_to_first_confirmed_s"] is not None
    assert g["time_to_first_confirmed_s"] is not None
    # Don't assert a strict winner — exhaustive could happen to hit a
    # confirmed-failure candidate first if its iteration order is
    # favourable. The benchmark's primary claim is solver-call count,
    # not latency.


def test_guided_candidates_are_subset_or_distinct_from_exhaustive(
    railway_artifact,
):
    """Sanity: every guided candidate's (kind, transition, removed_clause)
    triple is either also enumerated by the exhaustive strategy or
    distinct. We don't require strict subset because the reviewer is
    free to propose mutations the exhaustive enumerator skips, but
    silently producing 0 candidates would be a bug."""
    g = railway_artifact["guided"]["candidates"]
    assert g, "guided candidate set should be non-empty"


# ---------------------------------------------------------------------------
# Property coverage augmentation
# ---------------------------------------------------------------------------


def test_coverage_strategy_present(railway_artifact):
    assert "guided_with_property_coverage" in railway_artifact


def test_coverage_has_more_or_equal_candidates_than_guided(railway_artifact):
    g = railway_artifact["guided"]["meta"]
    c = railway_artifact["guided_with_property_coverage"]["meta"]
    assert c["candidates"] >= g["candidates"], (
        f"coverage candidates ({c['candidates']}) must be >= guided "
        f"({g['candidates']})"
    )


def test_coverage_has_fewer_candidates_than_exhaustive(railway_artifact):
    e = railway_artifact["exhaustive"]["meta"]
    c = railway_artifact["guided_with_property_coverage"]["meta"]
    assert c["candidates"] < e["candidates"], (
        f"coverage candidates ({c['candidates']}) must be < exhaustive "
        f"({e['candidates']}) — the augmentation must not drift toward "
        "exhaustive search"
    )


def test_coverage_includes_candidate_for_gate_down_response(railway_artifact):
    """The railway-specific recall claim: coverage augmentation must
    include at least one candidate targeting the
    `train_detection_reaches_gate_down` bounded response (whose
    response is `mode == GateDown or mode == Fault`).

    Concretely: a candidate that disables a transition entering
    GateDown — `gate_reaches_down` in the railway template — or any
    transition on the chain leading to GateDown."""
    coverage = railway_artifact["guided_with_property_coverage"]["candidates"]
    guided = railway_artifact["guided"]["candidates"]
    new_cands = [
        c for c in coverage
        if (c["kind"], c["transition"], c["removed_clause"])
        not in {
            (g["kind"], g["transition"], g["removed_clause"]) for g in guided
        }
    ]
    # The augmentation should have added something (otherwise the
    # property would remain missed).
    assert new_cands, "coverage augmentation added zero candidates"
    # At least one new candidate should disable a transition on the
    # GateDown response path.
    gate_down_path = {
        "train_detected_warning",
        "lower_gate",
        "gate_reaches_down",
    }
    targeting_path = [
        c for c in new_cands
        if c["kind"] == "disable_transition"
        and c["transition"] in gate_down_path
    ]
    assert targeting_path, (
        "coverage augmentation should have added a disable_transition "
        f"candidate on the GateDown response path; got new candidates: "
        f"{new_cands}"
    )


def test_artifact_has_missed_properties_per_strategy(railway_artifact):
    for key in ("exhaustive", "guided", "guided_with_property_coverage"):
        meta = railway_artifact[key]["meta"]
        assert "missed_properties" in meta, f"{key}.meta missing missed_properties"
        assert isinstance(meta["missed_properties"], list)


def test_coverage_strategy_finds_train_detection_property(railway_artifact):
    """End-to-end: the coverage strategy must surface
    `train_detection_reaches_gate_down` as a confirmed failure — that
    is the regression the augmentation is designed to close."""
    c = railway_artifact["guided_with_property_coverage"]["meta"]
    assert "train_detection_reaches_gate_down" in c["confirmed_property_names"], (
        f"coverage strategy did not confirm "
        f"train_detection_reaches_gate_down; got: "
        f"{c['confirmed_property_names']}"
    )


def test_coverage_at_most_one_new_candidate_per_property(railway_artifact):
    """The user-stated invariant: max 1 extra coverage candidate per
    property. On railway, 5 properties → at most 5 new candidates."""
    guided = railway_artifact["guided"]["candidates"]
    coverage = railway_artifact["guided_with_property_coverage"]["candidates"]
    new_count = len(coverage) - len(guided)
    n_props = railway_artifact["baseline"]["total_properties"]
    assert new_count <= n_props, (
        f"coverage added {new_count} candidates; budget is {n_props} "
        "(one per property)."
    )
