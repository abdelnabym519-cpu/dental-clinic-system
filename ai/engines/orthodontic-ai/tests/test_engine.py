"""
test_engine.py — Orthodontic AI engine gate (Phase 19B, engine 3 of 3).

Sandbox evidence: the full validated pipeline (bounded safe-globals gate,
strict weights_only load, repository's own preprocessing, real CPU forward)
runs against a fixed-seed stand-in built from the real audited config. The
audited 268,846,952-byte checkpoint is verified on the operator's machine at
container start; the loader refuses any file that is not the audited bytes
and any file whose pickle asks for unexpected globals.
"""

from __future__ import annotations

import base64
import hashlib
import os
import pickle

import pytest

from tests.conftest import STANDIN, synthetic_ceph

EXPECTED_SHA = "fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc"
EXPECTED_SIZE = 268_846_952
NUM_LANDMARKS = 38

_EVIL_MARKER = "/tmp/orthodontic-engine-tests/EVIL_MARKER"


def _evil_probe():
    """Module-level so it is picklable as a GLOBAL. If a scan ever executed
    the pickle's globals (it must not), this file would exist."""
    with open(_EVIL_MARKER, "wb") as fh:
        fh.write(b"executed")


# ---------------------------------------------------------------------------
# Registry — the audited artifact, pinned
# ---------------------------------------------------------------------------


def test_registry_pins_audited_artifact():
    from app import model as model_mod

    assert model_mod.ORTHODONTIC["expected_sha256"] == EXPECTED_SHA
    assert model_mod.ORTHODONTIC["expected_size_bytes"] == EXPECTED_SIZE
    assert (
        model_mod.ORTHODONTIC["source"].startswith(
            "https://github.com/5k5000/CLdetection2023@18d17d1934970016e7610c4849311900b8d1f191"
        )
    )
    assert "Apache-2.0" in model_mod.ORTHODONTIC["license"]
    assert model_mod.ORTHODONTIC["num_landmarks"] == NUM_LANDMARKS
    # neutral model vocabulary — no invented anatomical names
    assert model_mod.ORTHODONTIC["landmarks"] == {i: str(i) for i in range(NUM_LANDMARKS)}
    assert model_mod.ORTHODONTIC["num_tensors"] == 1_969


# ---------------------------------------------------------------------------
# Security gate (no-execution scan + bounded allow-list)
# ---------------------------------------------------------------------------


def test_enumerate_globals_is_non_executing():
    """A pickle whose GLOBAL would create a file if executed must be reported
    as unexpected — and the file must never be created (AUDIT.md: the probe
    never constructs an object)."""
    import os

    from app import safeload

    if os.path.exists(_EVIL_MARKER):
        os.unlink(_EVIL_MARKER)

    # a pickle referencing _evil_probe as a GLOBAL
    p = STANDIN.parent / "evil_global.pkl"
    p.write_bytes(pickle.dumps(_evil_probe))

    found = safeload.enumerate_globals(p)
    p.unlink()
    unknown = safeload.unexplained_globals(found)
    assert any("_evil_probe" in name for name in found)
    assert unknown, "evil global must be reported as unexplained"
    assert not os.path.exists(_EVIL_MARKER), "scanning must not execute the pickle"


def test_register_safe_globals_refuses_unknown(tmp_path):
    """Both a known-dangerous global (os.system) and an unknown local module
    global are hard stops (AUDIT.md §7: unexpected global -> stop, never
    auto-expand the allow-list)."""
    from app import safeload

    for payload, expected_suffix in (
        (pickle.dumps(os.system), ".system"),  # pickles as posix.system on Linux
        (pickle.dumps(_evil_probe), "_evil_probe"),
    ):
        p = tmp_path / "evil.pkl"
        p.write_bytes(payload)
        found = safeload.enumerate_globals(p)
        assert any(name.endswith(expected_suffix) for name in found), found
        with pytest.raises(safeload.CheckpointSecurityError, match="allow-listed"):
            safeload.register_safe_globals(found)


def test_real_checkpoint_globals_are_allowlisted():
    """The stand-in (same container shape as the real checkpoint) must pass
    the gate — this is the gate's acceptance path."""
    from app import safeload

    found = safeload.enumerate_globals(STANDIN)
    assert found  # a torch.save zip has pickle payloads
    assert safeload.unexplained_globals(found) == []


