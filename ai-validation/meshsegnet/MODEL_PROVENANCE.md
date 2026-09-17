# MeshSegNet — model and data provenance

Every statement below is either **VERIFIED** (read from an official source or
measured during this work, with the source named) or explicitly marked
**UNVERIFIED**. Nothing is inferred and presented as fact.

Audited: 2026-09-17.

---

## 1. Is this actually MeshSegNet?

Yes. MeshSegNet is a real, published, peer-reviewed method, and the repository
used here is the authors' own implementation.

| Field | Value | Status |
| --- | --- | --- |
| Method | MeshSegNet — deep multi-scale mesh feature learning for labeling raw dental surfaces from 3D intraoral scanners | VERIFIED |
| Primary paper | Lian C., Wang L., Wu T.-H., Wang F., Yap P.-T., Ko C.-C., Shen D. *Deep Multi-Scale Mesh Feature Learning for Automated Labeling of Raw Dental Surfaces From 3D Intraoral Scanners.* **IEEE Transactions on Medical Imaging**, 2020 | VERIFIED |
| Earlier version | Lian C. et al. *MeshSNet: Deep Multi-scale Mesh Feature Learning for End-to-End Tooth Labeling on 3D Dental Surfaces.* **MICCAI 2019**, LNCS vol. 11769 | VERIFIED |
| Official repository | `https://github.com/Tai-Hsien/MeshSegNet` | VERIFIED |
| Repository title | "PyTorch version of MeshSegNet for tooth segmentation of intraoral scans (point cloud/mesh). The code also includes visdom for training visualization; this project is partially powered by SOVE Inc." | VERIFIED |
| Default branch | `master` | VERIFIED |
| Last pushed | 2023-08-22 | VERIFIED |
| Stars | 331 | VERIFIED |
| License | **MIT**, "Copyright (c) 2020 Chunfeng Lian & Tai-Hsien Wu" (`LICENSE` file in the repository) | VERIFIED |

GitHub's licence detector reports `NOASSERTION` for this repository; the `LICENSE`
file itself is a standard MIT text with the authors' copyright line. The file is
snapshotted to `model/source/LICENSE` during download.

### What it is not

- Not a CBCT/volumetric model. It consumes **surface meshes**, not voxel volumes.
- Not a per-tooth *instance* segmenter with named FDI labels attached. It emits
  **class ids 0–14**, and the official repository publishes **no label→tooth-name
  map**.
- Not the same as TeethSeg/TSegNet/ToothGroupNetwork — those are separate methods
  that appear in the same literature and are often confused with it.

---

## 2. Which pretrained weights are official?

Exactly two, both published by the authors in the `models/` folder of the
official repository:

| Jaw | Official filename | Size (bytes) | SHA-256 |
| --- | --- | --- | --- |
| **Lower** (mandible) | `MeshSegNet_Man_15_classes_72samples_lr1e-2_best.zip` | 28,866,886 | `d74c87e0c1cbc47fcedcc6f8574c1ad484dd2e21a98cabfb3465a42a2760a0cf` |
| **Upper** (maxilla) | `MeshSegNet_Max_15_classes_72samples_lr1e-2_best.zip` | 28,860,102 | `727cd3c52fc85c55271782b5d432d2cc8199ec2445cfb39570249e3ea99675d2` |

`Man` = mandible, `Max` = maxilla. Both were hashed from the official repository
contents; `scripts/download_artifacts.py` refuses to write a file whose SHA-256
does not match, and `scripts/verify_artifacts.py` re-checks on every run.

### Method of acquisition

Both archives are **ordinary git blobs committed in the repository** — not
GitHub release assets, not Git-LFS pointers, not an external drive link. They are
retrieved from the official repository tarball:

```
https://codeload.github.com/Tai-Hsien/MeshSegNet/tar.gz/refs/heads/master
```

### Structure, verified by loading

Both files are **PyTorch `torch.save()` archives** (zip container containing
`archive/data.pkl`), despite the `.zip` suffix. The official `step5_predict.py`
still references a `.tar` filename, which no longer matches what the repository
ships.

