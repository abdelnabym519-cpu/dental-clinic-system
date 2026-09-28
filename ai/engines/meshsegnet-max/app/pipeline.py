"""pipeline.py — the validated MeshSegNet inference pipeline (Phase 19B, D2).

Faithful port of ai-validation/meshsegnet/scripts/run_meshsegnet.py
(the CPU runner that produced the validated runs — provenance §4-§6). Every
numerical step is the same operation, same normalisation, same thresholds:

  1. mesh -> points (N,3) float64, faces (M,3) int64 (triangle surface mesh,
     millimetre coordinates)
  2. official downsampling rule: any mesh above 10,000 cells is decimated to
     EXACTLY 10,000 (step5_predict.py: mesh.decimate(fraction=10000/ncells))
     before inference. Outputs are per-cell predictions on the decimated
     mesh, not on the original scan.
  3. move mesh to origin (points -= mean(points)) — every feature is built
     from these centred points so the normalisation stays self-consistent
  4. 15 features per cell:
       0-8   3 triangle vertices x 3 coords   (v - mean) / std over points
       9-11  cell barycenter                  (b - min) / (max - min) over points
       12-14 cell normal                      (n - mean) / std over cell normals
  5. adjacency matrices from barycenter distances, row-normalised:
       A_S: pairwise distance < 0.1
       A_L: pairwise distance < 0.2
     built in row blocks (bounded memory — a 10,000-cell mesh otherwise
     needs a dense 10,000x10,000 float64 distance matrix; the comparisons
     and normalisation are byte-for-byte the same operations)
  6. forward: model(X (1,15,N), A_S (1,N,N), A_L (1,N,N)) -> (1,N,15)
     per-cell Softmax; labels = argmax over classes

Deviation register (none change a weight, feature, threshold or the math):
  - .obj meshes are parsed by the in-process parser below (the validated
    inputs were .obj); .stl/.vtk/.ply go through vedo, exactly as the
    validated runner. Decimation (step 2) always uses vedo's decimate() —
    the official operation — when it triggers (meshes <= 10,000 cells skip
    decimation entirely and need no library).
  - cell normals are computed as the geometric cross product of each
    triangle's edges (identical to VTK's per-cell normals for a triangle
    polydata); when vedo is importable the engine still uses the same
    values — the formula is the same.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import numpy as np
import torch

# Official constants from step5_predict.py (validated runner, unchanged).
OFFICIAL_MAX_CELLS = 10_000
A_S_THRESHOLD = 0.1
A_L_THRESHOLD = 0.2

# 15 classes = gingiva + 14 teeth (second molar to second molar). The
# official repository publishes NO label-to-tooth-name map, so names are
# neutral and the numeric ids are what is recorded (provenance §3).
CLASS_NAMES = ["Gingiva"] + [f"Tooth_{i}" for i in range(1, 15)]


class MeshParseError(ValueError):
    """The input bytes are not a usable triangular surface mesh."""


class MeshFormatError(ValueError):
    """The requested mesh format is not supported by this deployment."""


# ---------------------------------------------------------------------------
# Mesh loading
# ---------------------------------------------------------------------------

def parse_obj(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Minimal OBJ parser for triangle meshes: `v x y z` and `f a b c`
    (vertex/uv/normal triplets tolerated). 1-based indices. Returns
    (points (N,3) float64, faces (M,3) int64)."""
    text = data.decode("utf-8", errors="replace")
    points: list[list[float]] = []
    faces: list[list[int]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("o ") or line.startswith("g "):
            continue
        parts = line.split()
        if parts[0] == "v" and len(parts) >= 4:
            try:
                points.append([float(parts[1]), float(parts[2]), float(parts[3])])
            except ValueError:
                raise MeshParseError("OBJ vertex line has non-numeric coordinates")
        elif parts[0] == "f" and len(parts) >= 4:
            idx = []
            for tok in parts[1:4]:
                first = tok.split("/")[0]
                try:
                    idx.append(int(first) - 1)
                except ValueError:
                    raise MeshParseError(f"OBJ face line has bad vertex index: {tok!r}")
            faces.append(idx)
        # other record types (vn, vt, s, usemtl, mtllib, ...) are ignored
    if len(points) < 4:
        raise MeshParseError("mesh has fewer than 4 vertices")
    if not faces:
        raise MeshParseError("mesh has no triangle faces")
    faces_arr = np.asarray(faces, dtype=np.int64)
    if faces_arr.min() < 0 or faces_arr.max() >= len(points):
        raise MeshParseError("mesh face index out of range")
    return np.asarray(points, dtype=np.float64), faces_arr


def _mesh_to_points_faces(mesh) -> tuple[np.ndarray, np.ndarray]:
    """Points/faces from a vedo mesh (method-or-property accessor, as the
    validated runner does)."""
    pts = mesh.points
    if callable(pts):
        pts = pts()
    points = np.asarray(pts, dtype=np.float64)
    for attr in ("cells", "faces"):
        if hasattr(mesh, attr):
            raw = getattr(mesh, attr)
            arr = np.asarray(raw() if callable(raw) else raw)
            if arr.ndim == 2 and arr.shape[1] == 3:
                return points, arr.astype(np.int64)
    raise MeshParseError("could not read triangular faces from mesh")


def load_mesh(data: bytes, fmt: str) -> tuple[np.ndarray, np.ndarray, int]:
    """Load mesh bytes -> (points, faces, cells_original)."""
    fmt = (fmt or "").lower().lstrip(".")
    if fmt == "obj":
        points, faces = parse_obj(data)
    elif fmt in ("stl", "vtk", "ply"):
        try:
            import io
            import pickle
            import tempfile

            import vedo
        except BaseException as exc:  # pragma: no cover - deployment-dependent
            # BaseException, not Exception: vedo's __init__ calls sys.exit(1)
            # when VTK is missing, and SystemExit would otherwise escape as
            # an unhandled 500.
            raise MeshFormatError(
                f"format .{fmt} requires the vedo/VTK runtime (not installed): {exc}"
            ) from exc
        with tempfile.NamedTemporaryFile(suffix=f".{fmt}", delete=False) as fh:
            fh.write(data)
            tmp = fh.name
        try:
            mesh = vedo.load(tmp)
        except Exception as exc:
            raise MeshParseError(f"failed to parse .{fmt} mesh: {exc}") from exc
        points, faces = _mesh_to_points_faces(mesh)
    else:
        raise MeshFormatError(f"unsupported mesh format .{fmt!r} (use obj, stl, vtk or ply)")
    if faces.shape[0] == 0:
        raise MeshParseError("mesh has no triangular cells")
    return points, faces, int(faces.shape[0])


def decimate(points: np.ndarray, faces: np.ndarray,
             target_cells: int = OFFICIAL_MAX_CELLS) -> tuple[np.ndarray, np.ndarray, bool]:
    """Official downsampling rule: > target cells -> exactly target cells.

    Decimation uses vedo's decimate() (the official operation). Meshes at or
    below the target pass through unchanged and need no library.
    """
    if faces.shape[0] <= target_cells:
        return points, faces, False
    try:
        import vedo
    except BaseException as exc:  # pragma: no cover - deployment-dependent
        # BaseException, not Exception: vedo's __init__ calls sys.exit(1)
        # when VTK is missing, and SystemExit would otherwise escape as
        # an unhandled 500.
        raise MeshFormatError(
            f"decimation to {target_cells} cells requires the vedo/VTK runtime "
            f"(not installed): {exc}"
        ) from exc
    mesh = vedo.Mesh([points, faces])
    mesh.decimate(fraction=target_cells / faces.shape[0])
    new_points, new_faces = _mesh_to_points_faces(mesh)
    return new_points, new_faces, True


# ---------------------------------------------------------------------------
# Official preprocessing (validated runner, section "official preprocessing")
# ---------------------------------------------------------------------------

def _cell_normals(points: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Per-triangle geometric normal (same values as VTK per-cell normals)."""
    v0 = points[faces[:, 0]]
    v1 = points[faces[:, 1]]
    v2 = points[faces[:, 2]]
    n = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(n, axis=1, keepdims=True)
    norms[norms == 0] = 1.0  # degenerate triangle: keep the zero normal
    return n / norms


def build_features(points: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (X (N,15) float32, barycenters (N,3) float64)."""
    N = faces.shape[0]
    points = points - points.mean(axis=0)          # move mesh to origin

    face_pts = points[faces]                        # (N, 3, 3)
    cells = face_pts.reshape(N, 9).astype(np.float32)

    normals = _cell_normals(points, faces)          # (N, 3)
    barycenters = face_pts.mean(axis=1)             # identical to cell_centers()

    maxs, mins = points.max(axis=0), points.min(axis=0)
    means, stds = points.mean(axis=0), points.std(axis=0)
    nmeans, nstds = normals.mean(axis=0), normals.std(axis=0)
    stds[stds == 0] = 1.0
    nstds[nstds == 0] = 1.0
    spans = maxs - mins
    spans[spans == 0] = 1.0

    for i in range(3):
        cells[:, i] = (cells[:, i] - means[i]) / stds[i]
        cells[:, i + 3] = (cells[:, i + 3] - means[i]) / stds[i]
        cells[:, i + 6] = (cells[:, i + 6] - means[i]) / stds[i]
        barycenters[:, i] = (barycenters[:, i] - mins[i]) / spans[i]
        normals[:, i] = (normals[:, i] - nmeans[i]) / nstds[i]

    X = np.column_stack((cells, barycenters, normals)).astype(np.float32)
    return X, barycenters


def build_adjacency(barycenters: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Row-blocked A_S (<0.1) / A_L (<0.2), row-normalised — same operations
    as the validated runner, bounded peak memory."""
    N = barycenters.shape[0]
    B = barycenters.astype(np.float64)
    A_S = np.zeros((N, N), dtype=np.float32)
    A_L = np.zeros((N, N), dtype=np.float32)
    block = max(1, min(4096, 4_000_000 // max(N, 1)))
    for start in range(0, N, block):
        stop = min(start + block, N)
        # squared-distance form is not used: the official pipeline compares
        # EUCLIDEAN distances < 0.1 / < 0.2, so compute them directly.
        diff = B[start:stop, None, :] - B[None, :, :]
        D = np.sqrt((diff ** 2).sum(axis=-1))
        A_S[start:stop][D < A_S_THRESHOLD] = 1.0
        A_L[start:stop][D < A_L_THRESHOLD] = 1.0
        del D, diff
    row_s = np.sum(A_S, axis=1, keepdims=True)
    row_l = np.sum(A_L, axis=1, keepdims=True)
    row_s[row_s == 0] = 1.0
    row_l[row_l == 0] = 1.0
    A_S /= row_s
    A_L /= row_l
    return A_S, A_L


@dataclass
class SegmentationResult:
    labels: list[int]                 # per-cell class id (decimated mesh)
    segments: list[dict]              # [{class_id, class_name, point_count}]
    num_points_total: int             # cells after the official rule
    cells_original: int
    downsampled: bool
    probabilities_shape: tuple
    processing_time_ms: int


def run_inference(model, points: np.ndarray, faces: np.ndarray,
                  cells_original: int,
                  target_cells: int = OFFICIAL_MAX_CELLS) -> SegmentationResult:
    t0 = time.perf_counter()
    dec_points, dec_faces, downsampled = decimate(points, faces, target_cells)
    N = int(dec_faces.shape[0])
    if dec_faces.shape[0] != N:  # defensive (validated runner checks the same)
        raise MeshParseError("face count mismatch after decimation")

    X, bary = build_features(dec_points, dec_faces)
    A_S, A_L = build_adjacency(bary)

    X_t = torch.from_numpy(X.transpose(1, 0).reshape(1, 15, N)).to("cpu", dtype=torch.float)
    A_S_t = torch.from_numpy(A_S.reshape(1, N, N)).to("cpu", dtype=torch.float)
    A_L_t = torch.from_numpy(A_L.reshape(1, N, N)).to("cpu", dtype=torch.float)

    with torch.no_grad():
        probs = model(X_t, A_S_t, A_L_t)
    probs_np = probs.cpu().numpy()
    labels_arr = np.argmax(probs_np[0], axis=-1).astype(np.int32)

    unique, counts = np.unique(labels_arr, return_counts=True)
    present = {int(u): int(c) for u, c in zip(unique, counts)}
    segments = [
        {"class_id": cid, "class_name": CLASS_NAMES[cid] if cid < len(CLASS_NAMES) else f"class_{cid}",
         "point_count": present[cid]}
        for cid in sorted(present)
    ]
    return SegmentationResult(
        labels=labels_arr.tolist(),
        segments=segments,
        num_points_total=N,
        cells_original=cells_original,
        downsampled=downsampled,
        probabilities_shape=tuple(probs.shape),
        processing_time_ms=int((time.perf_counter() - t0) * 1000),
    )
