"""
provenance.py — D9/§13, provenance assembly.

Every completed analysis must be reproducible/auditable through:
study + original image hash + engine + model version + model checksum +
model source + model license + orchestrator version + processing time +
device + runtime + timestamp + raw output reference.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .registry import ORCHESTRATOR_VERSION, registry


def build_provenance(
    engine_name: str,
    engine_model: dict,
    validated: dict,
    image_sha256: str,
    raw_output_key: str,
    annotated_key: str | None,
) -> dict:
    """Assemble the provenance record stored on the job.

    engine_model: the engine's /infer `model` block (registry_entry) — its
    checksum is what actually ran; it is cross-checked against the registry
    during validation.
    """
    reg = registry.get(engine_name)
    now = datetime.now(timezone.utc).isoformat()
    return {
        "engine": engine_name,
        "model_version": engine_model.get("model_version"),
        "model_checksum": (engine_model.get("model_sha256") or "").lower(),
        "model_checksum_expected": (reg or {}).get("model_checksum"),
        "model_source": (reg or {}).get("model_source"),
        "model_license": (reg or {}).get("model_license"),
        "orchestrator_version": ORCHESTRATOR_VERSION,
        "image_sha256": (image_sha256 or "").lower(),
        "image_width": validated["image"].get("width"),
        "image_height": validated["image"].get("height"),
        "device": (reg or {}).get("device", "cpu"),
        "runtime": (reg or {}).get("runtime"),
        "processing_time_ms": validated["processing_time_ms"],
        "raw_output_key": raw_output_key,
        "annotated_image_key": annotated_key,
        "timestamp": now,
    }
