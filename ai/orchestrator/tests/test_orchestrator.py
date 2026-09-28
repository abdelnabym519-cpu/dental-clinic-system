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
    assert body["engines"] == [
        "implant-ai", "liodon", "meshsegnet-man", "meshsegnet-max", "orthodontic-ai",
    ]
    # Phase 19B: per-engine reachability block + back-compatible liodon key
    assert set(body["engines_health"]) == {
        "implant-ai", "liodon", "meshsegnet-man", "meshsegnet-max", "orthodontic-ai",
    }
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
    # Phase 19B engine 2: Implant AI pinned to the audited checkpoint.
    im = next(e for e in engines if e["name"] == "implant-ai")
    assert im["model_checksum"] == "e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98"
    assert im["supported_modalities"] == ["BITEWING", "PERIAPICAL"] or im["supported_modalities"] == ["PERIAPICAL", "BITEWING"]
    assert im["result_kind"] == "findings"
    assert im["classes"]["3"] == "Implant"
    assert im["classes"]["7"] == "Root canal obturation"
    # Phase 19B engine 3: Orthodontic AI pinned to the audited checkpoint,
    # the 38 neutral landmark names, cephalometric modality only.
    oa = next(e for e in engines if e["name"] == "orthodontic-ai")
    assert oa["model_checksum"] == ORTHODONTIC_CHECKSUM
    assert oa["supported_modalities"] == ["CEPHALOMETRIC"]
    assert oa["result_kind"] == "landmarks"
    assert oa["classes"] == {str(i): str(i) for i in range(38)}


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


def _implant_harness(monkeypatch, response=None):
    """Harness for the Implant AI engine: IMAGE object key + image bytes
    (the 19A image contract), per-engine fake clients."""
    import hashlib

    from tests.conftest import (
        FakeEngine, FakeJobStore, FakeStorage,
        IMAGE_KEY, _default_implant_response,
    )

    img_bytes = b"periapical-xray-bytes-" + b"0" * 32
    real_sha = hashlib.sha256(img_bytes).hexdigest()

    db = FakeJobStore()
    storage = FakeStorage(img_bytes, key=IMAGE_KEY)
    resp = response if response is not None else _default_implant_response()
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


# ---------------------------------------------------------------------------
# Phase 19B engine 2 — Implant AI routing + validation (D8 gate)
# ---------------------------------------------------------------------------

IMPLANT_CHECKSUM = "e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98"


def _implant_payload(real_sha: str, **over) -> dict:
    base = {
        "job_id": JOB,
        "study_id": STUDY,
        "hospital_id": HOSPITAL,
        "image_key": IMAGE_KEY,
        "image_sha256": real_sha,
        "engine": "implant-ai",
        "modality": "PERIAPICAL",
        "requested_by": "user-1",
    }
    base.update(over)
    return base


def test_implant_routing_success(monkeypatch):
    from tests.conftest import _default_implant_response

    client, db, storage, clients, real_sha = _implant_harness(
        monkeypatch, response=_default_implant_response()
    )
    r = client.post("/analyze", json=_implant_payload(real_sha), headers=H)
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["status"] == "COMPLETED"
    assert len(body["findings"]) == 2
    f0 = body["findings"][0]
    assert f0["condition"] == "Implant"
    assert f0["tooth_number"] is None
    assert f0["bounding_box"]["x"] == 310.0
    assert f0["bounding_box"]["coordinate_space"] == "original_image"
    assert body["top_confidence"] == pytest.approx(0.71)

    p = body["provenance"]
    assert p["engine"] == "implant-ai"
    assert p["model_checksum"] == IMPLANT_CHECKSUM
    assert p["image_width"] == 1200
    assert p["image_height"] == 900

    assert db.jobs[JOB]["status"] == "COMPLETED"
    assert db.jobs[JOB]["modelChecksum"] == IMPLANT_CHECKSUM
    assert db.studies[STUDY]["status"] == "ANALYZED"

    # storage: result.json + annotated.png under the implant engine key
    keys = [k for k, _ in storage.puts]
    assert keys == [
        f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/implant-ai/result.json",
        f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/implant-ai/annotated.png",
    ]

    # the dialed engine got IMAGE bytes (not mesh) — the 19A image contract
    call = clients["implant-ai"].calls
    assert len(call) == 1
    sent = call[0]["json"]
    assert "mesh" not in sent
    assert base64.b64decode(sent["image"]) == storage.image_bytes
    assert sent["annotate"] is True
    assert clients["liodon"].calls == []
    assert clients["meshsegnet-max"].calls == []
    assert clients["meshsegnet-man"].calls == []


