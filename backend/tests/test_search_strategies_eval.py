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
