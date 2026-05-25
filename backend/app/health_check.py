"""Model health checks.

The Review Pipeline treats the LLM (or deterministic) draft as untrusted
input. Before the user can hand it to the reviewer or to Z3 we run a
structured set of checks and classify the draft as:

- ``checkable`` — no problems.
- ``checkable_with_warnings`` — has soft problems worth surfacing.
- ``blocked`` — has at least one hard error; the reviewer and the
  solver are NOT allowed to run on it.

Each check emits a ``HealthCheckItem`` with severity, a human-readable
message, and (where we can) a concrete suggested fix.
"""

from __future__ import annotations

import ast as _ast
import re
from typing import Dict, Iterable, List, Set, Tuple

from .guards import GuardSyntaxError, parse_guard
from .models import (
    HealthCheckItem,
    HealthCoverage,
    HealthReport,
    MAX_BOUND,
    MAX_PROPERTIES,
    MAX_TRANSITIONS,
    MAX_VARIABLES,
    ModelSpec,
    PropertySpec,
    VariableSpec,
)
from .property_lint import lint_property


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


def run_health_check(
    model: ModelSpec,
    properties: List[PropertySpec],
    description: str = "",
) -> HealthReport:
    items: List[HealthCheckItem] = []

    items.extend(_check_model_size(model, properties))
    items.extend(_check_guard_syntax(model, properties))
    items.extend(_check_referenced_symbols(model, properties))
    items.extend(_check_enum_bool_misuse(model, properties))
    items.extend(_check_transition_effects(model))
    items.extend(_check_property_lints(properties))
    items.extend(_check_event_reachability(model, properties))
    items.extend(_check_requirement_coverage(description, model, properties))

    classification = _classify(items)
    coverage = HealthCoverage(
        requirements_mentioned=_count_requirement_sentences(description),
        requirements_mapped=len(properties),
        properties_generated=len(properties),
        transitions_count=len(model.transitions),
        variables_count=len(model.variables),
    )
    return HealthReport(
        classification=classification, items=items, coverage=coverage
    )


# ---------------------------------------------------------------------------
# Severity helpers
# ---------------------------------------------------------------------------


def _classify(items: Iterable[HealthCheckItem]) -> str:
    has_error = any(i.severity == "error" for i in items)
    has_warning = any(i.severity == "warning" for i in items)
    if has_error:
        return "blocked"
    if has_warning:
        return "checkable_with_warnings"
    return "checkable"


def _ok(category: str, title: str, msg: str) -> HealthCheckItem:
    return HealthCheckItem(category=category, title=title, severity="pass", message=msg)


def _warn(
    category: str, title: str, msg: str, fix: str | None = None
) -> HealthCheckItem:
    return HealthCheckItem(
        category=category, title=title, severity="warning", message=msg, suggested_fix=fix
    )


def _err(
    category: str, title: str, msg: str, fix: str | None = None
) -> HealthCheckItem:
    return HealthCheckItem(
        category=category, title=title, severity="error", message=msg, suggested_fix=fix
    )


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def _check_model_size(
    model: ModelSpec, properties: List[PropertySpec]
) -> List[HealthCheckItem]:
    items: List[HealthCheckItem] = []
    issues: List[str] = []
    if len(model.variables) > MAX_VARIABLES:
        issues.append(f"variables ({len(model.variables)} > {MAX_VARIABLES})")
    if len(model.transitions) > MAX_TRANSITIONS:
        issues.append(
            f"transitions ({len(model.transitions)} > {MAX_TRANSITIONS})"
        )
    if len(properties) > MAX_PROPERTIES:
        issues.append(f"properties ({len(properties)} > {MAX_PROPERTIES})")
    if issues:
        items.append(
            _err(
                "model_size",
                "Model size limits",
                "Drafted model exceeds the public-demo size limits: "
                + ", ".join(issues)
                + ".",
                fix=(
                    f"Trim the model to ≤{MAX_VARIABLES} variables, "
                    f"≤{MAX_TRANSITIONS} transitions, ≤{MAX_PROPERTIES} properties."
                ),
            )
        )
    else:
        items.append(
            _ok(
                "model_size",
                "Model size limits",
                f"{len(model.variables)} variables, {len(model.transitions)} "
                f"transitions, {len(properties)} properties.",
            )
        )
    return items


