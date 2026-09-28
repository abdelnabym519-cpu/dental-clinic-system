"""
registry.py — D4, Model & Engine Registry (Phase 19A + 19B).

Explicit, code-pinned registry. The orchestrator does NOT discover model
files on disk and does not choose artifacts dynamically: every engine it can
route to is declared here with its exact validated model, and the checksum
is the identity of the artifact (a mismatched checksum means a different
model, full stop).

Liodon entry mirrors ai-validation/liodon (MODEL_PROVENANCE.md) and the
liodon-engine's own registry (ai/engines/liodon/app/model.py). The
MeshSegNet entries mirror ai-validation/meshsegnet (MODEL_PROVENANCE.md)
and each engine's own registry (ai/engines/meshsegnet-{max,man}/app/model.py).
The single source of truth for each artifact is the validation lab; these
copies are cross-checked by tests.
"""

from __future__ import annotations

ORCHESTRATOR_VERSION = "19B.0.0"

# Expected SHA-256 of the validated Liodon artifact. MUST match
# ai-validation/liodon/MODEL_PROVENANCE.md and
# ai-validation/liodon/scripts/run_liodon.py::MODEL_SHA256.
LIODON_EXPECTED_SHA256 = "4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71"

# Expected SHA-256 of the validated MeshSegNet artifacts. MUST match
# ai-validation/meshsegnet/MODEL_PROVENANCE.md §2 and
# scripts/verify_artifacts.py::EXPECTED (values taken from the official
# Tai-Hsien/MeshSegNet repository itself).
MESHSEGNET_MAX_EXPECTED_SHA256 = "727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2"
MESHSEGNET_MAN_EXPECTED_SHA256 = "d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf"

# Modalities the orchestrator will accept per engine. Liodon: PANORAMIC only
# (19A decision, D10.1). MeshSegNet: 3D surface-mesh modalities (19B, D14).
# Implant AI: the 2D radiographs that are NOT panoramic (19B spec D14):
# PERIAPICAL + BITEWING. Stored in uppercase to match the Prisma
# StudyModality enum.
LIODON_SUPPORTED_MODALITIES = ["PANORAMIC"]
MESHSEGNET_SUPPORTED_MODALITIES = ["THREE_D_SCAN", "CBCT"]
IMPLANT_SUPPORTED_MODALITIES = ["PERIAPICAL", "BITEWING"]
# Orthodontic AI: lateral cephalograms only (19B spec D14) — the StudyModality
# CEPHALOMETRIC value is added to the Prisma schema by an additive migration.
ORTHODONTIC_SUPPORTED_MODALITIES = ["CEPHALOMETRIC"]
ORTHODONTIC_NUM_LANDMARKS = 38

# Orthodontic AI: the 38 cephalometric landmark ids. The repository's own
# metainfo names the keypoints "0".."37" (numeric placeholders) and no
# official anatomical label map is published, so the model's own vocabulary
# is what is reported — never invented clinical names (same provenance rule
# as MeshSegNet's neutral names).
ORTHODONTIC_LANDMARKS = {i: str(i) for i in range(ORTHODONTIC_NUM_LANDMARKS)}
ORTHODONTIC_LANDMARKS_NOTE = (
    "38 cephalometric landmarks; the repository's metainfo names them "
    "\"0\"..\"37\" and no official anatomical label map is published, so the "
    "model's own vocabulary is reported (numeric ids are the recorded "
    "identity)."
)

# Neutral MeshSegNet class names — the official repository publishes NO
# label-to-tooth-name map (provenance §3), so numeric ids are the identity
# and names are neutral (Gingiva, Tooth_1..Tooth_14).
MESHSEGNET_CLASSES = {i: name for i, name in
                      zip(range(15), ["Gingiva"] + [f"Tooth_{i}" for i in range(1, 15)])}

MESHSEGNET_CLASSES_NOTE = (
    "15 classes = gingiva + 14 teeth (second molar to second molar). "
    "No official label-to-tooth-name mapping exists; numeric ids are "
    "the recorded identity."
)

# Expected identity of the audited implant checkpoint (MUST match
# ai-validation/yolov8-8024/README.md + AUDIT.md fields 5-6 and the engine's
# own registry, ai/engines/implant-ai/app/model.py).
IMPLANT_EXPECTED_SHA256 = "e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98"
IMPLANT_SIZE_BYTES = 143_955_443

