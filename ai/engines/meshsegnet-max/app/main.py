"""main.py — MeshSegNet-Max engine service (Phase 19B, D2).

FastAPI wrapper around the validated MeshSegNet pipeline (see model.py /
pipeline.py and ai-validation/meshsegnet for the source of truth).

    GET  /health  — status, model_loaded, model version/checksum, device
    POST /infer   — 3D mesh bytes (obj/stl/vtk/ply) -> real CPU inference
                    -> per-cell labels + 15-class segment counts

Startup is fail-closed, mirroring the Liodon engine: if the artifact at
MODEL_PATH is missing, does not match the registry SHA-256, or (for the
real model) does not load strict into the official architecture, the
process exits non-zero and the container never becomes healthy. A synthetic
stand-in is loadable only with ALLOW_STANDIN=1 and self-declaration, and is
flagged is_standin_not_meshsegnet=true on every response — the orchestrator
refuses to persist stand-in findings.
"""

from __future__ import annotations

import base64
import logging
import os
import sys
import time

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import model as model_mod
from .pipeline import CLASS_NAMES, MeshFormatError, MeshParseError, load_mesh, run_inference

log = logging.getLogger("meshsegnet-max")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "info").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

MAX_MESH_BYTES = 50 * 1024 * 1024  # mirrors the Next.js upload limit


class InferRequest(BaseModel):
    mesh: str = Field(..., description="Base64-encoded triangular surface mesh (obj/stl/vtk/ply)")
    format: str = Field("obj", description="Mesh container format: obj | stl | vtk | ply")


def _build_app() -> tuple[FastAPI, model_mod.LoadedModel | None]:
    app = FastAPI(title="MeshSegNet-Max Engine", version="19B")
    state: dict = {}

    model_path = os.environ.get(
        "MODEL_PATH", "/app/models/MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip"
    )
    allow_standin = os.environ.get("ALLOW_STANDIN", "0").strip() == "1"
    try:
        state["model"] = model_mod.load_model(
            model_path,
            expected_sha256=model_mod.MESHSEGNET["expected_sha256"],
            expected_size=model_mod.MESHSEGNET["expected_size_bytes"],
            allow_standin=allow_standin,
        )
        log.info(
            "model loaded (CPU, torch %s) in %s ms%s",
            torch.__version__, state["model"].load_time_ms,
            " [STAND-IN]" if state["model"].is_standin else "",
        )
    except model_mod.ModelRejectedError as exc:
        log.error("MODEL REJECTED: %s", exc)
        state["model"] = None
        state["reject_reason"] = str(exc)
    except Exception as exc:
        log.exception("failed to load model: %s", exc)
        state["model"] = None
        state["reject_reason"] = f"{type(exc).__name__}: {exc}"

    def _model_block(m: model_mod.LoadedModel) -> dict:
        reg = model_mod.MESHSEGNET
        return {
            "model_name": reg["name"],
            "model_version": reg["version"],
            "model_sha256": m.sha256,
            "model_sha256_expected": m.sha256_expected,
            "model_checksum_verified": m.sha256 == m.sha256_expected or m.is_standin,
            "model_size_bytes": m.size_bytes,
            "model_source": reg["source"],
            "model_license": reg["license"],
            "jaw": reg["jaw"],
            "num_classes": len(CLASS_NAMES),
            "classes": {str(i): name for i, name in enumerate(CLASS_NAMES)},
            "classes_note": reg["classes_note"],
            "parameter_count": m.parameter_count,
        }

    @app.get("/health")
    def health():
        m = state["model"]
        reg = model_mod.MESHSEGNET
        if m is None:
            # 200 with status=error keeps the container "up" so the reject
            # reason is readable; model_loaded=false is the gate signal.
            return {
                "status": "error",
                "model_loaded": False,
                "model_name": reg["name"],
                "model_version": reg["version"],
                "model_checksum": None,
                "model_checksum_expected": reg["expected_sha256"],
                "device": reg["device"],
                "runtime": {"torch_version": torch.__version__},
                "error": state.get("reject_reason"),
            }
        return {
            "status": "ok",
            "model_loaded": True,
            **_model_block(m),
            "model_path": str(m.path),
            "model_load_time_ms": m.load_time_ms,
            "device": reg["device"],
            "is_standin_not_meshsegnet": m.is_standin,
            "runtime": {"torch_version": torch.__version__, "cpu_threads": torch.get_num_threads()},
        }

    @app.post("/infer")
    def infer(req: InferRequest) -> dict:
        m = state["model"]
        if m is None:
            raise HTTPException(status_code=503, detail="Model not loaded — see /health")

        try:
            mesh_bytes = base64.b64decode(req.mesh, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="mesh must be valid base64")
        if not mesh_bytes:
            raise HTTPException(status_code=400, detail="mesh is empty")
        if len(mesh_bytes) > MAX_MESH_BYTES:
            raise HTTPException(status_code=413, detail="mesh exceeds 50MB limit")

        try:
            points, faces, cells_original = load_mesh(mesh_bytes, req.format)
            result = run_inference(m.model, points, faces, cells_original)
        except (MeshParseError, MeshFormatError) as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("inference failed: %s", exc)
            raise HTTPException(status_code=422, detail=f"inference failed: {exc}")

        return {
            "is_standin_not_meshsegnet": m.is_standin,
            "segments": result.segments,
            "labels": result.labels,
            "num_points_total": result.num_points_total,
            "cells_original": result.cells_original,
            "downsampled": result.downsampled,
            "probabilities_shape": list(result.probabilities_shape),
            "processing_time_ms": result.processing_time_ms,
            "model": _model_block(m),
            "device": model_mod.MESHSEGNET["device"],
            "runtime": {"torch_version": torch.__version__},
        }

    return app, state["model"]


app, _model = _build_app()

# Fail closed at process level too: if the model was refused, the service
# must not stay "running" (same policy as the Liodon engine).
if _model is None and os.environ.get("MODEL_PATH"):
    log.error("refusing to stay up without a verified model")
    if os.environ.get("STAY_UP_ON_REJECT") != "1":
        sys.exit(3)