def _check_guard_syntax(
    model: ModelSpec, properties: List[PropertySpec]
) -> List[HealthCheckItem]:
    items: List[HealthCheckItem] = []
    bad: List[Tuple[str, str]] = []
    for t in model.transitions:
        try:
            parse_guard(t.guard)
        except GuardSyntaxError as exc:
            bad.append((f"transition `{t.name}`", str(exc)))
    for p in properties:
        for label, expr in [
            ("condition", p.condition),
            ("trigger", p.trigger),
            ("response", p.response),
        ]:
            if expr is None:
                continue
            try:
                parse_guard(expr)
            except GuardSyntaxError as exc:
                bad.append((f"property `{p.name}` {label}", str(exc)))
    if bad:
        for what, err in bad:
            items.append(
                _err(
                    "guard_syntax",
                    "Guard syntax",
                    f"{what}: {err}",
                    fix="Rewrite the expression with the supported grammar: "
                    "==, !=, and, or, not, parentheses, `in [..]`, true / false.",
                )
            )
    else:
        items.append(_ok("guard_syntax", "Guard syntax", "All guards parse cleanly."))
    return items


def _check_referenced_symbols(
    model: ModelSpec, properties: List[PropertySpec]
) -> List[HealthCheckItem]:
    """Every Name in a guard / condition must be one of:
    - a declared model variable
    - a valid enum value of some declared enum variable
    - the bool keyword `true` / `false`
    """
    items: List[HealthCheckItem] = []
    var_names = set(model.variables.keys())
    enum_values = {
        v: set(spec.values or [])
        for v, spec in model.variables.items()
        if spec.type == "enum"
    }
    all_enum_values: Set[str] = set()
    for vals in enum_values.values():
        all_enum_values.update(vals)
    bool_keywords = {"true", "false", "True", "False"}

    problems: List[Tuple[str, str]] = []

    def visit_expr(label: str, expr: str | None):
        if not expr:
            return
        try:
            tree = parse_guard(expr)
        except GuardSyntaxError:
            return  # already covered by guard_syntax
        for node in _ast.walk(tree):
            if isinstance(node, _ast.Name):
                name = node.id
                if (
                    name in var_names
                    or name in all_enum_values
                    or name in bool_keywords
                ):
                    continue
                problems.append(
                    (
                        label,
                        f"`{name}` is not a declared variable, enum value, or "
                        "bool keyword.",
                    )
                )

    for t in model.transitions:
        visit_expr(f"transition `{t.name}` guard", t.guard)
    for p in properties:
        visit_expr(f"property `{p.name}` condition", p.condition)
        visit_expr(f"property `{p.name}` trigger", p.trigger)
        visit_expr(f"property `{p.name}` response", p.response)

    if problems:
        for where, msg in problems:
            items.append(
                _err(
                    "referenced_symbols",
                    "Referenced symbols",
                    f"{where}: {msg}",
                    fix="Add the variable to `model.variables` or fix the typo.",
                )
            )
    else:
        items.append(
            _ok(
                "referenced_symbols",
                "Referenced symbols",
                "Every symbol in every guard resolves to a declared variable, "
                "enum value, or bool keyword.",
            )
        )
    return items


