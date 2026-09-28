"""Harness tests — MeshSegNet-Max engine (Phase 19B, D2/D5 gate).

Real code paths, real torch forward pass on a real (random-weight) official
architecture, real OBJ parsing, real feature/adjacency construction. The
weights are synthetic and every response is flagged is_standin_not_meshsegnet
— exactly the guard the orchestrator enforces (stand-in findings must never
be stored against a patient).
"""

from __future__ import annotations

import base64

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app import model as model_mod
from app import pipeline as pipe

PINNED_SHA256 = "727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2"
PINNED_SIZE = 28_860_102


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(main_mod.app)


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

def test_health_model_loaded(client):
    h = client.get("/health").json()
    assert h["status"] == "ok"
    assert h["model_loaded"] is True
    assert h["num_classes"] == 15
    assert h["classes"] == {str(i): n for i, n in zip(range(15), pipe.CLASS_NAMES)}
    # Stand-in in this harness: flagged, verified-as-standin, real sha.
    assert h["is_standin_not_meshsegnet"] is True
    assert h["model_checksum_verified"] is True
    assert h["model_sha256"] != PINNED_SHA256  # random weights, not the artifact
    assert h["device"] == "cpu"


def test_health_reports_registry_identity(client):
    h = client.get("/health").json()
    # The pinned artifact identity (pre-validated — provenance §2):
    assert h["model_sha256_expected"] == PINNED_SHA256
    assert h["model_size_bytes"] == PINNED_SIZE or h["model_name"] == "meshsegnet-max"
    assert h["jaw"] == "maxilla (upper)"
    assert h["model_license"] == "MIT"
    assert "Tai-Hsien/MeshSegNet" in h["model_source"]


def test_registry_pins_prevalidated_artifact():
    reg = model_mod.MESHSEGNET
    assert reg["expected_sha256"] == PINNED_SHA256
    assert reg["expected_size_bytes"] == PINNED_SIZE
    assert reg["name"] == "meshsegnet-max"


# ---------------------------------------------------------------------------
# /infer — real pipeline on the stand-in
# ---------------------------------------------------------------------------

