"""
model.py — Implant AI engine: artifact registry + restricted loading + inference.

Phase 19B, engine 2 of 3 (port 8004).

The artifact is the YOLOv8 instance-segmentation checkpoint `8024.pt`
published as nsitnov/8024-yolov8-model on Hugging Face. The registry below is
the exact audited artifact, mirrored from ai-validation/yolov8-8024
(README.md + AUDIT.md, 16 fields):

    publisher   : nsitnov
    repository  : nsitnov/8024-yolov8-model
    revision    : 0304179670f4838bf0dec1053b963112a16a66cf (head of `main`)
    file        : 8024.pt
    size        : 143,955,443 bytes
    SHA-256     : e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98
    license     : Apache-2.0 (weights as published)
    arch        : YOLOv8-seg (SegmentationModel; Detect + Segment + Proto heads)
    input       : single RGB image, letterboxed to 1x3x640x640 (grey 114)
    task        : segment
    classes     : the 8 labels read from the checkpoint's OWN bytes
                  (AUDIT.md field 11) — NOT the model card's spelling

Load policy (AUDIT.md fields 6, 13, 14 — fail-closed):
  1. file must exist
  2. size + SHA-256 must match the pre-validated artifact
  3. the file is loaded ONLY through ultralytics' restricted loader:
     ULTRALYTICS_SAFE_LOAD=1 -> torch.load(weights_only=True) with a static
     allow-list of the pickle's globals; builtins.getattr is replaced by an
     attribute-only wrapper; anything outside the allow-list raises instead
     of executing. This module sets the flag BEFORE ultralytics is imported.
  4. torch >= 2.6 is REQUIRED. On older torch the safe-load flag is silently
     disabled by ultralytics, so refusing to start is the only honest option.
  5. the loaded model must be a segmentation model (task == "segment") whose
     class names are exactly the 8 audited checkpoint labels.
  6. a synthetic stand-in checkpoint (a real ultralytics .pt file with random
     weights, self-declared in its own bytes via the train_args marker) is
     accepted ONLY when ALLOW_STANDIN=1 AND the marker bytes are present.
     Every response it produces carries is_standin_not_implant=true, and the
     orchestrator refuses to persist stand-in findings. A real weight file
     with a wrong hash can never take this path (the marker scan only runs
     on checksum mismatch, and it is a plain byte search — the file is never
     unpickled to probe for it).
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# The restricted loader is a per-process env flag read by ultralytics at
# import time (ultralytics/utils/__init__.py: SAFE_LOAD =
# env_bool("ULTRALYTICS_SAFE_LOAD")). It must be set before `import
# ultralytics` executes anywhere in this process — hence here, at the top of
# the module that imports it. (AUDIT.md field 14.)
# ---------------------------------------------------------------------------
os.environ.setdefault("ULTRALYTICS_SAFE_LOAD", "1")

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from .inference import (  # noqa: E402
    DEFAULT_CONF,
    DEFAULT_IOU,
    DEFAULT_IMGSZ,
    BOX_COLOR,
)

log = logging.getLogger("implant-ai")

# ---------------------------------------------------------------------------
# Registry — the exact audited artifact (D6, engine side).
# ---------------------------------------------------------------------------

IMPLANT = {
    "name": "implant-ai",
    "version": "1.0.0",
    "publisher": "nsitnov",
    "source": (
        "https://huggingface.co/nsitnov/8024-yolov8-model"
        "@0304179670f4838bf0dec1053b963112a16a66cf (8024.pt)"
    ),
    "source_repo": "nsitnov/8024-yolov8-model",
    "source_revision": "0304179670f4838bf0dec1053b963112a16a66cf",
    "license": (
        "Apache-2.0 (weights as published); loading uses the restricted loader "
        "of ultralytics 8.4.155 (AGPL-3.0) — ai-validation/yolov8-8024/AUDIT.md"
    ),
    "architecture": "YOLOv8 instance segmentation (SegmentationModel: Detect + Segment + Proto)",
    "runtime": "ultralytics 8.4.155 (restricted loader) / torch CPU",
    "device": "cpu",
    "filename": "8024.pt",
    "expected_sha256": "e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98",
    "expected_size_bytes": 143_955_443,
    "input_spec": "JPEG/PNG dental X-ray (periapical / bitewing)",
    "task": "segment",
    # The checkpoint's OWN labels, in its own order (AUDIT.md field 11).
    # The model card spells three of these differently ("Missing-tooth-between",
    # "Periapical-lesion", "Root-Canal-Treatment"); per the audit's rule the
    # file's wording is never replaced, so the file's labels are what the
    # engine — and therefore the findings — report.
    "classes": {
        0: "Caries",
        1: "Crown",
        2: "Filling",
        3: "Implant",
        4: "Missing teeth",
        5: "Periapical lesion",
        6: "Root Piece",
        7: "Root canal obturation",
    },
    "classes_source": (
        "checkpoint 'names' read from 8024.pt's own bytes (ai-validation/"
        "yolov8-8024, AUDIT.md field 11) — the model card's spelling is NOT used"
    ),
}

# Byte marker of the synthetic stand-in. Plain bytes search — no unpickling.
STANDIN_MARKER = b"is_standin_not_implant"

MIN_TORCH_VERSION = (2, 6)  # AUDIT.md field 14: below this the safe loader is silently disabled


class ModelRejectedError(RuntimeError):
    """Raised when the artifact at MODEL_PATH is not the audited checkpoint."""


def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def _torch_version() -> tuple[int, int]:
    import torch

    parts = torch.__version__.split(".")
    try:
        return int(parts[0]), int(parts[1])
    except (IndexError, ValueError):
        return (0, 0)


def _load_with_restricted_loader(path: Path):
    """YOLO(path) under ULTRALYTICS_SAFE_LOAD=1 — verified to be active."""
    import torch
    from ultralytics import YOLO

    major, minor = _torch_version()
    if (major, minor) < MIN_TORCH_VERSION:
        raise ModelRejectedError(
            f"torch {major}.{minor} is below the required {MIN_TORCH_VERSION[0]}."
            f"{MIN_TORCH_VERSION[1]}: ultralytics would silently disable the "
            "restricted loader (ULTRALYTICS_SAFE_LOAD) and fall back to an "
            "unrestricted torch.load — refusing to start instead"
        )

    from ultralytics.utils import SAFE_LOAD

    if not SAFE_LOAD:
        raise ModelRejectedError(
            "ULTRALYTICS_SAFE_LOAD is not active in this process — refusing "
            "to load the checkpoint through the unrestricted path"
        )

    t0 = time.perf_counter()
    model = YOLO(str(path))  # restricted loader: weights_only=True + allow-list
    load_time_ms = int((time.perf_counter() - t0) * 1000)

    if getattr(model, "task", None) != "segment":
        raise ModelRejectedError(
            f"loaded model task is {getattr(model, 'task', None)!r}, not 'segment' "
            "— the audited artifact is a YOLOv8 instance-segmentation checkpoint"
        )
    if dict(model.names or {}) != dict(IMPLANT["classes"]):
        raise ModelRejectedError(
            "checkpoint class names do not match the 8 audited labels "
            f"(checkpoint: {dict(model.names or {})}) — not the audited artifact"
        )
    return model, load_time_ms


@dataclass
class LoadedModel:
    yolo: object  # live ultralytics YOLO wrapper (restricted-loaded)
    path: Path
    size_bytes: int
    sha256: str
    sha256_expected: str
    is_standin: bool
    class_names: dict
    classes_source: str
    load_time_ms: int
    parameter_count: int = 0

    @property
    def registry_entry(self) -> dict:
        """D6 registry view of what is actually loaded."""
        entry = dict(IMPLANT)
        entry["model_version"] = IMPLANT["version"]
        entry["model_path"] = str(self.path)
        entry["model_sha256"] = self.sha256
        entry["model_sha256_expected"] = self.sha256_expected
        entry["model_checksum_verified"] = (
            self.sha256.lower() == self.sha256_expected.lower() or self.is_standin
        )
        entry["model_size_bytes"] = self.size_bytes
        entry["is_standin_not_implant"] = self.is_standin
        entry["task"] = IMPLANT["task"]
        entry["parameter_count"] = self.parameter_count
        entry["classes"] = {str(k): v for k, v in sorted(self.class_names.items())}
        return entry


def load_model(model_path: str, allow_standin: bool = False) -> LoadedModel:
    path = Path(model_path)
    if not path.exists():
        raise ModelRejectedError(f"checkpoint not found: {model_path}")

    data = path.read_bytes()
    sha = sha256_of_bytes(data)
    is_real = (
        len(data) == IMPLANT["expected_size_bytes"]
        and sha.lower() == IMPLANT["expected_sha256"].lower()
    )

    if not is_real:
        # The marker probe is a plain byte search over the rejected file —
        # it never unpickles, so a hostile file cannot execute here.
        declared = STANDIN_MARKER in data
        if not (allow_standin and declared):
            raise ModelRejectedError(
                f"artifact does not match the audited checkpoint (expected "
                f"SHA-256 {IMPLANT['expected_sha256']}, size "
                f"{IMPLANT['expected_size_bytes']})"
                + (
                    " and is not a declared stand-in"
                    if allow_standin and not declared
                    else "; a stand-in is only accepted with ALLOW_STANDIN=1 "
                    "and a self-declaration in its own bytes"
                )
                + "; refusing to load"
            )

    model, load_time_ms = _load_with_restricted_loader(path)
    is_standin = not is_real
    parameter_count = sum(p.numel() for p in model.model.parameters())

    return LoadedModel(
        yolo=model,
        path=path,
        size_bytes=len(data),
        sha256=sha,
        sha256_expected=IMPLANT["expected_sha256"],
        is_standin=is_standin,
        class_names=dict(IMPLANT["classes"]),
        classes_source=IMPLANT["classes_source"],
        load_time_ms=load_time_ms,
        parameter_count=parameter_count,
    )


# ---------------------------------------------------------------------------
# Synthetic stand-in — sandbox/CI plumbing only.
#
# Builds a REAL ultralytics segmentation checkpoint (yolo11n-seg, 8 classes,
# fixed-seed random weights) in the native .pt format, self-declared via the
# train_args marker. It therefore exercises the exact production load path —
# restricted loader, task + class-name verification — with no audited
# weights. Loadable only with ALLOW_STANDIN=1; every response it produces is
# flagged is_standin_not_implant=true, and the orchestrator refuses to persist
# such findings.
# ---------------------------------------------------------------------------


def build_standin(path: str | Path, seed: int = 1908) -> str:
    import torch
    from ultralytics import __version__ as ultralytics_version
    from ultralytics.nn.tasks import SegmentationModel

    torch.manual_seed(seed)
    model = SegmentationModel("yolo11n-seg.yaml", ch=3, nc=8)
    # The 2024 trainer stamps the live task onto the module before saving;
    # a bare construction defaults to "detect", which the loader would reject.
    model.task = "segment"
    model.names = dict(IMPLANT["classes"])
    model.args = {
        "yaml": "yolo11n-seg.yaml",
        "nc": 8,
        "ch": 3,
        "scale": "n",
        "task": "segment",
        "imgsz": DEFAULT_IMGSZ,
        "is_standin_not_implant": True,
    }
    model.pt_path = str(path)

    ckpt = {
        "model": model,
        "ema": None,
        "train_args": {
            "is_standin_not_implant": True,
            "nc": 8,
            "names": dict(IMPLANT["classes"]),
            "imgsz": DEFAULT_IMGSZ,
            "task": "segment",
        },
        "model_args": {"yaml": "yolo11n-seg.yaml", "ch": 3, "nc": 8},
        "task": "segment",
        "version": ultralytics_version,
        "date": time.strftime("%Y-%m-%d"),
        "license": "STANDIN (synthetic — not the audited checkpoint)",
        "docs": "https://docs.ultralytics.com",
    }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    torch.save(ckpt, path)
    return sha256_of(Path(path))


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------


def draw_annotations(img: Image.Image, records: list[dict]) -> Image.Image:
    """Draw the detections on a copy of the original image (bbox #3b82f6,
    matching the FindingsViewer contract for this engine)."""
    out = img.copy()
    draw = ImageDraw.Draw(out)
    for rec in records:
        x1, y1 = rec["bbox"]["x"], rec["bbox"]["y"]
        x2, y2 = x1 + rec["bbox"]["width"], y1 + rec["bbox"]["height"]
        draw.rectangle([x1, y1, x2, y2], outline=BOX_COLOR, width=3)
        label = f"{rec['class_name']} {rec['confidence']:.2f}"
        draw.text((x1, max(0, y1 - 14)), label, fill=BOX_COLOR)
    return out


def run_inference(
    model: LoadedModel,
    image_bytes: bytes,
    conf: float = DEFAULT_CONF,
    iou: float = DEFAULT_IOU,
    imgsz: int = DEFAULT_IMGSZ,
    annotate: bool = True,
) -> dict:
    t_total0 = time.perf_counter()

    t0 = time.perf_counter()
    img = Image.open(__import__("io").BytesIO(image_bytes)).convert("RGB")
    timings = {"decode_ms": int((time.perf_counter() - t0) * 1000)}
    orig_w, orig_h = img.size
    np_img = np.asarray(img, dtype=np.uint8)  # HWC uint8 — ultralytics handles letterbox

    t0 = time.perf_counter()
    results = model.yolo.predict(
        np_img,
        conf=conf,
        iou=iou,
        imgsz=imgsz,
        device="cpu",
        verbose=False,
    )
    timings["inference_ms"] = int((time.perf_counter() - t0) * 1000)
    result = results[0]

    t0 = time.perf_counter()
    records: list[dict] = []
    if result.boxes is not None:
        boxes = result.boxes
        # ultralytics maps boxes back to the ORIGINAL image space (the
        # letterbox padding is undone internally); xyxy is in original pixels.
        for i in range(len(boxes)):
            cls_id = int(boxes.cls[i].item())
            conf_score = float(boxes.conf[i].item())
            x1, y1, x2, y2 = (float(v) for v in boxes.xyxy[i].tolist())
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
                        "x1": round(x1, 3),
                        "y1": round(y1, 3),
                        "x2": round(x2, 3),
                        "y2": round(y2, 3),
                        "x": round(x1, 3),
                        "y": round(y1, 3),
                        "width": round(x2 - x1, 3),
                        "height": round(y2 - y1, 3),
                    },
                }
            )
    timings["postprocess_ms"] = int((time.perf_counter() - t0) * 1000)

    annotated_png: str | None = None
    if annotate:
        t0 = time.perf_counter()
        annotated = draw_annotations(img, records)
        buf = __import__("io").BytesIO()
        annotated.save(buf, format="PNG")
        timings["draw_ms"] = int((time.perf_counter() - t0) * 1000)
        annotated_png = buf.getvalue().hex()

    timings["total_ms"] = int((time.perf_counter() - t_total0) * 1000)

    counts: dict[str, int] = {}
    for r in records:
        counts[r["class_name"]] = counts.get(r["class_name"], 0) + 1

    import hashlib as _hashlib

    return {
        "is_standin_not_implant": model.is_standin,
        "image": {
            "width": orig_w,
            "height": orig_h,
            "sha256": _hashlib.sha256(image_bytes).hexdigest(),
        },
        "detection_count": len(records),
        "counts_by_class": counts,
        "detections": records,
        "raw_model_output": {
            "task": IMPLANT["task"],
            "num_classes": len(IMPLANT["classes"]),
            "boxes_before_nms": None,  # not exposed by the ultralytics API
            "detections_after_nms": len(records),
            "masks_available": result.masks is not None,
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
            "normalization": "float32, /255.0, HWC->CHW, batch=1 (inside ultralytics)",
            "coordinate_mapping": "ultralytics maps boxes back to original image pixels",
        },
    }
