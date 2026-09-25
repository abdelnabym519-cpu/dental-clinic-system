"""
Orchestrator test fixtures.

The real MySQL/MinIO/engine are not available in this sandbox, so the tests
run the real FastAPI app + real validation/provenance/registry logic against
in-memory fakes for the three external boundaries (db, storage, engine http).
"""

from __future__ import annotations

import os

os.environ.setdefault("ORCHESTRATOR_SECRET", "test-secret")
os.environ.setdefault("DATABASE_URL", "mysql://root:test@127.0.0.1:3306/dental_erp")
os.environ.setdefault("LIODON_ENGINE_URL", "http://fake-engine:8001")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402

SECRET = "test-secret"
HOSPITAL = "hosp-1"
PATIENT = "pat-1"
STUDY = "study-1"
JOB = "job-1"
IMAGE_KEY = f"{HOSPITAL}/imaging/{PATIENT}/{STUDY}/original.png"
IMAGE_SHA = "a" * 64


class FakeJobStore:
    def __init__(self):
        self.jobs = {
            JOB: {
                "id": JOB, "hospitalId": HOSPITAL, "studyId": STUDY,
                "engine": "liodon", "status": "PENDING", "errorMessage": None,
                "findings": None, "reviewedById": None, "reviewedAt": None,
                "reviewDecision": None, "reviewNotes": None,
                "createdAt": "now", "updatedAt": "now",
            }
        }
        self.studies = {
            STUDY: {"id": STUDY, "hospitalId": HOSPITAL, "patientId": PATIENT, "status": "UPLOADED"}
        }
        self.audit_events: list[dict] = []
        self.transitions: list[str] = []
        self.ping_ok = True

    # -- JobStore interface used by the orchestrator ---------------------
    def ping(self):
        return self.ping_ok

    def get_job(self, job_id):
        return self.jobs.get(job_id)

    def get_study(self, study_id):
        return self.studies.get(study_id)

    def claim_job_processing(self, job_id, hospital_id):
        job = self.jobs.get(job_id)
        if job is None:
            from app.db import JobError
            raise JobError(404, f"job {job_id} not found")
        if job["hospitalId"] != hospital_id:
            from app.db import JobError
            raise JobError(404, f"job {job_id} not found")
        if job["status"] != "PENDING":
            from app.db import JobError
            raise JobError(409, f"job {job_id} is {job['status']}, not PENDING")
        job["status"] = "PROCESSING"
        self.transitions.append("PENDING->PROCESSING")
        return job

    def complete_job(self, job_id, **fields):
        job = self.jobs[job_id]
        # Mirror the real store's column mapping (snake kwargs -> camelCase columns).
        mapping = {
            "findings": "findings",
            "confidence": "confidence",
            "model_version": "modelVersion",
            "model_checksum": "modelChecksum",
            "model_source": "modelSource",
            "model_license": "modelLicense",
            "orchestrator_version": "orchestratorVersion",
            "processing_time_ms": "processingTimeMs",
            "raw_output_key": "rawOutputKey",
            "provenance": "provenance",
        }
        for k, v in fields.items():
            job[mapping[k]] = v
        job["status"] = "COMPLETED"
        self.transitions.append("PROCESSING->COMPLETED")

    def fail_job(self, job_id, error_message):
        job = self.jobs[job_id]
        job["status"] = "FAILED"
        job["errorMessage"] = error_message
        self.transitions.append(f"{job.get('_from', 'PROCESSING')}->FAILED")

    def mark_study_analyzed(self, study_id, hospital_id):
        s = self.studies[study_id]
        if s["hospitalId"] == hospital_id and s["status"] == "UPLOADED":
            s["status"] = "ANALYZED"

    def audit(self, **kw):
        self.audit_events.append(kw)


class FakeStorage:
    def __init__(self, image_bytes: bytes):
        self.image_bytes = image_bytes
        self.puts: list[tuple[str, bytes]] = []

    def get_object(self, key):
        assert key == IMAGE_KEY, f"unexpected key {key}"
        return self.image_bytes

    def put_json(self, key, payload):
        import json

        self.puts.append((key, json.dumps(payload).encode()))

    def put_png(self, key, png_hex):
        import base64

        self.puts.append((key, base64.b64decode(png_hex)))