def test_implant_bitewing_accepted(monkeypatch):
    client, db, storage, clients, real_sha = _implant_harness(monkeypatch)
    r = client.post("/analyze", json=_implant_payload(real_sha, modality="BITEWING"), headers=H)
    assert r.status_code == 200, r.text


def test_implant_rejects_panormic(monkeypatch):
    client, db, storage, clients, real_sha = _implant_harness(monkeypatch)
    r = client.post("/analyze", json=_implant_payload(real_sha, modality="PANORAMIC"), headers=H)
    assert r.status_code == 422
    assert "does not support modality" in r.json()["detail"]
    assert clients["implant-ai"].calls == []


def test_liodon_rejects_periapical(monkeypatch):
    """19A rule stays intact: PERIAPICAL is implant territory, not Liodon's."""
    client, db, storage, clients, real_sha = _implant_harness(monkeypatch)
    r = client.post("/analyze", json=_implant_payload(real_sha, engine="liodon", modality="PERIAPICAL"), headers=H)
    assert r.status_code == 422
    assert clients["liodon"].calls == []


def test_implant_standin_results_never_stored(monkeypatch):
    import copy

    from tests.conftest import _default_implant_response

    resp = copy.deepcopy(_default_implant_response())
    resp["is_standin_not_implant"] = True
    client, db, storage, clients, real_sha = _implant_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_implant_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "stand-in" in r.json()["detail"]
    _assert_failed(db)


def test_implant_checksum_mismatch_fails_job(monkeypatch):
    import copy

    from tests.conftest import _default_implant_response

    resp = copy.deepcopy(_default_implant_response())
    resp["model"]["model_sha256"] = "f" * 64
    client, db, storage, clients, real_sha = _implant_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_implant_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "checksum mismatch" in r.json()["detail"]
    _assert_failed(db)


def test_implant_unknown_class_fails_job(monkeypatch):
    import copy

    from tests.conftest import _default_implant_response

    resp = copy.deepcopy(_default_implant_response())
    resp["detections"][0]["condition"] = "implanted_tooth"
    resp["detections"][0]["class_name"] = "implanted_tooth"
    client, db, storage, clients, real_sha = _implant_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_implant_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "unknown class" in r.json()["detail"]
    _assert_failed(db)


# ---------------------------------------------------------------------------
# Phase 19B engine 3 — Orthodontic AI routing + validation (8005)
# ---------------------------------------------------------------------------

ORTHODONTIC_CHECKSUM = "fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc"


def _ortho_harness(monkeypatch, response=None):
    """Harness for the Orthodontic AI engine: IMAGE object key + image bytes
    (the 19A image contract), per-engine fake clients."""
    import hashlib

    from tests.conftest import (
        FakeEngine, FakeJobStore, FakeStorage,
        IMAGE_KEY, _default_orthodontic_response,
    )

    img_bytes = b"cephalogram-xray-bytes-" + b"0" * 32
    real_sha = hashlib.sha256(img_bytes).hexdigest()

    db = FakeJobStore()
    storage = FakeStorage(img_bytes, key=IMAGE_KEY)
    resp = response if response is not None else _default_orthodontic_response()
    clients = {name: FakeEngine(response=resp) for name in main.ENGINE_URLS}

    monkeypatch.setattr(main, "_state", {
        "db": db, "storage": storage, "engine_http": None,
        "engine_clients": clients,
    })
    from fastapi.testclient import TestClient
    return TestClient(main.app), db, storage, clients, real_sha


