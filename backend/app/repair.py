"""Targeted repair suggestions for failing properties.

For the demo we implement one kind of repair — strengthen a transition's
guard by conjoining a missing predicate. We only surface a suggestion when
we have a hand-written template for the property in question; otherwise the
caller should treat 'no repair available' as the honest answer rather than
fabricating one.
"""

from __future__ import annotations

from typing import Dict, Optional, Tuple

from .models import ModelSpec, PropertySpec, RepairSpec, TransitionSpec


# Property name → (predicate to conjoin, human-readable rationale).
_REPAIR_TEMPLATES: Dict[str, Tuple[str, str]] = {
    "no_actuate_without_authority": (
        "human_authorized == true",
        "The invariant requires that the platform never reaches Actuate with "
        "comms lost and no human approval. Adding the missing predicate to "
        "the culprit guard restores the human-in-the-loop precondition.",
    ),
    "no_actuate_on_sensor_disagreement": (
        "sensor_agreement == true",
        "Require consistent sensor evidence before allowing actuation.",
    ),
    "gps_loss_prevents_mission_start": (
        "gps == OK",
        "Restore the GPS precondition so Mission cannot start without a "
        "valid position fix.",
    ),
    "mission_requires_armed_history": (
        "armed_before == true",
        "Require the platform to have been armed at least once before "
        "entering Mission.",
    ),
}


def suggest_repair(
    prop: PropertySpec,
    culprit: Optional[TransitionSpec],
) -> Optional[RepairSpec]:
    if culprit is None:
        return None
    template = _REPAIR_TEMPLATES.get(prop.name)
    if template is None:
        return None
    predicate, rationale = template
    return _strengthen_with(culprit, predicate, rationale=rationale)


def _strengthen_with(
    culprit: TransitionSpec, predicate: str, rationale: str
) -> Optional[RepairSpec]:
    if predicate in culprit.guard:
        return None
    new_guard = f"({culprit.guard}) and {predicate}"
    return RepairSpec(
        kind="strengthen_guard",
        transition=culprit.name,
        add_predicate=predicate,
        new_guard=new_guard,
        rationale=rationale,
    )


def apply_repair(model: ModelSpec, repair: RepairSpec) -> ModelSpec:
    new_model = model.model_copy(deep=True)
    if repair.kind == "strengthen_guard":
        for t in new_model.transitions:
            if t.name == repair.transition:
                t.guard = repair.new_guard
                break
        else:
            raise ValueError(
                f"Cannot apply repair: transition {repair.transition!r} not found."
            )
    else:
        raise ValueError(f"Unsupported repair kind: {repair.kind}")
    return new_model