# Expected identity of the audited CLDetection2023 checkpoint (MUST match
# ai-validation/cldetection2023/AUDIT.md fields 5-6 and the engine's own
# registry, ai/engines/orthodontic-ai/app/model.py).
ORTHODONTIC_EXPECTED_SHA256 = "fb1a781ac1c83149b379cb15724e3b0fae06ba2d567978f35c61e9d06b46fdcc"
ORTHODONTIC_SIZE_BYTES = 268_846_952

# The 8 class labels read from 8024.pt's OWN bytes (AUDIT.md field 11) — the
# model card spells three of them differently and the file's wording is never
# replaced (audit rule), so these are exactly what findings report.
IMPLANT_CLASSES = {
    0: "Caries",
    1: "Crown",
    2: "Filling",
    3: "Implant",
    4: "Missing teeth",
    5: "Periapical lesion",
    6: "Root Piece",
    7: "Root canal obturation",
}


def _meshsegnet_entry(name: str, jaw: str, checksum: str, size: int, filename: str) -> dict:
    return {
        "name": name,
        "display_name": f"MeshSegNet ({jaw}) — 15-class dental surface segmentation",
        "publisher": "Chunfeng Lian & Tai-Hsien Wu (official repository)",
        "model_version": "1.0.0",
        "model_checksum": checksum,
        "model_size_bytes": size,
        "model_source": (
            f"https://github.com/Tai-Hsien/MeshSegNet@master (models/{filename})"
        ),
        "model_license": "MIT",
        "input_spec": "triangular surface mesh (obj/stl/vtk/ply), millimetre units",
        # Tensor layout is variable-length over cells (N): X (1,15,N),
        # A_S/A_L (1,N,N), output (1,N,15). N is capped by the official
        # 10,000-cell decimation rule — recorded here for information.
        "tensor_input": [1, 15, 10000],
        "tensor_output": [1, 10000, 15],
        "classes": dict(MESHSEGNET_CLASSES),
        "classes_note": MESHSEGNET_CLASSES_NOTE,
        "jaw": jaw,
        "runtime": "torch (CPU)",
        "device": "cpu",
        "supported_modalities": list(MESHSEGNET_SUPPORTED_MODALITIES),
        "model_path": f"/app/models/{filename}",
        "result_kind": "segments",
    }