def _check_enum_bool_misuse(
    model: ModelSpec, properties: List[PropertySpec]
) -> List[HealthCheckItem]:
    """Two patterns we want to catch:

    1. ``<enum value> == false`` (or ``true``) — e.g. ``Filling == false``
       where ``Filling`` is a value of an enum variable, not a bool
       variable. The model treats both sides as Names; the verifier will
       later fail to lower this to Z3.
    2. ``<bool var> == <enum value>`` — comparing a bool variable to a
       non-bool literal.
    """
    items: List[HealthCheckItem] = []
    var_specs = model.variables
    enum_values_by_var = {
        name: set(spec.values or [])
        for name, spec in var_specs.items()
        if spec.type == "enum"
    }
    all_enum_value_names = set()
    for vals in enum_values_by_var.values():
        all_enum_value_names.update(vals)
    bool_keywords = {"true", "false", "True", "False"}

    problems: List[Tuple[str, str, str]] = []  # (where, msg, fix)

    def visit_expr(label: str, expr: str | None):
        if not expr:
            return
        try:
            tree = parse_guard(expr)
        except GuardSyntaxError:
            return
        for node in _ast.walk(tree):
            if not isinstance(node, _ast.Compare) or len(node.ops) != 1:
                continue
            op = node.ops[0]
            if not isinstance(op, (_ast.Eq, _ast.NotEq)):
                continue
            left = node.left
            right = node.comparators[0]
            if not (isinstance(left, _ast.Name) and isinstance(right, _ast.Name)):
                continue
            l_name, r_name = left.id, right.id

            # Pattern 1: enum_value_name on the LEFT, bool keyword on RIGHT
            for lit_name, other_name in [(l_name, r_name), (r_name, l_name)]:
                if (
                    lit_name in all_enum_value_names
                    and lit_name not in var_specs
                    and other_name in bool_keywords
                ):
                    problems.append(
                        (
                            label,
                            f"`{lit_name} == {other_name}` treats the enum "
                            f"value `{lit_name}` as a boolean variable. The "
                            f"model has no `{lit_name}` variable of type bool.",
                            f"Use `mode != {lit_name}` (or whichever enum "
                            "variable holds it), or add a separate "
                            f"`{_snake(lit_name)}_active: bool` variable.",
                        )
                    )

            # Pattern 2: bool var compared with an enum value
            for var_name, other_name in [(l_name, r_name), (r_name, l_name)]:
                spec: VariableSpec | None = var_specs.get(var_name)
                if (
                    spec is not None
                    and spec.type == "bool"
                    and other_name not in bool_keywords
                    and other_name in all_enum_value_names
                ):
                    problems.append(
                        (
                            label,
                            f"`{var_name} == {other_name}` compares a bool "
                            f"variable to enum value `{other_name}`.",
                            f"Use `{var_name} == true` or `{var_name} == false`.",
                        )
                    )

            # Pattern 3: enum var compared with bool keyword
            for var_name, other_name in [(l_name, r_name), (r_name, l_name)]:
                spec = var_specs.get(var_name)
                if (
                    spec is not None
                    and spec.type == "enum"
                    and other_name in bool_keywords
                ):
                    problems.append(
                        (
                            label,
                            f"`{var_name} == {other_name}` compares the enum "
                            f"variable `{var_name}` to the bool keyword "
                            f"`{other_name}`.",
                            f"Compare to one of {sorted(enum_values_by_var.get(var_name, []))}.",
                        )
                    )

    for t in model.transitions:
        visit_expr(f"transition `{t.name}` guard", t.guard)
    for p in properties:
        visit_expr(f"property `{p.name}` condition", p.condition)
        visit_expr(f"property `{p.name}` trigger", p.trigger)
        visit_expr(f"property `{p.name}` response", p.response)

    if problems:
        # dedupe
        seen = set()
        for where, msg, fix in problems:
            key = (where, msg)
            if key in seen:
                continue
            seen.add(key)
            items.append(
                _err("enum_bool_misuse", "Enum / boolean misuse", f"{where}: {msg}", fix=fix)
            )
    else:
        items.append(
            _ok(
                "enum_bool_misuse",
                "Enum / boolean misuse",
                "Enum and boolean variables are compared with compatible literals.",
            )
        )
    return items


