"""Tests for counterexample interpretation."""

import pytest

from app.counterexample import find_culprit
from app.examples import EXAMPLES_DIR
from app.parser import load_model, load_properties
from app.properties import find_property
from app.verifier import Verifier


BOUND = 10


@pytest.fixture(scope="module")
def regressed_model():
    return load_model(EXAMPLES_DIR / "mission-controller" / "regressed.yaml")


@pytest.fixture(scope="module")
def properties():
    return load_properties(EXAMPLES_DIR / "mission-controller" / "properties.yaml")


def test_counterexample_reaches_unsafe_actuate(regressed_model, properties):
    prop = find_property(properties, "no_actuate_without_authority")
    v = Verifier(regressed_model)
    result = v.check_property(prop, BOUND)
    assert result.status == "fail"
    final = result.counterexample[-1]
    assert final["mode"] == "Actuate"
    assert final["comms"] == "Lost"
    assert final["human_authorized"] is False


def test_culprit_transition_is_authorized_actuation(regressed_model, properties):
    prop = find_property(properties, "no_actuate_without_authority")
    v = Verifier(regressed_model)
    result = v.check_property(prop, BOUND)
    culprit = find_culprit(result.counterexample, prop, regressed_model)
    assert culprit is not None
    assert culprit.name == "authorized_actuation"
    # Culprit's guard must NOT mention human_authorized (this is the regression).
    assert "human_authorized" not in culprit.guard
