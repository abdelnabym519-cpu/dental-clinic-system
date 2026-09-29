"""
capability_matrix.py — Dental task -> engine capability matrix (Phase 5, §9).

The matrix maps a DENTAL TASK to the specialised engine that covers it,
the required modality/input, the fallback, the output type and the human
review requirement.

Per §9 the matrix distinguishes SIX different states, recorded per task as
boolean levels (each backed by a named evidence artifact — nothing here is
"implied by latency" or "implied by a repo existing"):

    capability_declared         the task/engine pair is declared in code
    model_exists                the model identity is source-verified
    weights_verified            artifact present + SHA-256 verified
    local_inference_verified    an actual local inference run has evidence
    cpu_inference_verified      that run was CPU-only
    production_integrated       the engine is wired end-to-end (compose,
                                orchestrator routing, Next.js trigger)

overall:
    SUPPORTED   = all six levels true in the validation environment
    PARTIAL     = production_integrated but some evidence level unmet here
    UNVERIFIED  = model+weights exist but no real-inference evidence yet
    UNAVAILABLE = no engine covers the task (honest gap — never guessed)

These values are AUDIT DATA for the current environment (2026-09-30). They
are data, not code behaviour: changing them requires new evidence (a run,
a checksum, an integration), and the TS mirror is contract-tested against
this file so the two cannot drift silently.
"""

from __future__ import annotations

from typing import Any

CAPABILITY_OVERALL = ("SUPPORTED", "PARTIAL", "UNVERIFIED", "UNAVAILABLE")

# Evidence locations (the audit record for each level).
EV = {
    "liodon_weights": "ai-validation/liodon/MODEL_PROVENANCE.md (SHA from HF registry; HF unreachable from the validation environment 2026-09-30)",
    "meshsegnet_weights": "ai-validation/meshsegnet/reports/phase5_real_inference_{max,man}.json (SHA-256 verified from the official Tai-Hsien/MeshSegNet repository, 2026-09-30)",
    "meshsegnet_inference": "ai-validation/meshsegnet/reports/phase5_real_inference_{max,man}.json (real local CPU inference, real weights, 2026-09-30)",
    "implant_weights": "ai-validation/yolov8-8024/AUDIT.md (SHA from HF registry; HF unreachable from the validation environment 2026-09-30)",
    "orthodontic_weights": "ai-validation/cldetection2023/AUDIT.md (operator-verified SHA; Google Drive distribution route unreachable from the validation environment)",
    "orthodontic_control": "ai-validation/cldetection2023/reports/engine6_control_run.json (random-weight control run — mechanism only, NOT model output)",
    "integration": "ai-compose.yml (CPU-only containers) + ai/orchestrator/app/main.py (routing, validation, provenance) + app/api/imaging/studies/route.ts (modality->engine trigger)",
}

_LEVELS = dict(
    capability_declared=True,
    model_exists=True,
    weights_verified=False,
    local_inference_verified=False,
    cpu_inference_verified=False,
    production_integrated=True,
)


def _levels(**over: bool) -> dict[str, bool]:
    out = dict(_LEVELS)
    out.update(over)
    return out


def _overall(levels: dict[str, bool]) -> str:
    if all(levels.values()):
        return "SUPPORTED"
    if levels["production_integrated"] and levels["weights_verified"]:
        return "PARTIAL"
    if levels["weights_verified"] and levels["model_exists"]:
        return "UNVERIFIED"
    return "PARTIAL" if levels["production_integrated"] else "UNAVAILABLE"


def _task(task: str, modality: str, engine: str, input_spec: str, output: str,
          fallback: str, levels: dict[str, bool], review: str, note: str) -> dict[str, Any]:
    return {
        "task": task,
        "modality": modality,
        "engine": engine,
        "required_input": input_spec,
        "output_type": output,
        "fallback": fallback,
        "human_review": review,
        "levels": levels,
        "overall": _overall(levels),
        "note": note,
    }


