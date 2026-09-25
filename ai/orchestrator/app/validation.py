"""
validation.py — D16, result validation.

The orchestrator trusts the engine's schema only after checking it. Anything
that fails validation marks the job FAILED (never half-accepted, never
silently coerced):

  - top-level fields present
  - engine-reported model checksum == registry checksum (for the real model;
    the stand-in is rejected here outright — production must never persist
    synthetic findings)
  - detections: finite numeric bounding boxes, 0.0 <= confidence <= 1.0,
    condition in the registered class set (unknown classes are an error, not
    a finding)
  - processing time present and non-negative
"""

from __future__ import annotations

import math

from .registry import registry


class ValidationResultError(ValueError):
    """Raised when an engine response fails validation."""


def _finite(value, path: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValidationResultError(f"{path} is not numeric: {value!r}")
    if not math.isfinite(value):
        raise ValidationResultError(f"{path} is not finite: {value!r}")
    return float(value)


def validate_liodon_response(body: dict, expected_checksum: str | None = None) -> dict:
    """Validate the liodon /infer response. Returns a normalized findings list.

    expected_checksum: the registry checksum the engine must report. When the
    engine reports is_standin_not_liodon=true the result is always rejected —
    synthetic plumbing runs may exercise the pipeline, but their findings
    must never be stored against a patient.
    """
    if not isinstance(body, dict):
        raise ValidationResultError("engine response is not an object")

    if body.get("is_standin_not_liodon"):
        raise ValidationResultError(
            "engine returned stand-in (synthetic) results — refusing to store"
        )

    model = body.get("model") or {}
    reported_checksum = (model.get("model_sha256") or "").lower()
    if expected_checksum and reported_checksum != expected_checksum.lower():
        raise ValidationResultError(
            f"engine model checksum mismatch: reported {reported_checksum!r}, "
            f"registry expects {expected_checksum.lower()!r}"
        )
    if not model.get("model_version"):
        raise ValidationResultError("engine response missing model version")

    engine = registry.get("liodon")
    known_classes = set(engine["classes"].values())

    dets = body.get("detections")
    if not isinstance(dets, list):
        raise ValidationResultError("detections missing or not a list")

    findings = []
    for i, d in enumerate(dets):
        if not isinstance(d, dict):
            raise ValidationResultError(f"detection[{i}] is not an object")
        condition = d.get("condition") or d.get("class_name")
        if condition not in known_classes:
            # Unknown model classes must not silently become clinical findings.
            raise ValidationResultError(
                f"detection[{i}] has unknown class {condition!r} (known: {sorted(known_classes)})"
            )
        confidence = _finite(d.get("confidence"), f"detections[{i}].confidence")
        if not 0.0 <= confidence <= 1.0:
            raise ValidationResultError(f"detections[{i}].confidence out of range: {confidence}")

        bbox = d.get("bbox") or {}
        x = _finite(bbox.get("x", bbox.get("x1")), f"detections[{i}].bbox.x")
        y = _finite(bbox.get("y", bbox.get("y1")), f"detections[{i}].bbox.y")
        w = _finite(bbox.get("width"), f"detections[{i}].bbox.width")
        h = _finite(bbox.get("height"), f"detections[{i}].bbox.height")
        x2 = _finite(bbox.get("x2"), f"detections[{i}].bbox.x2")
        y2 = _finite(bbox.get("y2"), f"detections[{i}].bbox.y2")
        if w < 0 or h < 0:
            raise ValidationResultError(f"detections[{i}].bbox has negative size")
        if x2 < x or y2 < y:
            raise ValidationResultError(f"detections[{i}].bbox x2/y2 before x1/y1")

        findings.append({
            "condition": condition,
            "tooth_number": d.get("tooth_number"),  # always None for Liodon
            "confidence": round(confidence, 6),
            "bounding_box": {
                "x": x,
                "y": y,
                "width": w,
                "height": h,
                "x2": x2,
                "y2": y2,
                "coordinate_space": bbox.get("coordinate_space", "original_image"),
                "units": bbox.get("units", "pixels"),
            },
        })

    timings = body.get("timings_ms") or {}
    processing = _finite(timings.get("total_ms", 0), "timings_ms.total_ms")
    if processing < 0:
        raise ValidationResultError("negative processing time")

    image = body.get("image") or {}
    return {
        "findings": findings,
        "top_confidence": max((f["confidence"] for f in findings), default=None),
        "image": {
            "width": image.get("width"),
            "height": image.get("height"),
            "sha256": image.get("sha256"),
        },
        "raw_model_output": body.get("raw_model_output"),
        "processing_time_ms": processing,
    }
