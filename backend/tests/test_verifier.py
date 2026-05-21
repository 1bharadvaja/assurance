"""End-to-end verification tests on the bundled mission controller models."""

import pytest

from app.examples import EXAMPLES_DIR
from app.parser import load_model, load_properties
from app.properties import find_property
from app.verifier import Verifier


BOUND = 10


@pytest.fixture(scope="module")
def safe_model():
    return load_model(EXAMPLES_DIR / "mission-controller" / "safe.yaml")


@pytest.fixture(scope="module")
def regressed_model():
    return load_model(EXAMPLES_DIR / "mission-controller" / "regressed.yaml")


@pytest.fixture(scope="module")
def properties():
    return load_properties(EXAMPLES_DIR / "mission-controller" / "properties.yaml")


def test_safe_model_passes_all_properties(safe_model, properties):
    v = Verifier(safe_model)
    for p in properties:
        result = v.check_property(p, BOUND)
        assert result.status == "pass", (
            f"Property {p.name} should pass on safe model, got {result.status}\n"
            f"Counterexample: {result.counterexample}"
        )


def test_regressed_model_fails_no_actuate_without_authority(regressed_model, properties):
    prop = find_property(properties, "no_actuate_without_authority")
    assert prop is not None
    v = Verifier(regressed_model)
    result = v.check_property(prop, BOUND)
    assert result.status == "fail"
    assert result.counterexample is not None
    assert len(result.counterexample) > 0


def test_regressed_model_still_satisfies_other_safety_properties(
    regressed_model, properties
):
    """The regression only affects the human-authority guard."""
    v = Verifier(regressed_model)
    for name in (
        "no_actuate_on_sensor_disagreement",
        "low_battery_recovers_within_2",
        "mission_requires_armed_history",
        "gps_loss_prevents_mission_start",
    ):
        prop = find_property(properties, name)
        result = v.check_property(prop, BOUND)
        assert result.status == "pass", (
            f"Property {name} unexpectedly fails on regressed model.\n"
            f"Counterexample: {result.counterexample}"
        )
