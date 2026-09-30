#!/usr/bin/env python3
"""
run_phase6_evidence.py — Phase 6 real-local-inference re-verification (both jaws).

Phase 6 routes 3D mesh attachments through the SAME Phase 5 engine registry:
agent tool `analyze_attachment` -> LocalAIService -> orchestrator registry ->
meshsegnet-{max,man} engine service -> real CPU inference. The engine services
are the terminal of that critical path, and the Phase 5 evidence artifacts
(weights, meshes, venv) were rebuilt in this sandbox after being lost.

This script re-runs the PRODUCTION engine services (ai/engines/meshsegnet-{max,man},
unmodified) with the SHA-256-verified official weights over real HTTP
(/health + /infer, cold + warm runs) on the same published dental-surface
meshes as Phase 5, and records a Phase 6 report next to the Phase 5 ones.

What this proves (and what it does not):
  PROVES    : the re-acquired weights load strict into the official
              architecture with a matching checksum; the production engine
              performs actual local CPU inference on real mesh input and
              returns schema-valid 15-class segment output; no stand-in model.
  DOES NOT  : claim clinical accuracy (functional inference != clinical
              validation). The inputs are challenge-published test meshes;
              no patient-identifying information enters the report.

Usage:
    python scripts/run_phase6_evidence.py            # both jaws
    python scripts/run_phase6_evidence.py --jaw max  # one jaw
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
REPO = LAB.parents[1]
REPORTS = LAB / "reports"

# Reuse the Phase 5 production driver verbatim (same gates, same asserts).
_spec = importlib.util.spec_from_file_location("phase5_evidence", HERE / "run_phase5_evidence.py")
p5 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(p5)

PHASE6_CONTEXT = {
    "why_this_report": (
        "Phase 6 (multimodal dental AI) analyzes 3D mesh attachments via the Phase 5 "
        "capability registry: analyze_attachment tool -> LocalAIService -> orchestrator "
        "registry -> meshsegnet engine service. The sandbox that produced the Phase 5 "
        "evidence lost its weights/meshes/venv; this re-run re-verifies the exact engine "
        "code the Phase 6 critical path calls, with re-acquired SHA-256-verified weights."
    ),
    "phase6_critical_path": [
        "chat upload -> POST /api/ai/attachments (magic-byte classification, SHA-256, tenant storage)",
        "agent loop -> analyze_attachment tool (typed contract, server-resolved attachment id)",
        "LocalAIService.resolveEngine (modality[, jaw] -> registry; engine names never from user text)",
        "orchestrator /analyze (job state machine, task->engine routing)",
        "meshsegnet-{max,man} engine /infer (THIS EVIDENCE: real local CPU inference)",
    ],
    "evidence_level": (
        "engine terminal re-verified on the rebuilt sandbox; orchestrator routing/registry "
        "covered by its pytest suite (66 tests); Node transport covered by the Phase 5/6 "
        "integration tests. MySQL is unavailable in this sandbox, so orchestrator job-row "
        "writes are not re-exercised here (no DB; see report limitations)."
    ),
}


def run(jaw: str) -> int:
    (jaw, engine_dir, zip_name, mesh_name, mesh_sha, mesh_source) = next(
        j for j in p5.JAWS if j[0] == jaw
    )
    port = p5.free_port(p5.PORT_BASE)
    print(f"== phase6 meshsegnet-{jaw}: {zip_name} <- {mesh_name}")
    try:
        report = p5.run_jaw(jaw, engine_dir, zip_name, mesh_name, mesh_sha, mesh_source, port)
    except Exception as exc:  # noqa: BLE001 — record the failure, fail loudly
        print(f"   FAILED: {type(exc).__name__}: {exc}")
        REPORTS.mkdir(parents=True, exist_ok=True)
        (REPORTS / f"phase6_real_inference_{jaw}.json").write_text(json.dumps(
            {"engine": f"meshsegnet-{jaw}", "status": "FAILED",
             "failure": f"{type(exc).__name__}: {exc}"}, indent=2))
        return 1

    report["evidence"] = "phase6_real_local_inference_rerun"
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    report["phase6_context"] = PHASE6_CONTEXT
    out = REPORTS / f"phase6_real_inference_{jaw}.json"
    out.write_text(json.dumps(report, indent=2))
    perf = report["performance_ms"]
    print(f"   OK  cold {perf['cold_first_inference']} ms · "
          f"cells {report['output']['total_cells']} · "
          f"peak RSS {report['memory']['engine_process_peak_rss_mb']} MB")
    print(f"   report: {out.relative_to(REPO)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jaw", choices=["max", "man"], default=None)
    args = ap.parse_args()
    os.chdir(LAB)
    REPORTS.mkdir(parents=True, exist_ok=True)
    rc = 0
    for jaw in ([args.jaw] if args.jaw else ["max", "man"]):
        rc |= run(jaw)
    return rc


if __name__ == "__main__":
    sys.exit(main())