def _check_transition_effects(model: ModelSpec) -> List[HealthCheckItem]:
    items: List[HealthCheckItem] = []
    mode_var = model.variables.get("mode")
    mode_values = (
        set(mode_var.values or []) if mode_var and mode_var.type == "enum" else set()
    )
    problems: List[Tuple[str, str, str]] = []

    for t in model.transitions:
        if not (t.guard and t.guard.strip()):
            problems.append(
                (
                    f"transition `{t.name}`",
                    "has an empty guard, which would let it fire unconditionally.",
                    "Add a precondition or remove the transition.",
                )
            )
            continue
        if not t.updates:
            problems.append(
                (
                    f"transition `{t.name}`",
                    "has no `updates`. It cannot change any variable, so "
                    "firing it is a no-op.",
                    "Add at least one update or delete the transition.",
                )
            )

    if problems:
        for where, msg, fix in problems:
            items.append(_err("transition_effects", "Transition effects", f"{where} {msg}", fix=fix))

    # Soft: a transition named after a mode value but not updating mode to it.
    soft: List[Tuple[str, str, str]] = []
    for t in model.transitions:
        # crude camelify
        guesses = {t.name.replace("_", "").lower()}
        for v in mode_values:
            if v.lower() in guesses and t.updates.get("mode") != v:
                soft.append(
                    (
                        f"transition `{t.name}`",
                        f"name suggests it enters mode `{v}` but its updates "
                        "do not set `mode` to that value.",
                        f"Rename the transition or add `updates: {{mode: {v}}}`.",
                    )
                )

    for where, msg, fix in soft:
        items.append(_warn("transition_effects", "Transition effects", f"{where} {msg}", fix=fix))

    if not problems and not soft:
        items.append(
            _ok(
                "transition_effects",
                "Transition effects",
                "Every transition has a guard and at least one update.",
            )
        )
    return items


def _check_property_lints(properties: List[PropertySpec]) -> List[HealthCheckItem]:
    items: List[HealthCheckItem] = []
    any_lint = False
    for p in properties:
        for w in lint_property(p):
            any_lint = True
            # Vacuous-style warnings go to vacuous_properties; the mixed-paren
            # check is the other branch.
            if "vacuous" in w.lower():
                items.append(
                    _warn(
                        "vacuous_properties",
                        "Vacuous properties",
                        w,
                        fix="Use `or` instead of `and` for the either/or "
                        "case, or split into two invariants.",
                    )
                )
            else:
                items.append(
                    _warn(
                        "mixed_and_or",
                        "Mixed and / or parentheses",
                        w,
                        fix="Add explicit parentheses to make the grouping "
                        "unambiguous.",
                    )
                )
    if not any_lint:
        items.append(
            _ok(
                "vacuous_properties",
                "Vacuous properties",
                "No vacuous mode-equality conjunctions detected.",
            )
        )
        items.append(
            _ok(
                "mixed_and_or",
                "Mixed and / or parentheses",
                "No ambiguous `and`/`or` mixes detected.",
            )
        )
    return items


# ---------------------------------------------------------------------------
# Event / input reachability
# ---------------------------------------------------------------------------


# Substrings in a bool variable name that suggest it represents an external
# event, sensor reading, or environment condition the controller observes
# but does not itself set. If such a variable is referenced by some guard
# or property and no transition ever updates it, the relevant safety checks
# end up vacuous — the trigger state is unreachable from the initial state.
_EVENT_NAME_HINTS = (
    "detected",
    "detection",
    "fault",
    "fail",
    "failure",
    "lost",
    "high",
    "low",
    "unlocked",
    "cleared",
    "agreement",
    "active",
    "open",
    "armed",
    "ready",
    "engaged",
    "near",
    "authorized",
    "override",
)


def _looks_event_like(name: str) -> bool:
    lower = name.lower()
    return any(hint in lower for hint in _EVENT_NAME_HINTS)


