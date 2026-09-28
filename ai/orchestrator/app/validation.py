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


def validate_meshsegnet_response(body: dict, expected_checksum: str | None = None,
                                 engine_name: str = "meshsegnet-max") -> dict:
    """Validate a MeshSegNet /infer response (Phase 19B, D4).

    Same trust model as the Liodon validator: checksum must match the
    registry, a stand-in (synthetic) result is always refused, and every
    segment must be a registered class. Returns the normalized findings
    (the 15-class segment histogram — 3D data has no bounding boxes).
    """
    if not isinstance(body, dict):
        raise ValidationResultError("engine response is not an object")

    if body.get("is_standin_not_meshsegnet"):
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

    engine = registry.get(engine_name)
    if engine is None:
        raise ValidationResultError(f"unknown engine {engine_name!r}")
    known_classes = engine["classes"]  # {id: neutral name}

    segs = body.get("segments")
    if not isinstance(segs, list) or not segs:
        raise ValidationResultError("segments missing or empty")

    findings = []
    total = 0
    seen_ids: set[int] = set()
    for i, s in enumerate(segs):
        if not isinstance(s, dict):
            raise ValidationResultError(f"segments[{i}] is not an object")
        cid = s.get("class_id")
        if not isinstance(cid, int) or isinstance(cid, bool) or cid not in known_classes:
            raise ValidationResultError(
                f"segments[{i}] has unknown class_id {cid!r} (known: {sorted(known_classes)})"
            )
        if s.get("class_name") != known_classes[cid]:
            raise ValidationResultError(
                f"segments[{i}] class_name {s.get('class_name')!r} does not match "
                f"registry name {known_classes[cid]!r} for id {cid}"
            )
        count = s.get("point_count")
        if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
            raise ValidationResultError(f"segments[{i}].point_count must be a positive int")
        if cid in seen_ids:
            raise ValidationResultError(f"segments contains duplicate class_id {cid}")
        seen_ids.add(cid)
        total += count
        findings.append({"class_id": cid, "class_name": known_classes[cid], "point_count": count})

    n_total = body.get("num_points_total")
    if not isinstance(n_total, int) or isinstance(n_total, bool) or n_total <= 0:
        raise ValidationResultError("num_points_total missing or not a positive int")
    if total != n_total:
        raise ValidationResultError(
            f"segment counts sum to {total} but num_points_total is {n_total}"
        )
    # Official pipeline: meshes above 10,000 cells are decimated to exactly
    # 10,000 — a result claiming more cells than that did not run the
    # validated pipeline.
    official_cap = engine.get("tensor_input", [None, None, 10000])[2]
    if n_total > official_cap:
        raise ValidationResultError(
            f"num_points_total {n_total} exceeds the official {official_cap}-cell cap"
        )

    labels = body.get("labels")
    if labels is not None:
        if not isinstance(labels, list) or len(labels) != n_total:
            raise ValidationResultError("labels length does not match num_points_total")
        for i, l in enumerate(labels):
            if not isinstance(l, int) or isinstance(l, bool) or l not in known_classes:
                raise ValidationResultError(f"labels[{i}] is not a known class id: {l!r}")

    processing = _finite(body.get("processing_time_ms", 0), "processing_time_ms")
    if processing < 0:
        raise ValidationResultError("negative processing time")

    return {
        "findings": findings,
        "top_confidence": None,  # 15-class softmax labels carry no finding-level confidence
        "image": None,           # 3D input — no image dimensions in provenance
        "num_points_total": n_total,
        "cells_original": body.get("cells_original"),
        "downsampled": body.get("downsampled"),
        "raw_model_output": {"labels": labels, "probabilities_shape": body.get("probabilities_shape")},
        "processing_time_ms": processing,
    }
