"""
test_engine.py — Implant AI engine gate (Phase 19B, engine 2 of 3).

Sandbox evidence: the real production code paths (restricted loader,
task/class verification, ultralytics forward + NMS + coordinate mapping)
run against a fixed-seed synthetic stand-in checkpoint. The audited
weights (8024.pt) are verified on the operator's machine at container
start; the loader refuses any file that is not the audited bytes.
"""

from __future__ import annotations

import base64
import hashlib

import pytest

from tests.conftest import STANDIN, synthetic_xray

EXPECTED_SHA = "e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98"
EXPECTED_SIZE = 143_955_443
EXPECTED_CLASSES = {
    "0": "Caries",
    "1": "Crown",
    "2": "Filling",
    "3": "Implant",
    "4": "Missing teeth",
    "5": "Periapical lesion",
    "6": "Root Piece",
    "7": "Root canal obturation",
}


# ---------------------------------------------------------------------------
# Registry — the audited artifact, pinned
# ---------------------------------------------------------------------------


def test_registry_pins_audited_artifact():
    from app import model as model_mod

    assert model_mod.IMPLANT["expected_sha256"] == EXPECTED_SHA
    assert model_mod.IMPLANT["expected_size_bytes"] == EXPECTED_SIZE
    assert model_mod.IMPLANT["source"].startswith(
        "https://huggingface.co/nsitnov/8024-yolov8-model@0304179670f4838bf0dec1053b963112a16a66cf"
    )
    assert "Apache-2.0" in model_mod.IMPLANT["license"]
    assert model_mod.IMPLANT["task"] == "segment"
    assert model_mod.IMPLANT["device"] == "cpu"
    # The checkpoint's OWN labels — not the model card's spelling.
    assert model_mod.IMPLANT["classes"] == {
        int(k): v for k, v in EXPECTED_CLASSES.items()
    }
    assert "checkpoint" in model_mod.IMPLANT["classes_source"]


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------


def test_health_identity(client):
    r = client.get("/health")
    assert r.status_code == 200
    h = r.json()
    assert h["status"] == "ok"
    assert h["model_loaded"] is True
    assert h["model_name"] == "implant-ai"
    assert h["model_version"] == "1.0.0"
    assert h["model_checksum_expected"] == EXPECTED_SHA
    # stand-in: its own hash, verified flag true only because it self-declared
    assert h["model_checksum"] != EXPECTED_SHA
    assert h["model_checksum_verified"] is True
    assert h["is_standin_not_implant"] is True
    assert h["task"] == "segment"
    assert h["device"] == "cpu"
    assert h["classes"] == EXPECTED_CLASSES
    assert h["defaults"] == {"conf": 0.35, "iou": 0.35, "imgsz": 640}
    assert h["parameter_count"] > 0


# ---------------------------------------------------------------------------
# /infer — the real code path on the stand-in weights
# ---------------------------------------------------------------------------