def _collect_bool_polarity_uses(
    expr: str | None, bool_vars: Set[str]
) -> Tuple[Set[str], Set[str]]:
    """Walk a guard/condition expression and classify each bool-var use.

    Returns (positive_uses, negative_uses):
      - positive: `var == true`, `var != false`, bare `var` reference
      - negative: `var == false`, `var != true`, `not var` reference

    We deliberately ignore the wrapping `not`/`and`/`or` structure — what
    matters for the heuristic is whether the *direction* of the comparison
    requires the variable to be true or false at some point.
    """
    positives: Set[str] = set()
    negatives: Set[str] = set()
    if not expr:
        return positives, negatives
    try:
        tree = parse_guard(expr)
    except GuardSyntaxError:
        return positives, negatives
    bool_keywords = {"true": True, "false": False, "True": True, "False": False}
    for node in _ast.walk(tree):
        if not isinstance(node, _ast.Compare) or len(node.ops) != 1:
            continue
        op = node.ops[0]
        if not isinstance(op, (_ast.Eq, _ast.NotEq)):
            continue
        left = node.left
        right = node.comparators[0]
        if not (isinstance(left, _ast.Name) and isinstance(right, _ast.Name)):
            continue
        # Find the (var, literal) pair where exactly one side is a bool var
        # and the other side is a bool keyword.
        var_name, lit_val = None, None
        if left.id in bool_vars and right.id in bool_keywords:
            var_name, lit_val = left.id, bool_keywords[right.id]
        elif right.id in bool_vars and left.id in bool_keywords:
            var_name, lit_val = right.id, bool_keywords[left.id]
        if var_name is None:
            continue
        wants_true = lit_val if isinstance(op, _ast.Eq) else (not lit_val)
        if wants_true:
            positives.add(var_name)
        else:
            negatives.add(var_name)
    return positives, negatives


def _check_event_reachability(
    model: ModelSpec, properties: List[PropertySpec]
) -> List[HealthCheckItem]:
    """Detect bool variables that are used in guards/properties but whose
    required state is never produced by any transition.

    This is the common LLM-draft failure mode: the LLM declares an event
    bool like ``train_detected`` initialized false, writes a guard like
    ``train_detected == true``, but never emits a transition that sets
    ``train_detected`` to true. The downstream Z3 check then finds no
    counterexample for trivially-unreachable reasons.
    """
    items: List[HealthCheckItem] = []

    bool_vars = {
        name: spec for name, spec in model.variables.items() if spec.type == "bool"
    }
    if not bool_vars:
        items.append(
            _ok(
                "event_reachability",
                "Input / event reachability",
                "No boolean inputs to check.",
            )
        )
        return items

    # Aggregate uses across every transition guard and every property
    # condition / trigger / response.
    pos_uses: Dict[str, List[str]] = {}
    neg_uses: Dict[str, List[str]] = {}

    def absorb(label: str, expr: str | None) -> None:
        pos, neg = _collect_bool_polarity_uses(expr, set(bool_vars.keys()))
        for v in pos:
            pos_uses.setdefault(v, []).append(label)
        for v in neg:
            neg_uses.setdefault(v, []).append(label)

    for t in model.transitions:
        absorb(f"transition `{t.name}`", t.guard)
    for p in properties:
        absorb(f"property `{p.name}` condition", p.condition)
        absorb(f"property `{p.name}` trigger", p.trigger)
        absorb(f"property `{p.name}` response", p.response)

    # For each bool variable, look up the set of transitions that update it
    # to true and the set that update it to false.
    sets_true: Dict[str, List[str]] = {}
    sets_false: Dict[str, List[str]] = {}
    for t in model.transitions:
        for var, val in t.updates.items():
            if var not in bool_vars:
                continue
            target = bool_keyword_or_value(val)
            if target is True:
                sets_true.setdefault(var, []).append(t.name)
            elif target is False:
                sets_false.setdefault(var, []).append(t.name)

    problems: List[Tuple[str, str, str]] = []  # (severity_implied_by_us, msg, fix)

    for name, spec in bool_vars.items():
        initial = bool(spec.initial)
        used_pos = name in pos_uses
        used_neg = name in neg_uses
        can_be_set_true = name in sets_true
        can_be_set_false = name in sets_false

        if used_pos and initial is False and not can_be_set_true:
            problems.append(
                (
                    name,
                    f"`{name}` is used as a true event/condition "
                    f"(e.g. in {pos_uses[name][0]}) but no transition can "
                    "make it true. Checks depending on it may be vacuous.",
                    _suggest_event_transition(name, True),
                )
            )
        if used_neg and initial is True and not can_be_set_false:
            problems.append(
                (
                    name,
                    f"`{name}` is checked as false (e.g. in {neg_uses[name][0]}) "
                    "but no transition can make it false. Checks depending on "
                    "it may be vacuous.",
                    _suggest_event_transition(name, False),
                )
            )

        # Catch-all: event-like name referenced anywhere with no updaters
        # in EITHER direction. This is the strongest signal that the LLM
        # forgot to model the environment.
        if (
            _looks_event_like(name)
            and (used_pos or used_neg)
            and not (can_be_set_true or can_be_set_false)
            and not any(
                name == existing_name
                for existing_name, *_ in problems
            )
        ):
            direction = "true" if initial is False else "false"
            problems.append(
                (
                    name,
                    f"`{name}` looks like an environment/event input but no "
                    "transition ever updates it. Guards or properties that "
                    f"require it to be `{direction}` will be vacuous.",
                    _suggest_event_transition(name, initial is False),
                )
            )

    if problems:
        seen: Set[str] = set()
        for _, msg, fix in problems:
            if msg in seen:
                continue
            seen.add(msg)
            items.append(
                _warn(
                    "event_reachability",
                    "Input / event reachability",
                    msg,
                    fix=fix,
                )
            )
    else:
        items.append(
            _ok(
                "event_reachability",
                "Input / event reachability",
                "Event-like inputs used by guards/properties can be reached "
                "by some transition.",
            )
        )
    return items


