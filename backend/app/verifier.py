"""Z3-backed bounded model checker for Assurance Studio."""

from __future__ import annotations

import ast as _ast
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Tuple

import z3

from .guards import bool_keyword_value, is_bool_keyword, parse_guard
from .models import ModelSpec, PropertySpec, VerificationResult


def _solver_timeout_ms() -> int:
    """Per-query Z3 timeout in ms.

    Configurable via ``ASSURANCE_SOLVER_TIMEOUT_MS`` so deployments can
    tune it. Defaults to 5s which is comfortably above the time the
    bundled scenarios take and short enough to keep a public endpoint
    responsive.
    """
    raw = os.getenv("ASSURANCE_SOLVER_TIMEOUT_MS", "5000")
    try:
        return max(500, int(raw))
    except ValueError:
        return 5000


def _new_solver() -> z3.Solver:
    s = z3.Solver()
    s.set("timeout", _solver_timeout_ms())
    return s


# ---------------------------------------------------------------------------
# Guard -> Z3 conversion (per-time-step).
# ---------------------------------------------------------------------------


@dataclass
class _Z3Env:
    """Bundle of Z3 sorts and constants used to lower a guard at a time step."""

    sorts: Dict[str, Tuple[z3.SortRef, Dict[str, z3.ExprRef]]]  # enum var -> (sort, name->const)
    vars: Dict[str, z3.ExprRef]                                  # var name -> z3 const at time t
    var_types: Dict[str, str]                                    # var name -> "enum" | "bool"

    def enum_const(self, var: str, literal: str) -> z3.ExprRef:
        _, consts = self.sorts[var]
        return consts[literal]


def _node_to_z3(node: _ast.AST, env: _Z3Env) -> z3.ExprRef:
    if isinstance(node, _ast.Expression):
        return _node_to_z3(node.body, env)
    if isinstance(node, _ast.Name) and is_bool_keyword(node.id):
        return z3.BoolVal(bool_keyword_value(node.id))
    if isinstance(node, _ast.Constant) and isinstance(node.value, bool):
        return z3.BoolVal(node.value)
    if isinstance(node, _ast.BoolOp):
        parts = [_node_to_z3(v, env) for v in node.values]
        if isinstance(node.op, _ast.And):
            return z3.And(*parts) if parts else z3.BoolVal(True)
        if isinstance(node.op, _ast.Or):
            return z3.Or(*parts) if parts else z3.BoolVal(False)
    if isinstance(node, _ast.UnaryOp) and isinstance(node.op, _ast.Not):
        return z3.Not(_node_to_z3(node.operand, env))
    if isinstance(node, _ast.Compare):
        left_node = node.left
        op = node.ops[0]
        right_node = node.comparators[0]
        if isinstance(op, (_ast.Eq, _ast.NotEq)):
            left_z3, right_z3 = _resolve_pair(left_node, right_node, env)
            return (left_z3 == right_z3) if isinstance(op, _ast.Eq) else (left_z3 != right_z3)
        if isinstance(op, (_ast.In, _ast.NotIn)):
            # right is a List of literals; left is a variable name.
            if not isinstance(left_node, _ast.Name) or left_node.id not in env.vars:
                raise ValueError("`in` operator expects a state variable on the left.")
            left_z3 = env.vars[left_node.id]
            items = [_resolve_literal(left_node.id, it, env) for it in right_node.elts]
            disj = z3.Or(*[left_z3 == it for it in items]) if items else z3.BoolVal(False)
            return disj if isinstance(op, _ast.In) else z3.Not(disj)
    raise ValueError(f"Cannot lower node {type(node).__name__} to Z3.")


def _resolve_pair(
    left: _ast.AST, right: _ast.AST, env: _Z3Env
) -> Tuple[z3.ExprRef, z3.ExprRef]:
    """Resolve two operands of an equality, taking variable types into account."""
    # Case: variable on left, literal/variable on right.
    if isinstance(left, _ast.Name) and left.id in env.vars:
        return env.vars[left.id], _resolve_literal(left.id, right, env)
    if isinstance(right, _ast.Name) and right.id in env.vars:
        return _resolve_literal(right.id, left, env), env.vars[right.id]
    # Otherwise: both are literals / unknowns. Treat as boolean constants.
    return _resolve_pure(left), _resolve_pure(right)


