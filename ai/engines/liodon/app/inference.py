"""
inference.py — Liodon preprocessing / decoding / NMS / postprocessing.

Source of truth: ai-validation/liodon/scripts/run_liodon.py, which is a
line-for-line re-implementation of the publisher's reference inference code
(liodon-ai/dental-panoramic-detector-space, app.py). This module ports those
functions unchanged so the service preserves the validated behaviour exactly:

    letterbox 640x640 (pad value 114, BILINEAR)
    float32 / 255.0, HWC -> CHW, batch 1
    raw output decode (4+nc, N) layout
    class argmax, confidence threshold (0.45)
    xywh -> xyxy, letterbox un-pad back to ORIGINAL image pixels
    per-class greedy NMS (IoU 0.35) — same rule as the reference, without the
    reference's documented off-by-one indexing defect (see _nms docstring;
    recorded in the validated runner's deviations_from_reference)

Do NOT "improve" anything here. If the model or the reference changes, update
the validated lab first, re-validate, and then mirror it here.
"""

from __future__ import annotations

import os

import numpy as np

# ============================================================================
# Constants — from the publisher's model card / reference Space, unchanged.
# ============================================================================

DEFAULT_CONF = 0.45
DEFAULT_IOU = 0.35
DEFAULT_IMGSZ = 640

FALLBACK_CLASSES = ["caries", "periapical_lesion", "impacted_tooth"]

CLASS_COLORS = ["#2196F3", "#00BCD4", "#FFFFFF"]

LETTERBOX_PAD_VALUE = 114

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


# ============================================================================
# Preprocessing — faithful to the reference app.py `_letterbox`
# ============================================================================


def letterbox(img, imgsz: int):
    """Resize+pad to imgsz x imgsz keeping aspect ratio. Returns the canvas
    and the geometry needed to map boxes back to original pixel space."""
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

    Python evaluates `order[1:]` before the comprehension, so the slice has
    n-1 elements while the mask is built over the still-untruncated `order`
    and has n elements. NumPy therefore raises IndexError — for *any*
    non-empty input, including a single detection. Reproduced in the
    validation lab against the snippet copied verbatim from the published
    Space.

    This is an off-by-one indexing slip, not a difference of intent: the rule
    the code is clearly written to express is standard greedy NMS (take the
    highest-scoring box, drop everything overlapping it above the threshold).
    That rule is implemented below unchanged, so the detections kept are the
    ones the publisher intended to keep.
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
    """Boxes + labels + legend, drawn onto a copy of the original image.

    The returned image is a NEW object; the input image is never modified.
    """
    from PIL import ImageDraw

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


def ms(seconds: float) -> float:
    return round(seconds * 1000.0, 2)