def bool_keyword_or_value(v) -> bool | None:
    """Best-effort coerce an `updates` value to a bool. Returns None for
    enum-valued targets so the caller can skip them."""
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        if v.lower() == "true":
            return True
        if v.lower() == "false":
            return False
    return None


def _suggest_event_transition(name: str, target_true: bool) -> str:
    if target_true:
        verb = "becomes"
        val = "true"
    else:
        verb = "clears"
        val = "false"
    snake_name = _snake(name) if name[:1].isupper() else name
    return (
        f"Add an environment transition that sets `{name}` to `{val}`, "
        f"e.g. `{snake_name}_{verb}` with guard `{snake_name} == "
        f"{'false' if target_true else 'true'}` and updates "
        f"`{{{snake_name}: {val}}}`."
    )


# Words in the description that suggest a separate safety requirement.
_REQ_TRIGGERS = (
    " must ",
    " must not ",
    " should ",
    " should not ",
    " never ",
    " only ",
    " unless ",
    " requires ",
    " required ",
    " ensure ",
    " ensures ",
    " no more than ",
    " within ",
    " always ",
)


def _count_requirement_sentences(description: str) -> int:
    if not description:
        return 0
    # Split on . ; \n
    sentences = re.split(r"[.;\n]+", description)
    n = 0
    for s in sentences:
        s2 = " " + s.lower().strip() + " "
        if any(trig in s2 for trig in _REQ_TRIGGERS):
            n += 1
    return n


def _check_requirement_coverage(
    description: str, model: ModelSpec, properties: List[PropertySpec]
) -> List[HealthCheckItem]:
    mentioned = _count_requirement_sentences(description)
    if not description:
        return []
    if mentioned == 0:
        return [
            _warn(
                "requirement_coverage",
                "Requirement coverage",
                "Could not identify any requirement-style sentences "
                "(must / should / never / within …) in the description.",
                fix="Phrase the constraints as sentences with `must`, "
                "`should`, `never`, or `within`.",
            )
        ]
    mapped = len(properties)
    if mapped < mentioned // 2 or mapped == 0:
        return [
            _warn(
                "requirement_coverage",
                "Requirement coverage",
                f"Description mentions ~{mentioned} requirement-style "
                f"sentences but the draft produced only {mapped} properties. "
                "Some requirements may be missing from the formal model.",
                fix="Edit the draft to add the missing properties, or "
                "re-draft with a clearer description.",
            )
        ]
    return [
        _ok(
            "requirement_coverage",
            "Requirement coverage",
            f"{mapped} properties drafted from ~{mentioned} requirement "
            "sentences in the description.",
        )
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _snake(name: str) -> str:
    out = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    return out