def test_audited_checkpoint_additions_are_bounded_and_named():
    """The E2E-repair additions are exactly the audited checkpoint's two
    unexplained globals (operator's scan) plus torch 2.6's storage reader
    (probe evidence) — no host/code-execution modules (AUDIT.md §10)."""
    from app import safeload

    names = safeload.allow_list_names()
    for expected in (
        "mmengine.logging.history_buffer.HistoryBuffer",
        "builtins.getattr",
        "__builtin__.getattr",
        "torch.storage._load_from_bytes",
    ):
        assert expected in names, expected
    for host in ("os", "posix", "nt", "subprocess", "socket", "shutil",
                 "ctypes", "pickle", "marshal", "importlib"):
        assert not any(n.startswith(host + ".") for n in names), host


def test_scan_detailed_separates_object_attribute_refs(tmp_path):
    """A STACK_GLOBAL whose module slot is a memoised object is an attribute
    read on a constructed object — reported as an object-attribute ref, never
    as a (phantom) global. Stream: GLOBAL collections.OrderedDict (memo 0),
    BINGET 0, 'min', STACK_GLOBAL."""
    from app import safeload

    payload = (b"\x80\x05"
               + b"c" + b"collections\nOrderedDict\n"
               + b"\x94"          # MEMOIZE
               + b"h\x00"         # BINGET 0
               + b"\x8c\x03min"   # SHORT_BINUNICODE 'min'
               + b"\x93"          # STACK_GLOBAL
               + b".")
    p = tmp_path / "attrref.pth"
    p.write_bytes(payload)
    detail = safeload.scan_detailed(p)
    assert detail["globals"] == ["collections.OrderedDict"]
    assert detail["object_attribute_refs"] == ["min"]


def test_stack_global_references_are_scanned(tmp_path):
    """Protocol-2+ STACK_GLOBAL (what torch.save writes) is captured — the
    GLOBAL-only scan was the documented blind spot."""
    from app import safeload

    payload = (b"\x80\x05"
               + b"\x8c\x1fmmengine.logging.history_buffer"
               + b"\x8c\x0dHistoryBuffer"
               + b"\x93"
               + b".")
    p = tmp_path / "sg.pth"
    p.write_bytes(payload)
    found = safeload.enumerate_globals(p)
    assert found == ["mmengine.logging.history_buffer.HistoryBuffer"]


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------


def test_health_identity(client):
    r = client.get("/health")
    assert r.status_code == 200
    h = r.json()
    assert h["status"] == "ok"
    assert h["model_loaded"] is True
    assert h["model_name"] == "orthodontic-ai"
    assert h["model_version"] == "1.0.0"
    assert h["model_checksum_expected"] == EXPECTED_SHA
    assert h["model_checksum"] != EXPECTED_SHA  # stand-in's own hash
    assert h["model_checksum_verified"] is True
    assert h["is_standin_not_orthodontic"] is True
    assert h["device"] == "cpu"
    assert h["num_landmarks"] == NUM_LANDMARKS
    assert h["landmarks"] == {str(i): str(i) for i in range(NUM_LANDMARKS)}
    assert "HRNet" in h["architecture"]
    assert h["parameter_count"] > 0
    assert h["pickle_globals_registered"]


# ---------------------------------------------------------------------------
# /infer — the real code path on the stand-in weights
# ---------------------------------------------------------------------------


