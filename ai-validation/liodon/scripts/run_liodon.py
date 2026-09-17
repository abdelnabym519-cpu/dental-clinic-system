#!/usr/bin/env python3
"""
run_liodon.py — standalone ONNX Runtime **CPU** inference runner for the
Liodon Dental Panoramic Detector (liodon-ai/dental-panoramic-detector).

Pipeline
    Panoramic X-ray
        -> preprocessing      (letterbox 640x640, /255, NCHW float32)
        -> Liodon best.onnx
        -> ONNX Runtime CPU   (CPUExecutionProvider only)
        -> postprocessing     (class-argmax, conf filter, per-class NMS)
        -> detection results  (detections.json + annotated.png)

This runner is a standalone validation tool. It is NOT part of the
dental-clinic-system ERP and performs no integration with it.

Fidelity note
-------------
Preprocessing, model call, and postprocessing below are a line-for-line
re-implementation of the publisher's own reference inference code, published
in the official Space:
    https://huggingface.co/spaces/liodon-ai/dental-panoramic-detector-space
    file: app.py  (_letterbox / _postprocess / _nms / _iou)
The published operating point is conf=0.45, iou=0.35, imgsz=640.

No training, fine-tuning, retraining, conversion, quantisation, or weight
modification is performed. The published artifact is used exactly as-is.

Usage
-----
    python scripts/run_liodon.py --input input/sample.png
    python scripts/run_liodon.py --input input/ --output-dir output/
    python scripts/run_liodon.py --input input/sample.png --conf 0.45 --iou 0.35
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# --- Hard requirement: CPU-only ONNX Runtime. -------------------------------
# Imported lazily inside functions where possible so that --help still works on
# a machine without the dependency, but the check below is the load-bearing one.
try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.stderr.write("[FATAL] numpy is not installed. Run: pip install -r requirements.txt\n")
    raise SystemExit(2)


# ============================================================================
# Defaults — taken from the publisher's model card and reference Space.
# These are overridable from the CLI; every resolved value is written into the
# run report so a measurement is never ambiguous about what produced it.
# ============================================================================

MODEL_REPO_ID = "liodon-ai/dental-panoramic-detector"
MODEL_REPO_REVISION = "8bef2036b099e80e51f93f24de4b0c0edd366256"
MODEL_FILENAME = "best.onnx"
MODEL_SHA256 = "4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71"
MODEL_SIZE_BYTES = 10_605_711

DEFAULT_CONF = 0.45
DEFAULT_IOU = 0.35
DEFAULT_IMGSZ = 640

# Fallback class map. The authoritative map is read from the ONNX file's own
# metadata (`names`) when present; this is what the model card documents.
FALLBACK_CLASSES = ["caries", "periapical_lesion", "impacted_tooth"]

# Cosmetic-only colours for the annotated overlay (same as the reference Space).
CLASS_COLORS = ["#2196F3", "#00BCD4", "#FFFFFF"]

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}

LETTERBOX_PAD_VALUE = 114


# ============================================================================
# Instrumentation helpers
# ============================================================================


def rss_bytes():
    """Best-effort resident/working-set memory of this process, in bytes.

    Returns None when the platform gives us nothing usable, rather than
    inventing a number. On Windows this reports the process *working set*
    (private + shared resident pages), which is the closest Windows analogue
    of RSS.
    """
    # 1) psutil, if the user installed it — cross-platform and unambiguous.
    try:
        import psutil  # type: ignore

        return int(psutil.Process(os.getpid()).memory_info().rss)
    except Exception:
        pass

    # 2) Windows without psutil: PROCESS_MEMORY_COUNTERS via ctypes.
    if os.name == "nt":
        try:
            class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
                _fields_ = [
                    ("cb", ctypes.c_ulong),
                    ("PageFaultCount", ctypes.c_ulong),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            counters = PROCESS_MEMORY_COUNTERS()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            get_current = ctypes.windll.kernel32.GetCurrentProcess
            get_info = ctypes.windll.psapi.GetProcessMemoryInfo
            if get_info(get_current(), ctypes.byref(counters), counters.cb):
                return int(counters.WorkingSetSize)
        except Exception:
            pass

    # 3) POSIX fallback: ru_maxrss is KiB on Linux, bytes on macOS.
    try:
        import resource  # type: ignore

        ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(ru * 1024) if sys.platform != "darwin" else int(ru)
    except Exception:
        return None


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def ms(seconds: float) -> float:
    return round(seconds * 1000.0, 2)


# ============================================================================
# Model metadata (authoritative class names / imgsz come from the file itself)
# ============================================================================


def read_model_metadata(sess) -> dict:
    """Pull the Ultralytics ONNX export metadata out of the session.

    Ultralytics writes `names`, `imgsz`, `stride`, `task` and `batch` into the
    ONNX custom metadata map. When present this is more authoritative than any
    hand-copied table, so it takes precedence and the raw map is preserved in
    the report as evidence.
    """
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
            # Written by Ultralytics as a Python dict literal, e.g.
            # "{0: 'caries', 1: 'periapical_lesion', 2: 'impacted_tooth'}"
            parsed = _parse_names(names)
            if parsed:
                meta["classes_from_model"] = parsed

        if custom.get("imgsz"):
            try:
                meta["imgsz_from_model"] = int(str(custom["imgsz"]))
            except ValueError:
                pass
        if custom.get("stride"):
            try:
                meta["stride_from_model"] = int(str(custom["stride"]))
            except ValueError:
                pass
        if custom.get("task"):
            meta["task_from_model"] = str(custom["task"])
        if custom.get("batch"):
            try:
                meta["batch_from_model"] = int(str(custom["batch"]))
            except ValueError:
                pass
    except Exception as exc:  # pragma: no cover - metadata is best-effort
        meta["metadata_error"] = f"{type(exc).__name__}: {exc}"
    return meta


def _parse_names(raw):
    """Parse an ONNX custom-metadata `names` field into {id: name}."""
    import ast

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


def describe_io(sess):
    """Describe every model input/output: name, shape, dtype."""
    inputs, outputs = [], []
    for i in sess.get_inputs():
        inputs.append({"name": i.name, "shape": list(i.shape), "type": i.type})
    for o in sess.get_outputs():
        outputs.append({"name": o.name, "shape": list(o.shape), "type": o.type})
    return inputs, outputs


# ============================================================================
# Preprocessing — faithful to the reference app.py `_letterbox`
# ============================================================================


def letterbox(img, imgsz: int):
    """Resize+pad to imgsz x imgsz keeping aspect ratio. Returns the canvas and
    the geometry needed to map boxes back to original pixel space."""
    from PIL import Image

    orig_w, orig_h = img.size
    scale = min(imgsz / orig_w, imgsz / orig_h)
    new_w, new_h = round(orig_w * scale), round(orig_h * scale)
    pad_x, pad_y = (imgsz - new_w) // 2, (imgsz - new_h) // 2
    canvas = Image.new("RGB", (imgsz, imgsz), (LETTERBOX_PAD_VALUE,) * 3)
    canvas.paste(img.resize((new_w, new_h), Image.BILINEAR), (pad_x, pad_y))
    return canvas, scale, pad_x, pad_y, orig_w, orig_h


def preprocess(img, imgsz: int):
    """Letterbox -> float32 /255 -> HWC->CHW -> add batch dim."""
    canvas, scale, pad_x, pad_y, orig_w, orig_h = letterbox(img, imgsz)
    arr = np.array(canvas, dtype=np.float32) / 255.0
    arr = arr.transpose(2, 0, 1)[np.newaxis]
    return np.ascontiguousarray(arr), (scale, pad_x, pad_y, orig_w, orig_h)


# ============================================================================
# Postprocessing — faithful to the reference app.py `_postprocess` / `_nms`
# ============================================================================


def _iou(a, b):
    xi1, yi1 = max(a[0], b[0]), max(a[1], b[1])
    xi2, yi2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / (ua + 1e-6)


def _nms(boxes, scores, iou_thresh):
    """Greedy NMS — the publisher's decision rule, without its indexing defect.

    The reference snippet is:

        order = order[1:][[_iou(boxes[i], boxes[j]) < iou_thresh for j in order]]

    Python evaluates `order[1:]` before the comprehension, so the slice has n-1
    elements while the mask is built over the still-untruncated `order` and has
    n elements. NumPy therefore raises IndexError — for *any* non-empty input,
    including a single detection. Reproduced in Arena against the snippet
    copied verbatim from the published Space.

    This is an off-by-one indexing slip, not a difference of intent: the rule
    the code is clearly written to express is standard greedy NMS (take the
    highest-scoring box, drop everything overlapping it above the threshold).
    That rule is implemented below unchanged, so the detections this runner
    keeps are the ones the publisher intended to keep.
    """
    order = np.argsort(scores)[::-1]
    kept = []
    while len(order):
        i = int(order[0])
        kept.append(i)
        rest = order[1:]
        if len(rest) == 0:
            break
        keep = np.fromiter(
            (_iou(boxes[i], boxes[j]) < iou_thresh for j in rest),
            dtype=bool,
            count=len(rest),
        )
        order = rest[keep]
    return kept


def decode_raw(output, conf_thres: float):
    """Turn the raw model tensor into (boxes_cxcywh, confs, cls_ids) + shape info.

    Accepts either YOLO export layout, (1, 4+nc, N) or (1, N, 4+nc), and says
    which one it saw, so a surprising tensor is reported rather than silently
    mis-read.
    """
    arr = np.asarray(output)
    raw_shape = list(arr.shape)
    if arr.ndim == 3:
        arr = arr[0]
    if arr.ndim != 2:
        raise ValueError(f"Unexpected model output rank {arr.ndim} (shape {raw_shape})")

    # (4+nc, N) if rows < cols, else (N, 4+nc). 7x8400 -> transpose; 8400x7 -> keep.
    layout = "cxcywh+cls (4+nc, N)"
    if arr.shape[0] <= arr.shape[1]:
        pred = arr.T
    else:
        layout = "cxcywh+cls (N, 4+nc)"

    if pred.shape[1] <= 4:
        raise ValueError(
            f"Model output has {pred.shape[1]} channels; expected >4 "
            f"(4 box + at least 1 class). Raw shape {raw_shape}."
        )

    cls_scores = pred[:, 4:]
    cls_ids = cls_scores.argmax(axis=1)
    confs = cls_scores.max(axis=1)
    mask = confs >= conf_thres
    boxes = pred[mask, :4]
    confs = confs[mask]
    cls_ids = cls_ids[mask]

    return {
        "raw_shape": raw_shape,
        "layout": layout,
        "num_channels": int(pred.shape[1]),
        "num_classes": int(pred.shape[1] - 4),
        "num_anchors": int(pred.shape[0]),
        "boxes_cxcywh": boxes,
        "confs": confs,
        "cls_ids": cls_ids,
        "candidates_above_conf": int(boxes.shape[0]),
    }


def postprocess(output, geom, conf_thres: float, iou_thres: float):
    """conf filter -> per-class NMS -> boxes in ORIGINAL image pixel space."""
    scale, pad_x, pad_y, orig_w, orig_h = geom
    decoded = decode_raw(output, conf_thres)

    boxes = decoded["boxes_cxcywh"]
    confs = decoded["confs"]
    cls_ids = decoded["cls_ids"]

    if len(boxes) == 0:
        decoded.update({"detections": [], "after_nms": 0})
        return decoded

    x1 = np.clip((boxes[:, 0] - boxes[:, 2] / 2 - pad_x) / scale, 0, orig_w)
    y1 = np.clip((boxes[:, 1] - boxes[:, 3] / 2 - pad_y) / scale, 0, orig_h)
    x2 = np.clip((boxes[:, 0] + boxes[:, 2] / 2 - pad_x) / scale, 0, orig_w)
    y2 = np.clip((boxes[:, 1] + boxes[:, 3] / 2 - pad_y) / scale, 0, orig_h)
    xyxy = np.stack([x1, y1, x2, y2], axis=1)

    results = []
    for cid in np.unique(cls_ids):
        m = cls_ids == cid
        idxs = np.where(m)[0]
        kept = _nms(xyxy[m], confs[m], iou_thres)
        for k in kept:
            idx = idxs[k]
            results.append((int(cid), float(confs[idx]), *xyxy[idx].tolist()))

    decoded.update({"detections": results, "after_nms": len(results)})
    return decoded


# ============================================================================
# Annotation overlay (cosmetic; same visual language as the reference Space)
# ============================================================================


def load_font(size: int):
    from PIL import ImageFont

    candidates = [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        return ImageFont.load_default()


def draw_annotations(img, detections, class_names):
    """Boxes + labels + legend, drawn onto a copy of the original image."""
    from PIL import ImageColor, ImageDraw

    out = img.convert("RGB").copy()
    draw = ImageDraw.Draw(out)
    width = out.width
    lw = max(3, int(width / 400))
    font = load_font(max(16, int(width / 45)))
    small = load_font(max(13, int(width / 60)))

    for cls_id, conf, x1, y1, x2, y2 in detections:
        color = CLASS_COLORS[cls_id % len(CLASS_COLORS)]
        draw.rectangle([x1, y1, x2, y2], outline=color, width=lw)
        name = class_names.get(cls_id, f"class_{cls_id}")
        label = f"{name} {conf:.2f}"
        pad = max(2, lw // 2)
        try:
            bbox = draw.textbbox((x1, y1), label, font=font)
        except Exception:
            bbox = (x1, y1, x1 + 10 * len(label), y1 + 20)
        ty = max(0, y1 - (bbox[3] - bbox[1]) - 2 * pad)
        draw.rectangle(
            [bbox[0] - pad, ty - pad, bbox[2] + pad, bbox[3] - bbox[1] + ty + pad],
            fill=color,
        )
        draw.text((bbox[0], ty), label, fill="black", font=font)

    # Legend (bottom-left, as in the reference Space).
    lx, ly = max(12, int(width / 100)), max(0, out.height - (len(class_names) * 36 + 40))
    for i, (cid, name) in enumerate(sorted(class_names.items())):
        color = CLASS_COLORS[cid % len(CLASS_COLORS)]
        top = ly + i * 36
        draw.rectangle([lx, top, lx + 24, top + 24], fill=color, outline="black", width=1)
        draw.text((lx + 32, top), name.replace("_", " ").title(), fill="white", font=small)

    return out


# ============================================================================
# Runner
# ============================================================================


def build_session(model_path: Path, intra_threads: int | None, inter_threads: int | None):
    """Create the ONNX Runtime session, CPU ONLY.

    onnxruntime-gpu is refused outright: the target machine has no CUDA device
    and this validation is defined as CPU-only. If the CPU provider is missing
    we stop rather than silently falling back to whatever else is installed.
    """
    import onnxruntime as ort

    available = ort.get_available_providers()
    if "CPUExecutionProvider" not in available:
        raise RuntimeError(
            f"CPUExecutionProvider is not available. Providers reported: {available}. "
            "Install the CPU build: pip uninstall onnxruntime-gpu && pip install onnxruntime"
        )

    opts = ort.SessionOptions()
    if intra_threads:
        opts.intra_op_num_threads = intra_threads
    if inter_threads:
        opts.inter_op_num_threads = inter_threads
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

    t0 = time.perf_counter()
    sess = ort.InferenceSession(
        str(model_path),
        sess_options=opts,
        providers=["CPUExecutionProvider"],
    )
    load_s = time.perf_counter() - t0
    return sess, load_s, available


def process_one(sess, input_name, output_name, img_path: Path, args, class_names, imgsz):
    from PIL import Image

    timings = {}
    t_total0 = time.perf_counter()

    mem_before = rss_bytes()

    t0 = time.perf_counter()
    img = Image.open(img_path)
    img = img.convert("RGB")
    timings["decode_ms"] = ms(time.perf_counter() - t0)

    t0 = time.perf_counter()
    tensor, geom = preprocess(img, imgsz)
    timings["preprocess_ms"] = ms(time.perf_counter() - t0)

    inference_ms = []
    runs = max(1, args.warmup + 1)
    output = None
    for i in range(runs):
        t0 = time.perf_counter()
        output = sess.run([output_name], {input_name: tensor})
        dt = time.perf_counter() - t0
        inference_ms.append(ms(dt))
    timings["inference_all_ms"] = inference_ms
    timings["inference_ms"] = inference_ms[-1]          # measured (post-warmup)
    timings["inference_cold_ms"] = inference_ms[0]      # first call
    timings["warmup_runs"] = args.warmup

    t0 = time.perf_counter()
    decoded = postprocess(output[0], geom, args.conf, args.iou)
    timings["postprocess_ms"] = ms(time.perf_counter() - t0)

    mem_after = rss_bytes()

    detections = decoded["detections"]
    scale, pad_x, pad_y, orig_w, orig_h = geom

    records = []
    for cls_id, conf, x1, y1, x2, y2 in detections:
        records.append(
            {
                "class_id": cls_id,
                "class_name": class_names.get(cls_id, f"class_{cls_id}"),
                "confidence": round(conf, 6),
                # NOTE: the published postprocessing emits absolute pixel
                # coordinates in the ORIGINAL image space. That is the model's
                # own output format; nothing is forced on top of it.
                "bbox": {
                    "format": "xyxy",
                    "units": "pixels",
                    "coordinate_space": "original_image",
                    "x1": round(float(x1), 3),
                    "y1": round(float(y1), 3),
                    "x2": round(float(x2), 3),
                    "y2": round(float(y2), 3),
                    "width": round(float(x2 - x1), 3),
                    "height": round(float(y2 - y1), 3),
                },
            }
        )

    t0 = time.perf_counter()
    annotated = draw_annotations(img, detections, class_names)
    timings["draw_ms"] = ms(time.perf_counter() - t0)

    timings["total_ms"] = ms(time.perf_counter() - t_total0)

    counts = {}
    for r in records:
        counts[r["class_name"]] = counts.get(r["class_name"], 0) + 1

    result = {
        "image": {
            "path": str(img_path),
            "filename": img_path.name,
            "width": orig_w,
            "height": orig_h,
            "sha256": sha256_of(img_path),
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
        "memory": {
            "rss_before_bytes": mem_before,
            "rss_after_bytes": mem_after,
            "rss_delta_bytes": (None if mem_before is None or mem_after is None else mem_after - mem_before),
            "note": "peak_working_set is reported in the run report",
        },
        "annotated_image": annotated,
    }
    return result


def probe_process_peak():
    """Windows: peak working set for this process, if obtainable."""
    if os.name != "nt":
        return None
    try:

        class PMC(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        c = PMC()
        c.cb = ctypes.sizeof(PMC)
        ok = ctypes.windll.psapi.GetProcessMemoryInfo(
            ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb
        )
        return int(c.PeakWorkingSetSize) if ok else None
    except Exception:
        return None


def build_parser():
    p = argparse.ArgumentParser(
        description="Run the Liodon Dental Panoramic Detector on CPU (ONNX Runtime).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Example:\n"
            "  python scripts/run_liodon.py --input input/sample.png\n"
        ),
    )
    p.add_argument("--input", required=True, help="Panoramic X-ray image, or a folder of images.")
    p.add_argument(
        "--model",
        default=None,
        help=f"Path to {MODEL_FILENAME}. Default: model/{MODEL_FILENAME} next to this lab.",
    )
    p.add_argument("--output-dir", default=None, help="Output directory. Default: <lab>/output")
    p.add_argument("--conf", type=float, default=DEFAULT_CONF, help=f"Confidence threshold (default {DEFAULT_CONF}).")
    p.add_argument("--iou", type=float, default=DEFAULT_IOU, help=f"NMS IoU threshold (default {DEFAULT_IOU}).")
    p.add_argument(
        "--imgsz",
        type=int,
        default=None,
        help=f"Input size (default: model metadata, else {DEFAULT_IMGSZ}).",
    )
    p.add_argument("--warmup", type=int, default=1, help="Warmup inference calls before the measured one (default 1).")
    p.add_argument("--intra-threads", type=int, default=None, help="ONNX Runtime intra-op threads.")
    p.add_argument("--inter-threads", type=int, default=None, help="ONNX Runtime inter-op threads.")
    p.add_argument("--log-dir", default=None, help="Directory for the append-only run log. Default: <lab>/logs")
    p.add_argument("--no-log", action="store_true", help="Do not append to the run log.")
    p.add_argument("--quiet", action="store_true", help="Suppress the console summary.")
    p.add_argument(
        "--allow-standin",
        action="store_true",
        help=(
            "Testing only. Permits running against a file whose SHA-256 does NOT match the "
            "published one, but ONLY if that file self-declares STANDIN_NOT_LIODON=true in its "
            "ONNX metadata. Cannot be used to run a real weight file with a bad hash."
        ),
    )
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    lab_root = Path(__file__).resolve().parent.parent
    model_path = Path(args.model) if args.model else lab_root / "model" / MODEL_FILENAME
    out_dir = Path(args.output_dir) if args.output_dir else lab_root / "output"
    log_dir = Path(args.log_dir) if args.log_dir else lab_root / "logs"

    print("=" * 78)
    print(" Liodon Dental Panoramic Detector — independent CPU validation runner")
    print("=" * 78)

    # ---- Preflight -------------------------------------------------------
    if not model_path.exists():
        print(f"\n[STOP] Model file not found: {model_path}")
        print("\nThis is a hard stop, not a workaround: no substitute, converted or")
        print("re-exported weight file may be used. Obtain the published artifact with:")
        print("    python scripts/download_liodon.py")
        return 3

    file_size = model_path.stat().st_size
    digest = sha256_of(model_path)
    hash_ok = digest.lower() == MODEL_SHA256

    print(f"\nModel file : {model_path}")
    print(f"Size       : {file_size:,} bytes ({file_size / 1048576:.2f} MiB)")
    print(f"SHA-256    : {digest}")
    print(f"Expected   : {MODEL_SHA256}")
    print(f"Hash match : {'YES' if hash_ok else 'NO'}")

    # The hash gate is the stop condition from the validation protocol and is
    # mandatory for any real artifact. The only way past it is --allow-standin,
    # which is honoured ONLY for a file that declares itself a synthetic
    # stand-in inside its own ONNX metadata (checked after the session loads,
    # below). A real weight file with a wrong hash can never take this path.
    if not hash_ok and not args.allow_standin:
        print("\n[STOP] Artifact does not match the published SHA-256.")
        print("Per the validation protocol, a mismatched artifact stops the run.")
        print("Do not retrain, convert or re-export. Re-download the published file:")
        print("    python scripts/download_liodon.py --force")
        return 4

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"\n[STOP] Input not found: {input_path}")
        return 5

    if input_path.is_dir():
        images = sorted(p for p in input_path.rglob("*") if p.suffix.lower() in IMAGE_EXTS)
        if not images:
            print(f"\n[STOP] No images ({', '.join(sorted(IMAGE_EXTS))}) found in {input_path}")
            return 5
        batch = True
    else:
        images = [input_path]
        batch = False

    # ---- Session ---------------------------------------------------------
    print("\nLoading model (CPUExecutionProvider) ...")
    try:
        sess, load_s, providers = build_session(model_path, args.intra_threads, args.inter_threads)
    except Exception as exc:
        print(f"\n[STOP] Could not create the ONNX Runtime session: {exc}")
        return 6

    inputs, outputs = describe_io(sess)
    meta = read_model_metadata(sess)

    class_names = {int(k): str(v) for k, v in (meta.get("classes_from_model") or {}).items()}
    classes_source = "onnx_metadata" if class_names else "model_card_fallback"
    if not class_names:
        class_names = {i: n for i, n in enumerate(FALLBACK_CLASSES)}

    # Guard against ever mistaking stand-in output for a real Liodon result.
    is_standin = (
        str(meta.get("custom_metadata_raw", {}).get("STANDIN_NOT_LIODON", "")).lower() == "true"
    )

    if not hash_ok:
        # --allow-standin was passed. It buys a pass ONLY for a file that says,
        # in its own metadata, that it is synthetic. Otherwise: hard stop.
        if not is_standin:
            print("\n[STOP] --allow-standin was given, but this file does not declare itself a")
            print("       synthetic stand-in (no STANDIN_NOT_LIODON=true in its ONNX metadata).")
            print("       Refusing to run against an unverified artifact.")
            return 4
        print("\n" + "!" * 78)
        print("!! WARNING: the loaded file is the SYNTHETIC STAND-IN graph, NOT Liodon.")
        print("!! Everything below validates PIPELINE MECHANICS ONLY. It says nothing")
        print("!! whatsoever about the Liodon model's behaviour or accuracy.")
        print("!" * 78)

    if args.imgsz is not None:
        imgsz, imgsz_source = args.imgsz, "cli"
    elif meta.get("imgsz_from_model"):
        imgsz, imgsz_source = int(meta["imgsz_from_model"]), "onnx_metadata"
    else:
        imgsz, imgsz_source = DEFAULT_IMGSZ, "model_card_fallback"

    print(f"Providers  : {providers}")
    print(f"Active     : {sess.get_providers()}")
    print(f"Model load : {ms(load_s)} ms")
    print(f"Inputs     : {[(i['name'], i['shape'], i['type']) for i in inputs]}")
    print(f"Outputs    : {[(o['name'], o['shape'], o['type']) for o in outputs]}")
    print(f"Classes    : {class_names}  (source: {classes_source})")
    print(f"imgsz      : {imgsz}  (source: {imgsz_source})")

    input_name = inputs[0]["name"]
    output_name = outputs[0]["name"]

    expected = [1, 3, imgsz, imgsz]
    if inputs[0]["shape"] and len(inputs[0]["shape"]) == 4:
        declared = inputs[0]["shape"]
        dynamic = [d for d in declared if not isinstance(d, int) or d <= 0]
        if not dynamic and declared != expected:
            print(
                f"\n[STOP] The model declares input shape {declared} but this run would "
                f"feed {expected}. Fix --imgsz so the tensor matches the graph."
            )
            return 7

    # ---- Inference -------------------------------------------------------
    out_dir.mkdir(parents=True, exist_ok=True)
    per_image = []

    for img_path in images:
        # Single image -> output/ holds detections.json + annotated.png directly,
        # exactly as specified. A folder -> one subfolder per image so runs do
        # not overwrite each other.
        target_dir = out_dir / img_path.stem if batch else out_dir
        target_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n--- {img_path.name} ---")
        try:
            result = process_one(
                sess, input_name, output_name, img_path, args, class_names, imgsz
            )
        except Exception as exc:
            print(f"[ERROR] {img_path}: {type(exc).__name__}: {exc}")
            return 8

        annotated = result.pop("annotated_image")
        png_path = target_dir / "annotated.png"
        annotated.save(png_path)

        document = {
            "schema": "liodon.detections/1",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "is_standin_not_liodon": is_standin,
            "engine": {
                "name": "Liodon Dental Panoramic Detector",
                "repository": MODEL_REPO_ID,
                "revision": MODEL_REPO_REVISION,
                "artifact": MODEL_FILENAME,
                "artifact_size_bytes": file_size,
                "artifact_sha256": digest,
                "artifact_sha256_expected": MODEL_SHA256,
                "artifact_verified": hash_ok,
                "architecture": "YOLO11-N (Ultralytics), exported to ONNX",
            },
            "runtime": {
                "onnxruntime_version": _ort_version(),
                "execution_provider": "CPUExecutionProvider",
                "available_providers": providers,
                "python": sys.version.split()[0],
                "platform": platform.platform(),
                "processor": platform.processor(),
            },
            "model_io": {"inputs": inputs, "outputs": outputs, "metadata": meta},
            "parameters": {
                "conf": args.conf,
                "iou": args.iou,
                "imgsz": imgsz,
                "imgsz_source": imgsz_source,
                "classes_source": classes_source,
                "letterbox": {
                    "pad_value": LETTERBOX_PAD_VALUE,
                    "resample": "BILINEAR",
                    "scale_rule": "min(imgsz/w, imgsz/h)",
                },
                "normalization": "float32, /255.0, HWC->CHW, batch=1",
            },
            "classes": {str(k): v for k, v in sorted(class_names.items())},
            "fidelity": {
                "preprocessing": "identical to the publisher's reference app.py (_letterbox)",
                "model_call": "identical (single input, single output, float32 NCHW)",
                "postprocessing_decode": "identical (class argmax, conf threshold, xywh->xyxy, letterbox un-pad)",
                "postprocessing_nms": "same greedy rule; see deviations_from_reference",
                "annotation_overlay": "cosmetic only; font/scale adapted for local rendering",
            },
            "deviations_from_reference": _deviations(),
            **result,
        }

        json_path = target_dir / "detections.json"
        json_path.write_text(json.dumps(document, indent=2, ensure_ascii=False), encoding="utf-8")

        print(f"  image      : {result['image']['width']}x{result['image']['height']}")
        print(f"  raw output : {result['raw_model_output']['shape']} "
              f"as {result['raw_model_output']['interpreted_layout']}")
        print(f"  preprocess : {result['timings_ms']['preprocess_ms']} ms")
        print(f"  inference  : {result['timings_ms']['inference_ms']} ms "
              f"(cold {result['timings_ms']['inference_cold_ms']} ms)")
        print(f"  postprocess: {result['timings_ms']['postprocess_ms']} ms")
        print(f"  total      : {result['timings_ms']['total_ms']} ms")
        print(f"  detections : {result['detection_count']} {result['counts_by_class']}")
        for r in result["detections"]:
            b = r["bbox"]
            print(f"    - {r['class_name']:<18} {r['confidence']:.3f}  "
                  f"[{b['x1']:.1f}, {b['y1']:.1f}, {b['x2']:.1f}, {b['y2']:.1f}]")
        print(f"  wrote      : {json_path}")
        print(f"  wrote      : {png_path}")

        per_image.append({"path": str(img_path), "detections": result["detection_count"],
                          "document": document, "json": str(json_path), "png": str(png_path)})

    # ---- Run report ------------------------------------------------------
    peak = probe_process_peak()
    report = {
        "report": "liodon run report",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "host": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python": sys.version.replace("\n", " "),
            "cpu_count_logical": os.cpu_count(),
        },
        "runtime": {
            "onnxruntime_version": _ort_version(),
            "available_providers": providers,
            "active_providers": sess.get_providers(),
            "intra_op_threads": args.intra_threads,
            "inter_op_threads": args.inter_threads,
        },
        "model": {
            "path": str(model_path),
            "size_bytes": file_size,
            "sha256": digest,
            "sha256_expected": MODEL_SHA256,
            "sha256_match": hash_ok,
            "input_shape": inputs[0]["shape"],
            "output_shape": outputs[0]["shape"],
            "classes": {str(k): v for k, v in sorted(class_names.items())},
            "imgsz": imgsz,
            "load_time_ms": ms(load_s),
        },
        "measurements": {
            "note": (
                "These numbers were produced by THIS run on THIS machine. They are "
                "reported, not predicted: do not treat any number here as an "
                "estimate for different hardware."
            ),
            "process_rss_before_bytes": per_image[0]["document"]["memory"]["rss_before_bytes"],
            "process_rss_after_bytes": per_image[0]["document"]["memory"]["rss_after_bytes"],
            "process_peak_working_set_bytes": peak,
            "images_processed": len(per_image),
            "per_image": [
                {
                    "image": p["path"],
                    "detections": p["detections"],
                    "timings_ms": p["document"]["timings_ms"],
                }
                for p in per_image
            ],
        },
        "outputs": [{"input": p["path"], "detections_json": p["json"], "annotated_png": p["png"]}
                    for p in per_image],
    }

    report_path = out_dir / "run_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nRun report : {report_path}")

    if not args.no_log:
        log_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        (log_dir / f"run_{stamp}.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        with open(log_dir / "runs.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "at": report["generated_at"],
                "model_sha256": digest,
                "images": len(per_image),
                "detections": sum(p["detections"] for p in per_image),
                "inference_ms": [p["document"]["timings_ms"]["inference_ms"] for p in per_image],
                "imgsz": imgsz,
                "conf": args.conf,
                "iou": args.iou,
                "providers": sess.get_providers(),
            }, ensure_ascii=False) + "\n")
        print(f"Run log    : {log_dir / f'run_{stamp}.json'}")

    print("\nDone. Validation is local and independent: nothing was written to, or read")
    print("from, the dental-clinic-system ERP by this runner.")
    return 0


def _deviations():
    """Every place this runner knowingly departs from the publisher's reference
    code, recorded in the output so the evidence trail is not silent about it."""
    return [
        {
            "where": "per-class NMS (_nms)",
            "kind": "bug workaround, decisions unchanged",
            "issue": (
                "The reference snippet applies a boolean mask built over the untruncated "
                "`order` (n elements) to `order[1:]` (n-1 elements), so NumPy raises "
                "IndexError for any non-empty input. The published Space cannot complete "
                "postprocessing once any detection clears the confidence threshold."
            ),
            "evidence": (
                "Reproduced in Arena by running the publisher's _iou/_nms snippet verbatim "
                "on 1-box and 2-box inputs; all cases raise IndexError."
            ),
            "resolution": (
                "Implemented the same greedy rule the code intends (highest score first, "
                "drop boxes with IoU >= threshold) without the indexing defect."
            ),
        }
    ]


def _ort_version():
    try:
        import onnxruntime as ort

        return ort.__version__
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
