# input/

**Nothing real is stored in this repository.** Every mesh file here is
git-ignored.

```
input/
└── meshes/     real dental surface meshes (.obj / .stl / .vtk / .ply)
```

## What MeshSegNet expects

A **raw intraoral scan** of a dental arch — a triangular surface mesh in
millimetre coordinates, as produced by an intraoral scanner (IOS) or a
laboratory scanner. Not a CBCT volume, not a photograph, not a segmented file.

| Property | Requirement |
| --- | --- |
| Type | triangular surface mesh (per-face connectivity) |
| Formats the official code reads | anything `vedo.load()` handles, e.g. `.obj`, `.stl`, `.vtk`, `.ply` |
| Units | millimetres (the model normalises internally, but scale must be realistic) |
| Provenance | must be a real scanned jaw — never a synthetic or generated mesh |
| Labels | **not required** for prediction; the official `step5_predict.py` assumes no ground truth |

The official repository ships **no sample mesh** — `step5_predict.py` expects the
user to supply one (`sample_filenames = ['Example.stl'] # need to define`).

## Where the meshes used here come from

Both are real intraoral scans of dental arches, published by the
**3DTeethSeg'22 challenge** (MICCAI 2022) community:

| File | Jaw | Cells | Source |
| --- | --- | --- | --- |
| `0EJBIPTC_lower.obj` | lower | 178,421 | `abenhamadou/3DTeethSeg22_challenge` → `refrence_algorithm_submission/test/` |
| `ZOUIF2W4_upper.obj` | upper | 328,581 | `HuayuanSong/TeethSegFront` (3DTeethSeg'22 naming convention) |

Download them with:

```powershell
python scripts\download_artifacts.py --meshes
```

`scripts/verify_artifacts.py` records size, SHA-256, cell count and bounding box
for each mesh, so every run is tied to a hashed input.

## Getting a mesh from your own scanner

Any `.stl`/`.obj`/`.ply` export of a real intraoral scan works. Put it in
`input/meshes/` and pass it with `--input`. Large scans are handled by the
official downsampling rule (see `../README.md`), which reduces any mesh above
10,000 cells to exactly 10,000 before inference — that rule is part of the
published pipeline and is reproduced unchanged.
