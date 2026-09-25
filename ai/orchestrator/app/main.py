"""
main.py — AI Orchestrator (Phase 19A, D3).

Responsibilities (and nothing Liodon-specific preprocessing — routing only):
  - authenticate internal requests (X-Orchestrator-Secret, from environment)
  - validate the analysis request (engine, tenant context, modality)
  - drive the AIAnalysisJob state machine (PENDING -> PROCESSING ->
    COMPLETED/FAILED) in the core database
  - fetch the original image from object storage (read-only) and verify its
    SHA-256
  - route to the engine and receive the raw result
  - validate the result schema (validation.py)
  - persist AI outputs as separate objects (originals stay immutable)
  - store provenance (provenance.py) and write AI_JOB_* audit events

API contract (D3.1):
  GET  /health
  GET  /engines
  POST /analyze          (secret required)
  GET  /jobs/{job_id}    (secret required)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import sys
import time

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .db import JobError, JobStore
from .provenance import build_provenance
from .registry import ORCHESTRATOR_VERSION, registry
from .storage import ObjectStorage, StorageError, ai_output_keys
from .validation import ValidationResultError, validate_liodon_response

log = logging.getLogger("orchestrator")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "info").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

ORCHESTRATOR_SECRET = os.environ.get("ORCHESTRATOR_SECRET", "")
LIODON_ENGINE_URL = os.environ.get("LIODON_ENGINE_URL", "http://liodon-engine:8001").rstrip("/")
ENGINE_TIMEOUT_S = float(os.environ.get("ENGINE_TIMEOUT_SECONDS", "120"))

if not ORCHESTRATOR_SECRET:
    # Fail closed: an unauthenticated internal API is worse than a dead one.
    # (ai-compose.yml also refuses to start the container without the var.)
    log.error("ORCHESTRATOR_SECRET is not set — refusing to start")
    sys.exit(3)

app = FastAPI(title="DenToRa AI Orchestrator", version=ORCHESTRATOR_VERSION)

# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


class AnalyzeRequest(BaseModel):
    job_id: str = Field(..., min_length=1, max_length=64)
    study_id: str = Field(..., min_length=1, max_length=64)
    hospital_id: str = Field(..., min_length=1, max_length=64)
    image_key: str = Field(..., min_length=3)
    image_sha256: str = Field(..., min_length=64, max_length=64)
    engine: str = Field("liodon", min_length=1, max_length=32)
    modality: str = Field("PANORAMIC", min_length=1, max_length=32)
    requested_by: str | None = Field(None, max_length=64)


def _require_secret(x_orchestrator_secret: str | None) -> None:
    if not x_orchestrator_secret or not hmac.compare_digest(
        x_orchestrator_secret.encode(), ORCHESTRATOR_SECRET.encode()
    ):
        raise HTTPException(status_code=401, detail="invalid orchestrator secret")


# ---------------------------------------------------------------------------
# App state (lazy singletons)
# ---------------------------------------------------------------------------

_state: dict = {
    "db": None,
    "storage": None,
    "engine_http": None,
}


def _db() -> JobStore:
    if _state["db"] is None:
        url = os.environ.get("DATABASE_URL", "")
        if not url:
            raise HTTPException(status_code=503, detail="orchestrator has no DATABASE_URL")
        _state["db"] = JobStore(url)
    return _state["db"]


def _storage() -> ObjectStorage:
    if _state["storage"] is None:
        _state["storage"] = ObjectStorage()
    return _state["storage"]


def _engine_http() -> httpx.Client:
    if _state["engine_http"] is None:
        _state["engine_http"] = httpx.Client(
            base_url=LIODON_ENGINE_URL, timeout=ENGINE_TIMEOUT_S
        )
    return _state["engine_http"]


def _fail_job(db: JobStore, payload: AnalyzeRequest, reason: str) -> None:
    """Record FAILED + audit; audit failure must not mask the job failure."""
    try:
        db.fail_job(payload.job_id, reason)
        db.audit(
            hospital_id=payload.hospital_id,
            action="AI_JOB_FAILED",
            entity_type="AIAnalysisJob",
            entity_id=payload.job_id,
            user_id=payload.requested_by,
            new_values={"engine": payload.engine, "error": reason[:500]},
        )
    except Exception as exc:  # pragma: no cover - defensive
        log.error("failed to record job failure for %s: %s", payload.job_id, exc)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    out = {
        "status": "ok",
        "orchestrator_version": ORCHESTRATOR_VERSION,
        "engines": registry.names(),
        "liodon_engine_url": LIODON_ENGINE_URL,
    }
    try:
        out["database"] = "up" if _db().ping() else "down"
    except Exception:
        out["database"] = "unconfigured"
    try:
        r = _engine_http().get("/health", timeout=5)
        out["liodon_engine"] = {
            "reachable": True,
            "model_loaded": bool(r.json().get("model_loaded")),
            "status": r.json().get("status"),
        }
    except Exception:
        out["liodon_engine"] = {"reachable": False}
    out["status"] = "ok" if out["liodon_engine"].get("reachable") else "degraded"
    return out


@app.get("/engines")
def engines():
    return {"orchestrator_version": ORCHESTRATOR_VERSION, "engines": registry.public_view()}


@app.post("/analyze")
def analyze(payload: AnalyzeRequest, x_orchestrator_secret: str | None = Header(default=None)):
    _require_secret(x_orchestrator_secret)

    # 2. engine known + modality supported (D10.1)
    engine = registry.get(payload.engine)
    if engine is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown engine {payload.engine!r} (registered: {registry.names()})",
        )
    if payload.modality.upper() not in engine["supported_modalities"]:
        raise HTTPException(
            status_code=422,
            detail=(
                f"engine {payload.engine!r} does not support modality "
                f"{payload.modality!r} (supported: {engine['supported_modalities']})"
            ),
        )

    db = _db()

    # 3. job exists, belongs to this tenant, and is PENDING (atomic claim)
    try:
        db.claim_job_processing(payload.job_id, payload.hospital_id)
    except JobError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("job claim failed: %s", exc)
        raise HTTPException(status_code=503, detail="job state store unavailable")

    started = time.perf_counter()
    try:
        db.audit(
            hospital_id=payload.hospital_id,
            action="AI_JOB_PROCESSING",
            entity_type="AIAnalysisJob",
            entity_id=payload.job_id,
            user_id=payload.requested_by,
            new_values={"engine": payload.engine, "study_id": payload.study_id},
        )
    except Exception as exc:
        log.warning("audit AI_JOB_PROCESSING failed: %s", exc)

    try:
        # 4. study + tenant double-check (patient_id comes from the DB,
        #    never from the client)
        study = db.get_study(payload.study_id)
        if study is None or study["hospitalId"] != payload.hospital_id:
            raise _JobFail(f"study {payload.study_id} not found for this tenant")

        # 5. original image bytes + integrity check (originals are immutable:
        #    read-only here)
        image_bytes = _storage().get_object(payload.image_key)
        actual_sha = hashlib.sha256(image_bytes).hexdigest()
        if actual_sha != payload.image_sha256.lower():
            raise _JobFail(
                f"image integrity check failed: stored object sha256 {actual_sha} "
                f"!= {payload.image_sha256}"
            )

        # 6. route to the engine
        try:
            r = _engine_http().post(
                "/infer",
                json={"image": _b64(image_bytes), "annotate": True},
            )
        except httpx.HTTPError as exc:
            raise _JobFail(f"engine unreachable: {exc}") from exc
        if r.status_code != 200:
            detail = _safe_detail(r)
            raise _JobFail(f"engine returned HTTP {r.status_code}: {detail}")
        engine_body = r.json()

        # 7. validate the result (schema + checksum + stand-in guard)
        validated = validate_liodon_response(
            engine_body, expected_checksum=engine["model_checksum"]
        )

        # 8. persist AI outputs as SEPARATE objects (original untouched)
        raw_key, annotated_key = ai_output_keys(
            payload.hospital_id, study["patientId"], payload.study_id, payload.engine
        )
        _storage().put_json(raw_key, engine_body)
        annotated_key_saved = None
        if engine_body.get("annotated_png_hex"):
            _storage().put_png(annotated_key, engine_body["annotated_png_hex"])
            annotated_key_saved = annotated_key

        # 9. provenance + 10. commit the job
        provenance = build_provenance(
            payload.engine,
            engine_body.get("model") or {},
            validated,
            image_sha256=actual_sha,
            raw_output_key=raw_key,
            annotated_key=annotated_key_saved,
        )
        db.complete_job(
            payload.job_id,
            findings=validated["findings"],
            confidence=validated["top_confidence"],
            model_version=(engine_body.get("model") or {}).get("model_version"),
            model_checksum=provenance["model_checksum"],
            model_source=provenance["model_source"],
            model_license=provenance["model_license"],
            orchestrator_version=ORCHESTRATOR_VERSION,
            processing_time_ms=int(validated["processing_time_ms"]),
            raw_output_key=raw_key,
            provenance=provenance,
        )
        db.mark_study_analyzed(payload.study_id, payload.hospital_id)

        try:
            db.audit(
                hospital_id=payload.hospital_id,
                action="AI_JOB_COMPLETED",
                entity_type="AIAnalysisJob",
                entity_id=payload.job_id,
                user_id=payload.requested_by,
                new_values={
                    "engine": payload.engine,
                    "model_version": provenance["model_version"],
                    "model_checksum": provenance["model_checksum"],
                    "detection_count": len(validated["findings"]),
                    "processing_time_ms": int(validated["processing_time_ms"]),
                    "raw_output_key": raw_key,
                },
            )
        except Exception as exc:
            log.warning("audit AI_JOB_COMPLETED failed: %s", exc)

        log.info(
            "job %s COMPLETED engine=%s findings=%d total=%d ms",
            payload.job_id, payload.engine, len(validated["findings"]),
            int((time.perf_counter() - started) * 1000),
        )
        return {
            "job_id": payload.job_id,
            "status": "COMPLETED",
            "findings": validated["findings"],
            "top_confidence": validated["top_confidence"],
            "provenance": provenance,
            "processing_time_ms": int(validated["processing_time_ms"]),
            "raw_output_key": raw_key,
            "annotated_image_key": annotated_key_saved,
        }

    except _JobFail as exc:
        _fail_job(db, payload, str(exc))
        raise HTTPException(status_code=502, detail=str(exc))
    except (StorageError, ValidationResultError) as exc:
        _fail_job(db, payload, str(exc))
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        log.exception("analyze failed for job %s: %s", payload.job_id, exc)
        _fail_job(db, payload, f"internal error: {type(exc).__name__}")
        raise HTTPException(status_code=500, detail="internal orchestrator error")


class _JobFail(Exception):
    """Domain failure: the job must be marked FAILED and the client told why."""


def _b64(data: bytes) -> str:
    import base64

    return base64.b64encode(data).decode("ascii")


def _safe_detail(r: httpx.Response) -> str:
    try:
        return json.dumps(r.json())[:300]
    except Exception:
        return r.text[:300]


@app.get("/jobs/{job_id}")
def get_job(job_id: str, x_orchestrator_secret: str | None = Header(default=None)):
    _require_secret(x_orchestrator_secret)
    db = _db()
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"job {job_id} not found")
    return {"job": job}


@app.on_event("shutdown")
def _shutdown():
    for key in ("engine_http",):
        obj = _state.get(key)
        if obj is not None:
            try:
                obj.close()
            except Exception:
                pass
    db = _state.get("db")
    if db is not None:
        try:
            db.close()
        except Exception:
            pass