# ---------------------------------------------------------------------------
# The matrix (audit of 2026-09-30 — see EV for the evidence of each level).
# ---------------------------------------------------------------------------

CAPABILITY_MATRIX: list[dict[str, Any]] = [
    _task(
        "panoramic_caries_detection", "PANORAMIC", "liodon",
        "JPEG/PNG panoramic dental X-ray",
        "findings (bounding boxes; classes: caries, periapical_lesion, impacted_tooth)",
        "none — honest unavailable; clinician reads the radiograph (no substitute engine)",
        _levels(),
        "REQUIRED",
        "Weights (best.onnx, SHA 4cee38b5...) publish only on Hugging Face, which is "
        "unreachable from the validation environment; the operator-verified artifact "
        "path exists (run_liodon.py). On a deployment with the verified weights this "
        "task is fully operational end-to-end.",
    ),
    _task(
        "panoramic_impacted_tooth_detection", "PANORAMIC", "liodon",
        "JPEG/PNG panoramic dental X-ray",
        "findings (bounding boxes; class: impacted_tooth)",
        "none — honest unavailable; clinician reads the radiograph",
        _levels(),
        "REQUIRED",
        "Same engine/weights situation as panoramic_caries_detection.",
    ),
    _task(
        "periapical_lesion_detection", "PERIAPICAL", "implant-ai",
        "JPEG/PNG periapical radiograph",
        "findings (instance masks; 8 classes incl. Periapical lesion, Caries, Missing teeth)",
        "none — honest unavailable; clinician reads the radiograph",
        _levels(),
        "REQUIRED",
        "Weights (8024.pt, SHA e7cc1377...) publish only on Hugging Face, unreachable "
        "from the validation environment; operator-verified SHA on the operator machine.",
    ),
    _task(
        "bitewing_caries_detection", "BITEWING", "implant-ai",
        "JPEG/PNG bitewing radiograph",
        "findings (instance masks; class: Caries)",
        "none — honest unavailable; clinician reads the radiograph",
        _levels(),
        "REQUIRED",
        "Same engine/weights situation as periapical_lesion_detection.",
    ),
    _task(
        "dental_mesh_segmentation", "THREE_D_SCAN", "meshsegnet-max",
        "triangular surface mesh (obj/stl/vtk/ply), millimetre units, upper jaw",
        "segments (per-cell class histogram; 15 classes = gingiva + 14 teeth, neutral names)",
        "meshsegnet-man for mandibular scans; otherwise none — honest unavailable",
        _levels(
            weights_verified=True,
            local_inference_verified=True,
            cpu_inference_verified=True,
        ),
        "REQUIRED",
        "Weights downloaded from the official Tai-Hsien/MeshSegNet repository and "
        "SHA-256 verified in the validation environment; real CPU inference evidence: "
        + EV["meshsegnet_inference"] + ". Mandible variant: task dental_mesh_segmentation_mandible.",
    ),
    _task(
        "dental_mesh_segmentation_mandible", "THREE_D_SCAN", "meshsegnet-man",
        "triangular surface mesh (obj/stl/vtk/ply), millimetre units, lower jaw",
        "segments (per-cell class histogram; 15 classes, neutral names)",
        "none beyond meshsegnet-max for maxillary scans — honest unavailable",
        _levels(
            weights_verified=True,
            local_inference_verified=True,
            cpu_inference_verified=True,
        ),
        "REQUIRED",
        "Same evidence as the maxillary variant (separate weights, separate run).",
    ),
    _task(
        "cbct_surface_segmentation", "CBCT", "meshsegnet-max",
        "triangular surface mesh extracted from CBCT (the engine consumes meshes, not voxel volumes)",
        "segments (15 classes, neutral names)",
        "none for raw CBCT volume analysis — volume segmentation (ToothFairy-class) has no engine in this repository; deferred to a later phase",
        _levels(
            weights_verified=True,
            local_inference_verified=True,
            cpu_inference_verified=True,
        ),
        "REQUIRED",
        "MeshSegNet is a surface-mesh model; a CBCT voxel volume must be surfaced first. "
        "Raw-volume multi-structure segmentation is deliberately NOT claimed.",
    ),
    _task(
        "cephalometric_landmark_detection", "CEPHALOMETRIC", "orthodontic-ai",
        "JPEG/PNG lateral cephalometric X-ray",
        "landmarks (38 cephalometric landmarks, numeric ids — no official anatomical label map is published)",
        "none — honest unavailable; clinician measures landmarks",
        _levels(),
        "REQUIRED",
        "Mechanism proven end-to-end on a random-weight control run (20.38 s, 1.82 GB, "
        "CPU); the real checkpoint (SHA fb1a781a...) is distributed via Google Drive, "
        "unreachable from the validation environment — no real-weight output exists yet.",
    ),
    _task(
        "orthodontic_analysis", "CEPHALOMETRIC", "orthodontic-ai",
        "JPEG/PNG lateral cephalometric X-ray",
        "landmarks (38; numeric ids)",
        "none — honest unavailable; clinician analysis",
        _levels(),
        "REQUIRED",
        "Orthodontic analysis is exposed through the 38-landmark output; no angular "
        "measurements or diagnosis are computed (no clinical-interpretation step is "
        "implemented — interpretation remains with the clinician).",
    ),
    _task(
        "cbct_multi_structure_segmentation", "CBCT", None,
        "CBCT voxel volume (.nii.gz / .mha)",
        "multi-structure segmentation mask (not implemented)",
        "none — UNAVAILABLE; the ToothFairy-class model is access-gated (Grand Challenge) "
        "and has no engine in this repository",
        dict(capability_declared=False, model_exists=False, weights_verified=False,
             local_inference_verified=False, cpu_inference_verified=False,
             production_integrated=False),
        "REQUIRED",
        "Honest gap (spec §9: do not claim unsupported capabilities). Deferred work — "
        "see docs/DENTORA_AI_PHASE5_LOCAL_AI_MODEL_STRATEGY.md §18/§19.",
    ),
]