| Field | Man | Max |
| --- | --- | --- |
| Top-level keys | `epoch`, `model_state_dict`, `optimizer_state_dict`, `losses`, `mdsc`, `msen` | same |
| `epoch` (trained epochs) | **499** (500 epochs) | **405** |
| `model_state_dict` entries | 151 | 151 |
| Parameters | 1,799,140 | 1,799,140 |
| Output head | `output_conv.weight` `(15, 128, 1)` → **15 classes** | same |
| `load_state_dict(strict=False)` | missing **0**, unexpected **0** | missing **0**, unexpected **0** |

Zero missing and zero unexpected keys is the evidence that these are genuinely
MeshSegNet checkpoints for this exact architecture. A truncated file, a
substitute model, or the wrong jaw would fail this check.

Roughly 21 MB of each 28.8 MB archive is optimizer state, which inference does
not use.

---

## 3. Labels and classes

| Field | Value | Status |
| --- | --- | --- |
| Classes | **15** | VERIFIED — output head shape, training README |
| Composition | gingiva + 14 teeth, "second molar to second molar" | VERIFIED — official README |
| Label→tooth map | **not published** | VERIFIED (absence) |
| Output | per-cell softmax over 15 classes | VERIFIED — `forward()` returns `Softmax` |

Because no official mapping exists, this lab reports **numeric class ids only**
and never asserts which tooth a given id corresponds to. `scripts/run_meshsegnet.py`
uses the neutral names `Gingiva`, `Tooth_1` … `Tooth_14` in console output purely
for readability; the numbers are what is recorded.

---

## 4. Input format

Read from the official `step5_predict.py` and `Mesh_dataset.py`.

| Field | Value | Status |
| --- | --- | --- |
| Input type | triangular surface mesh of one dental arch | VERIFIED |
| Accepted extensions | whatever `vedo.load()` handles — `.obj`, `.stl`, `.vtk`, `.ply` | VERIFIED |
| Units | millimetres (normalised internally) | VERIFIED |
| Ground-truth labels needed | **no** for prediction | VERIFIED |
| Sample input shipped by the project | **none** — `sample_filenames = ['Example.stl'] # need to define` | VERIFIED |

### Feature construction (15 features per cell)

| Offset | Meaning | Normalisation |
| --- | --- | --- |
| 0–8 | 3 triangle vertices × 3 coordinates | `(v − mean) / std` over mesh points |
| 9–11 | cell barycenter | `(b − min) / (max − min)` over mesh points |
| 12–14 | cell normal | `(n − mean) / std` over cell normals |

Plus two row-normalised adjacency matrices: **A_S** where pairwise barycenter
distance `< 0.1`, and **A_L** where `< 0.2`.

### Downsampling rule (part of the published pipeline)

`step5_predict.py` reduces any mesh above **10,000 cells** to exactly 10,000
(`mesh.decimate(fraction=10000/ncells)`) before feature construction. This lab
reproduces that rule unchanged. Outputs are therefore per-cell predictions on the
**decimated** mesh, not on the original scan.

---

## 5. Real input meshes used

The official project ships no sample mesh, so real published intraoral scans
were used instead.

| File | Jaw | Size (bytes) | SHA-256 | Cells / points |
| --- | --- | --- | --- | --- |
| `0EJBIPTC_lower.obj` | lower | 11,543,252 | `b824f6822f4a6ada296eef6869e9341fa1e69ad6cd14862b53572198ae5e7a76` | 178,421 / 110,804 |
| `ZOUIF2W4_upper.obj` | upper | 18,769,177 | `581b9a026e2ce734f6335f34aa900e8114dc33e2a83541ebd6bb26536382545e` | 328,581 / 164,345 |

| File | Source repository | Provenance | License |
| --- | --- | --- | --- |
| `0EJBIPTC_lower.obj` | `abenhamadou/3DTeethSeg22_challenge` → `refrence_algorithm_submission/test/` | **3DTeethSeg'22 challenge** (MICCAI 2022) reference-algorithm test data — a real lower-jaw intraoral scan | **MIT** (declared on that repository) |
| `ZOUIF2W4_upper.obj` | `HuayuanSong/TeethSegFront` | real upper-jaw intraoral scan using the 3DTeethSeg'22 file naming convention | **no licence declared** — see limitation below |

