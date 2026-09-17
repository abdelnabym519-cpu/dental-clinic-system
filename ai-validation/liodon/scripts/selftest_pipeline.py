#!/usr/bin/env python3
"""
selftest_pipeline.py — prove the runner's mechanics against the synthetic
stand-in graph, using coordinates derived independently by hand.

What this DOES verify
  - preprocessing letterbox geometry (scale / pad_x / pad_y) on a 2:1 image,
  - the YOLO11 (1, 4+nc, N) output decode,
  - confidence filtering,
  - per-class NMS actually suppressing a duplicate,
  - boxes mapped back into ORIGINAL image pixel space, correctly,
  - detections.json / annotated.png / run_report.json produced with real content,
  - the run is pinned to CPUExecutionProvider.

What this does NOT verify
  - anything about the Liodon model: its accuracy, its real detections, its real
    speed. The stand-in has no trained weights.

Run it after: pip install -r requirements.txt

Usage
-----
    python scripts/selftest_pipeline.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
STANDIN = LAB / "model" / "STANDIN_NOT_LIODON.onnx"
IMAGE = LAB / "input" / "_synthetic_panoramic_test.png"
OUT = LAB / "output" / "_selftest"

TOL = 1.5  # pixels


def main() -> int:
    sys.path.insert(0, str(HERE))

    if not STANDIN.exists() or not IMAGE.exists():
        print("[setup] generating stand-in graph and test image ...")
        rc = subprocess.call([sys.executable, str(HERE / "make_standin_onnx.py")])
        if rc != 0:
            print("[FAIL] could not build the stand-in")
            return 1

    # Ground truth, computed here rather than read from the runner.
    from make_standin_onnx import expected_original_boxes

    exp = expected_original_boxes()
    planned = exp["boxes"]

    print("=" * 74)
    print(" PIPELINE SELF-TEST (synthetic stand-in graph — NOT Liodon)")
    print("=" * 74)

    cmd = [
        sys.executable,
        str(HERE / "run_liodon.py"),
        "--input", str(IMAGE),
        "--model", str(STANDIN),
        "--output-dir", str(OUT),
        "--warmup", "0",
        "--log-dir", str(OUT),
        "--allow-standin",
    ]
    print("\n$ " + " ".join(cmd) + "\n")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    print(proc.stdout)
    if proc.returncode != 0:
        print(proc.stderr)
        print(f"[FAIL] runner exited with {proc.returncode}")
        return 1

    doc = json.loads((OUT / "detections.json").read_text(encoding="utf-8"))
    failures: list[str] = []

    def check(label: str, ok: bool, detail: str = ""):
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{'  ' + detail if detail else ''}")
        if not ok:
            failures.append(label)

    print("\nChecks")

    # 1. Execution provider pinned to CPU.
    prov = doc["runtime"]["execution_provider"]
    check("execution provider is CPUExecutionProvider", prov == "CPUExecutionProvider", prov)

    # 2. Class names picked up from the ONNX file itself.
    check(
        "class names read from ONNX metadata",
        doc["parameters"]["classes_source"] == "onnx_metadata",
        str(doc["classes"]),
    )

    # 3. imgsz resolved from model metadata.
    check("imgsz resolved from model metadata", doc["parameters"]["imgsz"] == 640,
          str(doc["parameters"]["imgsz"]))

    # 4. Raw output interpreted as (1, 4+nc, N).
    raw = doc["raw_model_output"]
    check("raw output shape is [1, 7, 8400]", raw["shape"] == [1, 7, 8400], str(raw["shape"]))
    check("layout detected as (4+nc, N)", "(4+nc, N)" in raw["interpreted_layout"],
          raw["interpreted_layout"])
    check("3 classes derived from channel count", raw["num_classes"] == 3, str(raw["num_classes"]))
    check("8400 anchor points", raw["num_anchor_points"] == 8400, str(raw["num_anchor_points"]))

    # 5. Confidence filter dropped the 0.31 box.
    check("conf filter removed the sub-threshold box", raw["candidates_before_nms"] == 4,
          f"candidates={raw['candidates_before_nms']} (expected 4 of 5)")

    # 6. NMS collapsed the overlapping pair.
    check("NMS suppressed the duplicate box", doc["detection_count"] == 3,
          f"detections={doc['detection_count']} (expected 3)")

    # 7. Each surviving detection matches the hand-computed original-space box.
    by_class = {}
    for d in doc["detections"]:
        by_class.setdefault(d["class_name"], []).append(d)

    expected_survivors = {
        "caries": [b for b in planned if b["class_id"] == 0 and b["confidence"] == 0.91],
        "periapical_lesion": [b for b in planned if b["class_id"] == 1 and b["confidence"] == 0.73],
        "impacted_tooth": [b for b in planned if b["class_id"] == 2],
    }
    for name, exp_boxes in expected_survivors.items():
        got = by_class.get(name, [])
        if len(got) != len(exp_boxes):
            check(f"{name}: count", False, f"got {len(got)}, expected {len(exp_boxes)}")
            continue
        e = exp_boxes[0]
        g = got[0]["bbox"]
        ok = (
            abs(g["x1"] - e["x1"]) <= TOL
            and abs(g["y1"] - e["y1"]) <= TOL
            and abs(g["x2"] - e["x2"]) <= TOL
            and abs(g["y2"] - e["y2"]) <= TOL
        )
        check(
            f"{name}: box maps back to original space",
            ok,
            f"got [{g['x1']:.1f},{g['y1']:.1f},{g['x2']:.1f},{g['y2']:.1f}] "
            f"expected [{e['x1']:.1f},{e['y1']:.1f},{e['x2']:.1f},{e['y2']:.1f}]",
        )
        conf_ok = abs(got[0]["confidence"] - e["confidence"]) < 1e-4
        check(f"{name}: confidence preserved", conf_ok, f"{got[0]['confidence']}")

    # 8. Outputs exist and the annotation is a real image.
    png = OUT / "annotated.png"
    report = OUT / "run_report.json"
    check("annotated.png written", png.exists(), f"{png.stat().st_size:,} bytes" if png.exists() else "")
    check("run_report.json written", report.exists())
    if png.exists():
        from PIL import Image

        with Image.open(png) as im:
            check(
                "annotated.png has the original image dimensions",
                im.size == (doc["image"]["width"], doc["image"]["height"]),
                f"{im.size}",
            )

    # 9. Instrumentation fields are present and non-null.
    t = doc["timings_ms"]
    check(
        "instrumentation present (load/inference/total)",
        all(k in t for k in ("preprocess_ms", "inference_ms", "postprocess_ms", "total_ms")),
        f"inference={t['inference_ms']}ms total={t['total_ms']}ms",
    )
    m = doc["memory"]
    check("process memory captured", m["rss_after_bytes"] is not None,
          f"rss={m['rss_after_bytes']}")

    # 10. The stand-in is unmistakably flagged.
    check("output flags itself as stand-in", doc.get("is_standin_not_liodon") is True)

    print("\n" + "=" * 74)
    if failures:
        print(f" SELF-TEST FAILED — {len(failures)} check(s): {failures}")
        print("=" * 74)
        return 1
    print(" SELF-TEST PASSED — pipeline mechanics verified end to end")
    print(" (This says nothing about the Liodon model itself.)")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