def get_task(task: str) -> dict[str, Any] | None:
    for row in CAPABILITY_MATRIX:
        if row["task"] == task:
            return row
    return None


def resolve(task: str, modality: str | None = None) -> dict[str, Any]:
    """Deterministic capability resolution (spec §13 — no LLM involved).

    Returns the matrix row for the task (modality cross-checked when given),
    or a typed rejection. Never guesses: an unknown task or modality mismatch
    is a structured failure, not a best effort.
    """
    row = get_task(task)
    if row is None:
        return {
            "ok": False,
            "error": f"UNSUPPORTED_CAPABILITY: {task!r} is not in the capability matrix",
        }
    if row["engine"] is None:
        return {"ok": True, "task": row, "resolvable": False,
                "reason": row["fallback"]}
    if modality is not None and modality.upper() != row["modality"]:
        return {
            "ok": False,
            "error": f"MODALITY_MISMATCH: task {task!r} requires {row['modality']}, "
                     f"got {modality!r}",
        }
    return {"ok": True, "task": row, "resolvable": True, "reason": None}


def public_view() -> list[dict[str, Any]]:
    """What GET /engines returns: the full matrix (it carries no secrets —
    no weights, no paths, no patient data)."""
    return [
        {
            "task": r["task"],
            "modality": r["modality"],
            "engine": r["engine"],
            "required_input": r["required_input"],
            "output_type": r["output_type"],
            "fallback": r["fallback"],
            "human_review": r["human_review"],
            "levels": dict(r["levels"]),
            "overall": r["overall"],
            "note": r["note"],
        }
        for r in CAPABILITY_MATRIX
    ]
