"""
Orchestrator tests (Phase 19A, D13).

Real app + real validation/registry/provenance; fakes for db/storage/engine.
"""

from __future__ import annotations

import base64
import hashlib

import httpx
import pytest

from tests.conftest import HOSPITAL, IMAGE_KEY, JOB, PATIENT, STUDY, _default_engine_response

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
    assert body["orchestrator_version"] == "19A.0.0"
    assert body["engines"] == ["liodon"]


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
    assert p["orchestrator_version"] == "19A.0.0"
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
    assert job["provenance"]["orchestrator_version"] == "19A.0.0"

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
