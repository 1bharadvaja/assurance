"""YAML loaders for model specs and property sets."""

from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

import yaml

from .guards import GuardSyntaxError, parse_guard
from .models import ModelSpec, PropertySpec


def load_model(path: str | Path) -> ModelSpec:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    spec = ModelSpec.model_validate(raw)
    validate_model(spec)
    return spec


def load_properties(path: str | Path) -> List[PropertySpec]:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    props = [PropertySpec.model_validate(p) for p in raw.get("properties", [])]
    for p in props:
        validate_property(p)
    return props


def validate_model(spec: ModelSpec) -> None:
    """Validate variable types, initial values, transition guards, and updates."""
    var_names = set(spec.variables.keys())

    for vname, vinfo in spec.variables.items():
        if vinfo.type == "enum":
            if not vinfo.values:
                raise ValueError(f"Variable {vname!r} is enum but has no values.")
            if vinfo.initial not in vinfo.values:
                raise ValueError(
                    f"Variable {vname!r}: initial {vinfo.initial!r} not in {vinfo.values}"
                )
        elif vinfo.type == "bool":
            if not isinstance(vinfo.initial, bool):
                raise ValueError(
                    f"Variable {vname!r} is bool but initial is {vinfo.initial!r}"
                )

    seen_names = set()
    for t in spec.transitions:
        if t.name in seen_names:
            raise ValueError(f"Duplicate transition name: {t.name}")
        seen_names.add(t.name)
        try:
            parse_guard(t.guard)
        except GuardSyntaxError as exc:
            raise ValueError(f"Transition {t.name!r}: invalid guard: {exc}") from exc
        for uvar, uval in t.updates.items():
            if uvar not in var_names:
                raise ValueError(
                    f"Transition {t.name!r}: updates unknown variable {uvar!r}"
                )
            vinfo = spec.variables[uvar]
            if vinfo.type == "enum":
                if uval not in (vinfo.values or []):
                    raise ValueError(
                        f"Transition {t.name!r}: update {uvar}={uval!r} not in {vinfo.values}"
                    )
            elif vinfo.type == "bool":
                if not isinstance(uval, bool):
                    raise ValueError(
                        f"Transition {t.name!r}: bool update {uvar} must be true/false, got {uval!r}"
                    )


def validate_property(p: PropertySpec) -> None:
    if p.type == "invariant":
        if not p.condition:
            raise ValueError(f"Invariant {p.name!r} requires a `condition`.")
        parse_guard(p.condition)
    elif p.type == "bounded_response":
        if not p.trigger or not p.response or p.bound is None:
            raise ValueError(
                f"Bounded response {p.name!r} requires trigger, response, and bound."
            )
        if p.bound < 0:
            raise ValueError(f"Bounded response {p.name!r}: bound must be >= 0.")
        parse_guard(p.trigger)
        parse_guard(p.response)
