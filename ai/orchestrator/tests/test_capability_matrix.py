"""Phase 5 — dental task -> engine capability matrix (app/capability_matrix.py)."""

from __future__ import annotations

from app import capability_matrix as cm
from app.registry import registry


def test_matrix_rows_are_well_formed():
    tasks = [r["task"] for r in cm.CAPABILITY_MATRIX]
    assert len(tasks) == len(set(tasks)), "duplicate task ids"
    for r in cm.CAPABILITY_MATRIX:
        assert r["overall"] in cm.CAPABILITY_OVERALL
        assert set(r["levels"]) == {
            "capability_declared", "model_exists", "weights_verified",
            "local_inference_verified", "cpu_inference_verified",
            "production_integrated",
        }
        assert r["human_review"] == "REQUIRED", "every AI finding needs review"
        # A declared engine must be a real registry entry (no phantom engines).
        if r["engine"] is not None:
            assert registry.get(r["engine"]) is not None


def test_modality_matches_the_registry_per_engine():
    for r in cm.CAPABILITY_MATRIX:
        if r["engine"] is None:
            continue
        reg = registry.get(r["engine"])
        assert r["modality"] in reg["supported_modalities"]


def test_resolve_is_deterministic_and_honest():
    a = cm.resolve("panoramic_caries_detection")
    b = cm.resolve("panoramic_caries_detection")
    assert a == b
    assert a["ok"] and a["resolvable"]
    assert a["task"]["engine"] == "liodon"

    unknown = cm.resolve("quantum_tooth_teleportation")
    assert not unknown["ok"]
    assert unknown["error"].startswith("UNSUPPORTED_CAPABILITY")

    mismatch = cm.resolve("panoramic_caries_detection", modality="CBCT")
    assert not mismatch["ok"]
    assert mismatch["error"].startswith("MODALITY_MISMATCH")


def test_unavailable_tasks_are_explicit_never_guessed():
    row = cm.get_task("cbct_multi_structure_segmentation")
    assert row["overall"] == "UNAVAILABLE"
    assert row["engine"] is None
    out = cm.resolve("cbct_multi_structure_segmentation")
    assert out["ok"] and out["resolvable"] is False
    assert out["reason"]


def test_meshsegnet_is_the_only_fully_supported_task_pair_here():
    supported = [r["task"] for r in cm.CAPABILITY_MATRIX if r["overall"] == "SUPPORTED"]
    # Evidence-backed: only the two MeshSegNet jaw tasks have all six levels
    # true in this validation environment (real weights + real CPU runs).
    assert sorted(supported) == [
        "cbct_surface_segmentation",
        "dental_mesh_segmentation",
        "dental_mesh_segmentation_mandible",
    ]
    for r in cm.CAPABILITY_MATRIX:
        if r["overall"] == "SUPPORTED":
            assert all(r["levels"].values())


def test_blocked_weight_tasks_are_partial_with_evidence_notes():
    for task in ("panoramic_caries_detection", "periapical_lesion_detection",
                 "cephalometric_landmark_detection"):
        r = cm.get_task(task)
        assert r["overall"] == "PARTIAL"
        assert r["levels"]["weights_verified"] is False
        assert r["levels"]["production_integrated"] is True
        assert r["note"], "a PARTIAL must explain what evidence is missing"


def test_public_view_has_no_secrets_or_paths():
    import json
    blob = json.dumps(cm.public_view())
    assert "model_path" not in blob
    assert "/app/" not in blob
    assert "password" not in blob.lower()
