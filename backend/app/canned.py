"""Generate static API snapshots for the public Pages demo.

Running this module writes the JSON bodies that the live backend would
return, into a target directory. The frontend's ``lib/api.ts`` knows how to
read them when built in demo mode.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .diff import diff_results
from .examples import list_scenarios, load_scenario
from .models import ModelSpec, PropertySpec
from .repair import apply_repair
from .verifier import Verifier


SCENARIO_ID = "mission-controller"
BOUND = 10


def _verify_response(model: ModelSpec, properties: list[PropertySpec]) -> dict:
    v = Verifier(model)
    results = [v.check_property(p, BOUND) for p in properties]
    return {
        "results": [r.model_dump() for r in results],
        "summary": {
            "passed": sum(1 for r in results if r.status == "pass"),
            "failed": sum(1 for r in results if r.status == "fail"),
        },
    }


def _diff_response(
    old: ModelSpec, new: ModelSpec, properties: list[PropertySpec]
) -> dict:
    old_v = Verifier(old)
    new_v = Verifier(new)
    old_results = [old_v.check_property(p, BOUND) for p in properties]
    new_results = [new_v.check_property(p, BOUND) for p in properties]
    summary, regressions = diff_results(old_results, new_results, properties, new)
    return {
        "summary": summary.model_dump(),
        "results": [r.model_dump() for r in new_results],
        "regressions": [r.model_dump() for r in regressions],
    }


def generate(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    scenarios = list_scenarios()
    (output_dir / "scenarios.json").write_text(
        json.dumps({"scenarios": scenarios}, indent=2)
    )

    raw = load_scenario(SCENARIO_ID)
    assert raw is not None
    (output_dir / f"scenarios.{SCENARIO_ID}.json").write_text(json.dumps(raw, indent=2))

    safe = ModelSpec.model_validate(raw["safe_model"])
    regressed = ModelSpec.model_validate(raw["regressed_model"])
    properties = [PropertySpec.model_validate(p) for p in raw["properties"]]

    # Verify safe against safe (no regression, all pass).
    (output_dir / f"diff.{SCENARIO_ID}.safe.json").write_text(
        json.dumps(_diff_response(safe, safe, properties), indent=2)
    )

    # Verify regressed against safe (the headline regression).
    diff_regressed = _diff_response(safe, regressed, properties)
    (output_dir / f"diff.{SCENARIO_ID}.regressed.json").write_text(
        json.dumps(diff_regressed, indent=2)
    )

    # Apply the suggested repair and verify the repaired model.
    regressions = diff_regressed["regressions"]
    if regressions and regressions[0].get("suggested_repair"):
        from .models import RepairSpec

        repair = RepairSpec.model_validate(regressions[0]["suggested_repair"])
        repaired = apply_repair(regressed, repair)
        (output_dir / f"model.{SCENARIO_ID}.repaired.json").write_text(
            json.dumps(repaired.model_dump(), indent=2)
        )
        (output_dir / f"diff.{SCENARIO_ID}.repaired.json").write_text(
            json.dumps(_diff_response(safe, repaired, properties), indent=2)
        )

    print(f"Wrote canned API responses to {output_dir}")


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("frontend/public/canned")
    generate(target.resolve())
