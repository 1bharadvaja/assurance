"""Targeted repair suggestions for failing properties.

For the demo we implement a single, deterministic repair: strengthen the
guard of a transition by conjoining a missing predicate. This is *not* a
general program-repair engine — we surface it as a suggested fix only for
the specific regression we know how to reason about.
"""

from __future__ import annotations

import copy
from typing import Optional

from .models import ModelSpec, PropertySpec, RepairSpec, TransitionSpec


def suggest_repair(
    prop: PropertySpec,
    culprit: Optional[TransitionSpec],
) -> Optional[RepairSpec]:
    if culprit is None:
        return None

    if prop.name == "no_actuate_without_authority":
        return _strengthen_with(
            culprit,
            "human_authorized == true",
            rationale=(
                "The invariant requires that the platform never reaches Actuate "
                "with communications lost and no human authorization. Adding "
                "`human_authorized == true` to the actuation guard restores the "
                "human-in-the-loop precondition that the regression removed."
            ),
        )

    if prop.name == "no_actuate_on_sensor_disagreement":
        return _strengthen_with(
            culprit,
            "sensor_agreement == true",
            rationale=(
                "Require consistent sensor evidence before allowing actuation."
            ),
        )

    return None


def _strengthen_with(
    culprit: TransitionSpec, predicate: str, rationale: str
) -> Optional[RepairSpec]:
    if predicate in culprit.guard:
        # Predicate already present; nothing to suggest.
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
