#!/usr/bin/env python3
"""
make_standin_onnx.py — build a SYNTHETIC ONNX graph that only *mimics the I/O
signature* of the Liodon model, so the runner's plumbing can be exercised and
tested before (or without) the real weights.

    >>> THIS IS NOT THE LIODON MODEL. <<<

It contains no dental AI, no trained weights, and produces fixed boxes that are
meaningless. It is generated locally, in seconds, purely so that:

  - preprocessing (letterbox geometry) can be checked against hand-computed
    expected coordinates,
  - the YOLO11 output decode and the per-class NMS can be shown to work,
  - detections.json / annotated.png / run_report.json can be shown to be
    produced with the right contents.

Nothing here trains, converts, or modifies the published artifact. The real
run still requires the real best.onnx, verified by SHA-256.

Usage
-----
    python scripts/make_standin_onnx.py
    python scripts/make_standin_onnx.py --image-only
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

GRAPH_NAME = "STANDIN_NOT_LIODON"

# Letterbox-space (640x640) boxes deliberately placed so the expected
# original-image coordinates can be computed by hand in the self-test.
# Tuple: (anchor_index, cx, cy, w, h, class_id, confidence)
PLANNED = [
    (100, 200.0, 300.0, 60.0, 50.0, 0, 0.91),   # caries
    (101, 205.0, 305.0, 58.0, 48.0, 0, 0.52),   # caries, heavy overlap -> NMS should drop it
    (102, 430.0, 320.0, 45.0, 40.0, 1, 0.73),   # periapical_lesion
    (103, 560.0, 300.0, 70.0, 60.0, 2, 0.80),   # impacted_tooth
    (104, 330.0, 330.0, 40.0, 40.0, 1, 0.31),   # below conf -> must be filtered out
]

NUM_ANCHORS = 8400
NUM_CHANNELS = 7  # 4 box + 3 classes


def build_base_tensor() -> np.ndarray:
    base = np.zeros((1, NUM_CHANNELS, NUM_ANCHORS), dtype=np.float32)
    # Neutral floor for every anchor: below any sane confidence threshold.
    base[0, 4:, :] = 0.01
    for anchor, cx, cy, w, h, cls_id, conf in PLANNED:
        base[0, 0, anchor] = cx
        base[0, 1, anchor] = cy
        base[0, 2, anchor] = w
        base[0, 3, anchor] = h
        base[0, 4 + cls_id, anchor] = conf
    return base


def build_standin(out_path: Path) -> Path:
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    base = build_base_tensor()

    inp = helper.make_tensor_value_info("images", TensorProto.FLOAT, [1, 3, 640, 640])
    out = helper.make_tensor_value_info("output0", TensorProto.FLOAT, [1, NUM_CHANNELS, NUM_ANCHORS])

    initializers = [
        numpy_helper.from_array(base, name="base"),
        numpy_helper.from_array(np.array(0.0, dtype=np.float32), name="zero"),
    ]

    # The tiny arithmetic on `images` exists only so the graph genuinely depends
    # on its input; a pure-constant output could be folded away by the optimiser.
    #
    # keepdims=0 and a 0-d `zero` are deliberate: they keep the broadcast result
    # at exactly (1, 7, 8400). With keepdims=1 the 4-d (1,1,1,1) multiplicand
    # broadcasts `base` up to (1, 1, 7, 8400) instead, which is the wrong rank.
    nodes = [
        helper.make_node("ReduceMean", ["images"], ["m"], keepdims=0),
        helper.make_node("Mul", ["m", "zero"], ["z"]),
        helper.make_node("Add", ["base", "z"], ["output0"]),
    ]

    graph = helper.make_graph(nodes, GRAPH_NAME, [inp], [out], initializer=initializers)
    model = helper.make_model(graph, producer_name="liodon-validation-lab (STAND-IN)")
    model.opset_import[0].version = 13

    model.metadata_props.add(key="STANDIN_NOT_LIODON", value="true")
    model.metadata_props.add(
        key="warning",
        value="SYNTHETIC TEST GRAPH. Not the Liodon model. No trained weights. Output is fabricated.",
    )
    model.metadata_props.add(
        key="names", value="{0: 'caries', 1: 'periapical_lesion', 2: 'impacted_tooth'}"
    )
    model.metadata_props.add(key="imgsz", value="640")
    model.metadata_props.add(key="stride", value="32")
    model.metadata_props.add(key="task", value="detect")
    model.metadata_props.add(key="batch", value="1")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(out_path))
    return out_path


def build_synthetic_panorama(out_path: Path, width: int = 2400, height: int = 1200) -> Path:
    """A wide, panoramic-shaped greyscale image: an arch of tooth-like blobs.

    The aspect ratio (2:1) is what matters — it forces a non-trivial letterbox
    (pad_y = 160, pad_x = 0 at imgsz 640) so the coordinate mapping is actually
    exercised rather than accidentally passing with scale=1.
    """
    from PIL import Image, ImageDraw, ImageFilter

    img = Image.new("L", (width, height), 18)
    draw = ImageDraw.Draw(img)

    # Jaw body.
    draw.ellipse([180, 260, width - 180, height - 180], outline=90, width=40)
    draw.ellipse([260, 320, width - 260, height - 240], outline=70, width=30)

    # Teeth: an upper arc and a lower arc.
    import math

    for i in range(16):
        t = i / 15.0
        x = 260 + t * (width - 520)
        y_up = 300 + int(90 * math.sin(math.pi * t))
        y_lo = height - 330 - int(70 * math.sin(math.pi * t))
        for y in (y_up, y_lo):
            w = 90
            h = 150
            draw.rounded_rectangle(
                [x - w // 2, y - h // 2, x + w // 2, y + h // 2],
                radius=22,
                fill=205,
                outline=140,
                width=5,
            )

    # A couple of brighter "lesion" spots so the picture is not uniform.
    draw.ellipse([700, 470, 790, 560], fill=120)
    draw.ellipse([1520, 690, 1600, 770], fill=130)

    img = img.filter(ImageFilter.GaussianBlur(1.2)).convert("RGB")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return out_path


def expected_original_boxes(width: int = 2400, height: int = 1200, imgsz: int = 640):
    """Recompute, independently of the runner, where each planned box should
    land in the original image. Used by the self-test as ground truth."""
    scale = min(imgsz / width, imgsz / height)
    new_w, new_h = round(width * scale), round(height * scale)
    pad_x, pad_y = (imgsz - new_w) // 2, (imgsz - new_h) // 2

    out = []
    for anchor, cx, cy, w, h, cls_id, conf in PLANNED:
        x1 = max(0.0, min(width, (cx - w / 2 - pad_x) / scale))
        y1 = max(0.0, min(height, (cy - h / 2 - pad_y) / scale))
        x2 = max(0.0, min(width, (cx + w / 2 - pad_x) / scale))
        y2 = max(0.0, min(height, (cy + h / 2 - pad_y) / scale))
        out.append(
            {
                "anchor": anchor,
                "class_id": cls_id,
                "confidence": conf,
                "x1": round(x1, 3),
                "y1": round(y1, 3),
                "x2": round(x2, 3),
                "y2": round(y2, 3),
            }
        )
    return {"scale": scale, "pad_x": pad_x, "pad_y": pad_y, "boxes": out}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the synthetic stand-in graph (NOT Liodon)")
    parser.add_argument("--image-only", action="store_true", help="Only regenerate the test image")
    args = parser.parse_args()

    lab_root = Path(__file__).resolve().parent.parent
    img_path = lab_root / "input" / "_synthetic_panoramic_test.png"

    print("=" * 74)
    print(" STAND-IN GENERATOR — this does NOT produce the Liodon model")
    print("=" * 74)

    if not args.image_only:
        onnx_path = lab_root / "model" / "STANDIN_NOT_LIODON.onnx"
        build_standin(onnx_path)
        print(f"wrote stand-in graph : {onnx_path}")
        print("  I/O signature      : images (1,3,640,640) float32 -> output0 (1,7,8400) float32")
        print("  metadata           : STANDIN_NOT_LIODON=true (the runner warns on this)")

    build_synthetic_panorama(img_path)
    print(f"wrote test image     : {img_path}")

    exp = expected_original_boxes()
    print(
        f"letterbox geometry   : scale={exp['scale']:.6f} pad_x={exp['pad_x']} pad_y={exp['pad_y']}"
    )
    print("\nExpected results (hand-computed, independent of the runner):")
    for b in exp["boxes"]:
        print(
            f"  class {b['class_id']} conf {b['confidence']:.2f} -> "
            f"[{b['x1']:.1f}, {b['y1']:.1f}, {b['x2']:.1f}, {b['y2']:.1f}]"
        )
    print("\nAfter NMS at iou=0.35 the two overlapping `caries` boxes collapse to one,")
    print("and the 0.31-confidence box falls below conf=0.45. Expect 3 detections.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
