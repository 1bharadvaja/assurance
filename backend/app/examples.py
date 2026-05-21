"""Bundled example scenarios."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import ModelSpec, PropertySpec
from .parser import load_model, load_properties


REPO_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = REPO_ROOT / "examples"


@lru_cache(maxsize=None)
def _load_scenario_raw(scenario_id: str) -> Optional[Dict[str, Any]]:
    base = EXAMPLES_DIR / scenario_id
    if not base.is_dir():
        return None
    safe = load_model(base / "safe.yaml")
    regressed = load_model(base / "regressed.yaml")
    properties = load_properties(base / "properties.yaml")
    return {
        "id": scenario_id,
        "name": safe.name,
        "title": safe.title or safe.name,
        "description": safe.description or "",
        "safe_model": safe,
        "regressed_model": regressed,
        "properties": properties,
        "graph": _build_graph(safe),
    }


def list_scenarios() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not EXAMPLES_DIR.is_dir():
        return out
    for entry in sorted(EXAMPLES_DIR.iterdir()):
        if entry.is_dir():
            data = _load_scenario_raw(entry.name)
            if data is None:
                continue
            out.append(
                {
                    "id": entry.name,
                    "name": data["name"],
                    "title": data["title"],
                    "description": data["description"],
                }
            )
    return out


def load_scenario(scenario_id: str) -> Optional[Dict[str, Any]]:
    data = _load_scenario_raw(scenario_id)
    if data is None:
        return None
    return {
        "id": data["id"],
        "name": data["name"],
        "title": data["title"],
        "description": data["description"],
        "safe_model": data["safe_model"].model_dump(),
        "regressed_model": data["regressed_model"].model_dump(),
        "properties": [p.model_dump() for p in data["properties"]],
        "graph": data["graph"],
    }


def _build_graph(model: ModelSpec) -> Dict[str, Any]:
    """Build a UI-friendly graph from a model.

    Nodes are the values of the `mode` variable (if present); edges are the
    `mode` transitions extracted from the transition list. This keeps the
    frontend graph compact and focused on the controlled state.
    """
    mode_spec = model.variables.get("mode")
    if mode_spec is None or mode_spec.type != "enum":
        return {"nodes": [], "edges": []}

    nodes = [{"id": v, "label": v} for v in (mode_spec.values or [])]
    edges: List[Dict[str, Any]] = []
    for t in model.transitions:
        if "mode" not in t.updates:
            continue
        target = t.updates["mode"]
        # Try to figure out source from guard: look for `mode == X` or `mode in [...]`.
        sources = _extract_mode_sources(t.guard, mode_spec.values or [])
        for s in sources:
            edges.append(
                {
                    "id": f"{t.name}-{s}-{target}",
                    "source": s,
                    "target": target,
                    "label": t.name,
                    "reactive": t.reactive,
                }
            )
        if not sources:
            # Transition triggered by environment alone (e.g. emergency_land
            # might rely on mode == Recovery in its guard). Fall back to a
            # self-loop-free edge anchored on the target so the graph still
            # shows the transition.
            edges.append(
                {
                    "id": f"{t.name}-any-{target}",
                    "source": target,
                    "target": target,
                    "label": t.name,
                    "reactive": t.reactive,
                }
            )
    return {"nodes": nodes, "edges": edges}


def _extract_mode_sources(guard: str, modes: List[str]) -> List[str]:
    """Tiny heuristic to extract literal mode source names from a guard string."""
    found: List[str] = []
    for m in modes:
        token = f"mode == {m}"
        if token in guard and m not in found:
            found.append(m)
    return found
