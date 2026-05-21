"""Compare verification results between two model versions."""

from __future__ import annotations

from typing import Dict, List

from .models import (
    DiffSummary,
    PropertySpec,
    RegressionEntry,
    VerificationResult,
)
from .counterexample import find_culprit
from .explain import explain_failure
from .repair import suggest_repair


def diff_results(
    old_results: List[VerificationResult],
    new_results: List[VerificationResult],
    properties: List[PropertySpec],
    new_model,
) -> tuple[DiffSummary, List[RegressionEntry]]:
    by_name_old: Dict[str, VerificationResult] = {r.property: r for r in old_results}
    by_name_new: Dict[str, VerificationResult] = {r.property: r for r in new_results}
    by_name_prop: Dict[str, PropertySpec] = {p.name: p for p in properties}

    preserved = 0
    regressions: List[RegressionEntry] = []
    fixed = 0
    existing_failures = 0

    for name, new_r in by_name_new.items():
        old_r = by_name_old.get(name)
        prop = by_name_prop.get(name)
        old_status = old_r.status if old_r else "pass"
        new_status = new_r.status
        if old_status == "pass" and new_status == "pass":
            preserved += 1
        elif old_status == "pass" and new_status == "fail":
            # Regression!
            culprit = find_culprit(new_r.counterexample or [], prop, new_model) if prop else None
            explanation = (
                explain_failure(prop, new_r.counterexample or [], culprit) if prop else ""
            )
            suggested = suggest_repair(prop, culprit) if prop else None
            regressions.append(
                RegressionEntry(
                    property=name,
                    title=prop.title if prop else None,
                    counterexample=new_r.counterexample or [],
                    culprit_transition=(
                        {
                            "name": culprit.name,
                            "guard": culprit.guard,
                            "updates": culprit.updates,
                            "reactive": culprit.reactive,
                        }
                        if culprit
                        else None
                    ),
                    explanation=explanation,
                    suggested_repair=suggested,
                )
            )
        elif old_status == "fail" and new_status == "pass":
            fixed += 1
        else:
            existing_failures += 1

    summary = DiffSummary(
        preserved=preserved,
        regressions=len(regressions),
        fixed=fixed,
        existing_failures=existing_failures,
    )
    return summary, regressions
