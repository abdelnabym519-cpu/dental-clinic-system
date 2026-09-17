# ai-validation / meshsegnet

Real CPU validation of **MeshSegNet** — per-face tooth labeling on 3D intraoral
scan meshes (15 classes: gingiva + 14 teeth).

**Engine:** MeshSegNet (Lian et al., IEEE TMI 2020 / MICCAI 2019)
**Official repository:** https://github.com/Tai-Hsien/MeshSegNet (MIT)
**Target hardware:** ASUS Vivobook X1505VA · i9-13900H · 16 GB RAM · Intel Iris Xe · no CUDA

> ## VERDICT: 🟢 OPERATIONAL
>
> Real official pretrained weights were verified by hash and by exact
> architecture load. Real published intraoral scans were verified by hash.
> **Actual CPU inference completed and produced real per-cell segmentation
> output**, repeatedly and with stable runtime. No training, no fine-tuning, no
> model conversion, no stand-in weights, no synthetic input.

This lab lives inside the `dental-clinic-system` repository but is **not
connected to the ERP**: no API route, no Prisma model, no UI, no patient
wiring. Nothing here is called by the application.

---

## Measured results

Two real runs, both on CPU, no GPU present:

| | Lower jaw | Upper jaw |
| --- | --- | --- |
| Model | `MeshSegNet_Man_…_best.zip` | `MeshSegNet_Max_…_best.zip` |
| Input mesh | `0EJBIPTC_lower.obj` | `ZOUIF2W4_upper.obj` |
| Cells before decimation | 178,421 | 328,581 |
| Cells used (official rule) | 10,000 | 9,999 |
| **Inference time** | **2.02 s** | **2.05 s** |
| Total runtime | 9.32 s | 10.72 s |
| Peak RAM | 1.48 GB | 1.50 GB |
| Classes predicted | **15 / 15** | 10 / 15 |
| Output | 10,000 labeled cells (`.vtp`, `.npy`, `.npz`) | 9,999 labeled cells |

**Stability** — three repeats of the lower-jaw job:

| Run | Inference | Total | Peak RAM | Classes |
| --- | --- | --- | --- | --- |
| 1 | 2.02 s | 9.32 s | 1.48 GB | 15 |
| 2 | 2.21 s | 10.23 s | 1.52 GB | 15 |
| 3 | 2.05 s | 9.27 s | 1.47 GB | 15 |

Runtime is stable and completes comfortably. The lower-jaw scan resolved **all
15 classes**, with a plausible distribution (58 % gingiva, the largest tooth
regions at 7.9 % and 5.7 %).

> **These numbers are from the validation sandbox (2 CPU cores, 3 GB RAM, 1 torch
> thread), not from your laptop.** They are not a benchmark of your machine —
> your i9-13900H has 14 cores and 8× the memory, so it should be faster and will
> not be memory-constrained. Re-run `scripts/run_meshsegnet.py` locally to
> measure your own hardware; the runner records the timings for you.

---

## Setup (Windows PowerShell)

