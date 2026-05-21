"""Property utilities (loading helpers + lookup)."""

from __future__ import annotations

from typing import Dict, Iterable, Optional

from .models import PropertySpec


def by_name(properties: Iterable[PropertySpec]) -> Dict[str, PropertySpec]:
    return {p.name: p for p in properties}


def find_property(properties: Iterable[PropertySpec], name: str) -> Optional[PropertySpec]:
    for p in properties:
        if p.name == name:
            return p
    return None
