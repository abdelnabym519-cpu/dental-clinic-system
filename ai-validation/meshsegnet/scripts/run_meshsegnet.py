#!/usr/bin/env python3
"""
run_meshsegnet.py — run the REAL official MeshSegNet model on a REAL dental
mesh, on CPU, and record what actually happened.

This is the only script here that performs inference. It follows the official
prediction pipeline (`step5_predict.py` from Tai-Hsien/MeshSegNet,
MIT) with these documented differences, all of which are forced by the CPU-only
contract or by library-version drift — none of them changes the model or the
mathematics:

  1. The official script calls ``torch.cuda.set_device(gpu_id)`` unconditionally
     and therefore cannot execute on a machine without CUDA. This runner pins
     execution to the CPU (``torch.device("cpu")``) and never touches CUDA.
  2. The adjacency matrices A_S / A_L are built in row blocks instead of one
     full ``distance_matrix`` call. The comparisons (<0.1, <0.2) and the row
     normalisation are byte-for-byte the same operations; blocking only bounds
     peak memory, which matters because a 10,000-cell mesh otherwise needs a
     dense 10,000 x 10,000 float64 distance matrix plus two float32 adjacency
     matrices.
  3. Cell barycenters are derived from the same point array used to build the
     face features (``points_faces.mean(axis=1)``), which is identical to
     ``mesh.cell_centers()`` for a triangular mesh and keeps the normalisation
     self-consistent.
  4. Mesh attribute accessors are written to work with both the vedo API used by
     the official code (methods) and the current vedo API (properties).
  5. Two in-process compatibility shims are installed when — and only when — the
     installed library versions need them: numpy names that vedo 2022.4.2 expects
     at import time, and vedo's own ``mapper()`` method, which modern VTK hides
     behind a property of the same name. Both shims only restore a library's own
     behaviour under a newer dependency; neither changes the model, the features,
     the adjacency matrices or the forward pass.

Memory reporting is diagnostics only: it feeds one console line and the RAM
field of the report, and it never touches the model, the features, the adjacency
matrices or the forward pass. It is therefore measured through the first probe
that works on the current platform (psutil, then a platform-native API, then
/proc), so that this file also imports on Windows, where the Unix-only
``resource`` module does not exist.

Usage:
    python scripts/run_meshsegnet.py --model max --input input/meshes/ZOUIF2W4_upper.obj
    python scripts/run_meshsegnet.py --model man --input input/meshes/0EJBIPTC_lower.obj
    python scripts/run_meshsegnet.py --model man --input ... --dry-run
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
SOURCE_DIR = LAB / "model" / "source"

# Official downsampling rule from step5_predict.py: any mesh above 10,000 cells
# is decimated to exactly 10,000 before inference. Reproduced unchanged.
OFFICIAL_MAX_CELLS = 10000

# Official adjacency thresholds from step5_predict.py.
A_S_THRESHOLD = 0.1
A_L_THRESHOLD = 0.2

MODELS = {
    "man": {"file": "MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip",
            "jaw": "lower jaw (mandible)"},
    "max": {"file": "MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip",
            "jaw": "upper jaw (maxilla)"},
}

# Official class list: 15 classes = gingiva + 14 teeth (second molar to second
# molar). The published code does not ship a label->tooth map, so names are
# reported for the classes the network actually resolves; the numeric ids are
# what matters and are recorded verbatim.
CLASS_NAMES = ["Gingiva"] + [f"Tooth_{i}" for i in range(1, 15)]

DEVIATIONS = [
    "CPU execution: the official step5_predict.py calls torch.cuda.set_device() and cannot run without CUDA.",
    "Adjacency matrices A_S/A_L are built in row blocks (identical comparisons and normalisation, bounded memory).",
    "Cell barycenters computed from the same face points used for the cell features (identical to cell_centers() for triangles).",
    "Mesh attribute access supports both the vedo method API (official era) and the current vedo property API.",
    "Environment shim (no computational effect): np.warnings / np.VisibleDeprecationWarning are restored in memory so "
    "vedo 2022.4.2 can be imported on numpy >= 1.24. These names only control which warnings are printed.",
    "Environment shim (no computational effect): vedo's own mapper() method is rebound where modern VTK's vtkActor.mapper "
    "property shadows it, so that clone()/decimate()/compute_normals() can run. The same vedo code then calls the same "
    "VTK filters with the same parameters.",
]


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


# --------------------------------------------------------------------------
# portable process-memory measurement (diagnostics only)
#
# ``resource`` is a Unix-only module: importing it on Windows raises
# ``ModuleNotFoundError: No module named 'resource'``, which used to abort this
# script before it did anything. Nothing here affects inference, so the
# measurement now goes through the first probe that works:
#
#   1. psutil                     — if installed; cross-platform, used when present
#   2. Windows: GetProcessMemoryInfo via ctypes — working set and peak working set
#   3. POSIX:   resource.getrusage() for the peak, /proc/self/statm for the current
#
# If no probe works the measurement degrades to 0 and reports
# method="unavailable" instead of raising. Note that Windows measures a *working
# set* and Linux a *resident set*; the report records which probe produced the
# number so the figure is never quoted without its origin.
# --------------------------------------------------------------------------
MEMORY_UNAVAILABLE = "unavailable"


class _ProcessMemoryCounters(ctypes.Structure):
    """PROCESS_MEMORY_COUNTERS from the Windows psapi.h.

    Defined unconditionally because it is pure ctypes and therefore harmless
    everywhere; it is only ever filled in on Windows. Keeping it at module level
    also lets the layout be checked on any platform.
    """

    _fields_ = [
        ("cb", ctypes.c_uint32),
        ("PageFaultCount", ctypes.c_uint32),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def _psutil_memory() -> dict | None:
    """Memory via psutil if it is importable, else None. Never raises."""
    try:
        import psutil  # optional: see requirements.txt
    except Exception:
        # On POSIX psutil itself imports `resource`, so a blocked/absent
        # `resource` lands here too — which is exactly the case on Windows.
        return None
    try:
        info = psutil.Process().memory_info()
        peak = int(getattr(info, "peak_wset", 0) or 0)  # Windows only
        return {"rss": int(info.rss), "peak": peak,
                "rss_label": "psutil resident set",
                "peak_label": "psutil peak working set" if peak else ""}
    except Exception:
        return None


def _windows_memory() -> dict | None:
    """Working set / peak working set on Windows via GetProcessMemoryInfo.

    Every signature is declared explicitly. This is not decoration: ctypes
    defaults a function's return type to ``c_int`` (32 bits), while
    ``GetCurrentProcess()`` returns a *pseudo-handle* — a full 64-bit value on
    64-bit Windows. Without ``restype = c_void_p`` the handle is truncated, the
    subsequent ``GetProcessMemoryInfo`` call fails, and this probe silently
    reported nothing (a 0-byte reading attributed to a working probe). Declaring
    the pointer-sized handle and the 32-bit ``BOOL`` return is the documented
    way to call these APIs.
    """
    if os.name != "nt":
        return None
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)

        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        kernel32.GetCurrentProcess.argtypes = []

        # psapi exports this on Windows 7+; kernel32 re-exports it too, and is
        # the fallback if the psapi DLL lookup ever fails.
        get_info = getattr(psapi, "GetProcessMemoryInfo", None)
        if get_info is None:
            get_info = kernel32.GetProcessMemoryInfo
        get_info.restype = ctypes.c_int                 # BOOL (4 bytes)
        get_info.argtypes = [ctypes.c_void_p,           # HANDLE
                             ctypes.POINTER(_ProcessMemoryCounters),
                             ctypes.c_uint32]           # DWORD cb

        counters = _ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(_ProcessMemoryCounters)
        handle = kernel32.GetCurrentProcess()
        if not handle or not get_info(handle, ctypes.byref(counters), counters.cb):
            return None
        rss = int(counters.WorkingSetSize)
        peak = int(counters.PeakWorkingSetSize)
        if not (rss or peak):
            # A real process never has a zero working set. Treat a zeroed struct
            # as "this probe has nothing to say" rather than reporting 0 bytes.
            return None
        return {"rss": rss, "peak": peak,
                "rss_label": "Windows working set",
                "peak_label": "Windows peak working set" if peak else ""}
    except Exception:
        return None


def _posix_memory() -> dict | None:
    """Resident / peak resident set on POSIX; ``resource`` is imported lazily."""
    if os.name == "nt":
        return None
    page_size, rss, peak = 0, 0, 0
    try:
        # Lazy, so a machine without `resource` (Windows) never reaches this.
        import resource

        peak = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        # ru_maxrss is KiB on Linux/BSD and bytes on macOS.
        if sys.platform != "darwin":
            peak *= 1024
        page_size = int(resource.getpagesize())
    except Exception:
        peak = 0
        try:
            page_size = int(os.sysconf("SC_PAGE_SIZE"))
        except Exception:
            page_size = 0
    try:
        with open("/proc/self/statm", encoding="ascii") as fh:
            rss = int(fh.read().split()[1]) * page_size
    except Exception:
        rss = 0
    if not (rss or peak):
        return None
    return {"rss": rss, "peak": peak,
            "rss_label": "resident set (/proc/self/statm)" if rss else "",
            "peak_label": "peak resident set (ru_maxrss)" if peak else ""}


def memory_usage() -> dict:
    """Current and peak process memory, portably. Never raises.

    Returns ``{"rss_bytes", "peak_bytes", "method"}`` where ``method`` names the
    probe(s) that produced the numbers, or ``"unavailable"``.
    """
    rss = peak = 0
    labels: list[str] = []
    for probe in (_psutil_memory, _windows_memory, _posix_memory):
        got = probe()
        if not got:
            continue
        if not rss and got.get("rss"):
            rss = int(got["rss"])
            if got.get("rss_label"):
                labels.append(got["rss_label"])
        if not peak and got.get("peak"):
            peak = int(got["peak"])
            if got.get("peak_label"):
                labels.append(got["peak_label"])
    return {"rss_bytes": rss, "peak_bytes": peak,
            "method": ", ".join(labels) if labels else MEMORY_UNAVAILABLE}


def rss_bytes() -> int:
    """Current resident/working set of this process, or 0 if unmeasurable."""
    return memory_usage()["rss_bytes"]


def peak_rss_bytes() -> int:
    """Peak resident/working set of this process, or 0 if unmeasurable."""
    return memory_usage()["peak_bytes"]


def format_gb(value: int) -> str:
    """Format a byte count for humans, honestly reporting an unmeasurable one."""
    return f"{value / 2**30:.2f} GB" if value else "n/a (probe unavailable)"


# --------------------------------------------------------------------------
# compatibility shims — implemented in compat.py, shared by every script here
#
# Two library drifts break this pipeline for reasons that have nothing to do
# with the model: numpy >= 1.24 removed the ``np.warnings`` alias that vedo
# 2022.4.2 touches while importing, and modern VTK hides vedo's ``mapper()``
# method behind a property of the same name, which breaks clone()/decimate().
# compat.py restores both in-process; see that file for the full explanation
# and the README for the evidence. Neither shim changes a model, a weight, a
# feature, a threshold or any computation.
#
# compat.py is loaded by path so this script runs from any working directory and
# stays importable as a module by the test suite.
# --------------------------------------------------------------------------
def _load_compat():
    path = Path(__file__).resolve().parent / "compat.py"
    spec = importlib.util.spec_from_file_location("meshsegnet_compat", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("meshsegnet_compat", module)
    spec.loader.exec_module(module)
    return module


compat = _load_compat()

# re-exported so callers (and the tests) keep using the runner as the entry point
# while the implementation lives in one shared place
install_numpy_warnings_shim = compat.install_numpy_warnings_shim
install_vedo_mapper_shim = compat.install_vedo_mapper_shim
verify_mesh_operations = compat.verify_mesh_operations
make_console_utf8_safe = compat.make_console_utf8_safe


def _read_attr(obj, name, *args):
    value = getattr(obj, name)
    return value(*args) if callable(value) else value


def mesh_points(mesh):
    pts = _read_attr(mesh, "points")
    return __import__("numpy").array(pts, dtype=__import__("numpy").float64)


def mesh_faces(mesh):
    """Triangle vertex indices as an (N, 3) int array."""
    import numpy as np

    for attr in ("cells", "faces"):
        if hasattr(mesh, attr):
            try:
                raw = _read_attr(mesh, attr)
                arr = np.asarray(raw)
                if arr.ndim == 2 and arr.shape[1] == 3:
                    return arr.astype(np.int64)
            except Exception:
                pass
    # fall back to the underlying vtk polydata
    import vtk

    pd = _read_attr(mesh, "polydata")
    polys = pd.GetPolys()
    ids = vtk.vtkIdList()
    out = []
    polys.InitTraversal()
    while polys.GetNextCell(ids):
        out.append([ids.GetId(i) for i in range(ids.GetNumberOfIds())])
    return np.asarray(out, dtype=np.int64)


def load_official_architecture():
    path = SOURCE_DIR / "meshsegnet.py"
    if not path.exists():
        raise SystemExit(
            f"[STOP] official architecture source not found: {path}\n"
            "       Run: python scripts/download_artifacts.py --models"
        )
    spec = importlib.util.spec_from_file_location("official_meshsegnet", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["official_meshsegnet"] = mod
    spec.loader.exec_module(mod)
    return mod, hashlib.sha256(path.read_bytes()).hexdigest()


# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", choices=sorted(MODELS), required=True,
                    help="man = lower jaw (mandible), max = upper jaw (maxilla)")
    ap.add_argument("--input", required=True, help="Path to a real dental surface mesh")
    ap.add_argument("--output-dir", default=None, help="Default: <lab>/output")
    ap.add_argument("--target-cells", type=int, default=OFFICIAL_MAX_CELLS,
                    help=f"Official decimation target (default {OFFICIAL_MAX_CELLS}).")
    ap.add_argument("--expect-sha256", default=None,
                    help="If given, the input mesh must match this hash or the run stops.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Do everything except the forward pass.")
    args = ap.parse_args()

    make_console_utf8_safe()

    out_dir = Path(args.output_dir) if args.output_dir else LAB / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = LAB / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    model_path = LAB / "model" / MODELS[args.model]["file"]
    input_path = Path(args.input)

    print("=" * 78)
    print(" MeshSegNet — real pretrained model, real dental mesh, local CPU inference")
    print("=" * 78)
    print(f"\n  model : {args.model}  ({MODELS[args.model]['jaw']})")
    print(f"  file  : {model_path.name}")
    print(f"  input : {input_path}")

    # ---- preflight ---------------------------------------------------------
    if not model_path.exists():
        print(f"\n[STOP] model archive missing: {model_path}")
        print("       Run: python scripts/download_artifacts.py --models")
        return 3
    if not input_path.exists():
        print(f"\n[STOP] input mesh missing: {input_path}")
        print("       Run: python scripts/download_artifacts.py --meshes")
        return 3

    input_sha = sha256_of(input_path)
    model_sha = sha256_of(model_path)
    print(f"\n  model sha256 : {model_sha}")
    print(f"  input sha256 : {input_sha}")
    if args.expect_sha256 and input_sha != args.expect_sha256:
        print(f"\n[STOP] input hash mismatch — expected {args.expect_sha256}")
        return 3

    try:
        import numpy as np
        # Must run before `import vedo`: vedo 2022.4.2 touches np.warnings at
        # import time, which numpy >= 1.24 no longer provides. Shim only, no
        # version change and no effect on any computation.
        shim_messages: list[str] = []
        numpy_shims = install_numpy_warnings_shim(shim_messages)
        import scipy
        import torch
        import vedo
        import vtk
        from scipy.spatial import distance_matrix
    except Exception as exc:
        print(f"\n[STOP] missing dependency: {type(exc).__name__}: {exc}")
        return 4

    for message in shim_messages:
        print(f"  np compat    : {message}")

    # Must run before any mesh operation: modern VTK hides vedo's mapper()
    # method behind a property of the same name, which breaks clone/decimate.
    vedo_shim_messages: list[str] = []
    vedo_shim = install_vedo_mapper_shim(vedo_shim_messages)
    for message in vedo_shim_messages:
        print(f"  vedo compat  : {message}")

    vedo_version = getattr(vedo, "__version__", "unknown")
    vtk_version = vtk.vtkVersion.GetVTKVersion()

    if vedo_shim.get("patched") and not vedo_shim.get("verified"):
        print("\n[STOP] the vedo/VTK combination cannot clone or decimate a mesh,")
        print("       and the in-process compatibility shim did not fix it.")
        print("       Verified working pairs: vedo 2022.4.2 + vtk 9.2.x (official),")
        print("       or a matching vedo/vtk pair from the same release.")
        return 4

    t_start = time.perf_counter()
    device = torch.device("cpu")          # CPU-only contract
    threads = torch.get_num_threads()
    print(f"\n  torch        : {torch.__version__}")
    print(f"  cuda present : {torch.cuda.is_available()}")
    print(f"  device       : {device}  ({threads} threads)")
    print(f"  vedo / vtk   : {vedo_version} / {vtk_version}")

    # ---- model -------------------------------------------------------------
    t0 = time.perf_counter()
    mod, arch_sha = load_official_architecture()
    ckpt = torch.load(str(model_path), map_location="cpu", weights_only=False)
    state = ckpt["model_state_dict"] if isinstance(ckpt, dict) and "model_state_dict" in ckpt else ckpt
    model = mod.MeshSegNet(num_classes=15, num_channels=15,
                           with_dropout=True, dropout_p=0.5)
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing or unexpected:
        print(f"\n[STOP] state_dict does not match the architecture "
              f"(missing={len(missing)}, unexpected={len(unexpected)})")
        return 5
    model = model.to(device, dtype=torch.float)
    model.eval()
    t_model = time.perf_counter() - t0
    params = sum(v.numel() for v in state.values())
    print(f"\n  weights loaded : exact match, {params:,} parameters, "
          f"{state['output_conv.weight'].shape[0]} classes  ({t_model:.2f}s)")

    # ---- mesh --------------------------------------------------------------
    t0 = time.perf_counter()
    try:
        mesh = vedo.load(str(input_path))
        cells_original = int(mesh.ncells)
        points_original = int(mesh.npoints)

        if mesh.ncells > args.target_cells:
            ratio = args.target_cells / mesh.ncells
            mesh_d = mesh.clone()
            mesh_d.decimate(fraction=ratio)
            downsampled = True
        else:
            mesh_d = mesh.clone()
            downsampled = False
    except Exception as exc:
        print(f"\n[STOP] mesh preprocessing failed: {type(exc).__name__}: {exc}")
        print(f"       input : {input_path}")
        print(f"       stack : vedo {vedo_version} / vtk {vtk_version}")
        print("       The official pipeline needs mesh.clone() and mesh.decimate();")
        print("       this failure is a library incompatibility, not a model problem.")
        return 6
    t_load = time.perf_counter() - t0
    print(f"\n  mesh           : {cells_original:,} cells / {points_original:,} points")
    print(f"  decimation     : {'yes' if downsampled else 'no'} -> {mesh_d.ncells:,} cells "
          f"(official rule: >{args.target_cells} cells reduced to {args.target_cells})")

    # ---- official preprocessing -------------------------------------------
    t0 = time.perf_counter()
    points = mesh_points(mesh_d)
    faces = mesh_faces(mesh_d)
    N = int(mesh_d.ncells)
    if faces.shape[0] != N:
        print(f"\n[STOP] face count {faces.shape[0]} != cell count {N}")
        return 5

    # move mesh to origin (official step). Every feature below is built from
    # these centred points, so the normalisation stays self-consistent.
    mean_cell_centers = points.mean(axis=0)
    points = points - mean_cell_centers

    face_pts = points[faces]                                  # (N, 3, 3)
    cells = face_pts.reshape(N, 9).astype(np.float32)

    mesh_d.compute_normals()
    normals = np.asarray(mesh_d.celldata["Normals"], dtype=np.float64)

    barycenters = face_pts.mean(axis=1)                       # identical to cell_centers() for triangles

    maxs, mins = points.max(axis=0), points.min(axis=0)
    means, stds = points.mean(axis=0), points.std(axis=0)
    nmeans, nstds = normals.mean(axis=0), normals.std(axis=0)

    for i in range(3):
        cells[:, i] = (cells[:, i] - means[i]) / stds[i]           # vertex 1
        cells[:, i + 3] = (cells[:, i + 3] - means[i]) / stds[i]   # vertex 2
        cells[:, i + 6] = (cells[:, i + 6] - means[i]) / stds[i]   # vertex 3
        barycenters[:, i] = (barycenters[:, i] - mins[i]) / (maxs[i] - mins[i])
        normals[:, i] = (normals[:, i] - nmeans[i]) / nstds[i]

    X = np.column_stack((cells, barycenters, normals)).astype(np.float32)
    t_features = time.perf_counter() - t0
    print(f"  features       : X {X.shape}  ({t_features:.2f}s)")

    # ---- adjacency ---------------------------------------------------------
    t0 = time.perf_counter()
    A_S = np.zeros((N, N), dtype=np.float32)
    A_L = np.zeros((N, N), dtype=np.float32)
    B = X[:, 9:12]
    block = max(1, min(4096, 4_000_000 // max(N, 1)))
    for start in range(0, N, block):
        stop = min(start + block, N)
        D = distance_matrix(B[start:stop], B)
        A_S[start:stop][D < A_S_THRESHOLD] = 1.0
        A_L[start:stop][D < A_L_THRESHOLD] = 1.0
        del D
    A_S /= np.sum(A_S, axis=1, keepdims=True)
    A_L /= np.sum(A_L, axis=1, keepdims=True)
    t_adj = time.perf_counter() - t0
    print(f"  adjacency      : A_S/A_L {A_S.shape}, "
          f"nnz/row {int((A_S > 0).sum() / N)} / {int((A_L > 0).sum() / N)}  ({t_adj:.2f}s)")
    print(f"  resident RAM   : {format_gb(rss_bytes())}")

    X_t = torch.from_numpy(X.transpose(1, 0).reshape(1, 15, N)).to(device, dtype=torch.float)
    A_S_t = torch.from_numpy(A_S.reshape(1, N, N)).to(device, dtype=torch.float)
    A_L_t = torch.from_numpy(A_L.reshape(1, N, N)).to(device, dtype=torch.float)

    if args.dry_run:
        print("\n  --dry-run: skipping the forward pass.")
        return 0

    # ---- inference ---------------------------------------------------------
    t0 = time.perf_counter()
    with torch.no_grad():
        probs = model(X_t, A_S_t, A_L_t)
    t_infer = time.perf_counter() - t0
    probs_np = probs.cpu().numpy()
    print(f"\n  forward pass   : {t_infer:.2f}s on {device}")
    print(f"  output tensor  : {tuple(probs.shape)} (batch, cells, classes)")

    # ---- labels ------------------------------------------------------------
    labels = np.argmax(probs_np[0], axis=-1).astype(np.int32)
    t_total = time.perf_counter() - t_start
    unique, counts = np.unique(labels, return_counts=True)
    present = {int(u): int(c) for u, c in zip(unique, counts)}

    print(f"  labels         : {len(unique)} distinct classes present")
    for u, c in sorted(present.items()):
        name = CLASS_NAMES[u] if u < len(CLASS_NAMES) else f"class_{u}"
        print(f"      {u:>2}  {name:<12} {c:>7,} cells  ({100*c/N:5.1f}%)")

    # ---- outputs -----------------------------------------------------------
    stem = f"{input_path.stem}_{args.model}"
    labels_npy = out_dir / f"{stem}_labels.npy"
    probs_npz = out_dir / f"{stem}_probabilities.npz"
    vtp_path = out_dir / f"{stem}_predicted.vtp"
    np.save(labels_npy, labels)
    np.savez_compressed(probs_npz, probabilities=probs_np[0].astype(np.float32))

    vtp_written = False
    try:
        out_mesh = mesh_d.clone()
        out_mesh.celldata["Label"] = labels.reshape(-1, 1)
        vedo.write(out_mesh, str(vtp_path))
        vtp_written = vtp_path.exists()
    except Exception as exc:
        print(f"  [WARN] could not write .vtp: {type(exc).__name__}: {exc}")

    for p in (labels_npy, probs_npz, vtp_path):
        if p.exists():
            print(f"  wrote {p.name}  {p.stat().st_size:,} B")

    # ---- report ------------------------------------------------------------
    report = {
        "schema": "meshsegnet.run_report/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "success": True,
        "model": {
            "key": args.model,
            "jaw": MODELS[args.model]["jaw"],
            "official_filename": model_path.name,
            "size_bytes": model_path.stat().st_size,
            "sha256": model_sha,
            "framework": f"PyTorch {torch.__version__}",
            "architecture_source": {
                "file": str(SOURCE_DIR / "meshsegnet.py"),
                "sha256": arch_sha,
                "note": "official meshsegnet.py, unmodified",
            },
            "parameters": params,
            "classes": int(state["output_conv.weight"].shape[0]),
            "trained_epochs": ckpt.get("epoch") if isinstance(ckpt, dict) else None,
            "state_dict_verified_exact": True,
        },
        "input": {
            "path": str(input_path),
            "size_bytes": input_path.stat().st_size,
            "sha256": input_sha,
            "format": input_path.suffix.lower().lstrip("."),
            "cells_original": cells_original,
            "points_original": points_original,
            "cells_used": N,
            "decimated": downsampled,
            "decimation_rule": f"official: >{args.target_cells} cells -> {args.target_cells}",
            "feature_matrix": list(X.shape),
        },
        "device": {
            "inference_device": "cpu",
            "cuda_available": bool(torch.cuda.is_available()),
            "torch_threads": threads,
            "host": platform.platform(),
            "cpu_count": os.cpu_count(),
        },
        "environment": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "torch": torch.__version__,
            "vedo": vedo_version,
            "vtk": vtk_version,
            "host": platform.platform(),
            "cpu_count": os.cpu_count(),
            "mesh_operations_verified": bool(vedo_shim.get("verified")),
        },
        "environment_shims": {
            "numpy_warnings_shim": numpy_shims or None,
            "vedo_mapper_shim": vedo_shim or None,
            "note": "in-memory attribute restoration only; changes no computation and no installed package version",
        },
        "timing_seconds": {
            "load_model": round(t_model, 3),
            "load_mesh": round(t_load, 3),
            "features": round(t_features, 3),
            "adjacency": round(t_adj, 3),
            "inference": round(t_infer, 3),
            "total_runtime": round(t_total, 3),
        },
        "memory_bytes": {
            "rss_after_adjacency": rss_bytes(),
            "peak_rss": peak_rss_bytes(),
            "method": memory_usage()["method"],
            "note": "diagnostic only; peak resident/working set of this process on the "
                    "host that ran the job, measured by the probe named in 'method'. "
                    "Windows reports a working set, Linux a resident set.",
        },
        "output": {
            "classes": int(probs.shape[-1]),
            "class_names_note": "15 classes = gingiva + 14 teeth (second molar to second molar); "
                                "the official code ships no label->tooth map",
            "cells_labeled": int(N),
            "classes_present": present,
            "labels_npy": str(labels_npy),
            "probabilities_npz": str(probs_npz),
            "predicted_vtp": str(vtp_path) if vtp_written else None,
        },
        "deviations_from_official_script": DEVIATIONS,
    }

    run_report = out_dir / "run_report.json"
    run_report.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = logs_dir / f"run_{stamp}_{args.model}.json"
    log_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\n" + "=" * 78)
    print(f" SUCCESS — real segmentation produced on {device}")
    print(f" inference {t_infer:.2f}s   total {t_total:.2f}s   "
          f"peak RAM {format_gb(peak_rss_bytes())}")
    print("=" * 78)
    print(f"\nWrote {run_report}")
    print(f"Wrote {log_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