def _ortho_payload(real_sha: str, **over) -> dict:
    base = {
        "job_id": JOB,
        "study_id": STUDY,
        "hospital_id": HOSPITAL,
        "image_key": IMAGE_KEY,
        "image_sha256": real_sha,
        "engine": "orthodontic-ai",
        "modality": "CEPHALOMETRIC",
        "requested_by": "user-1",
    }
    base.update(over)
    return base


def test_registry_contains_orthodontic_entry(harness):
    from app.registry import registry

    reg = registry.get("orthodontic-ai")
    assert reg is not None
    assert reg["model_checksum"] == ORTHODONTIC_CHECKSUM
    assert reg["model_size_bytes"] == 268_846_952
    assert reg["num_landmarks"] == 38
    assert reg["classes"] == {i: str(i) for i in range(38)}
    assert reg["supported_modalities"] == ["CEPHALOMETRIC"]
    assert reg["result_kind"] == "landmarks"
    assert reg["model_path"] == "/app/models/model_pretrained_on_train_and_val.pth"
    assert "18d17d1934970016e7610c4849311900b8d1f191" in reg["model_source"]
    assert "Apache-2.0" in reg["model_license"]


def test_orthodontic_routing_success(monkeypatch):
    import base64

    from tests.conftest import _default_orthodontic_response

    client, db, storage, clients, real_sha = _ortho_harness(
        monkeypatch, response=_default_orthodontic_response()
    )
    r = client.post("/analyze", json=_ortho_payload(real_sha), headers=H)
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["status"] == "COMPLETED"
    assert len(body["findings"]) == 38
    f0 = body["findings"][0]
    assert f0["landmark_id"] == 0
    assert f0["landmark_name"] == "0"  # the model's own neutral vocabulary
    assert f0["coordinate_space"] == "cropped_original_image"
    ids = [f["landmark_id"] for f in body["findings"]]
    assert ids == list(range(38))
    assert body["top_confidence"] == pytest.approx(0.9)

    p = body["provenance"]
    assert p["engine"] == "orthodontic-ai"
    assert p["model_checksum"] == ORTHODONTIC_CHECKSUM
    assert p["image_width"] == 2400
    assert p["image_height"] == 2880

    assert db.jobs[JOB]["status"] == "COMPLETED"
    assert db.jobs[JOB]["modelChecksum"] == ORTHODONTIC_CHECKSUM
    assert db.studies[STUDY]["status"] == "ANALYZED"

    # storage: result.json + annotated.png under the orthodontic engine key
    keys = [k for k, _ in storage.puts]
    assert keys == [
        f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/orthodontic-ai/result.json",
        f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/ai/orthodontic-ai/annotated.png",
    ]

    # the dialed engine got IMAGE bytes (not mesh) — the 19A image contract
    call = clients["orthodontic-ai"].calls
    assert len(call) == 1
    sent = call[0]["json"]
    assert "mesh" not in sent
    assert base64.b64decode(sent["image"]) == storage.image_bytes
    assert sent["annotate"] is True
    assert clients["liodon"].calls == []
    assert clients["implant-ai"].calls == []
    assert clients["meshsegnet-max"].calls == []
    assert clients["meshsegnet-man"].calls == []


def test_orthodontic_rejects_panoramic(monkeypatch):
    """CEPHALOMETRIC is orthodontic territory; PANORAMIC stays Liodon's."""
    client, db, storage, clients, real_sha = _ortho_harness(monkeypatch)
    r = client.post("/analyze", json=_ortho_payload(real_sha, modality="PANORAMIC"), headers=H)
    assert r.status_code == 422
    assert "does not support modality" in r.json()["detail"]
    assert clients["orthodontic-ai"].calls == []


def test_liodon_rejects_cephalometric(monkeypatch):
    """19A rule stays intact in reverse: Liodon never takes cephalograms."""
    client, db, storage, clients, real_sha = _ortho_harness(monkeypatch)
    r = client.post(
        "/analyze", json=_ortho_payload(real_sha, engine="liodon", modality="CEPHALOMETRIC"),
        headers=H,
    )
    assert r.status_code == 422
    assert clients["liodon"].calls == []