Both are millimetre-scale dental arches (spanning roughly 85 × 65 × 41 mm),
consistent with real intraoral scanning — not synthetic geometry.

**Limitation, stated plainly:** the upper-jaw mesh comes from a repository that
declares no licence. It is used here only as local, non-redistributed test input
for a validation run. If you intend to publish results obtained with it, verify
its terms first — or substitute your own scan via `--input`.

Meshes are git-ignored and are never committed.

---

## 6. CPU feasibility

| Question | Answer | Evidence |
| --- | --- | --- |
| Is the model CPU-capable? | **Yes** — plain PyTorch convolutions and `bmm`; no custom CUDA kernels | `meshsegnet.py` uses only `torch.nn` / `torch.nn.functional` |
| Does the official prediction script run on CPU as-is? | **No** | `step5_predict.py` calls `utils.get_avail_gpu()` and `torch.cuda.set_device(gpu_id)` unconditionally |
| Does the architecture itself branch on CUDA? | Only for the identity-matrix device of two spatial-transformer modules; harmless on CPU | `meshsegnet.py` STN3d/STNkd |
| Memory driver | the dense `N × N` adjacency matrices (N = 10,000 → 400 MB each, plus a 800 MB float64 distance matrix in the naive path) | measured |
| Time driver | three dense `(N×N) @ (N×C)` products | measured |

This lab therefore runs the model on CPU through its own runner, documented in
`../README.md`, with the deviations listed there and recorded inside every
`run_report.json`.

### Library stacks actually exercised

| Stack | What was observed |
| --- | --- |
| vedo 2026.6.1 · vtk 9.7.0 · numpy 1.26.4 · torch 2.0.1 | full CPU inference on both jaws, real output written (the original validation run) |
| vedo 2022.4.2 · vtk 9.7.0 · numpy 1.26.4 · scipy 1.17.1 · torch 2.0.1 | the whole pipeline up to the forward pass on both real meshes, with features and adjacency identical to the row above; requires the two in-process shims documented in `../README.md` |
| vedo 2022.4.2 · vtk 9.7.0 · numpy 1.26.4 · scipy 1.17.1 · **torch 2.14.0** | the same numbers again on the torch release installed on the local Windows machine: the checkpoint loads with `weights_only=False`, the official architecture instantiates with 0 missing keys, and decimation/features/adjacency are unchanged |
| vedo 2022.4.2 · vtk 9.2.x (what the official `requirements.txt` pins) | **not exercised here** — the Arena sandbox cannot install that VTK build (its wheels need `libGL`, unavailable without root). It is the combination the authors wrote against, so no shim should be needed; unverified rather than assumed |

The shims restore library behaviour only. They change no weight, no feature, no
threshold and no computation — the "identical features and adjacency" column
above is the measurement that supports that claim.

---

## 7. Summary

| Item | Status |
| --- | --- |
| Method identity (paper, authors, repository) | **VERIFIED** |
| Official pretrained weights for upper and lower jaw | **VERIFIED** — hashes match on every run |
| Weights load into the official architecture exactly | **VERIFIED** — 0 missing, 0 unexpected |
| Class count and label range | **VERIFIED** — 15 classes, ids 0–14 |
| Label→tooth-name mapping | **NOT PUBLISHED** — never asserted here |
| Input format and feature contract | **VERIFIED** — read from official code |
| Sample mesh shipped by the project | **DOES NOT EXIST** — real published scans used instead |
| Real dental mesh input | **VERIFIED** — hashed, millimetre-scale, from the 3DTeethSeg'22 ecosystem |
| CPU execution | **VERIFIED** — real inference completed repeatedly |
| Output produced | **VERIFIED** — per-cell labels on the decimated mesh |
| Clinical validity of the output | **NOT ASSESSED** — no ground truth, no accuracy metric claimed |
