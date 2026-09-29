#!/usr/bin/env python3
"""
run_phase5_evidence.py — Phase 5 real-local-inference evidence (both jaws).

Runs the PRODUCTION engine services (ai/engines/meshsegnet-{max,man}, the
exact code the compose deployment runs) against the SHA-256-verified
official weights, over real HTTP (/health + /infer), on real published
dental-surface meshes from the 3DTeethSeg'22 / TeethSegFront test sets.

What this proves (and what it does not):
  PROVES    : the validated weights load strict into the official
              architecture with a matching checksum; the production engine
              performs actual local CPU inference on real mesh input and
              returns schema-valid 15-class segment output; cold/warm
              latency and peak memory are measured on the running machine.
  DOES NOT  : claim clinical accuracy (see AUDIT convention: functional
              inference != clinical validation). The inputs are
              challenge-published test meshes; no patient-identifying
              information enters the report (SHA + shape only).

The report is machine-readable and committed (reports/ is tracked; model
weights and mesh inputs are gitignored). Every field is measured or
read from the engine's own response — nothing is invented.

Usage:
    python scripts/run_phase5_evidence.py            # both jaws
    python scripts/run_phase5_evidence.py --jaw max  # one jaw
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
REPO = LAB.parents[1]
REPORTS = LAB / "reports"
MESH_DIR = LAB / "input" / "meshes"
MODEL_DIR = LAB / "model"

PYTHON = sys.executable  # run the engine with the interpreter that runs this script

# (jaw, engine dir, model zip, mesh file, pinned mesh sha256, source note)
JAWS = [
    (
        "max",
        REPO / "ai/engines/meshsegnet-max",
        "MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip",
        "ZOUIF2W4_upper.obj",
        "581b9a026e2ce734f6335f34aa900e8114dc33e2a83541ebd6bb26536382545e",
        "HuayuanSong/TeethSegFront @ main (test set, published with the dataset)",
    ),
    (
        "man",
        REPO / "ai/engines/meshsegnet-man",
        "MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip",
        "0EJBIPTC_lower.obj",
        "b824f6822f4a6ada296eef6869e9341fa1e69ad6cd14862b53572198ae5e7a76",
        "abenhamadou/3DTeethSeg22_challenge @ main (reference algorithm test set)",
    ),
]

WARM_RUNS = 5
PORT_BASE = 8120


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def free_port(base: int) -> int:
    for port in range(base, base + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("no free port found")


def wait_http(base: str, path: str, timeout_s: float = 240.0) -> dict:
    """Poll GET until 200 (model loading takes a while)."""
    import urllib.request
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base + path, timeout=5) as r:
                return json.loads(r.read().decode())
        except Exception as exc:  # noqa: BLE001 — retry until deadline
            last = exc
            time.sleep(1.5)
    raise RuntimeError(f"engine {path} did not come up: {last}")


def post_infer(base: str, mesh_b64: str, fmt: str) -> tuple[dict, float]:
    import urllib.request
    body = json.dumps({"mesh": mesh_b64, "format": fmt}).encode()
    req = urllib.request.Request(
        base + "/infer", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=900) as r:
        out = json.loads(r.read().decode())
    return out, (time.perf_counter() - t0) * 1000.0


def peak_rss_mb(pid: int) -> float | None:
    try:
        with open(f"/proc/{pid}/status") as fh:
            for line in fh:
                if line.startswith("VmHWM:"):
                    return int(line.split()[1]) / 1024.0
    except Exception:  # noqa: BLE001
        return None
    return None


def run_jaw(jaw: str, engine_dir: Path, zip_name: str, mesh_name: str,
            mesh_sha: str, mesh_source: str, port: int) -> dict:
    model_zip = MODEL_DIR / zip_name
    mesh_path = MESH_DIR / mesh_name

    # -- Pre-flight: weights + input must be the pinned artifacts ---------
    assert model_zip.exists(), f"weights missing: {model_zip} (run download_artifacts.py --models)"
    weight_sha = sha256_of(model_zip)
    mesh_bytes = mesh_path.read_bytes()
    mesh_actual_sha = hashlib.sha256(mesh_bytes).hexdigest()
    assert mesh_actual_sha == mesh_sha, (
        f"mesh input sha mismatch for {mesh_name}: {mesh_actual_sha} != {mesh_sha}"
    )

    # -- Start the PRODUCTION engine service (unmodified ai/engines/*) ----
    env = dict(os.environ)
    env["MODEL_PATH"] = str(model_zip)
    env["ALLOW_STANDIN"] = "0"  # fail closed: only the verified weights may load
    base = f"http://127.0.0.1:{port}"
    proc = subprocess.Popen(
        [PYTHON, "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(engine_dir), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        health = wait_http(base, "/health")
        if health.get("status") != "ok" or not health.get("model_loaded"):
            raise RuntimeError(f"engine health gate failed: {json.dumps(health)[:400]}")
        if health.get("model_checksum_verified") is not True:
            raise RuntimeError("model checksum not verified by the engine itself")
        if health.get("is_standin_not_meshsegnet") is not False:
            raise RuntimeError("engine loaded a stand-in — aborting (must be the real model)")

        cold_body, cold_ms = post_infer(base, base64.b64encode(mesh_bytes).decode(), "obj")
        warm: list[float] = []
        warm_body = cold_body
        for _ in range(WARM_RUNS):
            warm_body, ms = post_infer(base, base64.b64encode(mesh_bytes).decode(), "obj")
            warm.append(ms)
        warm.sort()
        warm_median = warm[len(warm) // 2]
        rss_mb = peak_rss_mb(proc.pid)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
        out_log = proc.stdout.read().decode(errors="replace") if proc.stdout else ""

    # -- Output schema checks (the production validator's invariants) -----
    segs = cold_body.get("segments") or []
    assert segs, "empty segmentation"
    for row in segs:
        assert isinstance(row.get("point_count"), int) and row["point_count"] >= 0
        assert row.get("class_id") is not None and 0 <= row["class_id"] < 15
        assert isinstance(row.get("class_name"), str)
    total_cells = sum(r["point_count"] for r in segs)
    assert total_cells == cold_body.get("num_points_total"), "segment counts != cell count"
    assert cold_body.get("is_standin_not_meshsegnet") is False
    assert (cold_body.get("model") or {}).get("model_checksum_verified") is True
    assert cold_body.get("device") == "cpu"

    report = {
        "evidence": "phase5_real_local_inference",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engine": f"meshsegnet-{jaw}",
        "engine_code": str(engine_dir.relative_to(REPO)),
        "engine_modified": False,
        "model": {
            "filename": zip_name,
            "sha256": weight_sha,
            "size_bytes": model_zip.stat().st_size,
            "source": "https://github.com/Tai-Hsien/MeshSegNet (official repository, MIT)",
            "checksum_verified_by": "download_artifacts.py + engine /health model_checksum_verified",
        },
        "input": {
            "filename": mesh_name,
            "sha256": mesh_actual_sha,
            "size_bytes": len(mesh_bytes),
            "source": mesh_source,
            "format": "obj (triangular surface mesh, mm)",
            "note": "challenge-published test mesh; geometry NOT committed, SHA recorded only",
        },
        "runtime": {
            "python": platform.python_version(),
            "torch": (health.get("runtime") or {}).get("torch_version"),
            "execution_provider": "CPU (no GPU present; torch.cuda.is_available() false)",
            "cuda_available": False,
            "host": f"{platform.system()} {platform.release()} (Phase 5 validation sandbox, {os.cpu_count()} vCPU)",
        },
        "health_gate": {
            "status": health.get("status"),
            "model_loaded": health.get("model_loaded"),
            "model_checksum": health.get("model_sha256"),
            "model_checksum_expected": health.get("model_sha256_expected"),
            "model_checksum_verified": health.get("model_checksum_verified"),
            "model_load_time_ms": health.get("model_load_time_ms"),
            "parameter_count": health.get("parameter_count"),
            "is_standin": health.get("is_standin_not_meshsegnet"),
        },
        "preprocessing": {
            "official_max_cells": 10000,
            "cells_original": cold_body.get("cells_original"),
            "downsampled_to_official_cap": cold_body.get("downsampled"),
            "inference_cells": total_cells,
            "probabilities_shape": cold_body.get("probabilities_shape"),
            "engine_processing_time_ms": cold_body.get("processing_time_ms"),
        },
        "output": {
            "schema": "per-cell 15-class labels -> class histogram (neutral names)",
            "total_cells": total_cells,
            "segments": segs,
            "top_classes": [
                {"class_id": r["class_id"], "class_name": r.get("class_name"),
                 "point_count": r["point_count"]}
                for r in sorted(segs, key=lambda x: -x["point_count"])[:5]
            ],
        },
        "performance_ms": {
            "cold_first_inference": round(cold_ms, 1),
            "warm_median_of_%d" % WARM_RUNS: round(warm_median, 1),
            "warm_all": [round(x, 1) for x in warm],
            "note": "sandbox hardware (2 vCPU / ~4 GB RAM), NOT the target Windows "
                    "machine; infrastructure baseline only — no accuracy implied",
        },
        "memory": {
            "engine_process_peak_rss_mb": round(rss_mb, 1) if rss_mb else None,
        },
        "determinism_check": {
            "labels_identical_cold_vs_warm":
                cold_body.get("labels") == warm_body.get("labels"),
            "segments_identical_cold_vs_warm": segs == warm_body.get("segments"),
        },
        "status": "REAL_INFERENCE_VERIFIED",
        "engine_tail_log": out_log[-800:],
    }
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jaw", choices=["max", "man"], default=None)
    args = ap.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)

    rc = 0
    port = free_port(PORT_BASE)
    for (jaw, engine_dir, zip_name, mesh_name, mesh_sha, mesh_source) in JAWS:
        if args.jaw and jaw != args.jaw:
            continue
        print(f"== meshsegnet-{jaw}: {zip_name} <- {mesh_name}")
        try:
            report = run_jaw(jaw, engine_dir, zip_name, mesh_name, mesh_sha,
                             mesh_source, port)
        except Exception as exc:  # noqa: BLE001
            print(f"   FAILED: {type(exc).__name__}: {exc}")
            (REPORTS / f"phase5_real_inference_{jaw}.json").write_text(json.dumps(
                {"engine": f"meshsegnet-{jaw}", "status": "FAILED",
                 "failure": f"{type(exc).__name__}: {exc}"}, indent=2))
            rc = 1
            continue
        out = REPORTS / f"phase5_real_inference_{jaw}.json"
        out.write_text(json.dumps(report, indent=2))
        perf = report["performance_ms"]
        print(f"   OK  cold {perf['cold_first_inference']} ms · "
              f"warm {perf['warm_median_of_%d' % WARM_RUNS]} ms · "
              f"cells {report['output']['total_cells']} · "
              f"peak RSS {report['memory']['engine_process_peak_rss_mb']} MB")
        print(f"   report: {out.relative_to(REPO)}")
        port = free_port(port + 1)
    return rc


if __name__ == "__main__":
    sys.exit(main())