```powershell
cd dental-clinic-system\ai-validation\meshsegnet
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

Install the **CPU-only** PyTorch build — this is the correct wheel for a machine
without NVIDIA hardware, and it is the one thing you cannot copy from the
sandbox:

```powershell
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install "numpy<2" scipy "vedo==2022.4.2"
```

`requirements.txt` records the full set.

> **Note on what ran in the sandbox.** `download.pytorch.org` is unreachable from
> the validation environment, so the sandbox installed the ordinary PyPI `torch`
> wheel, which drags in ~2 GB of NVIDIA CUDA runtime libraries that are never
> used (no GPU is present; `torch.cuda.is_available()` is `False` and the runner
> pins the device to CPU). On your machine the command above avoids that
> entirely. This difference does not affect the model, the weights, or the
> results.

---

## Workflow

```powershell
python scripts\check_environment.py        # CPU contract + dependency report
python scripts\download_artifacts.py --models --meshes   # official files, hash-verified
python scripts\verify_artifacts.py         # hashes + exact architecture load (no inference)
python scripts\run_meshsegnet.py --model man --input input\meshes\0EJBIPTC_lower.obj
python scripts\run_meshsegnet.py --model max --input input\meshes\ZOUIF2W4_upper.obj
```

### `np.warnings`: numpy ≥ 1.24 versus vedo 2022.4.2

vedo 2022.4.2 executes this statement while its package is being imported
(`vedo/__init__.py:234`):

```python
np.warnings.filterwarnings('ignore', category=np.VisibleDeprecationWarning)
```

`np.warnings` was the standard library `warnings` module re-exported by numpy.
NumPy deprecated the alias in 1.15 and **removed it in 1.24**, so with the
numpy 1.26.4 pinned for this lab, `import vedo` fails with

```
AttributeError: module 'numpy' has no attribute 'warnings'
```

and the runner stops with `[STOP] missing dependency: AttributeError: ...`
before reaching inference. (`np.VisibleDeprecationWarning` is the second
casualty: numpy 2.0 moved it to `np.exceptions`.)

The runner installs a shim **before** importing vedo, restoring only those two
names in memory for the current process:

| Restored name | Value | Why it is safe |
| --- | --- | --- |
| `np.warnings` | the standard library `warnings` module | exactly the object numpy re-exported before 1.24 — not a reimplementation |
| `np.VisibleDeprecationWarning` | `np.exceptions.VisibleDeprecationWarning`, if numpy moved it | same class object, different location |

Nothing else is patched, no package version changes, no file is written, and no
numerical behaviour is affected: these names only control **which warnings are
printed**. The applied shim is named in the run output and recorded in
`run_report.json` under `environment_shims`.

The shim is needed because the lab pins numpy below 2.0 for torch. If you would
rather not rely on it, the alternative is an era-matched numpy (`numpy<1.24`),
which this lab does not recommend — torch 2.0.1 supports numpy 1.26.4 well, and
downgrading numpy to suit one library's warning filter is the larger risk. No
numpy downgrade is performed or required.

### Library-compatibility fixes applied by the runner

Three version drifts in the pinned library set stopped this pipeline *before* it
could touch the model. Each was reproduced against the real libraries and fixed
inside the lab. None of them touches the model, the weights or the mathematics.

| # | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| 1 | `ModuleNotFoundError: No module named 'resource'` at startup | `resource` is Unix-only | portable memory probing: `psutil` → Windows `GetProcessMemoryInfo` → POSIX `resource` + `/proc`, imported lazily |
| 2 | `AttributeError: module 'numpy' has no attribute 'warnings'` while importing vedo | numpy removed the alias in 1.24; vedo 2022.4.2 still uses it at import time | `np.warnings` restored in memory — the stdlib `warnings` module, i.e. the same object numpy used to re-export |
| 3 | `ValueError: No input was provided when one is required.` from `clone()` / `decimate()` / `compute_normals()` | modern VTK added a `mapper` **property** to `vtkActor` that shadows vedo's own `mapper()` method earlier in the MRO | the class attribute is rebound to vedo's own method, then verified on a tiny mesh |

Fixes 2 and 3 live in **`scripts/compat.py`** and are applied by every script in
the lab (loaded by path, so a fix made once cannot drift between scripts). They
are idempotent, they revert themselves when verification fails, and they are
recorded in `run_report.json` under `environment_shims`. Every run prints them:

```
  np compat    : restored for vedo 2022.4.2 on numpy 1.26.4: np.warnings
  vedo compat  : vtkActor.mapper shadows vedo's method on vtk 9.7.0; rebound to vedo.base.BaseActor.mapper
