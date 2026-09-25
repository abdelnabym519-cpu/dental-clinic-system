"""
model.py — Liodon artifact registry + model loading.

The registry below is the exact validated artifact, mirrored from
ai-validation/liodon (MODEL_PROVENANCE.md and scripts/run_liodon.py):

    publisher   : liodon-ai
    repository  : liodon-ai/dental-panoramic-detector
    revision    : 8bef2036b099e80e51f93f24de4b0c0edd366256
    file        : best.onnx
    size        : 10,605,711 bytes
    SHA-256     : 4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71
    license     : CC-BY-NC-4.0
    arch        : YOLO11-N (Ultralytics) -> ONNX
    tensor in   : [1, 3, 640, 640] float32 (input name `images`)
    tensor out  : [1, 7, 8400] float32   (output name `output0`)
    classes     : 0 caries, 1 periapical_lesion, 2 impacted_tooth

Load policy (identical to the validated runner's preflight):
  1. file must exist
  2. extension must be .onnx
  3. SHA-256 computed from the bytes on disk
  4. best.onnx: mismatch with the registry hash is a HARD STOP (raise
     ModelRejectedError) — the service refuses to start. No override.
  5. The synthetic stand-in (model/STANDIN_NOT_LIODON.onnx) is accepted ONLY
     when ALLOW_STANDIN=1 AND the file declares itself synthetic in its own
     ONNX metadata (STANDIN_NOT_LIODON=true). Every response it produces is
     flagged is_standin_not_liodon=true. A real weight file with a wrong hash
     can never take this path.
  6. Session is created with providers=["CPUExecutionProvider"] only.
     If the CPU provider is unavailable, startup fails.
"""

from __future__ import annotations

import ast
import hashlib
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .inference import FALLBACK_CLASSES, DEFAULT_IMGSZ

log = logging.getLogger("liodon")

# ---------------------------------------------------------------------------
# Registry — the exact validated artifact (D4, engine side).
# ---------------------------------------------------------------------------

LIODON = {
    "name": "liodon",
    "version": "1.0.0",
    "publisher": "liodon-ai",
    "source": (
        "https://huggingface.co/liodon-ai/dental-panoramic-detector"
        f"@8bef2036b099e80e51f93f24de4b0c0edd366256"
    ),
    "source_repo": "liodon-ai/dental-panoramic-detector",
    "source_revision": "8bef2036b099e80e51f93f24de4b0c0edd366256",
    "license": "CC-BY-NC-4.0",
    "architecture": "YOLO11-N (Ultralytics), exported to ONNX",
    "runtime": "onnxruntime",
    "device": "cpu",
    "filename": "best.onnx",
    "expected_sha256": "4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71",
    "expected_size_bytes": 10_605_711,
    "input_spec": "JPEG/PNG panoramic dental X-ray",
    "tensor_input": [1, 3, 640, 640],
    "tensor_output": [1, 7, 8400],
    "classes": {0: "caries", 1: "periapical_lesion", 2: "impacted_tooth"},
}


class ModelRejectedError(RuntimeError):
    """Raised when the artifact at MODEL_PATH is not the validated model."""


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def _parse_names(raw):
    """Parse an ONNX custom-metadata `names` field into {id: name}."""
    try:
        value = ast.literal_eval(raw)
    except Exception:
        return None
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            try:
                out[int(k)] = str(v)
            except (TypeError, ValueError):
                return None
        return dict(sorted(out.items()))
    if isinstance(value, (list, tuple)):
        return {i: str(v) for i, v in enumerate(value)}
    return None


@dataclass
class LoadedModel:
    session: object  # live onnxruntime.InferenceSession (CPU only)
    path: Path
    size_bytes: int
    sha256: str
    sha256_expected: str
    is_standin: bool
    class_names: dict
    classes_source: str
    input_name: str
    output_name: str
    input_shape: list
    output_shape: list
    load_time_ms: float
    metadata: dict = field(default_factory=dict)

    @property
    def registry_entry(self) -> dict:
        """D4 registry view of what is actually loaded."""
        entry = dict(LIODON)
        entry["model_version"] = LIODON["version"]
        entry["model_path"] = str(self.path)
        entry["model_sha256"] = self.sha256
        entry["model_size_bytes"] = self.size_bytes
        entry["is_standin_not_liodon"] = self.is_standin
        entry["tensor_input_actual"] = self.input_shape
        entry["tensor_output_actual"] = self.output_shape
        entry["classes"] = {str(k): v for k, v in sorted(self.class_names.items())}
        return entry


