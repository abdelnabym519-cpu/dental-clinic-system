"""
main.py — Liodon engine service (Phase 19A).

FastAPI wrapper around the validated Liodon pipeline (see model.py /
inference.py and ai-validation/liodon for the source of truth).

    GET  /health  — status, model_loaded, model version/checksum, device
    POST /infer   — image bytes -> real CPU inference -> structured findings

Startup is fail-closed: if the artifact at MODEL_PATH is missing, not ONNX,
or (for the real model) does not match the registry SHA-256, the process
exits non-zero and the container never becomes healthy.
"""

from __future__ import annotations

import base64
import logging
import os
import sys

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import model as model_mod
from .inference import DEFAULT_CONF, DEFAULT_IMGSZ, DEFAULT_IOU

log = logging.getLogger("liodon")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "info").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

MAX_IMAGE_BYTES = 50 * 1024 * 1024  # mirrors the Next.js upload limit


class InferRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded image (JPEG/PNG/WebP)")
    conf: float = Field(DEFAULT_CONF, ge=0.0, le=1.0)
    iou: float = Field(DEFAULT_IOU, ge=0.0, le=1.0)
    imgsz: int = Field(DEFAULT_IMGSZ, ge=64, le=2048)
    annotate: bool = True


class InferResponse(BaseModel):
    is_standin_not_liodon: bool
    image: dict
    detection_count: int
    counts_by_class: dict
    detections: list
    raw_model_output: dict
    timings_ms: dict
    parameters: dict
    model: dict
    device: str
    runtime: dict


def _build_app() -> tuple[FastAPI, model_mod.LoadedModel | None]:
    app = FastAPI(title="Liodon Engine", version="19A")
    state: dict = {}

    model_path = os.environ.get("MODEL_PATH", "/app/models/liodon/best.onnx")
    allow_standin = os.environ.get("ALLOW_STANDIN", "0").strip() == "1"
    try:
        state["model"] = model_mod.load_model(model_path, allow_standin=allow_standin)
        log.info("model loaded (CPUExecutionProvider) in %s ms", state["model"].load_time_ms)
    except model_mod.ModelRejectedError as exc:
        # Fail closed: refuse to serve. Compose will show the container as
        # starting/crashing and /health is unreachable — never half-healthy.
        log.error("MODEL REJECTED: %s", exc)
        state["model"] = None
        state["reject_reason"] = str(exc)
    except Exception as exc:  # session-creation failure, missing numpy, ...
        log.exception("failed to load model: %s", exc)
        state["model"] = None
        state["reject_reason"] = f"{type(exc).__name__}: {exc}"

    @app.get("/health")
    def health():
        m = state["model"]
        if m is None:
            # 200 with status=error keeps the container "up" so the reject
            # reason is readable; model_loaded=false is the gate signal.
            return {
                "status": "error",
                "model_loaded": False,
                "model_name": model_mod.LIODON["name"],
                "model_version": model_mod.LIODON["version"],
                "model_checksum": None,
                "model_checksum_expected": model_mod.LIODON["expected_sha256"],
                "device": model_mod.LIODON["device"],
                "runtime": {
                    "onnxruntime_version": ort.__version__,
                    "available_providers": ort.get_available_providers(),
                },
                "error": state.get("reject_reason"),
            }
        return {
            "status": "ok",
            "model_loaded": True,
            "model_name": model_mod.LIODON["name"],
            "model_version": model_mod.LIODON["version"],
            "model_checksum": m.sha256,
            "model_checksum_expected": m.sha256_expected,
            "model_checksum_verified": m.sha256 == m.sha256_expected or m.is_standin,
            "model_path": str(m.path),
            "model_size_bytes": m.size_bytes,
            "model_source": model_mod.LIODON["source"],
            "model_license": model_mod.LIODON["license"],
            "model_load_time_ms": m.load_time_ms,
            "device": model_mod.LIODON["device"],
            "is_standin_not_liodon": m.is_standin,
            "classes": {str(k): v for k, v in sorted(m.class_names.items())},
            "classes_source": m.classes_source,
            "tensor_input": {"name": m.input_name, "shape": m.input_shape},
            "tensor_output": {"name": m.output_name, "shape": m.output_shape},
            "runtime": {
                "onnxruntime_version": ort.__version__,
                "execution_provider": "CPUExecutionProvider",
                "active_providers": m.session.get_providers(),
            },
            "defaults": {"conf": DEFAULT_CONF, "iou": DEFAULT_IOU, "imgsz": DEFAULT_IMGSZ},
        }

    @app.post("/infer")
    def infer(req: InferRequest) -> dict:
        m = state["model"]
        if m is None:
            raise HTTPException(status_code=503, detail="Model not loaded — see /health")

        try:
            image_bytes = base64.b64decode(req.image, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="image must be valid base64")
        if not image_bytes:
            raise HTTPException(status_code=400, detail="image is empty")
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="image exceeds 50MB limit")

        # Guard: numpy arrays from a crafted payload are not a concern here
        # (bytes in, PIL decode), but a decode failure is a 400, not a 500.
        try:
            result = model_mod.run_inference(
                m,
                image_bytes,
                conf=req.conf,
                iou=req.iou,
                imgsz=req.imgsz,
                annotate=req.annotate,
            )
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("inference failed: %s", exc)
            raise HTTPException(status_code=422, detail=f"inference failed: {exc}")

        # Strip the annotated image from the JSON body when a caller does not
        # want it; otherwise pass it through so the orchestrator can persist
        # it as a SEPARATE object (originals stay immutable).
        out = dict(result)
        if not req.annotate:
            out.pop("annotated_png_hex", None)

        out["model"] = m.registry_entry
        out["device"] = model_mod.LIODON["device"]
        out["runtime"] = {
            "onnxruntime_version": ort.__version__,
            "execution_provider": "CPUExecutionProvider",
        }
        return out

    return app, state["model"]


app, _model = _build_app()

# Fail closed at process level too: if the model was refused, the service
# must not stay "running" — exit so the container restart policy and
# /health both make the failure visible. (The 503/health-error paths above
# cover the in-window case; this covers "never became usable".)
if _model is None and os.environ.get("MODEL_PATH"):
    log.error("refusing to stay up without a verified model")
    # Keep the process alive in dev (ALLOW_STANDIN / debugging) only when
    # explicitly told to; in a container the default is to exit.
    if os.environ.get("STAY_UP_ON_REJECT") != "1":
        sys.exit(3)