```

Check the stack on your machine before a long run — this imports nothing heavy
and performs no inference:

```powershell
python scripts\compat.py
```

**These shims are numerically inert, and that was measured, not assumed.** With
the shimmed stack (vedo 2022.4.2 + vtk 9.7.0 + numpy 1.26.4 + scipy 1.17.1) the
pipeline produces *exactly* the same features and adjacency matrices as the
modern stack used for the original validation run (vedo 2026.6.1 + vtk 9.7.0):

| Mesh | Cells | Points after decimation | A_S / A_L nonzeros per row |
| --- | --- | --- | --- |
| `0EJBIPTC_lower.obj` | 178,421 → **10,000** | 6,172 | **428 / 1697** |
| `ZOUIF2W4_upper.obj` | 328,581 → **9,999** | 5,003 | **311 / 1307** |

Both stacks agree to the digit on both jaws. The decimation, the 15 features and
the two adjacency thresholds are therefore unchanged by the compatibility work —
that is the point of doing it this way rather than switching library versions.

### Windows: memory reporting

`run_meshsegnet.py` prints a RAM line and records a RAM field. That is
diagnostics only — it has no effect on inference. Because the Unix-only
`resource` module does not exist on Windows, measurement goes through the first
probe that works:

1. **`psutil`**, if it is installed — cross-platform;
2. **`GetProcessMemoryInfo`** (Windows API), through `ctypes` — needs no
   dependency at all;
3. **`resource` / `/proc`** on POSIX, imported lazily so Windows never touches it.

If no probe works the field reads `n/a (probe unavailable)` and the run
continues. Install `psutil` only if you want its numbers:

```powershell
pip install psutil      # optional
```

The reported figure is always attributed to the probe that produced it, because
Windows measures a *working set* and Linux a *resident set* — the two are not
interchangeable and the report does not pretend they are.

Verify the runner starts on a machine without `resource`:

```powershell
python -m unittest discover -s tests -v
```

Use `--dry-run` to exercise everything except the forward pass, and
`--expect-sha256 <hash>` to pin the input.

| Script | Purpose |
| --- | --- |
| `check_environment.py` | Python, torch, CUDA availability, cores, RAM, mesh libraries, artifact presence |
| `download_artifacts.py` | Fetches the official models, official source snapshot and real meshes; refuses anything whose SHA-256 does not match |
| `verify_artifacts.py` | Hashes everything, loads each checkpoint into the architecture with `strict=False`, and reports missing/unexpected keys |
| `run_meshsegnet.py` | The only script that performs inference |
| `compat.py` | The shared compatibility shims (numpy names for vedo, vedo's `mapper()` method) plus a mesh-operation self-test. Run it directly for a pre-flight report: `python scripts\compat.py` |
| `../tests/test_vedo_vtk_compat.py` | Regression tests for the vedo/VTK fix: the shim must repair `clone()`/`decimate()`, must be a no-op on a correct stack, must run before any mesh is touched, and the official decimation targets (10,000 / 9,999 cells) must still be hit exactly. |
| `../tests/test_runner_import.py` | Platform-compatibility regression tests: the runner must import and start on a machine without `resource`, memory probes must never raise, and the official constants/filenames must stay unchanged. Standard library only. |
| `../tests/test_numpy_warnings_shim.py` | Regression tests for the `np.warnings` fix: the exact vedo 2022.4.2 statement must execute after the shim and must still fail without it, the shim must be installed before `import vedo`, and it must patch nothing else. Really imports vedo where it is installed. |

`--model man` = lower jaw (mandible), `--model max` = upper jaw (maxilla). Match
the model to the jaw of the scan; the two heads were trained separately.

### Outputs

| File | Contents |
| --- | --- |
| `output/<case>_<model>_predicted.vtp` | the decimated mesh with per-cell `Label` data — the same output format as the official script |
| `output/<case>_<model>_labels.npy` | `int32` label per cell, shape `(N,)`, values 0–14 |
| `output/<case>_<model>_probabilities.npz` | full softmax output, shape `(N, 15)` |
| `output/run_report.json` | machine-readable run record |
| `logs/run_<UTC>_<model>.json` | immutable copy of each run |

`run_report.json` records model identity (filename, size, SHA-256, architecture
source hash, parameter count, class count, trained epochs), input identity (path,
size, SHA-256, original cell count, decimated count), device and CUDA
availability, a timing breakdown (model load / mesh load / features / adjacency /
inference / total), peak RAM, output dimensions, the class histogram, and the
list of deviations from the official script.

---

## How the runner relates to the official script

The published `step5_predict.py` **cannot execute on your machine as written**:
it calls `utils.get_avail_gpu()` and `torch.cuda.set_device(gpu_id)`
unconditionally. So this lab uses its own runner, and every deviation is recorded
inside each `run_report.json`:

1. **CPU execution.** The runner pins `torch.device("cpu")` and never touches
   CUDA. The official script's device logic is CUDA-only.
2. **Adjacency built in row blocks.** The official code builds one dense
   `distance_matrix` over all cells; at 10,000 cells that alone is an 800 MB
   float64 array, plus two 400 MB float32 matrices. The runner computes the same
   comparisons (`< 0.1`, `< 0.2`) and the same row normalisation in blocks, so
   peak memory stays bounded. The resulting matrices are the same.
3. **Cell barycenters** are derived from the same point array used for the cell
   features (`points[faces].mean(axis=1)`) instead of `mesh.cell_centers()`.
   For a triangular mesh these are identical, and it keeps the normalisation
   self-consistent.
4. **Mesh accessors** work with both the vedo method API (the era the official
   code targets) and the current vedo property API.

What is **not** changed: the official `meshsegnet.py` architecture (imported
verbatim from a hashed snapshot), the official weights, the 15-feature
construction, the two adjacency thresholds, the 10,000-cell downsampling rule,
and the output format.

---

## Verification status

| Claim | Status |
| --- | --- |
| Method identity (paper, authors, repository, MIT) | **VERIFIED** |
| Official weights exist as in-repo git blobs (not release assets) | **VERIFIED** |
| Both model SHA-256 values | **VERIFIED** — match on every run |
| Weights load into the architecture with 0 missing / 0 unexpected keys | **VERIFIED** |
| Class count 15, ids 0–14 | **VERIFIED** |
| Real intraoral scan inputs, hashed, millimetre scale | **VERIFIED** |
| **Actual CPU inference** | **VERIFIED** — repeated, both jaws |
| Real segmentation output produced | **VERIFIED** — `.vtp` / `.npy` / `.npz` |
| Runtime stability | **VERIFIED** — 3 repeats, 2.02–2.21 s inference |
| Label→tooth-name mapping | **NOT PUBLISHED** — not claimed |
| Accuracy of the segmentation | **NOT ASSESSED** — no ground truth used |
| Behaviour on your specific laptop | **NOT MEASURED HERE** — re-run locally |
| Runs on Windows (no Unix-only imports; RAM probing portable) | **VERIFIED BY TEST** — `tests/test_runner_import.py`, no change to model or mathematics |
| Windows `GetProcessMemoryInfo` reports a real working set | **VERIFIED BY TEST** — pointer-sized handle declared; a truncated handle (the original bug) is now impossible; zeroed counters degrade to `unavailable` instead of a fake `0 bytes` |
| Mesh pipeline works on the era-mismatched stack (vedo 2022.4.2 + vtk 9.7.0) | **VERIFIED** — reproduced the failure, fixed it, then ran the full pipeline on both real meshes with identical features and adjacency |
| Dependency versions changed to make it work | **NONE** — no numpy/torch/vedo/vtk downgrade or upgrade; the shims restore library behaviour in-process |
| Imports vedo 2022.4.2 on numpy 1.26.4 (`np.warnings` gap) | **VERIFIED** — reproduced the real failure, then imported the real vedo 2022.4.2 with vtk 9.7.0 after the shim; covered by `tests/test_numpy_warnings_shim.py` |

---

## Arena validation vs your machine

Two different things are being claimed, and they are kept apart on purpose.

| | Where it was established | What it covers |
| --- | --- | --- |
| The method, the weights, the input data, the pipeline | Arena sandbox (Linux, 2 cores, 3 GB, 1 torch thread) | that these are the real official artifacts and that real inference produced real output |
| The dependency stack *you* have (vedo 2022.4.2 + vtk 9.7.0 + numpy 1.26.4 + scipy 1.17.1) | Arena sandbox, by installing exactly that stack | that the pipeline runs on those versions, with identical numbers |
| Your hardware, your Windows, your timing and RAM | **only you can produce this** | that it runs on the i9-13900H, and how fast |

Arena cannot observe your machine, your VTK runtime, your filesystem or your
timings. Nothing below is a substitute for running it locally.

### LOCAL_ONLY_CHECKS

Run these from `C:\Users\abdoo\dental-clinic-system\ai-validation\meshsegnet`.
Each one is safe: none of them trains, converts, downloads, deletes or writes
into the application.

**1 — the library stack can perform mesh operations (fastest, do this first)**

```powershell
python scripts\compat.py
```
Expected: `mesh ops verified: True` and
`This library stack can perform the pipeline's mesh operations.`
Any other result means the mesh stage cannot run — send me the output.

