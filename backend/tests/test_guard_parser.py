"""Tests for the restricted guard parser and evaluator."""

import pytest

from app.guards import GuardSyntaxError, evaluate, parse_guard


def _eval(expr: str, state: dict) -> bool:
    return evaluate(parse_guard(expr), state)


def test_simple_equality_against_enum():
    assert _eval("mode == Armed", {"mode": "Armed"}) is True
    assert _eval("mode == Armed", {"mode": "Idle"}) is False


def test_boolean_literal_compare():
    assert _eval("human_authorized == true", {"human_authorized": True}) is True
    assert _eval("human_authorized == false", {"human_authorized": True}) is False


def test_and_or_not_combinators():
    state = {"mode": "Mission", "battery": "Low"}
    assert _eval("mode == Mission and battery == Low", state) is True
    assert _eval("mode == Mission or battery == High", state) is True
    assert _eval("not (mode == Mission and battery == Low)", state) is False


def test_in_membership():
    assert _eval("mode in [Mission, DegradedComms]", {"mode": "Mission"}) is True
    assert _eval("mode in [Mission, DegradedComms]", {"mode": "Idle"}) is False


def test_not_in_membership():
    assert _eval("mode not in [Idle, Armed]", {"mode": "Mission"}) is True
    assert _eval("mode not in [Idle, Armed]", {"mode": "Idle"}) is False


def test_rejects_function_call():
    with pytest.raises(GuardSyntaxError):
        parse_guard("print(mode)")


def test_rejects_subscript():
    with pytest.raises(GuardSyntaxError):
        parse_guard("mode[0] == Idle")


def test_rejects_chained_compare():
    with pytest.raises(GuardSyntaxError):
        parse_guard("1 == 1 == 1")


def test_rejects_arithmetic():
    with pytest.raises(GuardSyntaxError):
        parse_guard("mode + 1 == 2")


def test_rejects_string_literals():
    with pytest.raises(GuardSyntaxError):
        parse_guard("mode == 'Idle'")


def test_rejects_empty_string():
    with pytest.raises(GuardSyntaxError):
        parse_guard("")


def test_standalone_bool_keyword():
    """The playground reduces empty conjunctions to the literal `true`."""
    assert _eval("true", {}) is True
    assert _eval("false", {}) is False
    assert _eval("not false", {}) is True
    assert _eval("true or false", {}) is True
    assert _eval("(true) and mode == Idle", {"mode": "Idle"}) is True