def _resolve_literal(var_name: str, node: _ast.AST, env: _Z3Env) -> z3.ExprRef:
    vtype = env.var_types[var_name]
    if isinstance(node, _ast.Constant) and isinstance(node.value, bool):
        if vtype != "bool":
            raise ValueError(f"Cannot compare {var_name} ({vtype}) with bool literal.")
        return z3.BoolVal(node.value)
    if isinstance(node, _ast.Name):
        if is_bool_keyword(node.id):
            if vtype != "bool":
                raise ValueError(
                    f"Cannot compare {var_name} ({vtype}) with bool keyword {node.id!r}."
                )
            return z3.BoolVal(bool_keyword_value(node.id))
        if node.id in env.vars:
            return env.vars[node.id]
        if vtype != "enum":
            raise ValueError(f"Cannot compare {var_name} ({vtype}) with name {node.id!r}.")
        try:
            return env.enum_const(var_name, node.id)
        except KeyError as exc:
            raise ValueError(
                f"{node.id!r} is not a valid value for enum variable {var_name!r}."
            ) from exc
    raise ValueError(f"Unsupported operand in guard: {_ast.dump(node)}")


def _resolve_pure(node: _ast.AST) -> z3.ExprRef:
    if isinstance(node, _ast.Constant) and isinstance(node.value, bool):
        return z3.BoolVal(node.value)
    if isinstance(node, _ast.Name) and is_bool_keyword(node.id):
        return z3.BoolVal(bool_keyword_value(node.id))
    raise ValueError(f"Unsupported standalone term: {_ast.dump(node)}")


# ---------------------------------------------------------------------------
# Verifier
# ---------------------------------------------------------------------------