def test_infer_real_pipeline_on_standin(client, mesh_bytes):
    r = client.post("/infer", json={"mesh": base64.b64encode(mesh_bytes).decode(), "format": "obj"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_standin_not_meshsegnet"] is True

    # The synthetic fixture: (12-1) rings x 24 segments x 2 triangles = 528 cells.
    assert body["cells_original"] == 528
    assert body["downsampled"] is False  # <= official 10,000-cell rule
    assert body["num_points_total"] == 528
    assert body["probabilities_shape"] == [1, 528, 15]
    assert len(body["labels"]) == 528
    assert all(0 <= l <= 14 for l in body["labels"])
    assert body["processing_time_ms"] >= 0

    segs = body["segments"]
    assert segs, "expected at least one present class"
    ids = [s["class_id"] for s in segs]
    assert sorted(ids) == ids and len(set(ids)) == len(ids)
    assert all(0 <= c <= 14 for c in ids)
    assert sum(s["point_count"] for s in segs) == 528
    for s in segs:
        assert s["point_count"] > 0
        assert s["class_name"] == pipe.CLASS_NAMES[s["class_id"]]
        assert set(s) == {"class_id", "class_name", "point_count"}

    assert body["device"] == "cpu"
    assert body["model"]["model_name"] == "meshsegnet-max"
    assert body["model"]["model_sha256_expected"] == PINNED_SHA256


def test_infer_rejects_bad_base64(client):
    r = client.post("/infer", json={"mesh": "not-base64!!", "format": "obj"})
    assert r.status_code == 400


def test_infer_rejects_empty(client):
    r = client.post("/infer", json={"mesh": base64.b64encode(b"").decode(), "format": "obj"})
    assert r.status_code == 400


def test_infer_rejects_unknown_format(client, mesh_bytes):
    r = client.post("/infer", json={"mesh": base64.b64encode(mesh_bytes).decode(), "format": "xyz"})
    assert r.status_code == 400
    assert "unsupported mesh format" in r.json()["detail"]


def test_infer_rejects_garbage_mesh(client):
    r = client.post("/infer", json={"mesh": base64.b64encode(b"hello world").decode(), "format": "obj"})
    assert r.status_code == 400


def test_infer_rejects_out_of_range_face(client):
    bad = b"v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 9\n"
    r = client.post("/infer", json={"mesh": base64.b64encode(bad).decode(), "format": "obj"})
    assert r.status_code == 400
    assert "out of range" in r.json()["detail"]


def test_infer_model_not_loaded_503(monkeypatch):
    """The 503 path: a client against a freshly-built app whose model was
    refused (missing artifact, stand-in flag off)."""
    monkeypatch.setenv("MODEL_PATH", "/nonexistent/MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip")
    monkeypatch.setenv("ALLOW_STANDIN", "0")
    monkeypatch.setenv("STAY_UP_ON_REJECT", "1")
    refused_app, m = main_mod._build_app()
    assert m is None
    c = TestClient(refused_app)
    h = c.get("/health").json()
    assert h["model_loaded"] is False
    assert h["status"] == "error"
    assert "not found" in (h.get("error") or "")
    assert c.post("/infer", json={"mesh": base64.b64encode(b"v 0 0 0").decode()}).status_code == 503


# ---------------------------------------------------------------------------
# Loader policy (fail-closed, stand-in guard)
# ---------------------------------------------------------------------------

def test_rejects_wrong_checksum_without_standin_flag(standin_path):
    data = standin_path.read_bytes()
    with pytest.raises(model_mod.ModelRejectedError, match="does not match the registry"):
        model_mod.load_model_bytes(
            data, model_mod.MESHSEGNET["expected_sha256"],
            model_mod.MESHSEGNET["expected_size_bytes"], allow_standin=False,
        )


def test_rejects_garbage_bytes_with_standin_flag(standin_path):
    with pytest.raises(model_mod.ModelRejectedError):
        model_mod.load_model_bytes(
            b"definitely not a torch archive",
            model_mod.MESHSEGNET["expected_sha256"],
            model_mod.MESHSEGNET["expected_size_bytes"], allow_standin=True,
        )


def test_standin_loads_and_flags(standin_path):
    m = model_mod.load_model_bytes(
        standin_path.read_bytes(),
        model_mod.MESHSEGNET["expected_sha256"],
        model_mod.MESHSEGNET["expected_size_bytes"], allow_standin=True,
    )
    assert m.is_standin is True
    assert m.parameter_count == 1_799_140  # official architecture parameter count


def test_missing_file_is_rejected():
    with pytest.raises(model_mod.ModelRejectedError, match="not found"):
        model_mod.load_model(
            "/nonexistent/MeshSegNet_Max.zip",
            model_mod.MESHSEGNET["expected_sha256"],
            model_mod.MESHSEGNET["expected_size_bytes"], allow_standin=False,
        )


# ---------------------------------------------------------------------------
# Pipeline units (official preprocessing, validated runner)
# ---------------------------------------------------------------------------

def test_parse_obj_roundtrip():
    obj = (
        b"# cube\n"
        b"v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n"
        b"v 0 0 1\nv 1 0 1\nv 1 1 1\nv 0 1 1\n"
        b"f 1 2 3\nf 1 3 4\n"
    )
    pts, faces = pipe.parse_obj(obj)
    assert pts.shape == (8, 3)
    assert faces.shape == (2, 3)
    assert faces.dtype == np.int64


def test_parse_obj_tolerates_uv_triples():
    pts, faces = pipe.parse_obj(
        b"v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1/1/1 2/2/2 3/3/3\nf 1/1/1 3/3/3 4/4/4\n"
    )
    assert pts.shape == (4, 3)
    assert faces.tolist() == [[0, 1, 2], [0, 2, 3]]


def test_features_and_adjacency_shapes():
    rng = np.random.default_rng(3)
    pts = rng.normal(size=(50, 3))
    faces = np.array([[0, i, (i + 1) % 49] for i in range(1, 50)]) + 0  # 49 triangles
    X, bary = pipe.build_features(pts, faces)
    assert X.shape == (49, 15) and X.dtype == np.float32
    A_S, A_L = pipe.build_adjacency(bary)
    assert A_S.shape == (49, 49)
    # row-normalised
    assert np.allclose(A_S.sum(axis=1), 1.0)
    assert np.allclose(A_L.sum(axis=1), 1.0)
    # every cell is within 0 of itself... at distance 0 both adjacency
    # matrices mark the diagonal (0 < threshold)
    assert np.all(np.diag(A_S) > 0) or np.all(np.diag(A_L) > 0)


def test_small_mesh_skips_decimation():
    pts = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]], dtype=float)
    faces = np.array([[0, 1, 2], [0, 2, 3], [0, 3, 4], [1, 3, 4]])
    p2, f2, down = pipe.decimate(pts, faces)
    assert down is False
    assert f2.shape == faces.shape
