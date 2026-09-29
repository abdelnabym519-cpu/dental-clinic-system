"""
lifecycle.py — Local AI engine lifecycle (Phase 5, spec §16).

States:

    DISCOVERED  -> VERIFIED  -> REGISTERED  -> HEALTHY  -> AVAILABLE
                                                |-> DEGRADED
                                                |-> BLOCKED
    any                         -> RETIRED

Meaning (evidence-backed only — a state is never claimed without its
evidence in `reason`):

- DISCOVERED  : known to exist (audited upstream), not yet pinned here.
- VERIFIED    : artifact identity established (source + checksum + license
                read from an authoritative record).
- REGISTERED  : declared in the code-pinned registry (registry.py). This is
                the default state for every engine this orchestrator routes
                to — registration itself is NOT a health claim.
- HEALTHY     : engine process reachable AND its model is loaded.
- AVAILABLE   : HEALTHY AND the loaded checksum matches the registry
                checksum. This is the only state in which /analyze may
                meaningfully succeed.
- DEGRADED    : reachable but not servable (model rejected, stand-in
                loaded, checksum mismatch, partial runtime).
- BLOCKED     : unreachable, or weights missing at deployment time. The
                operator must act; the exact reason is recorded.
- RETIRED     : deactivated on purpose. Never selected, never routed to.

`derive_lifecycle` is a PURE function of (registry entry, observed health).
The orchestrator never persists lifecycle state across restarts: it is
always re-derived from live evidence, so a state can never drift from
reality (spec §23: an HTTP 200 health endpoint must not imply inference
works).
"""

from __future__ import annotations

from typing import Any

LIFECYCLE_STATES = (
    "DISCOVERED",
    "VERIFIED",
    "REGISTERED",
    "HEALTHY",
    "AVAILABLE",
    "DEGRADED",
    "BLOCKED",
    "RETIRED",
)

# The only transitions the state machine permits. Anything else is a bug or
# a lie — both are rejected by can_transition().
_ALLOWED = {
    "DISCOVERED": {"VERIFIED", "RETIRED"},
    "VERIFIED": {"REGISTERED", "RETIRED"},
    "REGISTERED": {"HEALTHY", "DEGRADED", "BLOCKED", "RETIRED"},
    "HEALTHY": {"AVAILABLE", "DEGRADED", "BLOCKED", "RETIRED"},
    "AVAILABLE": {"HEALTHY", "DEGRADED", "BLOCKED", "RETIRED"},
    "DEGRADED": {"HEALTHY", "AVAILABLE", "BLOCKED", "RETIRED"},
    "BLOCKED": {"REGISTERED", "HEALTHY", "DEGRADED", "AVAILABLE", "RETIRED"},
    "RETIRED": set(),  # terminal in one direction: re-registration is a new entry
}


def can_transition(src: str, dst: str) -> bool:
    """Deterministic transition check (used by tests and by future operators)."""
    if src not in LIFECYCLE_STATES or dst not in LIFECYCLE_STATES:
        return False
    return dst in _ALLOWED.get(src, set())


def derive_lifecycle(
    reg: dict[str, Any] | None,
    health: dict[str, Any] | None,
    *,
    retired: bool = False,
) -> dict[str, str]:
    """Derive the lifecycle state from live evidence.

    reg    : registry entry (registry.py) or None.
    health : the engine /health response as observed by the orchestrator,
             or None / {"reachable": False} when it could not be reached.

    Returns {"status": ..., "reason": ...}. The reason always carries the
    concrete evidence — never an optimism default.
    """
    if retired:
        return {"status": "RETIRED", "reason": "engine deactivated on purpose"}

    if reg is None:
        return {
            "status": "DISCOVERED",
            "reason": "not present in the code-pinned registry — no routing",
        }

    if health is None or not health.get("reachable"):
        return {
            "status": "BLOCKED",
            "reason": "engine unreachable (no /health response) — weights may be "
                      "missing or the container is down; operator action required",
        }

    if not health.get("model_loaded"):
        return {
            "status": "DEGRADED",
            "reason": str(health.get("status") or "model not loaded")
            + (" — " + str(health.get("error")) if health.get("error") else ""),
        }

    checksum = (health.get("model_checksum") or "").lower()
    expected = (reg.get("model_checksum") or "").lower()
    if not checksum or checksum != expected:
        # Includes the stand-in case: the loaded artifact is not the
        # validated one, so the engine must not be treated as servable.
        return {
            "status": "DEGRADED",
            "reason": f"loaded checksum {checksum or '<none>'} != registry "
                      f"{expected} (stand-in or substituted artifact)",
        }

    if health.get("is_standin_not_meshsegnet") or health.get("is_standin_not_liodon") \
            or health.get("is_standin_not_implant") or health.get("is_standin_not_orthodontic"):
        return {
            "status": "DEGRADED",
            "reason": "engine reports a synthetic stand-in model — production "
                      "refuses to store stand-in findings",
        }

    return {
        "status": "AVAILABLE",
        "reason": f"model loaded and checksum {checksum} matches the registry",
    }


def all_states() -> list[str]:
    return list(LIFECYCLE_STATES)
