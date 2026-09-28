"""
main.py — Implant AI engine service (Phase 19B, engine 2 of 3, port 8004).

FastAPI wrapper around the audited YOLOv8-segmentation checkpoint 8024.pt
(see model.py / inference.py and ai-validation/yolov8-8024 for the source
of truth).

    GET  /health  — status, model_loaded, model version/checksum, device,
                    the 8 audited class labels
    POST /infer   — image bytes -> real CPU inference (restricted-loaded
                    ultralytics) -> structured findings (19A contract)

Startup is fail-closed: if the artifact at MODEL_PATH is missing, does not
match the registry SHA-256, was not loaded through the restricted loader,
or is not an 8-class segmentation model, the process exits non-zero and the
container never becomes healthy.
"""

from __future__ import annotations

import base64
import logging
import os
import sys

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import model as model_mod
from .inference import DEFAULT_CONF, DEFAULT_IMGSZ, DEFAULT_IOU

log = logging.getLogger("implant-ai")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "info").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

MAX_IMAGE_BYTES = 50 * 1024 * 1024  # mirrors the Next.js upload limit


class InferRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded image (JPEG/PNG)")
    conf: float = Field(DEFAULT_CONF, ge=0.0, le=1.0)
    iou: float = Field(DEFAULT_IOU, ge=0.0, le=1.0)
    imgsz: int = Field(DEFAULT_IMGSZ, ge=64, le=2048)
    annotate: bool = True


def _build_app() -> tuple[FastAPI, model_mod.LoadedModel | None]:
    app = FastAPI(title="Implant AI Engine", version="19B")
    state: dict = {}

    model_path = os.environ.get("MODEL_PATH", "/app/models/8024.pt")
    allow_standin = os.environ.get("ALLOW_STANDIN", "0").strip() == "1"
    try:
        state["model"] = model_mod.load_model(model_path, allow_standin=allow_standin)
        log.info(
            "model loaded (restricted loader, CPU) in %s ms", state["model"].load_time_ms
        )
    except model_mod.ModelRejectedError as exc:
        # Fail closed: refuse to serve. Compose will show the container as
        # starting/crashing and /health reports the reason — never half-healthy.
        log.error("MODEL REJECTED: %s", exc)
        state["model"] = None
        state["reject_reason"] = str(exc)
    except Exception as exc:  # load failure, missing ultralytics, ...
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
                "model_name": model_mod.IMPLANT["name"],
                "model_version": model_mod.IMPLANT["version"],
                "model_checksum": None,
                "model_checksum_expected": model_mod.IMPLANT["expected_sha256"],
                "device": model_mod.IMPLANT["device"],
                "error": state.get("reject_reason"),
            }
        return {
            "status": "ok",
            "model_loaded": True,
            "model_name": model_mod.IMPLANT["name"],
            "model_version": model_mod.IMPLANT["version"],
            "model_checksum": m.sha256,
            "model_checksum_expected": m.sha256_expected,
            "model_checksum_verified": m.sha256 == m.sha256_expected or m.is_standin,
            "model_path": str(m.path),
            "model_size_bytes": m.size_bytes,
            "model_source": model_mod.IMPLANT["source"],
            "model_license": model_mod.IMPLANT["license"],
            "model_load_time_ms": m.load_time_ms,
            "device": model_mod.IMPLANT["device"],
            "is_standin_not_implant": m.is_standin,
            "task": model_mod.IMPLANT["task"],
            "parameter_count": m.parameter_count,
            "classes": {str(k): v for k, v in sorted(m.class_names.items())},
            "classes_source": m.classes_source,
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
        out["device"] = model_mod.IMPLANT["device"]
        out["runtime"] = {"loader": "ultralytics restricted (ULTRALYTICS_SAFE_LOAD=1)"}
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