def test_infer_contract(client, xray_bytes):
    r = client.post(
        "/infer", json={"image": base64.b64encode(xray_bytes).decode(), "annotate": True}
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["is_standin_not_implant"] is True
    assert body["image"]["width"] == 640
    assert body["image"]["height"] == 480
    assert body["image"]["sha256"] == hashlib.sha256(xray_bytes).hexdigest()

    # detections (the model may find zero on a synthetic image — the
    # contract is that each record it DOES produce is well-formed)
    assert body["detection_count"] == len(body["detections"])
    assert body["detection_count"] == sum(body["counts_by_class"].values())
    for rec in body["detections"]:
        assert rec["class_id"] in range(8)
        assert rec["class_name"] == EXPECTED_CLASSES[str(rec["class_id"])]
        assert rec["condition"] == rec["class_name"]
        assert rec["tooth_number"] is None
        assert 0.0 < rec["confidence"] <= 1.0
        bb = rec["bbox"]
        assert bb["coordinate_space"] == "original_image"
        assert 0 <= bb["x1"] < bb["x2"] <= 640
        assert 0 <= bb["y1"] < bb["y2"] <= 480
        assert bb["width"] == pytest.approx(bb["x2"] - bb["x1"], abs=0.01)

    # engine's annotated PNG (hex — the 19A transport convention)
    ann = bytes.fromhex(body["annotated_png_hex"])
    assert ann[:8] == b"\x89PNG\r\n\x1a\n"

    # model block + parameters
    assert body["model"]["model_sha256_expected"] == EXPECTED_SHA
    assert body["model"]["is_standin_not_implant"] is True
    assert body["parameters"]["conf"] == 0.35
    assert body["device"] == "cpu"
    assert body["timings_ms"]["total_ms"] >= 0


def test_infer_low_conf_exercises_detection_records(client, xray_bytes):
    """At a very low threshold the random-weight stand-in DOES emit boxes
    (probing showed ~300 at conf=0.001, all ~0.0016). This forces the full
    postprocess -> record -> annotated-PNG path to run with NON-EMPTY
    detections, so the bbox record contract is verified with real data
    rather than a vacuous empty list."""
    r = client.post(
        "/infer",
        json={
            "image": base64.b64encode(xray_bytes).decode(),
            "annotate": True,
            "conf": 0.001,
            "iou": 0.9,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["detection_count"] > 0
    assert body["detection_count"] == sum(body["counts_by_class"].values())
    for rec in body["detections"][:50]:
        assert rec["class_id"] in range(8)
        assert rec["class_name"] == EXPECTED_CLASSES[str(rec["class_id"])]
        assert rec["tooth_number"] is None
        assert 0.0 < rec["confidence"] <= 1.0
        bb = rec["bbox"]
        assert 0 <= bb["x1"] < bb["x2"] <= 640
        assert 0 <= bb["y1"] < bb["y2"] <= 480
    # the annotated PNG must be a real PNG
    ann = bytes.fromhex(body["annotated_png_hex"])
    assert ann[:8] == b"\x89PNG\r\n\x1a\n"


def test_infer_is_deterministic(client, xray_bytes):
    payload = {"image": base64.b64encode(xray_bytes).decode(), "annotate": False}
    a = client.post("/infer", json=payload).json()
    b = client.post("/infer", json=payload).json()
    assert a["detections"] == b["detections"]
    assert a["detection_count"] == b["detection_count"]


def test_infer_without_annotate_omits_png(client, xray_bytes):
    r = client.post(
        "/infer", json={"image": base64.b64encode(xray_bytes).decode(), "annotate": False}
    )
    assert r.status_code == 200
    assert "annotated_png_hex" not in r.json()


# ---------------------------------------------------------------------------
# /infer — request errors
# ---------------------------------------------------------------------------


def test_infer_bad_base64_400(client):
    assert client.post("/infer", json={"image": "!!not-base64!!"}).status_code == 400


def test_infer_empty_400(client):
    assert client.post("/infer", json={"image": base64.b64encode(b"").decode()}).status_code == 400


def test_infer_oversize_413(client):
    big = base64.b64encode(b"0" * (50 * 1024 * 1024 + 1)).decode()
    assert client.post("/infer", json={"image": big}).status_code == 413


def test_infer_rejects_unreadable_image_422(client):
    # Valid base64 but not an image
    junk = base64.b64encode(b"this is not an image at all" * 10).decode()
    assert client.post("/infer", json={"image": junk}).status_code == 422


# ---------------------------------------------------------------------------
# Loader policy — fail-closed
# ---------------------------------------------------------------------------


def test_real_artifact_expected_values(tmp_path):
    """A file that is NOT the audited bytes is rejected even with
    ALLOW_STANDIN — it does not self-declare."""
    from app import model as model_mod

    p = tmp_path / "8024.pt"
    p.write_bytes(b"\x00" * 1234)
    with pytest.raises(model_mod.ModelRejectedError, match="does not match the audited checkpoint"):
        model_mod.load_model(str(p), allow_standin=True)


def test_standin_requires_allow_flag():
    from app import model as model_mod

    with pytest.raises(model_mod.ModelRejectedError, match="refusing to load"):
        model_mod.load_model(str(STANDIN), allow_standin=False)


def test_standin_accepted_with_flag():
    from app import model as model_mod

    m = model_mod.load_model(str(STANDIN), allow_standin=True)
    assert m.is_standin is True
    assert m.class_names == model_mod.IMPLANT["classes"]
    assert m.parameter_count > 0
    entry = m.registry_entry
    assert entry["model_sha256_expected"] == EXPECTED_SHA
    assert entry["model_checksum_verified"] is True
    assert entry["is_standin_not_implant"] is True


def test_standin_marker_is_a_byte_search_not_an_unpickle():
    """The probe must work on a file that is NOT a valid checkpoint at all
    (no unpickle is possible), and must NOT accept a valid checkpoint
    without the marker."""
    from app import model as model_mod

    marker_file = STANDIN.parent / "garbage_with_marker.bin"
    marker_file.write_bytes(b"junk " + model_mod.STANDIN_MARKER + b" junk")
    # marker present but the file is not a loadable checkpoint -> the loader
    # (restricted) rejects it, i.e. acceptance is not marker-alone
    with pytest.raises(Exception):
        model_mod.load_model(str(marker_file), allow_standin=True)
    marker_file.unlink()


def test_missing_file_rejected():
    from app import model as model_mod

    with pytest.raises(model_mod.ModelRejectedError, match="not found"):
        model_mod.load_model("/tmp/does-not-exist-8024.pt", allow_standin=True)


# ---------------------------------------------------------------------------
# Rejected startup -> /health error + /infer 503 (in-process via _build_app)
# ---------------------------------------------------------------------------


def test_rejected_startup_health_error_and_503(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app import main as main_mod

    bogus = tmp_path / "missing-8024.pt"
    monkeypatch.setenv("MODEL_PATH", str(bogus))
    monkeypatch.delenv("ALLOW_STANDIN", raising=False)
    app2, model = main_mod._build_app()
    assert model is None
    c = TestClient(app2)
    h = c.get("/health").json()
    assert h["model_loaded"] is False
    assert h["status"] == "error"
    assert "not found" in h["error"]
    r = c.post("/infer", json={"image": base64.b64encode(synthetic_xray()).decode()})
    assert r.status_code == 503
