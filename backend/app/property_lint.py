"""Lightweight semantic linter for generated properties.

The drafter and the reviewer can both emit bad properties:

- Vacuous invariants like ``not (mode == Draining and mode == Filling)`` —
  ``mode`` cannot be two values simultaneously, so the negation is
  trivially true regardless of the model.
- Mixed ``and`` / ``or`` without parentheses, where the author probably
  did not mean Python's default precedence.

These are not parse errors (the guard parser is happy), so they slip
past validation. The linter spots them and returns short human-readable
warnings the API surfaces to the caller.
"""

from __future__ import annotations

import ast as _ast
import re
from typing import List, Optional

from .guards import GuardSyntaxError, parse_guard
from .models import PropertySpec


def lint_property(p: PropertySpec) -> List[str]:
    out: List[str] = []
    if p.type == "invariant":
        if p.condition:
            out.extend(_lint_expr(p.condition, where=f"invariant `{p.name}` condition"))
    elif p.type == "bounded_response":
        if p.trigger:
            out.extend(_lint_expr(p.trigger, where=f"bounded_response `{p.name}` trigger"))
        if p.response:
            out.extend(_lint_expr(p.response, where=f"bounded_response `{p.name}` response"))
    return out


def _lint_expr(expr: str, where: str) -> List[str]:
    warnings: List[str] = []
    warnings.extend(_lint_mixed_and_or(expr, where))
    try:
        tree = parse_guard(expr).body
    except GuardSyntaxError:
        return warnings  # parser will reject elsewhere
    # Strip a single leading `not` so we lint the inner predicate.
    inner = tree
    if isinstance(inner, _ast.UnaryOp) and isinstance(inner.op, _ast.Not):
        inner = inner.operand
    warnings.extend(_lint_vacuous_var_equality(inner, where))
    return warnings


def _lint_mixed_and_or(expr: str, where: str) -> List[str]:
    """If both `and` and `or` appear without any parentheses, the author
    probably did not mean Python's default precedence. Warn."""
    if "(" in expr or ")" in expr:
        return []
    low = expr.lower()
    if " and " in low and " or " in low:
        return [
            f"{where}: mixes `and` and `or` without parentheses — "
            "Python evaluates `and` before `or`, which may not be the "
            "intended grouping. Add explicit parentheses."
        ]
    return []


def _lint_vacuous_var_equality(node: _ast.AST, where: str) -> List[str]:
    """Detect `var == A and var == B` where A != B (vacuous: a single
    variable cannot equal two distinct values at the same time)."""
    if not (isinstance(node, _ast.BoolOp) and isinstance(node.op, _ast.And)):
        return []
    # collect var == LITERAL pairs from top-level conjuncts (recurse into
    # parenthesised conjunctions so we also catch nested cases)
    eq_map: dict[str, set[str]] = {}
    for clause in _flatten_and(node):
        var, literal = _extract_var_eq_literal(clause)
        if var is None or literal is None:
            continue
        eq_map.setdefault(var, set()).add(literal)
    warnings: List[str] = []
    for var, vals in eq_map.items():
        if len(vals) >= 2:
            warnings.append(
                f"{where}: vacuous — requires `{var}` to be both "
                f"{' and '.join(sorted(vals))} at the same time, which "
                "is impossible."
            )
    return warnings


def _flatten_and(node: _ast.AST) -> List[_ast.AST]:
    if isinstance(node, _ast.BoolOp) and isinstance(node.op, _ast.And):
        out: List[_ast.AST] = []
        for v in node.values:
            out.extend(_flatten_and(v))
        return out
    return [node]


def _extract_var_eq_literal(
    node: _ast.AST,
) -> tuple[Optional[str], Optional[str]]:
    """Return (var_name, literal) for `var == literal`, else (None, None)."""
    if not (isinstance(node, _ast.Compare) and len(node.ops) == 1):
        return None, None
    if not isinstance(node.ops[0], _ast.Eq):
        return None, None
    left, right = node.left, node.comparators[0]
    if isinstance(left, _ast.Name) and isinstance(right, _ast.Name):
        return left.id, right.id
    return None, None