class Verifier:
    """Bounded model checker for a given model spec.

    Each verification call uses freshly-named Z3 sorts and constants so that
    repeated calls (e.g. from a long-lived API process) cannot collide in the
    underlying solver namespace.
    """

    _suffix_counter = 0

    def __init__(self, spec: ModelSpec):
        self.spec = spec
        # Pre-parse guards once.
        self._parsed_guards = {t.name: parse_guard(t.guard) for t in spec.transitions}

    # -- Z3 environment construction -------------------------------------

    @classmethod
    def _next_suffix(cls) -> int:
        cls._suffix_counter += 1
        return cls._suffix_counter

    def _make_sorts_and_vars(
        self, bound: int
    ) -> Tuple[
        Dict[str, Tuple[z3.SortRef, Dict[str, z3.ExprRef]]],
        List[Dict[str, z3.ExprRef]],
        List[z3.ExprRef],
    ]:
        suffix = self._next_suffix()
        sorts: Dict[str, Tuple[z3.SortRef, Dict[str, z3.ExprRef]]] = {}
        for vname, vinfo in self.spec.variables.items():
            if vinfo.type == "enum":
                sort, consts = z3.EnumSort(
                    f"{vname}_sort_{suffix}", vinfo.values or []
                )
                sorts[vname] = (sort, dict(zip(vinfo.values or [], consts)))
        vars_by_t: List[Dict[str, z3.ExprRef]] = []
        for t in range(bound + 1):
            row: Dict[str, z3.ExprRef] = {}
            for vname, vinfo in self.spec.variables.items():
                tag = f"{vname}_{t}_{suffix}"
                if vinfo.type == "enum":
                    sort, _ = sorts[vname]
                    row[vname] = z3.Const(tag, sort)
                else:
                    row[vname] = z3.Bool(tag)
            vars_by_t.append(row)
        trans_choices = [z3.Int(f"trans_{t}_{suffix}") for t in range(bound)]
        return sorts, vars_by_t, trans_choices

    def _env(
        self,
        sorts: Dict[str, Tuple[z3.SortRef, Dict[str, z3.ExprRef]]],
        vars_at_t: Dict[str, z3.ExprRef],
    ) -> _Z3Env:
        return _Z3Env(
            sorts=sorts,
            vars=vars_at_t,
            var_types={n: v.type for n, v in self.spec.variables.items()},
        )

    # -- Constraint generation -------------------------------------------

    def _initial_constraints(
        self,
        sorts: Dict[str, Tuple[z3.SortRef, Dict[str, z3.ExprRef]]],
        vars0: Dict[str, z3.ExprRef],
    ) -> List[z3.ExprRef]:
        constraints: List[z3.ExprRef] = []
        for name, vinfo in self.spec.variables.items():
            if vinfo.type == "enum":
                _, consts = sorts[name]
                constraints.append(vars0[name] == consts[vinfo.initial])
            else:
                constraints.append(vars0[name] == z3.BoolVal(bool(vinfo.initial)))
        return constraints

    def _literal_z3(
        self,
        var: str,
        value: Any,
        sorts: Dict[str, Tuple[z3.SortRef, Dict[str, z3.ExprRef]]],
    ) -> z3.ExprRef:
        vinfo = self.spec.variables[var]
        if vinfo.type == "enum":
            _, consts = sorts[var]
            return consts[value]
        return z3.BoolVal(bool(value))

    def _step_constraints(
        self,
        sorts: Dict[str, Tuple[z3.SortRef, Dict[str, z3.ExprRef]]],
        vars_t: Dict[str, z3.ExprRef],
        vars_tp1: Dict[str, z3.ExprRef],
        trans_choice: z3.ExprRef,
    ) -> List[z3.ExprRef]:
        constraints: List[z3.ExprRef] = []
        env_t = self._env(sorts, vars_t)
        n = len(self.spec.transitions)
        all_var_names = list(self.spec.variables.keys())

        # Build per-transition implications.
        for i, trans in enumerate(self.spec.transitions):
            guard_z3 = _node_to_z3(self._parsed_guards[trans.name].body, env_t)
            update_eqs: List[z3.ExprRef] = []
            for var, val in trans.updates.items():
                update_eqs.append(vars_tp1[var] == self._literal_z3(var, val, sorts))
            for v in all_var_names:
                if v not in trans.updates:
                    update_eqs.append(vars_tp1[v] == vars_t[v])
            applies = z3.And(guard_z3, *update_eqs) if update_eqs else guard_z3
            constraints.append(z3.Implies(trans_choice == i, applies))

        # Stutter: index n.
        stutter_eqs = [vars_tp1[v] == vars_t[v] for v in all_var_names]
        constraints.append(z3.Implies(trans_choice == n, z3.And(*stutter_eqs)))
        constraints.append(z3.And(trans_choice >= 0, trans_choice <= n))

        # Reactive transitions: if guard holds AND no higher-priority reactive
        # guard holds, the reactive transition must fire.
        reactives = [
            (i, trans)
            for i, trans in enumerate(self.spec.transitions)
            if trans.reactive
        ]
        for idx, (i_react, trans_react) in enumerate(reactives):
            guard_z3 = _node_to_z3(self._parsed_guards[trans_react.name].body, env_t)
            higher_guards = []
            for _, t_high in reactives[:idx]:
                higher_guards.append(
                    _node_to_z3(self._parsed_guards[t_high.name].body, env_t)
                )
            higher_fires = z3.Or(*higher_guards) if higher_guards else z3.BoolVal(False)
            constraints.append(
                z3.Implies(z3.And(guard_z3, z3.Not(higher_fires)), trans_choice == i_react)
            )

        return constraints

    # -- Public verification API -----------------------------------------

    def check_property(self, prop: PropertySpec, bound: int) -> VerificationResult:
        if prop.type == "invariant":
            return self._check_invariant(prop, bound)
        if prop.type == "bounded_response":
            return self._check_bounded_response(prop, bound)
        raise ValueError(f"Unsupported property type: {prop.type}")

    # -- Invariant checking ----------------------------------------------

    def _check_invariant(self, prop: PropertySpec, bound: int) -> VerificationResult:
        assert prop.condition is not None
        start = time.perf_counter()
        sorts, vars_by_t, trans_choices = self._make_sorts_and_vars(bound)

        solver = _new_solver()
        for c in self._initial_constraints(sorts, vars_by_t[0]):
            solver.add(c)
        for t in range(bound):
            for c in self._step_constraints(
                sorts, vars_by_t[t], vars_by_t[t + 1], trans_choices[t]
            ):
                solver.add(c)

        cond_ast = parse_guard(prop.condition)
        violations = []
        for t in range(bound + 1):
            env_t = self._env(sorts, vars_by_t[t])
            cond_at_t = _node_to_z3(cond_ast.body, env_t)
            violations.append(z3.Not(cond_at_t))
        solver.add(z3.Or(*violations))

        result = solver.check()
        elapsed = (time.perf_counter() - start) * 1000.0
        if result == z3.sat:
            model = solver.model()
            first_t = self._first_violation_time(
                model, sorts, vars_by_t, cond_ast, bound
            )
            trace = self._extract_trace(
                model, sorts, vars_by_t, trans_choices, first_t
            )
            return VerificationResult(
                property=prop.name,
                title=prop.title,
                type=prop.type,
                status="fail",
                bound=bound,
                counterexample=[step for step in trace],
                violation_time=first_t,
                elapsed_ms=elapsed,
            )
        if result == z3.unsat:
            return VerificationResult(
                property=prop.name,
                title=prop.title,
                type=prop.type,
                status="pass",
                bound=bound,
                counterexample=None,
                violation_time=None,
                elapsed_ms=elapsed,
            )
        # unknown — solver hit its timeout. Be honest about it.
        return VerificationResult(
            property=prop.name,
            title=prop.title,
            type=prop.type,
            status="timeout",
            bound=bound,
            elapsed_ms=elapsed,
            note=f"Solver timed out after {elapsed:.0f} ms (no decision).",
        )

    def _first_violation_time(
        self,
        model: z3.ModelRef,
        sorts,
        vars_by_t,
        cond_ast,
        bound: int,
    ) -> int:
        for t in range(bound + 1):
            env_t = self._env(sorts, vars_by_t[t])
            cond_at_t = _node_to_z3(cond_ast.body, env_t)
            val = model.evaluate(cond_at_t, model_completion=True)
            if z3.is_false(val):
                return t
        return bound

    # -- Bounded response checking ---------------------------------------

    def _check_bounded_response(
        self, prop: PropertySpec, bound: int
    ) -> VerificationResult:
        assert prop.trigger and prop.response and prop.bound is not None
        B = prop.bound
        start = time.perf_counter()
        sorts, vars_by_t, trans_choices = self._make_sorts_and_vars(bound)

        solver = _new_solver()
        for c in self._initial_constraints(sorts, vars_by_t[0]):
            solver.add(c)
        for t in range(bound):
            for c in self._step_constraints(
                sorts, vars_by_t[t], vars_by_t[t + 1], trans_choices[t]
            ):
                solver.add(c)

        trigger_ast = parse_guard(prop.trigger)
        response_ast = parse_guard(prop.response)

        violation_disj = []
        # We mark each candidate t0 with a fresh boolean for diagnosis.
        t0_flags: List[Tuple[int, z3.ExprRef]] = []
        for t0 in range(0, bound - B + 1):
            env_t0 = self._env(sorts, vars_by_t[t0])
            trig_at = _node_to_z3(trigger_ast.body, env_t0)
            no_resp_terms = []
            for tp in range(B + 1):
                env_tp = self._env(sorts, vars_by_t[t0 + tp])
                resp = _node_to_z3(response_ast.body, env_tp)
                no_resp_terms.append(z3.Not(resp))
            flag = z3.Bool(f"viol_t0_{t0}_{id(solver)}")
            solver.add(flag == z3.And(trig_at, *no_resp_terms))
            t0_flags.append((t0, flag))
            violation_disj.append(flag)

        if not violation_disj:
            # bound smaller than required horizon: vacuously pass.
            elapsed = (time.perf_counter() - start) * 1000.0
            return VerificationResult(
                property=prop.name,
                title=prop.title,
                type=prop.type,
                status="pass",
                bound=bound,
                elapsed_ms=elapsed,
            )

        solver.add(z3.Or(*violation_disj))
        result = solver.check()
        elapsed = (time.perf_counter() - start) * 1000.0
        if result == z3.unknown:
            return VerificationResult(
                property=prop.name,
                title=prop.title,
                type=prop.type,
                status="timeout",
                bound=bound,
                elapsed_ms=elapsed,
                note=f"Solver timed out after {elapsed:.0f} ms (no decision).",
            )
        if result == z3.sat:
            model = solver.model()
            first_t0 = bound
            for t0, flag in t0_flags:
                if z3.is_true(model.evaluate(flag, model_completion=True)):
                    first_t0 = t0
                    break
            end_t = min(first_t0 + B, bound)
            trace = self._extract_trace(
                model, sorts, vars_by_t, trans_choices, end_t
            )
            return VerificationResult(
                property=prop.name,
                title=prop.title,
                type=prop.type,
                status="fail",
                bound=bound,
                counterexample=trace,
                violation_time=end_t,
                elapsed_ms=elapsed,
            )
        return VerificationResult(
            property=prop.name,
            title=prop.title,
            type=prop.type,
            status="pass",
            bound=bound,
            elapsed_ms=elapsed,
        )

    # -- Trace extraction -------------------------------------------------

    def _extract_trace(
        self,
        model: z3.ModelRef,
        sorts,
        vars_by_t,
        trans_choices,
        last_t: int,
    ) -> List[Dict[str, Any]]:
        trace: List[Dict[str, Any]] = []
        n_trans = len(self.spec.transitions)
        for t in range(last_t + 1):
            step: Dict[str, Any] = {"t": t}
            for vname, vinfo in self.spec.variables.items():
                z3_val = model.evaluate(vars_by_t[t][vname], model_completion=True)
                step[vname] = self._z3_to_python(vinfo.type, z3_val)
            if t < last_t and t < len(trans_choices):
                idx_val = model.evaluate(trans_choices[t], model_completion=True)
                try:
                    idx = idx_val.as_long()
                except Exception:
                    idx = n_trans
                if 0 <= idx < n_trans:
                    step["transition"] = self.spec.transitions[idx].name
                else:
                    step["transition"] = "stutter"
            trace.append(step)
        return trace

    @staticmethod
    def _z3_to_python(vtype: str, val: z3.ExprRef) -> Any:
        if vtype == "bool":
            if z3.is_true(val):
                return True
            if z3.is_false(val):
                return False
            return bool(val)
        # enum
        return str(val)


def verify_all(
    spec: ModelSpec, properties: List[PropertySpec], bound: int
) -> List[VerificationResult]:
    verifier = Verifier(spec)
    return [verifier.check_property(p, bound) for p in properties]