def read_model_metadata(sess) -> dict:
    """Pull the Ultralytics ONNX export metadata out of the session (best-effort)."""
    meta = {}
    try:
        meta_obj = sess.get_modelmeta()
        custom = dict(getattr(meta_obj, "custom_metadata_map", {}) or {})
        meta["custom_metadata_raw"] = {k: str(v) for k, v in custom.items()}
        meta["producer_name"] = getattr(meta_obj, "producer_name", None)
        meta["graph_name"] = getattr(meta_obj, "graph_name", None)
        meta["version"] = getattr(meta_obj, "version", None)
        meta["description"] = getattr(meta_obj, "description", None)

        names = custom.get("names")
        if names:
            parsed = _parse_names(names)
            if parsed:
                meta["classes_from_model"] = parsed

        for key, cast in (("imgsz", int), ("stride", int), ("batch", int)):
            if custom.get(key):
                try:
                    meta[f"{key}_from_model"] = cast(str(custom[key]))
                except ValueError:
                    pass
        if custom.get("task"):
            meta["task_from_model"] = str(custom["task"])
    except Exception as exc:  # metadata is best-effort
        meta["metadata_error"] = f"{type(exc).__name__}: {exc}"
    return meta


def load_model(model_path: str | Path, allow_standin: bool = False) -> LoadedModel:
    """Load the ONNX session for the configured artifact, or refuse to start."""
    import onnxruntime as ort

    model_path = Path(model_path)

    # 1 + 2: existence and extension — no substitute, converted or re-exported
    # weight file may be used.
    if not model_path.exists():
        raise ModelRejectedError(f"Model file not found: {model_path}")
    if model_path.suffix.lower() != ".onnx":
        raise ModelRejectedError(f"Model file must be ONNX: {model_path}")

    # 3: hash the actual bytes on disk.
    size = model_path.stat().st_size
    digest = sha256_of(model_path)
    hash_ok = digest.lower() == LIODON["expected_sha256"]

    log.info(
        "model file=%s size=%d bytes sha256=%s expected=%s match=%s standin_allowed=%s",
        model_path, size, digest, LIODON["expected_sha256"], hash_ok, allow_standin,
    )

    # 4/5: the hash gate is mandatory for any real artifact; the stand-in is
    # the only path past a mismatch, and it must opt in AND self-declare.
    if not hash_ok and not allow_standin:
        raise ModelRejectedError(
            "Artifact does not match the published SHA-256 "
            f"(got {digest}). Per the validation protocol a mismatched "
            "artifact stops the service. Re-download the published file "
            "(ai-validation/liodon/scripts/download_liodon.py). Do not "
            "retrain, convert or re-export."
        )

    # 6: CPU-only session, refuse if the CPU provider is missing.
    available = ort.get_available_providers()
    if "CPUExecutionProvider" not in available:
        raise ModelRejectedError(
            f"CPUExecutionProvider is not available (providers: {available}). "
            "Install the CPU build of onnxruntime."
        )

    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    t0 = time.perf_counter()
    try:
        sess = ort.InferenceSession(
            str(model_path), sess_options=opts, providers=["CPUExecutionProvider"]
        )
    except Exception as exc:
        # Corrupt/unreadable artifact: fail closed like the validated runner
        # (which exits non-zero here). Never serve a model we could not open.
        raise ModelRejectedError(f"Could not create the ONNX session: {exc}") from exc
    load_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    inputs = sess.get_inputs()
    outputs = sess.get_outputs()
    meta = read_model_metadata(sess)

    # Class names: authoritative from the model's own metadata, model-card
    # fallback otherwise (same precedence as the validated runner).
    class_names = {int(k): str(v) for k, v in (meta.get("classes_from_model") or {}).items()}
    classes_source = "onnx_metadata" if class_names else "model_card_fallback"
    if not class_names:
        class_names = {i: n for i, n in enumerate(FALLBACK_CLASSES)}

    # Guard against ever mistaking stand-in output for a real Liodon result:
    # the stand-in declares itself synthetic inside its own ONNX metadata.
    is_standin = (
        str(meta.get("custom_metadata_raw", {}).get("STANDIN_NOT_LIODON", "")).lower()
        == "true"
    )

    if not hash_ok:
        if not is_standin:
            # allow_standin was set but the file does not declare itself a
            # stand-in: it is a real weight file with a wrong hash. Stop.
            raise ModelRejectedError(
                "ALLOW_STANDIN is set but the file does not declare itself the "
                "synthetic stand-in (missing STANDIN_NOT_LIODON=true metadata). "
                "A mismatched real artifact is refused."
            )
        log.warning(
            "!!! LOADED THE SYNTHETIC STAND-IN MODEL — NOT LIODON. !!! "
            "Every result from this process is flagged is_standin_not_liodon=true. "
            "This is plumbing validation only."
        )

    return LoadedModel(
        session=sess,
        path=model_path,
        size_bytes=size,
        sha256=digest,
        sha256_expected=LIODON["expected_sha256"],
        is_standin=is_standin,
        class_names=class_names,
        classes_source=classes_source,
        input_name=inputs[0].name,
        output_name=outputs[0].name,
        input_shape=list(inputs[0].shape),
        output_shape=list(outputs[0].shape),
        load_time_ms=load_ms,
        metadata=meta,
    )


