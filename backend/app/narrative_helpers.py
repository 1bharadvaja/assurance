"""Backend-side mirror of the frontend's `splitConjuncts` helper.

The Playground UI and the Review Pipeline both need to parse a guard into
its top-level conjuncts (so they can deactivate a clause individually).
Doing it server-side too means the deterministic reviewer can construct
mutated models without copy-pasting frontend code.
"""

from __future__ import annotations

from typing import List


def split_top_conjuncts(guard: str) -> List[str]:
    """Split a top-level conjunctive guard into its component clauses.

    Recursively flattens any clause that is itself a parenthesised
    conjunction, so the output is a flat list of leaf clauses.
    """
    raw: List[str] = []
    depth = 0
    start = 0
    lower = guard.lower()
    i = 0
    while i <= len(guard):
        c = guard[i] if i < len(guard) else None
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        if depth == 0:
            if i + 5 <= len(guard) and lower[i : i + 5] == " and ":
                raw.append(guard[start:i].strip())
                start = i + 5
                i += 5
                continue
            if i == len(guard):
                raw.append(guard[start:i].strip())
        i += 1
    out: List[str] = []
    for p in raw:
        if not p:
            continue
        if p.startswith("(") and p.endswith(")"):
            out.extend(split_top_conjuncts(p[1:-1].strip()))
        else:
            out.append(p)
    return out
