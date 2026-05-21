"""Deterministic, template-driven explanations for verification failures."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .models import ModelSpec, PropertySpec, TransitionSpec


def explain_failure(
    prop: PropertySpec,
    trace: List[Dict[str, Any]],
    culprit: Optional[TransitionSpec],
    safe_model: Optional[ModelSpec] = None,
) -> str:
    """Return a short operational explanation for a failing property."""

    if not trace:
        return "The verifier reported a failure but produced no counterexample trace."

    final = trace[-1]
    culprit_name = culprit.name if culprit else "unknown"

    if prop.name == "no_actuate_without_authority":
        return (
            f"The controller can reach Actuate while communications are lost and "
            f"human_authorized is false. The culprit is the transition "
            f"`{culprit_name}`, whose guard no longer requires human authorization. "
            f"Operationally, this weakens human oversight: the platform may take an "
            f"irreversible action while disconnected from its operator."
        )

    if prop.name == "no_actuate_on_sensor_disagreement":
        return (
            f"The controller can reach Actuate while its safety-critical sensors "
            f"disagree. The culprit is `{culprit_name}`, which fires without "
            f"requiring sensor agreement. Acting on inconsistent sensor evidence "
            f"is a known precursor to mission-critical failures."
        )

    if prop.name == "low_battery_recovers_within_2":
        return (
            f"The controller can remain in {final.get('mode')!r} for too many steps "
            f"after the battery becomes Low. The recovery transition does not fire "
            f"in time, so the platform may exhaust its energy budget while still "
            f"in a normal operating mode."
        )

    if prop.name == "mission_requires_armed_history":
        return (
            f"The controller can reach Mission without having been armed. "
            f"This breaks the precondition that the operator has explicitly "
            f"placed the platform into a mission-capable state."
        )

    if prop.name == "gps_loss_prevents_mission_start":
        return (
            f"The controller can be in Mission with GPS lost. This breaks the "
            f"assumption that the platform always enters Mission with a valid "
            f"position fix."
        )

    # Generic fallback.
    label = prop.title or prop.name
    return (
        f"The property `{label}` is violated: the system reaches state "
        f"{final} via `{culprit_name}`."
    )