**2 — environment and artifacts**

```powershell
python scripts\check_environment.py
python scripts\verify_artifacts.py --expect-models
```
Expected: `torch 2.14.0+cpu`, `CUDA available : False`, total RAM ≈ 16 GB; both
models `official match : YES` with `missing=0 unexpected=0`; both meshes with
`finite coords : True` and extent ≈ 85 mm. Exit code 0 for both.

**3 — the test suite**

```powershell
python -m unittest discover -s tests -v
```
Expected: `Ran 43 tests` … `OK`.

**4 — the RAM probe really measures something on Windows**

```powershell
python -c "import sys; sys.path.insert(0,'scripts'); import run_meshsegnet as r; print(r.memory_usage())"
```
Expected: `rss_bytes` greater than 0 and a `method` mentioning
`Windows working set`. If it says `unavailable`, report it — that is the bug this
round of work fixed.

**5 — full pipeline rehearsal, no inference**

```powershell
python scripts\run_meshsegnet.py --dry-run --model man --input input\meshes\0EJBIPTC_lower.obj --expect-sha256 b824f6822f4a6ada296eef6869e9341fa1e69ad6cd14862b53572198ae5e7a76
```
Expected: `decimation : yes -> 10,000 cells`,
`features : X (10000, 15)`, `adjacency : A_S/A_L (10000, 10000), nnz/row 428 / 1697`,
then `--dry-run: skipping the forward pass.` Exit code 0. This exercises the
whole pipeline except the forward pass, so any remaining library problem surfaces
here rather than halfway through the real run.

