"""
registry.py — D4, Model & Engine Registry.

Explicit, code-pinned registry. The orchestrator does NOT discover model
files on disk and does NOT choose artifacts dynamically: every engine it can
route to is declared here with its exact validated model, and the checksum is
the identity of the artifact (a mismatched checksum means a different model,
full stop).

Liodon entry mirrors ai-validation/liodon (MODEL_PROVENANCE.md) and the
liodon-engine's own registry (ai/engines/liodon/app/model.py) — the single
source of truth for the artifact is the validation lab; these two copies are
cross-checked by tests.
"""

from __future__ import annotations

ORCHESTRATOR_VERSION = "19A.0.0"

# Expected SHA-256 of the validated Liodon artifact. MUST match
# ai-validation/liodon/MODEL_PROVENANCE.md and
# ai-validation/liodon/scripts/run_liodon.py::MODEL_SHA256.
LIODON_EXPECTED_SHA256 = "4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71"

# Modalities the orchestrator will accept per engine (D10.1: only PANORAMIC
# goes to Liodon). Stored in uppercase to match the Prisma StudyModality enum.
LIODON_SUPPORTED_MODALITIES = ["PANORAMIC"]


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
            }
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
            })
        return out


registry = EngineRegistry()
