"""Safe restricted parser and evaluator for transition / property guards.

We accept a small, side-effect-free Boolean expression grammar:

    expr     := bool_term ('or' bool_term)*
    bool_term := bool_factor ('and' bool_factor)*
    bool_factor := 'not' bool_factor | '(' expr ')' | atom
    atom     := name comparator value
              | name 'in' '[' value (',' value)* ']'
              | name 'not' 'in' '[' ... ']'
    value    := name | 'true' | 'false'
    comparator := '==' | '!='

`name` resolves to either a state variable or an enum literal depending on
context. We piggy-back on Python's ``ast`` module for parsing because the
grammar is a strict subset of Python expressions, then validate the AST to
ensure that no disallowed constructs are present. We never call ``eval``.
"""

from __future__ import annotations

import ast
from typing import Any, Dict, Iterable, List, Mapping


class GuardSyntaxError(Exception):
    """Raised when a guard expression contains a disallowed construct."""


_ALLOWED_NODES = (
    ast.Expression,
    ast.BoolOp,
    ast.And,
    ast.Or,
    ast.UnaryOp,
    ast.Not,
    ast.Compare,
    ast.Eq,
    ast.NotEq,
    ast.In,
    ast.NotIn,
    ast.Name,
    ast.Constant,
    ast.List,
    ast.Tuple,
    ast.Load,
)


def parse_guard(expr: str) -> ast.Expression:
    """Parse a guard string and validate that only allowed nodes appear."""
    if not isinstance(expr, str) or not expr.strip():
        raise GuardSyntaxError("Guard expression must be a non-empty string.")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise GuardSyntaxError(f"Could not parse guard: {exc.msg}") from exc

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise GuardSyntaxError(
                f"Disallowed construct in guard: {type(node).__name__}"
            )
        if isinstance(node, ast.Constant) and not isinstance(node.value, bool):
            # Only allow boolean constants. Strings, numbers, None are not
            # part of our grammar.
            raise GuardSyntaxError(
                f"Only boolean literals are allowed, got: {node.value!r}"
            )
        if isinstance(node, ast.Compare):
            if len(node.ops) != 1:
                raise GuardSyntaxError("Chained comparisons are not allowed.")
            op = node.ops[0]
            if not isinstance(op, (ast.Eq, ast.NotEq, ast.In, ast.NotIn)):
                raise GuardSyntaxError(
                    f"Comparator {type(op).__name__} is not allowed."
                )
    return tree


def collect_names(tree: ast.AST) -> List[str]:
    return [n.id for n in ast.walk(tree) if isinstance(n, ast.Name)]


def evaluate(tree: ast.AST, state: Mapping[str, Any]) -> bool:
    """Evaluate a parsed guard against a concrete state dict."""
    if isinstance(tree, ast.Expression):
        return evaluate(tree.body, state)
    # Standalone bool keywords / bool literals — useful when the playground
    # ends up with an empty conjunction it wants to flatten to `true`, or a
    # disabled transition we'd express as `false`.
    if isinstance(tree, ast.Name) and tree.id in _BOOL_KEYWORDS:
        return _BOOL_KEYWORDS[tree.id]
    if isinstance(tree, ast.Constant) and isinstance(tree.value, bool):
        return tree.value
    if isinstance(tree, ast.BoolOp):
        if isinstance(tree.op, ast.And):
            return all(evaluate(v, state) for v in tree.values)
        if isinstance(tree.op, ast.Or):
            return any(evaluate(v, state) for v in tree.values)
    if isinstance(tree, ast.UnaryOp) and isinstance(tree.op, ast.Not):
        return not evaluate(tree.operand, state)
    if isinstance(tree, ast.Compare):
        left = _eval_term(tree.left, state)
        op = tree.ops[0]
        right_node = tree.comparators[0]
        if isinstance(op, (ast.Eq, ast.NotEq)):
            right = _eval_term(right_node, state)
            return (left == right) if isinstance(op, ast.Eq) else (left != right)
        if isinstance(op, (ast.In, ast.NotIn)):
            items = [_eval_term(it, state) for it in right_node.elts]
            return (left in items) if isinstance(op, ast.In) else (left not in items)
    raise GuardSyntaxError(f"Cannot evaluate node {type(tree).__name__}")


_BOOL_KEYWORDS = {"true": True, "false": False}


def _eval_term(node: ast.AST, state: Mapping[str, Any]) -> Any:
    if isinstance(node, ast.Name):
        if node.id in _BOOL_KEYWORDS:
            return _BOOL_KEYWORDS[node.id]
        if node.id in state:
            return state[node.id]
        # Treat as enum literal token.
        return node.id
    if isinstance(node, ast.Constant) and isinstance(node.value, bool):
        return node.value
    raise GuardSyntaxError(f"Unexpected term: {ast.dump(node)}")


# Keep this re-export usable from `from .guards import bool_keyword_value`.


def is_bool_keyword(name: str) -> bool:
    return name in _BOOL_KEYWORDS


def bool_keyword_value(name: str) -> bool:
    return _BOOL_KEYWORDS[name]


def variables_referenced(tree: ast.AST, known_variables: Iterable[str]) -> List[str]:
    """Return the variable names referenced in the guard (a subset of known)."""
    known = set(known_variables)
    return sorted({n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and n.id in known})