**6 — redirected output stays clean**

```powershell
python scripts\run_meshsegnet.py --help > $env:TEMP\msn_help.txt; Get-Content $env:TEMP\msn_help.txt | Select-Object -First 3
```
Expected: the usage text, with no `UnicodeEncodeError`.

## Limitations

1. **No accuracy claim.** No ground truth was used; nothing here says the
   segmentation is correct, only that it was really produced by the official
   model on real input.
2. **Predictions are on the decimated mesh.** The official pipeline reduces every
   scan above 10,000 cells to 10,000 before inference, so labels are per-face on
   that reduced mesh, not on the original 178k/328k-cell scan. Upsampling back to
   the full mesh is not part of the official code and was not attempted.
3. **No label→tooth mapping.** The repository does not publish one, so class ids
   are reported numerically and never translated into FDI tooth numbers here.
4. **Upper-jaw input licence is undeclared.** `ZOUIF2W4_upper.obj` comes from a
   repository with no `LICENSE`. It is used only as local test input and is never
   redistributed. The lower-jaw mesh comes from the MIT-licensed 3DTeethSeg'22
   challenge repository.
5. **Small training set.** Both models were trained on 72 samples; the filenames
   record this. Expect limited generalisation — that is a property of the
   published artifact, not of this validation.
6. **Single-mesh, single-jaw-pair test.** Two scans is enough to prove the
   pipeline runs; it is not an evaluation across scanners, malocclusions, or
   edentulous cases.
7. **Era drift, and what it costs.** The official code targets vedo 2022.4.2 +
   vtk 9.2.4 + torch 1.13.1. Two drifts were found and repaired in-process (see
   above). A third is cosmetic and left alone: on vtk 9.7.0 vedo 2022.4.2 emits
   `DeprecationWarning` for `vtkTransformPolyDataFilter` and `GetData` while
   decimating. The calls still work, the numbers are identical, and suppressing
   a library's warnings was not this lab's call to make. A future VTK that
   *removes* those APIs would break the mesh stage; the runner detects that
   before touching the mesh (`python scripts\compat.py`) and stops cleanly
   with `[STOP]` rather than crashing.
8. **Sandbox ≠ laptop.** Timing and RAM figures come from a 2-core, 3 GB
   container.

---

## Clinical disclaimer

A segmentation being produced is not a segmentation being correct, and neither
is a diagnosis. Any output from this lab is research material requiring review by
a licensed clinician. Not a medical device. Not clinically validated here.
