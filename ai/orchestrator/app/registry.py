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
MESHSEGNET_MAX_EXPECTED_SHA256 = "727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d"
MESHSEGNET_MAN_EXPECTED_SHA256 = "d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf"

# Modalities the orchestrator will accept per engine. Liodon: PANORAMIC only
# (19A decision, D10.1). MeshSegNet: 3D surface-mesh modalities (19B, D14).
# Stored in uppercase to match the Prisma StudyModality enum.
LIODON_SUPPORTED_MODALITIES = ["PANORAMIC"]
MESHSEGNET_SUPPORTED_MODALITIES = ["THREE_D_SCAN", "CBCT"]

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
