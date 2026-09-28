"""
Orchestrator tests (Phase 19A, D13).

Real app + real validation/registry/provenance; fakes for db/storage/engine.
"""

from __future__ import annotations

import base64
import hashlib

import httpx
import pytest

from app import main

from tests.conftest import (
    HOSPITAL, IMAGE_KEY, MESH_KEY, JOB, PATIENT, STUDY, _default_engine_response,
)

SECRET = "test-secret"
H = {"X-Orchestrator-Secret": SECRET}
CHECKSUM = "4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71"


def _payload(real_sha: str, **over) -> dict:
    base = {
        "job_id": JOB,
        "study_id": STUDY,
        "hospital_id": HOSPITAL,
        "image_key": IMAGE_KEY,
        "image_sha256": real_sha,
        "engine": "liodon",
        "modality": "PANORAMIC",
        "requested_by": "user-1",
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# Auth / health / engines
# ---------------------------------------------------------------------------


def test_analyze_requires_secret(harness):
    client, _db, _storage, _engine, real_sha = harness
    r = client.post("/analyze", json=_payload(real_sha))
    assert r.status_code == 401
    r = client.post("/analyze", json=_payload(real_sha), headers={"X-Orchestrator-Secret": "wrong"})
    assert r.status_code == 401


def test_get_job_requires_secret(harness):
    client, *_rest = harness
    assert client.get(f"/jobs/{JOB}").status_code == 401


def test_health(harness):
    client, *_rest = harness
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["orchestrator_version"] == "19B.0.0"
    assert body["engines"] == ["liodon", "meshsegnet-man", "meshsegnet-max"]
    # Phase 19B: per-engine reachability block + back-compatible liodon key
    assert set(body["engines_health"]) == {"liodon", "meshsegnet-man", "meshsegnet-max"}
    assert body["liodon_engine"] == body["engines_health"]["liodon"]


def test_engines_lists_registry(harness):
    client, *_rest = harness
    r = client.get("/engines")
    assert r.status_code == 200
    engines = r.json()["engines"]
    liodon = next(e for e in engines if e["name"] == "liodon")
    assert liodon["model_checksum"] == CHECKSUM
    assert liodon["model_license"] == "CC-BY-NC-4.0"
    assert liodon["device"] == "cpu"
    assert liodon["supported_modalities"] == ["PANORAMIC"]
    assert liodon["result_kind"] == "findings"
    # Phase 19B: both MeshSegNet jaws registered with their pinned artifacts.
    mx = next(e for e in engines if e["name"] == "meshsegnet-max")
    assert mx["model_checksum"] == "727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d"
    assert mx["supported_modalities"] == ["THREE_D_SCAN", "CBCT"]
    assert mx["result_kind"] == "segments"
    assert mx["classes"] == {str(i): n for i, n in
                             enumerate(["Gingiva"] + [f"Tooth_{i}" for i in range(1, 15)])}
    mn = next(e for e in engines if e["name"] == "meshsegnet-man")
    assert mn["model_checksum"] == "d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf"


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


def test_unknown_engine(harness):
    client, _db, _storage, _engine, real_sha = harness
    r = client.post("/analyze", json=_payload(real_sha, engine="toothfairy2"), headers=H)
    assert r.status_code == 404


def test_unsupported_modality(harness):
    client, _db, _storage, _engine, real_sha = harness
    r = client.post("/analyze", json=_payload(real_sha, modality="BITEWING"), headers=H)
    assert r.status_code == 422
    assert "modality" in r.json()["detail"]


def test_job_not_found(harness):
    client, _db, _storage, _engine, real_sha = harness
    r = client.post("/analyze", json=_payload(real_sha, job_id="nope"), headers=H)
    assert r.status_code == 404


def test_cross_tenant_job_is_404_not_oracle(harness):
    client, db, _storage, _engine, real_sha = harness
    r = client.post(
        "/analyze", json=_payload(real_sha, hospital_id="other-hospital"), headers=H
    )
    assert r.status_code == 404  # never 403: do not confirm another tenant's job exists
    assert db.jobs[JOB]["status"] == "PENDING"  # untouched


def test_job_not_pending_is_409(harness):
    client, db, _storage, _engine, real_sha = harness
    assert client.post("/analyze", json=_payload(real_sha), headers=H).status_code == 200
    r = client.post("/analyze", json=_payload(real_sha), headers=H)
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Success path — full state machine + provenance + audit + storage
# ---------------------------------------------------------------------------


def test_analyze_success_end_to_end(harness):
    client, db, storage, engine, real_sha = harness
    r = client.post("/analyze", json=_payload(real_sha), headers=H)
    assert r.status_code == 200
    body = r.json()

    # response shape
    assert body["status"] == "COMPLETED"
    assert len(body["findings"]) == 2
    f0 = body["findings"][0]
    assert f0["condition"] == "caries"
    assert f0["confidence"] == pytest.approx(0.631)
    assert f0["bounding_box"]["x"] == pytest.approx(1998.2)
    assert f0["tooth_number"] is None
    assert body["top_confidence"] == pytest.approx(0.631)

    # provenance
    p = body["provenance"]
    assert p["engine"] == "liodon"
    assert p["model_version"] == "1.0.0"
    assert p["model_checksum"] == CHECKSUM
    assert p["model_checksum_expected"] == CHECKSUM
    assert p["image_sha256"] == real_sha
    assert p["orchestrator_version"] == "19B.0.0"
    assert p["device"] == "cpu"
    assert p["processing_time_ms"] == 423
    assert p["raw_output_key"] == f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/liodon/result.json"
    assert p["annotated_image_key"] == f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/liodon/annotated.png"
    assert p["timestamp"]

    # job row
    job = db.jobs[JOB]
    assert job["status"] == "COMPLETED"
    assert job["confidence"] == pytest.approx(0.631)
    assert job["modelVersion"] == "1.0.0"
    assert job["modelChecksum"] == CHECKSUM
    assert job["rawOutputKey"].endswith("ai/liodon/result.json")
    assert job["processingTimeMs"] == 423
    assert job["errorMessage"] is None
    # provenance persisted as a first-class column (D9 / section 13)
    assert job["provenance"]["model_checksum"] == CHECKSUM
    assert job["provenance"]["image_sha256"] == real_sha
    assert job["provenance"]["orchestrator_version"] == "19B.0.0"

    # study progressed UPLOADED -> ANALYZED
    assert db.studies[STUDY]["status"] == "ANALYZED"

    # deterministic transitions
    assert db.transitions == ["PENDING->PROCESSING", "PROCESSING->COMPLETED"]

    # audit: who/when/tenant/resource/engine recorded
    actions = [e["action"] for e in db.audit_events]
    assert actions == ["AI_JOB_PROCESSING", "AI_JOB_COMPLETED"]
    for e in db.audit_events:
        assert e["hospital_id"] == HOSPITAL
        assert e["entity_type"] == "AIAnalysisJob"
        assert e["entity_id"] == JOB
        assert e["user_id"] == "user-1"
    completed = db.audit_events[1]
    assert completed["new_values"]["model_checksum"] == CHECKSUM
    assert completed["new_values"]["detection_count"] == 2

    # storage: result.json + annotated.png as SEPARATE objects
    keys = [k for k, _ in storage.puts]
    assert keys == [
        f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/liodon/result.json",
        f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/liodon/annotated.png",
    ]
    # The annotated object must be the engine's PNG bytes verbatim —
    # hex-decoded (regression: the old base64 decode of hex input silently
    # stored garbage bytes, so the object existed but was not a PNG).
    stored = dict(storage.puts)
    ann = stored[f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/liodon/annotated.png"]
    assert ann == bytes.fromhex("89504e470d0a1a0a")
    assert ann[:8] == b"\x89PNG\r\n\x1a\n"

    # engine received the decoded original bytes
    assert len(engine.calls) == 1
    sent = engine.calls[0]["json"]["image"]
    assert base64.b64decode(sent) == storage.image_bytes


# ---------------------------------------------------------------------------
# Failure paths — job FAILED + audit, never half-completed
# ---------------------------------------------------------------------------


def _assert_failed(db, engine=None):
    assert db.jobs[JOB]["status"] == "FAILED"
    assert db.jobs[JOB]["errorMessage"]
    assert db.jobs[JOB]["findings"] is None
    actions = [e["action"] for e in db.audit_events]
    assert actions == ["AI_JOB_PROCESSING", "AI_JOB_FAILED"]


def test_image_integrity_mismatch_fails_job(harness):
    client, db, _storage, _engine, real_sha = harness
    r = client.post("/analyze", json=_payload(real_sha, image_sha256="f" * 64), headers=H)
    assert r.status_code == 502
    assert "integrity" in r.json()["detail"]
    _assert_failed(db)


def test_result_validation_rejects_bad_confidence(harness):
    client, db, _storage, engine, real_sha = harness
    body = _default_engine_response(real_sha)
    body["detections"][0]["confidence"] = 1.5
    engine.response = body
    r = client.post("/analyze", json=_payload(real_sha), headers=H)
    assert r.status_code == 502
    _assert_failed(db)


def test_result_validation_rejects_unknown_class(harness):
    client, db, _storage, engine, real_sha = harness
    body = _default_engine_response(real_sha)
    body["detections"][0]["condition"] = "gum_disease"
    engine.response = body
    r = client.post("/analyze", json=_payload(real_sha), headers=H)
    assert r.status_code == 502
    _assert_failed(db)


def test_standin_results_never_stored(harness):
    client, db, _storage, engine, real_sha = harness
    body = _default_engine_response(real_sha)
    body["is_standin_not_liodon"] = True
    engine.response = body
    r = client.post("/analyze", json=_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "stand-in" in r.json()["detail"]
    _assert_failed(db)


def test_model_checksum_mismatch_fails_job(harness):
    client, db, _storage, engine, real_sha = harness
    body = _default_engine_response(real_sha)
    body["model"]["model_sha256"] = "b" * 64
    engine.response = body
    r = client.post("/analyze", json=_payload(real_sha), headers=H)
    assert r.status_code == 502
    _assert_failed(db)


def test_engine_down_fails_job(harness):
    client, db, _storage, engine, real_sha = harness
    engine.response = httpx.ConnectError("connection refused")
    r = client.post("/analyze", json=_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "unreachable" in r.json()["detail"]
    _assert_failed(db)


def test_get_job_returns_state(harness):
    client, *_r = harness
    r = client.get(f"/jobs/{JOB}", headers=H)
    assert r.status_code == 200
    assert r.json()["job"]["id"] == JOB
    assert client.get("/jobs/missing", headers=H).status_code == 404


def test_put_png_decodes_hex_not_base64(monkeypatch):
    """Regression: the engine's annotated_png_hex is HEX (model.py:
    buf.getvalue().hex()). The old base64.b64decode silently stored
    garbage bytes, because hex digits are a subset of the base64
    alphabet — the object existed in MinIO but was not a PNG."""
    from app.storage import ObjectStorage

    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_ACCESS_KEY", "test")
    monkeypatch.setenv("S3_SECRET_KEY", "test")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    store = ObjectStorage()
    captured = {}
    store._put = lambda key, data, content_type: captured.update(
        key=key, data=data, content_type=content_type
    )
    store.put_png("k/annotated.png", "89504e470d0a1a0a")
    assert captured["data"] == b"\x89PNG\r\n\x1a\n"
    assert captured["content_type"] == "image/png"


# ---------------------------------------------------------------------------
# Phase 19B — MeshSegNet routing + validation (D4 gate)
# ---------------------------------------------------------------------------

MESH_CHECKSUM_MAX = "727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d"
MESH_CHECKSUM_MAN = "d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf"


def _mesh_harness(monkeypatch, engine_name="meshsegnet-max", response=None):
    """Harness variant: mesh object key + per-engine fake clients (distinct
    instances so a routing test can prove WHICH engine was dialed)."""
    import hashlib

    from tests.conftest import (
        FakeEngine, FakeJobStore, FakeStorage,
        MESH_KEY, _default_meshsegnet_response,
    )

    mesh_bytes = b"fake-obj-mesh-bytes-" + b"0" * 32
    real_sha = hashlib.sha256(mesh_bytes).hexdigest()

    db = FakeJobStore()
    storage = FakeStorage(mesh_bytes, key=MESH_KEY)
    resp = response if response is not None else _default_meshsegnet_response(engine_name)
    clients = {name: FakeEngine(response=resp) for name in main.ENGINE_URLS}

    monkeypatch.setattr(main, "_state", {
        "db": db, "storage": storage, "engine_http": None,
        "engine_clients": clients,
    })
    from fastapi.testclient import TestClient
    return TestClient(main.app), db, storage, clients, real_sha


def _mesh_payload(real_sha: str, **over) -> dict:
    base = {
        "job_id": JOB,
        "study_id": STUDY,
        "hospital_id": HOSPITAL,
        "image_key": MESH_KEY,
        "image_sha256": real_sha,
        "engine": "meshsegnet-max",
        "modality": "THREE_D_SCAN",
        "requested_by": "user-1",
    }
    base.update(over)
    return base


def test_meshsegnet_routing_success(monkeypatch):
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch)
    r = client.post("/analyze", json=_mesh_payload(real_sha), headers=H)
    assert r.status_code == 200, r.text
    body = r.json()

    # findings are the 15-class segment histogram (3D — no bounding boxes)
    assert body["status"] == "COMPLETED"
    assert len(body["findings"]) == 3
    assert body["findings"][0] == {"class_id": 0, "class_name": "Gingiva", "point_count": 412}
    assert body["top_confidence"] is None

    # provenance — the pinned real artifact identity, not a stand-in
    p = body["provenance"]
    assert p["engine"] == "meshsegnet-max"
    assert p["model_checksum"] == MESH_CHECKSUM_MAX
    assert p["model_checksum_expected"] == MESH_CHECKSUM_MAX
    assert p["model_license"] == "MIT"
    assert p["image_width"] is None  # 3D input — no image dimensions
    assert p["image_sha256"] == real_sha

    # job row + study progression + audit
    assert db.jobs[JOB]["status"] == "COMPLETED"
    assert db.jobs[JOB]["modelChecksum"] == MESH_CHECKSUM_MAX
    assert db.jobs[JOB]["findings"][1]["class_name"] == "Tooth_3"
    assert db.studies[STUDY]["status"] == "ANALYZED"
    assert [e["action"] for e in db.audit_events] == ["AI_JOB_PROCESSING", "AI_JOB_COMPLETED"]

    # storage: result.json persisted (no annotated.png for 3D)
    keys = [k for k, _ in storage.puts]
    assert keys == [f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/meshsegnet-max/result.json"]

    # the dialed engine got MESH bytes + the format from the key extension
    call = clients["meshsegnet-max"].calls
    assert len(call) == 1
    sent = call[0]["json"]
    assert "image" not in sent
    assert base64.b64decode(sent["mesh"]) == storage.image_bytes
    assert sent["format"] == "obj"
    # the other engines were never dialed
    assert clients["liodon"].calls == []
    assert clients["meshsegnet-man"].calls == []


def test_meshsegnet_man_routed_to_its_own_url(monkeypatch):
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch, engine_name="meshsegnet-man")
    r = client.post("/analyze", json=_mesh_payload(real_sha, engine="meshsegnet-man", modality="CBCT"), headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["provenance"]["model_checksum"] == MESH_CHECKSUM_MAN
    assert len(clients["meshsegnet-man"].calls) == 1
    assert clients["meshsegnet-max"].calls == []


def test_meshsegnet_rejects_panormic(monkeypatch):
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch)
    r = client.post("/analyze", json=_mesh_payload(real_sha, modality="PANORAMIC"), headers=H)
    assert r.status_code == 422
    assert "does not support modality" in r.json()["detail"]
    assert clients["meshsegnet-max"].calls == []


def test_liodon_rejects_three_d_scan(monkeypatch):
    """19A rule stays intact: only PANORAMIC goes to Liodon. (The 422 is
    raised at the modality check, before any engine is dialed.)"""
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch)
    r = client.post("/analyze", json=_mesh_payload(real_sha, engine="liodon", modality="THREE_D_SCAN"), headers=H)
    assert r.status_code == 422
    assert clients["liodon"].calls == []


def test_meshsegnet_standin_results_never_stored(monkeypatch):
    import copy

    from tests.conftest import _default_meshsegnet_response

    resp = _default_meshsegnet_response()
    resp = copy.deepcopy(resp)
    resp["is_standin_not_meshsegnet"] = True
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_mesh_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "stand-in" in r.json()["detail"]
    _assert_failed(db)


def test_meshsegnet_checksum_mismatch_fails_job(monkeypatch):
    import copy

    from tests.conftest import _default_meshsegnet_response

    resp = _default_meshsegnet_response()
    resp = copy.deepcopy(resp)
    resp["model"]["model_sha256"] = "f" * 64
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_mesh_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "checksum mismatch" in r.json()["detail"]
    _assert_failed(db)


def test_meshsegnet_segment_sum_mismatch_fails_job(monkeypatch):
    import copy

    from tests.conftest import _default_meshsegnet_response

    resp = _default_meshsegnet_response()
    resp = copy.deepcopy(resp)
    resp["segments"][0]["point_count"] = 999  # 999+355+233 != 1000
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_mesh_payload(real_sha), headers=H)
    assert r.status_code == 502
    _assert_failed(db)


def test_meshsegnet_wrong_class_name_fails_job(monkeypatch):
    """A speculative tooth name (e.g. 'upper_canine') must be rejected — the
    registry pins the neutral names (no official label-to-tooth map)."""
    import copy

    from tests.conftest import _default_meshsegnet_response

    resp = _default_meshsegnet_response()
    resp = copy.deepcopy(resp)
    resp["segments"][2] = {"class_id": 11, "class_name": "lower_canine", "point_count": 233}
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_mesh_payload(real_sha), headers=H)
    assert r.status_code == 502
    _assert_failed(db)


def test_meshsegnet_cell_cap_enforced(monkeypatch):
    """> 10,000 cells means the official decimation rule was not run."""
    import copy

    from tests.conftest import _default_meshsegnet_response

    resp = _default_meshsegnet_response()
    resp = copy.deepcopy(resp)
    resp["num_points_total"] = 12000
    resp["segments"][0]["point_count"] = 11555
    client, db, storage, clients, real_sha = _mesh_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_mesh_payload(real_sha), headers=H)
    assert r.status_code == 502
    _assert_failed(db)
