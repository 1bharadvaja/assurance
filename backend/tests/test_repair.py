"""Tests for the targeted repair suggestion and application."""

import pytest

from app.counterexample import find_culprit
from app.examples import EXAMPLES_DIR
from app.parser import load_model, load_properties
from app.properties import find_property
from app.repair import apply_repair, suggest_repair
from app.verifier import Verifier


BOUND = 10


@pytest.fixture(scope="module")
def regressed_model():
    return load_model(EXAMPLES_DIR / "mission-controller" / "regressed.yaml")


@pytest.fixture(scope="module")
def properties():
    return load_properties(EXAMPLES_DIR / "mission-controller" / "properties.yaml")


def test_repair_adds_missing_human_authorization(regressed_model, properties):
    prop = find_property(properties, "no_actuate_without_authority")
    v = Verifier(regressed_model)
    result = v.check_property(prop, BOUND)
    assert result.status == "fail"

    culprit = find_culprit(result.counterexample, prop, regressed_model)
    repair = suggest_repair(prop, culprit)
    assert repair is not None
    assert repair.add_predicate == "human_authorized == true"
    assert repair.transition == "authorized_actuation"
    assert "human_authorized == true" in repair.new_guard


def test_repaired_model_passes_again(regressed_model, properties):
    prop = find_property(properties, "no_actuate_without_authority")
    v = Verifier(regressed_model)
    result = v.check_property(prop, BOUND)
    culprit = find_culprit(result.counterexample, prop, regressed_model)
    repair = suggest_repair(prop, culprit)
    repaired = apply_repair(regressed_model, repair)

    v2 = Verifier(repaired)
    result_after = v2.check_property(prop, BOUND)
    assert result_after.status == "pass"

    # All properties should also still pass.
    for p in properties:
        r = v2.check_property(p, BOUND)
        assert r.status == "pass", (
            f"After repair, property {p.name} should pass but got {r.status}.\n"
            f"Counterexample: {r.counterexample}"
        )