class EngineRegistry:
    """Read-only registry of engines this orchestrator can route to."""

    def __init__(self) -> None:
        self._engines: dict[str, dict] = {
            "liodon": {
                "name": "liodon",
                "display_name": "Liodon Dental Panoramic Detector",
                "publisher": "liodon-ai",
                "model_version": "1.0.0",
                "model_checksum": LIODON_EXPECTED_SHA256,
                "model_size_bytes": 10_605_711,
                "model_source": (
                    "https://huggingface.co/liodon-ai/dental-panoramic-detector"
                    "@8bef2036b099e80e51f93f24de4b0c0edd366256"
                ),
                "model_license": "CC-BY-NC-4.0",
                "input_spec": "JPEG/PNG panoramic dental X-ray",
                "tensor_input": [1, 3, 640, 640],
                "tensor_output": [1, 7, 8400],
                "classes": {0: "caries", 1: "periapical_lesion", 2: "impacted_tooth"},
                "runtime": "onnxruntime",
                "device": "cpu",
                "supported_modalities": LIODON_SUPPORTED_MODALITIES,
                # Explicit model path inside the engine container (read-only
                # mount). The registry references it — it never scans a
                # directory and never picks "whatever file is there".
                "model_path": "/app/models/liodon/best.onnx",
                "result_kind": "findings",
            },
            "meshsegnet-max": _meshsegnet_entry(
                "meshsegnet-max", "maxilla",
                MESHSEGNET_MAX_EXPECTED_SHA256, 28_860_102,
                "MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip",
            ),
            "meshsegnet-man": _meshsegnet_entry(
                "meshsegnet-man", "mandible",
                MESHSEGNET_MAN_EXPECTED_SHA256, 28_866_886,
                "MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip",
            ),
            # Phase 19B engine 2 — YOLOv8 instance segmentation for
            # periapical / bitewing radiographs (ai-validation/yolov8-8024).
            "implant-ai": {
                "name": "implant-ai",
                "display_name": "Implant AI — YOLOv8-seg dental radiograph findings (8 classes)",
                "publisher": "nsitnov",
                "model_version": "1.0.0",
                "model_checksum": IMPLANT_EXPECTED_SHA256,
                "model_size_bytes": IMPLANT_SIZE_BYTES,
                "model_source": (
                    "https://huggingface.co/nsitnov/8024-yolov8-model"
                    "@0304179670f4838bf0dec1053b963112a16a66cf (8024.pt)"
                ),
                "model_license": (
                    "Apache-2.0 (weights as published); restricted loader: "
                    "ultralytics 8.4.155 (AGPL-3.0) — "
                    "ai-validation/yolov8-8024/AUDIT.md"
                ),
                "input_spec": "JPEG/PNG dental X-ray (periapical / bitewing)",
                "tensor_input": [1, 3, 640, 640],
                "tensor_output": [1, 44, 8400],
                "classes": dict(IMPLANT_CLASSES),
                "classes_note": (
                    "8 labels read from the checkpoint's own bytes "
                    "(ai-validation/yolov8-8024, AUDIT.md field 11)"
                ),
                "runtime": "ultralytics 8.4.155 (restricted loader) / torch (CPU)",
                "device": "cpu",
                "supported_modalities": list(IMPLANT_SUPPORTED_MODALITIES),
                "model_path": "/app/models/8024.pt",
                "result_kind": "findings",
            },
            # Phase 19B engine 3 — 38 cephalometric landmarks on lateral
            # cephalograms (ai-validation/cldetection2023). The input is not
            # fixed-size (the whole radiograph is fed whole-image, exactly
            # like the repository's own validation loop), so there is no
            # tensor_input/tensor_output to pin — the audited input identity
            # is the SHA-256-verified image bytes, as for all image engines.
            "orthodontic-ai": {
                "name": "orthodontic-ai",
                "display_name": "Orthodontic AI — 38 cephalometric landmarks (CLDetection2023)",
                "publisher": "Team SUTD-VLG (MICCAI CLDetection2023 winning solution)",
                "model_version": "1.0.0",
                "model_checksum": ORTHODONTIC_EXPECTED_SHA256,
                "model_size_bytes": ORTHODONTIC_SIZE_BYTES,
                "model_source": (
                    "https://github.com/5k5000/CLdetection2023"
                    "@18d17d1934970016e7610c4849311900b8d1f191 "
                    "(model/model_pretrained_on_train_and_val.pth)"
                ),
                "model_license": (
                    "Apache-2.0 (repository); restricted loader: bounded "
                    "safe-globals allow-list + strict weights_only torch.load "
                    "— ai-validation/cldetection2023/AUDIT.md §7"
                ),
                "input_spec": "JPEG/PNG lateral cephalometric X-ray",
                "classes": dict(ORTHODONTIC_LANDMARKS),
                "classes_note": ORTHODONTIC_LANDMARKS_NOTE,
                "num_landmarks": ORTHODONTIC_NUM_LANDMARKS,
                "runtime": "mmpose 1.0.0 fork / mmcv-lite 2.1.0 / mmengine 0.10.7 / torch (CPU)",
                "device": "cpu",
                "supported_modalities": list(ORTHODONTIC_SUPPORTED_MODALITIES),
                "model_path": "/app/models/model_pretrained_on_train_and_val.pth",
                "result_kind": "landmarks",
            },
        }

    def get(self, name: str) -> dict | None:
        return self._engines.get(name)

    def names(self) -> list[str]:
        return sorted(self._engines)

    def public_view(self) -> list[dict]:
        """What GET /engines returns (no secrets — there are none here)."""
        out = []
        for e in self._engines.values():
            out.append({
                "name": e["name"],
                "display_name": e["display_name"],
                "model_version": e["model_version"],
                "model_checksum": e["model_checksum"],
                "model_source": e["model_source"],
                "model_license": e["model_license"],
                "runtime": e["runtime"],
                "device": e["device"],
                "classes": {str(k): v for k, v in sorted(e["classes"].items())},
                "supported_modalities": list(e["supported_modalities"]),
                "result_kind": e.get("result_kind", "findings"),
            })
        return out


registry = EngineRegistry()
