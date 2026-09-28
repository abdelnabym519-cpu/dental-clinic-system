"""
pipeline.py — Orthodontic AI engine inference (Phase 19B, engine 3 of 3).

The pipeline is the repository's own, unchanged (AUDIT.md §3): image ->
`remove_zero_padding` (vendored verbatim from cldetection_utils.py @
18d17d19) -> `inference_topdown(model, img, bboxes=None)` (whole-image
bbox, exactly what the repository's own val loop does) ->
`merge_data_samples` -> 38 keypoints + scores.

No retraining, no conversion, no reinterpretation of the model.
"""

from __future__ import annotations

import hashlib
import time

import cv2
import numpy as np

from .model import ORTHODONTIC, LoadedModel

# Landmark overlay colour (Phase 19B spec D15: 38 landmark dots).
LANDMARK_COLOR = (0, 0, 255)  # BGR red — visible on radiographs


def remove_zero_padding(image_array: np.ndarray) -> np.ndarray:
    """Vendored VERBATIM from the audited repository
    (5k5000/CLdetection2023 @ 18d17d1934970016e7610c4849311900b8d1f191,
    cldetection_utils.py) — the exact preprocessing the repository's own
    validation loop applies. (The original module imports SimpleITK at
    import time; only this function is needed here, which is pure numpy,
    so it is copied rather than imported.)

    Removes the zero padding around the radiograph by cropping to the last
    non-zero row/column.
    """
    row = np.sum(image_array, axis=(1, 2))
    column = np.sum(image_array, axis=(0, 2))

    non_zero_row_indices = np.argwhere(row != 0)
    non_zero_column_indices = np.argwhere(column != 0)

    last_row = int(non_zero_row_indices[-1])
    last_column = int(non_zero_column_indices[-1])

    image_array = image_array[:last_row + 1, :last_column + 1, :]
    return image_array


def draw_landmarks(img: np.ndarray, records: list[dict]) -> np.ndarray:
    """Numbered overlay of the 38 landmarks (mirrors the lab's overlay)."""
    canvas = img.copy()
    for rec in records:
        x, y = rec["x"], rec["y"]
        if 0 <= x < canvas.shape[1] and 0 <= y < canvas.shape[0]:
            cv2.circle(canvas, (int(round(x)), int(round(y))), 6, LANDMARK_COLOR, -1)
            cv2.putText(
                canvas, str(rec["id"] + 1), (int(x) + 8, int(y) - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2,
            )
    return canvas


def run_inference(model: LoadedModel, image_bytes: bytes, annotate: bool = True) -> dict:
    t_total0 = time.perf_counter()

    t0 = time.perf_counter()
    img = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("image could not be decoded")
    timings = {"decode_ms": int((time.perf_counter() - t0) * 1000)}
    orig_h, orig_w = img.shape[:2]

    # the repository's own preprocessing, exactly as the val loop applies it
    t0 = time.perf_counter()
    img = remove_zero_padding(img)
    timings["crop_ms"] = int((time.perf_counter() - t0) * 1000)
    crop_h, crop_w = img.shape[:2]

    t0 = time.perf_counter()
    import torch
    from mmpose.apis import inference_topdown
    from mmpose.structures import merge_data_samples

    with torch.no_grad():
        preds = inference_topdown(model=model.pose_model, img=img, bboxes=None, bbox_format="xyxy")
    result = merge_data_samples(preds)
    keypoints = result.pred_instances.keypoints[0]
    scores = getattr(result.pred_instances, "keypoint_scores", None)
    timings["inference_ms"] = int((time.perf_counter() - t0) * 1000)

    if keypoints.shape[0] != ORTHODONTIC["num_landmarks"]:
        raise ValueError(
            f"model produced {keypoints.shape[0]} landmarks, expected "
            f"{ORTHODONTIC['num_landmarks']}"
        )

    t0 = time.perf_counter()
    records = []
    for i in range(keypoints.shape[0]):
        x, y = float(keypoints[i, 0]), float(keypoints[i, 1])
        score = float(scores[0][i]) if scores is not None else None
        records.append({
            "id": i,
            "name": model.landmark_names.get(i, str(i)),
            "x": round(x, 2),
            "y": round(y, 2),
            "score": round(score, 6) if score is not None else None,
        })
    timings["postprocess_ms"] = int((time.perf_counter() - t0) * 1000)

    annotated_png_hex: str | None = None
    if annotate:
        t0 = time.perf_counter()
        canvas = draw_landmarks(img, records)
        ok, buf = cv2.imencode(".png", canvas)
        if not ok:
            raise ValueError("annotated overlay could not be encoded")
        annotated_png_hex = buf.tobytes().hex()
        timings["draw_ms"] = int((time.perf_counter() - t0) * 1000)

    timings["total_ms"] = int((time.perf_counter() - t_total0) * 1000)

    return {
        "is_standin_not_orthodontic": model.is_standin,
        "image": {
            "width": int(orig_w),
            "height": int(orig_h),
            "sha256": hashlib.sha256(image_bytes).hexdigest(),
        },
        # remove_zero_padding crops the radiograph — landmarks are in the
        # CROPPED original image's pixel space (the repository's own
        # convention; the challenge's ground truth uses the same crop).
        "image_after_padding_crop": {
            "width": int(crop_w),
            "height": int(crop_h),
            "coordinate_space": "cropped_original_image",
        },
        "landmark_count": len(records),
        "landmarks": records,
        "scores_mean": (
            round(float(np.mean([r["score"] for r in records])), 6)
            if scores is not None else None
        ),
        "raw_model_output": {
            "estimator": type(model.pose_model).__name__,
            "backbone": type(model.pose_model.backbone).__name__,
            "head": type(model.pose_model.head).__name__,
            "num_joints": int(getattr(model.pose_model.head, "num_joints", 0)),
            "flip_test": bool(model.pose_model.cfg.model.test_cfg.get("flip_test", False)),
            "metainfo": "cephalometric (38 keypoints)",
        },
        "timings_ms": timings,
        "annotated_png_hex": annotated_png_hex,
    }