def test_infer_contract(client, ceph_bytes):
    import numpy as np

    r = client.post(
        "/infer", json={"image": base64.b64encode(ceph_bytes).decode(), "annotate": True}
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["is_standin_not_orthodontic"] is True
    assert body["image"]["sha256"] == hashlib.sha256(ceph_bytes).hexdigest()
    w, h = body["image"]["width"], body["image"]["height"]
    assert w > 0 and h > 0

    # the repository's own zero-padding crop is applied and reported
    crop = body["image_after_padding_crop"]
    assert crop["coordinate_space"] == "cropped_original_image"
    assert 0 < crop["width"] <= w and 0 < crop["height"] <= h

    # 38 landmarks, all finite, ids 0..37 unique, model's own neutral names.
    # (random-weight stand-in: coordinates are meaningless by construction —
    # finiteness + structure, never accuracy or in-bounds claims)
    assert body["landmark_count"] == NUM_LANDMARKS
    pts = body["landmarks"]
    assert len(pts) == NUM_LANDMARKS
    seen = set()
    for i, rec in enumerate(pts):
        assert rec["id"] == i
        assert rec["name"] == str(i)
        seen.add(rec["id"])
        assert np.isfinite(rec["x"]) and np.isfinite(rec["y"])
        assert rec["score"] is None or 0.0 <= rec["score"] <= 1.0
    assert seen == set(range(NUM_LANDMARKS))

    # raw model output = the audited architecture
    raw = body["raw_model_output"]
    assert raw["estimator"] == "TopdownPoseEstimator"
    assert "HRNet" in raw["backbone"]
    assert raw["head"] == "SRPoseHead"
    assert raw["num_joints"] == NUM_LANDMARKS
    assert raw["flip_test"] is True

    # engine's annotated overlay PNG
    ann = bytes.fromhex(body["annotated_png_hex"])
    assert ann[:8] == b"\x89PNG\r\n\x1a\n"

    assert body["model"]["model_sha256_expected"] == EXPECTED_SHA
    assert body["model"]["is_standin_not_orthodontic"] is True
    assert body["device"] == "cpu"
    assert body["timings_ms"]["total_ms"] >= 0


def test_infer_is_deterministic(client, ceph_bytes):
    payload = {"image": base64.b64encode(ceph_bytes).decode(), "annotate": False}
    a = client.post("/infer", json=payload).json()
    b = client.post("/infer", json=payload).json()
    assert a["landmarks"] == b["landmarks"]
    assert a["scores_mean"] == b["scores_mean"]


def test_infer_without_annotate_omits_png(client, ceph_bytes):
    r = client.post(
        "/infer", json={"image": base64.b64encode(ceph_bytes).decode(), "annotate": False}
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
    junk = base64.b64encode(b"this is not an image at all" * 10).decode()
    assert client.post("/infer", json={"image": junk}).status_code == 422


# ---------------------------------------------------------------------------
# Loader policy — fail-closed
# ---------------------------------------------------------------------------


def test_real_artifact_expected_values(tmp_path):
    """A file that is NOT the audited bytes is rejected even with
    ALLOW_STANDIN — it does not self-declare."""
    from app import model as model_mod

    p = tmp_path / "model_pretrained_on_train_and_val.pth"
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
    assert m.parameter_count > 0
    entry = m.registry_entry
    assert entry["model_sha256_expected"] == EXPECTED_SHA
    assert entry["model_checksum_verified"] is True
    assert entry["is_standin_not_orthodontic"] is True
    assert entry["num_landmarks"] == NUM_LANDMARKS


def test_missing_file_rejected():
    from app import model as model_mod

    with pytest.raises(model_mod.ModelRejectedError, match="not found"):
        model_mod.load_model("/tmp/does-not-exist-cld.pth", allow_standin=True)


# ---------------------------------------------------------------------------
# remove_zero_padding — the repo's own preprocessing, verbatim
# ---------------------------------------------------------------------------


def test_remove_zero_padding_crops_like_the_repo():
    import numpy as np

    from app.pipeline import remove_zero_padding

    img = np.zeros((10, 12, 3), dtype=np.uint8)
    img[2:8, 3:9, :] = 200  # non-zero block
    out = remove_zero_padding(img)
    # crops to the LAST non-zero row/column inclusive (the repo's behaviour)
    assert out.shape == (8, 9, 3)
    assert out[5, 5, 0] == 200


# ---------------------------------------------------------------------------
# Rejected startup -> /health error + /infer 503 (in-process via _build_app)
# ---------------------------------------------------------------------------


def test_rejected_startup_health_error_and_503(monkeypatch, tmp_path, ceph_bytes):
    from fastapi.testclient import TestClient

    from app import main as main_mod

    bogus = tmp_path / "missing.pth"
    monkeypatch.setenv("MODEL_PATH", str(bogus))
    monkeypatch.delenv("ALLOW_STANDIN", raising=False)
    app2, model = main_mod._build_app()
    assert model is None
    c = TestClient(app2)
    h = c.get("/health").json()
    assert h["model_loaded"] is False
    assert h["status"] == "error"
    assert "not found" in h["error"]
    r = c.post("/infer", json={"image": base64.b64encode(ceph_bytes).decode()})
    assert r.status_code == 503
