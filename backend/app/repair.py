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
from .narrative_helpers import split_top_conjuncts


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
        if not repair.new_guard:
            raise ValueError("strengthen_guard requires `new_guard`.")
        for t in new_model.transitions:
            if t.name == repair.transition:
                t.guard = repair.new_guard
                break
        else:
            raise ValueError(
                f"Cannot apply repair: transition {repair.transition!r} not found."
            )
        return new_model

    if repair.kind == "restore_transition":
        # The mutation removed this transition entirely; re-insert it
        # using the original spec carried by the RepairSpec. If the
        # transition is already present (e.g. the user applied the
        # repair to a model that never had it removed) this is a no-op.
        if repair.original_transition is None:
            raise ValueError(
                "restore_transition requires `original_transition` payload."
            )
        if any(t.name == repair.transition for t in new_model.transitions):
            return new_model
        new_model.transitions = list(new_model.transitions) + [
            repair.original_transition.model_copy(deep=True)
        ]
        return new_model

    if repair.kind == "restore_guard_clause":
        # Add the removed conjunct back to the named transition's guard,
        # preserving the existing clauses. If the clause is already
        # present, leave the guard alone.
        if not repair.add_predicate:
            raise ValueError(
                "restore_guard_clause requires `add_predicate`."
            )
        norm_add = " ".join(repair.add_predicate.split())
        for t in new_model.transitions:
            if t.name != repair.transition:
                continue
            current = t.guard or ""
            clauses = (
                [c for c in split_top_conjuncts(current) if c.strip()]
                if current.strip()
                else []
            )
            # Drop a placeholder `true` so the restored guard reads as
            # the original clause rather than `true and <clause>`.
            clauses = [
                c for c in clauses if " ".join(c.split()).lower() != "true"
            ]
            already = any(" ".join(c.split()) == norm_add for c in clauses)
            if not already:
                clauses.append(repair.add_predicate)
            new_guard = " and ".join(clauses) if clauses else "true"
            t.guard = new_guard
            break
        else:
            raise ValueError(
                f"Cannot apply repair: transition {repair.transition!r} not found."
            )
        return new_model

    raise ValueError(f"Unsupported repair kind: {repair.kind}")
