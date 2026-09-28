"""
main.py — Orthodontic AI engine service (Phase 19B, engine 3 of 3, port 8005).

FastAPI wrapper around the audited MICCAI CLDetection2023 model (see
model.py / pipeline.py and ai-validation/cldetection2023 for the source
of truth).

    GET  /health  — status, model_loaded, model version/checksum, device,
                    architecture, the 38 landmark ids
    POST /infer   — lateral cephalogram bytes -> real CPU inference
                    (strict-guard checkpoint load, repository's own
                    pipeline) -> 38 structured landmarks

Startup is fail-closed: if the artifact at MODEL_PATH is missing, does
not match the registry SHA-256, names pickle globals outside the bounded
allow-list, or is not the audited 38-landmark architecture, the process
exits non-zero and the container never becomes healthy.
"""

from __future__ import annotations

import base64
import logging
import os
import sys

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import model as model_mod
from .pipeline import run_inference

log = logging.getLogger("orthodontic-ai")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "info").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

MAX_IMAGE_BYTES = 50 * 1024 * 1024  # mirrors the Next.js upload limit


class InferRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded lateral cephalometric X-ray (JPEG/PNG)")
    annotate: bool = True


def _build_app() -> tuple[FastAPI, model_mod.LoadedModel | None]:
    app = FastAPI(title="Orthodontic AI Engine", version="19B")
    state: dict = {}

    model_path = os.environ.get("MODEL_PATH", "/app/models/model_pretrained_on_train_and_val.pth")
    allow_standin = os.environ.get("ALLOW_STANDIN", "0").strip() == "1"
    try:
        state["model"] = model_mod.load_model(model_path, allow_standin=allow_standin)
        log.info(
            "model loaded (strict-guard loader, CPU) in %s ms", state["model"].load_time_ms
        )
    except model_mod.ModelRejectedError as exc:
        # Fail closed: refuse to serve. Compose shows the container as
        # starting/crashing and /health reports the reason — never
        # half-healthy.
        log.error("MODEL REJECTED: %s", exc)
        state["model"] = None
        state["reject_reason"] = str(exc)
    except Exception as exc:  # load failure, missing mmpose, ...
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
                "model_name": model_mod.ORTHODONTIC["name"],
                "model_version": model_mod.ORTHODONTIC["version"],
                "model_checksum": None,
                "model_checksum_expected": model_mod.ORTHODONTIC["expected_sha256"],
                "device": model_mod.ORTHODONTIC["device"],
                "error": state.get("reject_reason"),
            }
        return {
            "status": "ok",
            "model_loaded": True,
            "model_name": model_mod.ORTHODONTIC["name"],
            "model_version": model_mod.ORTHODONTIC["version"],
            "model_checksum": m.sha256,
            "model_checksum_expected": m.sha256_expected,
            "model_checksum_verified": m.sha256 == m.sha256_expected or m.is_standin,
            "model_path": str(m.path),
            "model_size_bytes": m.size_bytes,
            "model_source": model_mod.ORTHODONTIC["source"],
            "model_license": model_mod.ORTHODONTIC["license"],
            "model_load_time_ms": m.load_time_ms,
            "device": model_mod.ORTHODONTIC["device"],
            "is_standin_not_orthodontic": m.is_standin,
            "architecture": model_mod.ORTHODONTIC["architecture"],
            "parameter_count": m.parameter_count,
            "num_landmarks": model_mod.ORTHODONTIC["num_landmarks"],
            "landmarks": {str(k): v for k, v in sorted(m.landmark_names.items())},
            "landmarks_note": model_mod.ORTHODONTIC["landmarks_note"],
            "pickle_globals_registered": m.globals_found,
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

        try:
            result = run_inference(m, image_bytes, annotate=req.annotate)
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("inference failed: %s", exc)
            raise HTTPException(status_code=422, detail=f"inference failed: {exc}")

        out = dict(result)
        if not req.annotate:
            out.pop("annotated_png_hex", None)

        out["model"] = m.registry_entry
        out["device"] = model_mod.ORTHODONTIC["device"]
        out["runtime"] = {
            "loader": "mmpose init_model, strict torch.load weights_only default "
                      "+ bounded safe-globals allow-list (ai-validation/cldetection2023 §7)",
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
    if os.environ.get("STAY_UP_ON_REJECT") != "1":
        sys.exit(3)