class FakeEngine:
    """Stands in for the liodon-engine HTTP client."""

    def __init__(self, response: dict | Exception):
        self.response = response
        self.calls: list[dict] = []

    def post(self, path, json=None, **kw):
        self.calls.append({"path": path, "json": json})
        if isinstance(self.response, Exception):
            raise self.response
        return _FakeResponse(self.response)

    def get(self, path, **kw):
        raise Exception("engine probe not configured")

    def close(self):
        pass


class _FakeResponse:
    def __init__(self, body):
        self._body = body
        self.status_code = 200
        self.text = str(body)

    def json(self):
        return self._body

    @property
    def content(self):
        return b""


import httpx  # noqa: E402


@pytest.fixture()
def harness(monkeypatch):
    """Wires the real app to fresh fakes; returns (client, db, storage, engine)."""
    image_bytes = b"fake-xray-bytes-" + b"0" * 32
    import hashlib

    real_sha = hashlib.sha256(image_bytes).hexdigest()

    db = FakeJobStore()
    storage = FakeStorage(image_bytes)
    engine = FakeEngine(response=_default_engine_response(real_sha))

    monkeypatch.setattr(main, "_state", {
        "db": db, "storage": storage, "engine_http": engine,
    })
    client = TestClient(main.app)
    return client, db, storage, engine, real_sha


def _default_engine_response(image_sha: str) -> dict:
    """A valid liodon /infer response (real-model checksum, 2 findings)."""
    return {
        "is_standin_not_liodon": False,
        "image": {"width": 2400, "height": 1200, "sha256": image_sha},
        "detection_count": 2,
        "counts_by_class": {"caries": 1, "impacted_tooth": 1},
        "detections": [
            {
                "class_id": 0, "class_name": "caries", "condition": "caries",
                "tooth_number": None, "confidence": 0.631,
                "bbox": {
                    "format": "xyxy", "units": "pixels",
                    "coordinate_space": "original_image",
                    "x1": 1998.2, "y1": 420.4, "x2": 2134.9, "y2": 633.1,
                    "x": 1998.2, "y": 420.4, "width": 136.7, "height": 212.7,
                },
            },
            {
                "class_id": 2, "class_name": "impacted_tooth",
                "condition": "impacted_tooth", "tooth_number": None,
                "confidence": 0.539,
                "bbox": {
                    "format": "xyxy", "units": "pixels",
                    "coordinate_space": "original_image",
                    "x1": 300.0, "y1": 500.0, "x2": 420.0, "y2": 560.0,
                    "x": 300.0, "y": 500.0, "width": 120.0, "height": 60.0,
                },
            },
        ],
        "raw_model_output": {
            "shape": [1, 7, 8400], "interpreted_layout": "cxcywh+cls (4+nc, N)",
            "num_channels": 7, "num_classes": 3, "num_anchor_points": 8400,
            "candidates_before_nms": 4, "detections_after_nms": 2,
        },
        "timings_ms": {
            "decode_ms": 3.1, "preprocess_ms": 2.2, "inference_ms": 412.5,
            "postprocess_ms": 0.8, "draw_ms": 4.4, "total_ms": 423.0,
        },
        "annotated_png_hex": "89504e470d0a1a0a",  # fake PNG bytes
        "parameters": {"conf": 0.45, "iou": 0.35, "imgsz": 640},
        "model": {
            "name": "liodon",
            "model_version": "1.0.0",
            "model_sha256": "4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71",
            "model_source": "https://huggingface.co/liodon-ai/dental-panoramic-detector@8bef2036b099e80e51f93f24de4b0c0edd366256",
            "model_license": "CC-BY-NC-4.0",
        },
        "device": "cpu",
        "runtime": {"onnxruntime_version": "1.30.0", "execution_provider": "CPUExecutionProvider"},
    }
