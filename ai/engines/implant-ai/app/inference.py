"""
inference.py — Implant AI engine inference defaults.

Phase 19B, engine 2 of 3. Defaults follow the validated contract
(ai-validation/yolov8-8024, README.md + AUDIT.md fields 9-10) and the
Phase 19B specification:

    conf  : 0.35   (spec: detection confidence threshold for this model)
    iou   : 0.35   (NMS overlap threshold)
    imgsz : 640    (letterboxed to 1x3x640x640, grey 114 padding — AUDIT.md field 9)
"""

from __future__ import annotations

DEFAULT_CONF = 0.35
DEFAULT_IOU = 0.35
DEFAULT_IMGSZ = 640

# Bounding-box colour for the engine's annotated PNG — matches the
# FindingsViewer contract for this engine (#3b82f6, Phase 19B spec D15).
BOX_COLOR = "#3b82f6"
