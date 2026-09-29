"""Phase 5 — engine lifecycle state machine (app/lifecycle.py)."""

from __future__ import annotations

from app import lifecycle as lc
from app.registry import registry


def test_states_are_the_full_vocabulary():
    assert lc.all_states() == [
        "DISCOVERED", "VERIFIED", "REGISTERED", "HEALTHY",
        "AVAILABLE", "DEGRADED", "BLOCKED", "RETIRED",
    ]


def test_registered_is_the_default_for_every_pinned_engine():
    for name in registry.names():
        out = lc.derive_lifecycle(registry.get(name), None)
        # No health observed -> never optimistic: BLOCKED with a reason.
        assert out["status"] == "BLOCKED"
        assert out["reason"]


def test_available_requires_checksum_match():
    reg = registry.get("liodon")
    health = {
        "reachable": True, "model_loaded": True,
        "model_checksum": reg["model_checksum"],
        "is_standin_not_liodon": False,
    }
    out = lc.derive_lifecycle(reg, health)
    assert out["status"] == "AVAILABLE"
    assert reg["model_checksum"] in out["reason"]


def test_checksum_mismatch_is_degraded_never_available():
    reg = registry.get("liodon")
    health = {
        "reachable": True, "model_loaded": True,
        "model_checksum": "0" * 64,  # a different artifact
    }
    out = lc.derive_lifecycle(reg, health)
    assert out["status"] == "DEGRADED"
    assert "checksum" in out["reason"]


def test_standin_is_degraded_even_with_matching_flag_shape():
    reg = registry.get("liodon")
    health = {
        "reachable": True, "model_loaded": True,
        "model_checksum": reg["model_checksum"],
        "is_standin_not_liodon": True,  # synthetic weights, self-declared
    }
    out = lc.derive_lifecycle(reg, health)
    assert out["status"] == "DEGRADED"
    assert "stand-in" in out["reason"]


def test_unreachable_is_blocked_with_reason():
    reg = registry.get("meshsegnet-max")
    assert lc.derive_lifecycle(reg, {"reachable": False})["status"] == "BLOCKED"
    assert lc.derive_lifecycle(reg, None)["status"] == "BLOCKED"


def test_not_loaded_is_degraded_with_engine_error():
    reg = registry.get("meshsegnet-max")
    out = lc.derive_lifecycle(
        reg,
        {"reachable": True, "model_loaded": False,
         "status": "error", "error": "model file missing"},
    )
    assert out["status"] == "DEGRADED"
    assert "model file missing" in out["reason"]


def test_retired_is_terminal():
    reg = registry.get("liodon")
    health = {"reachable": True, "model_loaded": True,
              "model_checksum": reg["model_checksum"]}
    out = lc.derive_lifecycle(reg, health, retired=True)
    assert out["status"] == "RETIRED"
    assert not lc.can_transition("RETIRED", "AVAILABLE")


def test_transition_matrix_rejects_illegal_jumps():
    assert lc.can_transition("DISCOVERED", "VERIFIED")
    assert lc.can_transition("VERIFIED", "REGISTERED")
    assert lc.can_transition("HEALTHY", "AVAILABLE")
    assert not lc.can_transition("REGISTERED", "AVAILABLE")  # must pass HEALTHY first
    assert not lc.can_transition("DISCOVERED", "AVAILABLE")  # no skipping evidence
    assert not lc.can_transition("BLOCKED", "DISCOVERED")   # no backwards amnesia
    assert not lc.can_transition("RETIRED", "REGISTERED")
    assert not lc.can_transition("NOPE", "AVAILABLE")


def test_undefined_engine_is_discovered_not_registered():
    out = lc.derive_lifecycle(None, None)
    assert out["status"] == "DISCOVERED"