def run_inference(
    model: LoadedModel,
    image_bytes: bytes,
    conf: float = 0.45,
    iou: float = 0.35,
    imgsz: int = DEFAULT_IMGSZ,
    annotate: bool = True,
) -> dict:
    """Decode an image, run the (validated) pipeline, return the result dict.

    Mirrors run_liodon.py::process_one minus the filesystem/report concerns:
    same decode -> preprocess -> single ONNX run -> postprocess -> records,
    same timings, same annotated overlay (the original image is never
    modified — draw_annotations works on a copy).
    """
    import io
    from PIL import Image

    from .inference import draw_annotations, ms, postprocess, preprocess

    t_total0 = time.perf_counter()

    t0 = time.perf_counter()
    img = Image.open(io.BytesIO(image_bytes))
    img = img.convert("RGB")
    timings = {"decode_ms": ms(time.perf_counter() - t0)}

    import hashlib as _hashlib

    t0 = time.perf_counter()
    tensor, geom = preprocess(img, imgsz)
    timings["preprocess_ms"] = ms(time.perf_counter() - t0)

    t0 = time.perf_counter()
    (output,) = model.session.run([model.output_name], {model.input_name: tensor})
    timings["inference_ms"] = ms(time.perf_counter() - t0)

    t0 = time.perf_counter()
    decoded = postprocess(output, geom, conf, iou)
    timings["postprocess_ms"] = ms(time.perf_counter() - t0)

    scale, pad_x, pad_y, orig_w, orig_h = geom  # noqa: F841 (geometry evidence)

    records = []
    for cls_id, conf_score, x1, y1, x2, y2 in decoded["detections"]:
        records.append(
            {
                "class_id": cls_id,
                "class_name": model.class_names.get(cls_id, f"class_{cls_id}"),
                "condition": model.class_names.get(cls_id, f"class_{cls_id}"),
                # The model has no tooth numbering: tooth_number is always null.
                "tooth_number": None,
                "confidence": round(conf_score, 6),
                "bbox": {
                    "format": "xyxy",
                    "units": "pixels",
                    "coordinate_space": "original_image",
                    "x1": round(float(x1), 3),
                    "y1": round(float(y1), 3),
                    "x2": round(float(x2), 3),
                    "y2": round(float(y2), 3),
                    "x": round(float(x1), 3),
                    "y": round(float(y1), 3),
                    "width": round(float(x2 - x1), 3),
                    "height": round(float(y2 - y1), 3),
                },
            }
        )

    annotated_png: str | None = None
    if annotate:
        t0 = time.perf_counter()
        annotated = draw_annotations(img, decoded["detections"], model.class_names)
        timings["draw_ms"] = ms(time.perf_counter() - t0)
        buf = io.BytesIO()
        annotated.save(buf, format="PNG")
        annotated_png = buf.getvalue().hex()

    timings["total_ms"] = ms(time.perf_counter() - t_total0)

    counts: dict[str, int] = {}
    for r in records:
        counts[r["class_name"]] = counts.get(r["class_name"], 0) + 1

    return {
        "is_standin_not_liodon": model.is_standin,
        "image": {
            "width": orig_w,
            "height": orig_h,
            "sha256": _hashlib.sha256(image_bytes).hexdigest(),
        },
        "detection_count": len(records),
        "counts_by_class": counts,
        "detections": records,
        "raw_model_output": {
            "shape": decoded["raw_shape"],
            "interpreted_layout": decoded["layout"],
            "num_channels": decoded["num_channels"],
            "num_classes": decoded["num_classes"],
            "num_anchor_points": decoded["num_anchors"],
            "candidates_before_nms": decoded["candidates_above_conf"],
            "detections_after_nms": decoded["after_nms"],
        },
        "timings_ms": timings,
        "annotated_png_hex": annotated_png,
        "parameters": {
            "conf": conf,
            "iou": iou,
            "imgsz": imgsz,
            "letterbox": {
                "pad_value": 114,
                "resample": "BILINEAR",
                "scale_rule": "min(imgsz/w, imgsz/h)",
            },
            "normalization": "float32, /255.0, HWC->CHW, batch=1",
        },
    }


