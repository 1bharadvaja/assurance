"""Counterexample interpretation: identify the culprit transition in a trace."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .models import ModelSpec, PropertySpec, TransitionSpec


def find_culprit(
    trace: List[Dict[str, Any]],
    prop: PropertySpec,
    model: ModelSpec,
) -> Optional[TransitionSpec]:
    """Heuristically pick the transition responsible for the violation.

    For invariants of the form ``not (...mode == X...)`` we look for the last
    non-stutter transition that updates ``mode`` to a value that appears in the
    violating state. Falls back to the most recent non-stutter transition.
    """
    if not trace:
        return None

    final_state = trace[-1]
    target_mode = final_state.get("mode")

    transitions_by_name = {t.name: t for t in model.transitions}

    # Walk backward looking for a mode-changing transition that updates `mode`.
    if target_mode is not None:
        for step in reversed(trace):
            name = step.get("transition")
            if not name or name == "stutter":
                continue
            trans = transitions_by_name.get(name)
            if trans is None:
                continue
            if trans.updates.get("mode") == target_mode:
                return trans

    # Fallback: last non-stutter transition.
    for step in reversed(trace):
        name = step.get("transition")
        if not name or name == "stutter":
            continue
        trans = transitions_by_name.get(name)
        if trans is not None:
            return trans

    return None