def test_orthodontic_standin_results_never_stored(monkeypatch):
    import copy

    from tests.conftest import _default_orthodontic_response

    resp = copy.deepcopy(_default_orthodontic_response())
    resp["is_standin_not_orthodontic"] = True
    resp["model"]["is_standin_not_orthodontic"] = True
    client, db, storage, clients, real_sha = _ortho_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_ortho_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "stand-in" in r.json()["detail"]
    _assert_failed(db)
    assert storage.puts == []  # nothing persisted


def test_orthodontic_checksum_mismatch_fails_job(monkeypatch):
    import copy

    from tests.conftest import _default_orthodontic_response

    resp = copy.deepcopy(_default_orthodontic_response())
    resp["model"]["model_sha256"] = "0" * 64
    client, db, storage, clients, real_sha = _ortho_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_ortho_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "checksum mismatch" in r.json()["detail"]
    _assert_failed(db)


def test_orthodontic_wrong_landmark_count_fails_job(monkeypatch):
    import copy

    from tests.conftest import _default_orthodontic_response

    resp = copy.deepcopy(_default_orthodontic_response())
    resp["landmarks"] = resp["landmarks"][:37]
    resp["landmark_count"] = 37
    client, db, storage, clients, real_sha = _ortho_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_ortho_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "wrong count" in r.json()["detail"]
    _assert_failed(db)


def test_orthodontic_unknown_landmark_name_fails_job(monkeypatch):
    import copy

    from tests.conftest import _default_orthodontic_response

    resp = copy.deepcopy(_default_orthodontic_response())
    # an anatomical name that the model never emits — never invented upstream
    resp["landmarks"][0]["name"] = "Sella"
    client, db, storage, clients, real_sha = _ortho_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_ortho_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "not a registered landmark name" in r.json()["detail"]
    _assert_failed(db)


def test_orthodontic_nonfinite_coordinate_fails_job(monkeypatch):
    import copy
    import math

    from tests.conftest import _default_orthodontic_response

    resp = copy.deepcopy(_default_orthodontic_response())
    resp["landmarks"][5]["x"] = math.nan
    client, db, storage, clients, real_sha = _ortho_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_ortho_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "not finite" in r.json()["detail"]
    _assert_failed(db)


def test_orthodontic_raw_model_output_mismatch_fails_job(monkeypatch):
    """A different estimator/head must not pass — it would relabel the 38
    points while keeping their coordinates plausible-looking."""
    import copy

    from tests.conftest import _default_orthodontic_response

    resp = copy.deepcopy(_default_orthodontic_response())
    resp["raw_model_output"]["estimator"] = "TopdownPoseEstimator"
    resp["raw_model_output"]["num_joints"] = 17  # COCO, not ceph
    client, db, storage, clients, real_sha = _ortho_harness(monkeypatch, response=resp)
    r = client.post("/analyze", json=_ortho_payload(real_sha), headers=H)
    assert r.status_code == 502
    assert "num_joints" in r.json()["detail"]
    _assert_failed(db)


def test_orthodontic_validator_accepts_and_rejects_directly():
    from app.validation import (
        ValidationResultError,
        validate_orthodontic_response,
    )
    from tests.conftest import _default_orthodontic_response

    reg = _default_orthodontic_response()
    ok = validate_orthodontic_response(
        reg, expected_checksum=ORTHODONTIC_CHECKSUM
    )
    assert len(ok["findings"]) == 38
    assert ok["findings"][0]["landmark_name"] == "0"
    assert ok["image_after_padding_crop"]["width"] == 2400

    standin = _default_orthodontic_response()
    standin["is_standin_not_orthodontic"] = True
    with pytest.raises(ValidationResultError, match="stand-in"):
        validate_orthodontic_response(standin, expected_checksum=ORTHODONTIC_CHECKSUM)
