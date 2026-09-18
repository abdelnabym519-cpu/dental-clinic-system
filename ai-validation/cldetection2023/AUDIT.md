# Engine #6 — Audit: `5k5000/CLdetection2023` (cephalometric landmark detection)

Audit date: 2026-09-18. Scope: repository audit → dependency repair → model load →
real dental image → real CPU inference → runtime evidence → classification.

Everything below is tagged the way the previous engines do it:

- **VERIFIED-HERE** — read from a primary source during this audit (the upstream tree at a
  pinned revision, the config, the fork's own source, a command that ran).
- **VERIFIED-BY-OPERATOR** — established on the machine that has the checkpoint.
- **EXPECTED** — derived from the above but not yet observed on the target hardware.

---

## 1. Repository

**VERIFIED-HERE.** `5k5000/CLdetection2023` ("The Solution Repository for MICCAI
CLDetection2023 of Team SUTD-VLG"), default branch `master`, **Apache-2.0**, public.
Audit revision: **`18d17d193497…`** — the head of `master` when the repository was
inspected, dated 2026-07-28 ("Merge pull request #8 … Display point IDs in single image
inference"). Pinned sub-revisions of interest: the single-image script came from
`6a889ba23962` (2023-10-05), the README from `d1a01536ad89` (2023-11-28).

Contents: `inference_single_image.py`, `step1_test_mmpose.py`, `step2_prepare_coco_dataset.py`,
`step3_train_and_evaluation.py`, `step4_test_and_visualize.py`, `cldetection_utils.py`,
`configs/CLdetection2023/srpose_s2.py`, `requirements.txt`, `install_env.sh`, and a **vendored
mmpose fork** under `mmpose_package/mmpose` (1,365 files, 13 MB) that reports version `1.0.0`.

The card's install recipe (`install_env.sh`) is:

```
conda create -n LMD python=3.10 … pip install -r requirements.txt …
cd mmpose_package/mmpose ; pip install -e . ; mim install mmengine ; mim install "mmcv>=2.0.0" ; pip install --upgrade numpy
```

Note the unpinned `"mmcv>=2.0.0"`: it is what makes `mim` pick 2.2.0, which the fork
refuses. See §6.

## 2. Task

**VERIFIED-HERE.** Cephalometric landmark detection on **lateral** cephalometric X-rays:
38 landmarks, heatmap regression, top-down pipeline. The model card and the config agree;
the codec is MSRA heatmaps at 1024×1024 (see §7).

## 3. Dataset access — and what it means for inference

**VERIFIED-HERE.** The training/dev data (`train_stack.mha`, `train-gt.json`) is **not** in
the repository and cannot be: the README states the challenge data may not be forwarded and
must be requested from `cl-detection2023.grand-challenge.org`, which is access-gated.

`inference_single_image.py` does **not** actually do single-image inference. It reads
`val_dataloader`/`test_dataloader` from the config, opens the COCO annotation JSON, and
iterates every image, computing MRE/SDR against the ground truth. Without the gated
dataset it cannot run at all — for a new image there is no annotation to iterate.

**Consequence.** The faithful way to run *this* model on *one* image is the same pipeline
without the annotation loop: image → the repository's own preprocessing → `inference_topdown`
→ `merge_data_samples`. That is exactly what `scripts/run_inference.py` does; the model,
config, weights and post-processing are unchanged.

## 4. Checkpoint

**VERIFIED-BY-OPERATOR (identity), EXPECTED (structure).**

| field | value |
| --- | --- |
| file | `model/model_pretrained_on_train_and_val.pth` |
| size | **268,846,952 bytes** |
| sha256 | **`FB1A781AC1C83149B379CB15724E3B0FAE06BA2D567978F35C61E9D06B46FDCC`** |
| provenance | the project's own pretrained weights, documented in the repository README and distributed by the authors via Google Drive |

The digest was computed locally by the operator and matches the expected value exactly. It
was **not** recomputed in this audit environment: the file is not here, and the authors'
distribution route (Google Drive) is not reachable from this sandbox — `drive.google.com`
returns no connection, as do Hugging Face, figshare, Zenodo and Wikimedia. This is recorded
rather than glossed over; `scripts/inspect_checkpoint.py` recomputes size + sha256 and stops
on any mismatch (exit 6).

Structure: a 268.3 MB `torch.save` artifact that the model builder reads as
`{'state_dict': …, 'meta': …}` — `state_dict` for the 66.8 M-parameter HRNet-W48 +
SRPoseHead graph, `meta` for `dataset_meta` (keypoint definitions, flip indices, sigmas).
The audit verified the *shape* of that contract by building the model from the config,
saving an equivalent checkpoint and loading it through the same `init_model()` path with
`strict=True`-equivalent equality checks (see §8, control run). It does not prove the real
file's contents; that is what the first run on the operator's machine proves.

## 5. Input

**VERIFIED-HERE.** The model needs a **lateral cephalometric radiograph**. What exists
in the workspace and what does not:

- The repository ships **no** dental image: its only image files are a results table
  (`Pictures_for_Github_only/Online Result.png`, which is a screenshot of metrics) and
  framework diagrams.
- No cephalogram is reachable from this sandbox through any route tested (Wikimedia,
  NIH, figshare, Mendeley, Zenodo, Hugging Face, arXiv, Google Drive — all unreachable).
- A real one **is** reachable through GitHub, from the challenge organisers themselves:

| field | value |
| --- | --- |
| repository | `szuboy/CL-Detection2023` — *"CL-Detection2023 Challenge Official Repository"*, **Apache-2.0** |
| revision | `dc1ce2bd0a3f317de4160cde17e4a6f60371e67c` |
| path | `step5_docker_and_upload/test/stack1.mha` (41,472,328 bytes) |
| container | MetaImage, `MET_UCHAR`, `BinaryData = True`, `ElementDataFile = LOCAL`, `DimSize = 2880 2400 2`, `ElementNumberOfChannels = 3` |
| content | two lateral cephalometric radiographs (2880×2400, RGB, grayscale-valued), i.e. the organisers' own validation inputs for the baseline they published |
| companion file | `step5_docker_and_upload/test/expected_output.json` — the organisers' reference 76 points (38 per image) |

These are the challenge's own validation images, published by the organisers for exactly
this purpose, under Apache-2.0, alongside the ground truth. The extracted slice 1 writes to
a 2400×2880 PNG with sha256
`b663ed10bd190f8891e781b7e408b9e380c3a2f550a6bdca1c5414cee545d988` (see
`reports/engine6_control_run.json` → `input_sha256`). Nothing is invented, nothing is
synthesised, and no patient-identifying information is added by this lab.

The image is **not committed to git** (both because of its size and because it carries a
radiograph's own burned-in study label). `scripts/extract_input.py` regenerates it
byte-for-byte from the public source, and `input/NOTE.md` records the provenance.

## 6. Dependency matrix — where the reported failure came from

**VERIFIED-HERE.** The fork's `mmpose/__init__.py` asserts, on import:

```python
mmcv_minimum_version     = '2.0.0rc4'   mmcv_maximum_version     = '2.1.0'
mmengine_minimum_version = '0.6.0'      mmengine_maximum_version = '1.0.0'
```

`mim install "mmcv>=2.0.0"` therefore resolves to **mmcv 2.2.0**, which the fork refuses —
and because no `mmcv` 2.2.0 wheel matches the installed torch, `mim` starts a **source
build**, which is where the reported `ModuleNotFoundError: No module named 'pkg_resources'`
appeared. (`meson` and `torch` were installed by that build path; the missing
`pkg_resources` was the symptom, not the cause.) The cause is the version window above.

### Is a prebuilt MMCV wheel available for this torch?

**VERIFIED-HERE (from PyPI's index).** `mmcv` publishes **only sdists** for 2.0.1/2.1.0/2.2.0
(no wheels at all), and the binary wheels the project used to host on
`download.openmmlab.com` are built for torch ≤ 2.1.0 — that host is unreachable from this
sandbox and, more importantly, using it would force a torch downgrade. **`mmcv-lite` does
publish a pure-Python wheel:** `mmcv_lite-2.1.0-py2.py3-none-any.whl` (720 KB, `requires_python
>=3.7`), and it satisfies the fork's version assertion.

### Does this model need full mmcv?

**VERIFIED-HERE.** The fork's only `mmcv.ops` uses are two optional imports
(`models/heads/hybrid_heads/dekr_head.py`, `models/necks/posewarper_neck.py`), both wrapped
in `try/except` with `has_mmcv_full = False` fallbacks. Neither DEKR nor PoseWarper is used
by this config: it is `TopdownPoseEstimator` + `HRNet` + `SRPoseHead` + `MSRAHeatmap`, which
need `mmcv.cnn`, `mmcv.utils` and the registry plumbing — all present in `mmcv-lite`. The
control run in §8 exercised exactly this path and loaded nothing from `mmcv.ops`.

### The stack that works (and why each pin)

| package | version | why |
| --- | --- | --- |
| Python | 3.10 (repo's recipe) / 3.11 (audit env) | both work with these wheels |
| **torch** | **2.6.0 (CPU)** — *kept, not downgraded* | see §7; the fork's mmcv cap is satisfied by mmcv-lite, so no torch change is needed |
| torchvision | 0.21.0 | matches torch 2.6.0 |
| **mmcv-lite** | **2.1.0** | inside `[2.0.0rc4, 2.1.0]`; **prebuilt wheel, no compilation**; the model never touches `mmcv.ops` |
| mmengine | 0.10.7 | inside `[0.6.0, 1.0.0]` |
| mmpose | 1.0.0 | the repository's own vendored fork, installed editable |
| **numpy** | **1.26.4** | `xtcocotools` (mmpose dependency) is compiled against NumPy 1.x; on 2.x it raises `ValueError: numpy.dtype size changed` at import |
| **setuptools** | **< 81** (80.10.2) | `mmengine.utils.package_utils.get_installed_path` imports `pkg_resources`, removed in setuptools 81 |
| opencv | `opencv-python-headless` 4.10 | `xtcocotools` pulls full `opencv-python`, whose Linux wheel needs `libGL.so.1`; headless has no GUI dependency. **On Windows the normal `opencv-python` is fine** |
| SimpleITK 2.2.1 | | imported by `cldetection_utils.py`; only needed to read `.mha` |

`torch`, `mmcv-lite`, `mmengine`, `mmpose` and `numpy` were all installed (or already
present) **without compiling anything**. The only source build in the whole stack is the
repository's own `pip install -e mmpose_package/mmpose`, which is pure Python.

## 7. The torch ≥ 2.6 finding (this is the one that would have stopped inference)

**VERIFIED-HERE, reproduced twice.**

```
_pickle.UnpicklingError: Weights only load failed.
  In PyTorch 2.6, we changed the default value of the `weights_only` argument in torch.load
  from False to True.
  WeightsUnpickler error: Can only build Tensor, Parameter, OrderedDict or types allowlisted
  via add_safe_globals, but got <class 'numpy.dtypes.UInt8DType'>
```

From PyTorch 2.6, `torch.load` defaults to `weights_only=True`. `mmengine 0.10.7`'s
`CheckpointLoader.load_from_local` calls `torch.load(filename, map_location=map_location)`
— the installed source has **no `weights_only` parameter anywhere** — so `init_model()`,
which is what `init_pose_estimator()` and both of the repository's scripts use, cannot load
an mmpose-1.0 checkpoint on a modern torch. The failure has nothing to do with MMCV: it
would appear even with a perfect mmcv, and it is not the `pkg_resources` error either.

Three ways out, and the one taken:

1. **`torch.load(..., weights_only=False)`** — restores the pre-2.6 behaviour, but mmengine
   offers no passthrough, so it needs a monkey-patch or a hand-written loader, and it
   re-opens arbitrary code execution from the checkpoint.
2. **Downgrade torch to < 2.6** — restores upstream behaviour exactly, at the cost of a
   second large reinstall and of pinning the engine away from current torch.
3. **Keep torch 2.6 and allow-list the checkpoint's own reconstruction primitives** —
   **chosen.** `run_inference.py` reads the checkpoint's pickle globals *before* loading
   (non-executing, `pickletools`), refuses to continue if any name is outside a bounded,
   documented allow-list, then registers that allow-list with
   `torch.serialization.add_safe_globals` and lets `torch.load` keep its strict default.
   Nothing is weakened; the guard stays on and the allow-list is readable in
   `scripts/run_inference.py` (`SAFE_GLOBAL_NAMES` / `allow_list_names()`).

Important detail for anyone reproducing this: registering only the names found in the file
is **not** enough. torch's unpickler also checks the *type of every constructed object*, and
a numpy dtype class such as `numpy.dtypes.UInt8DType` never appears as a GLOBAL — it is
constructed. The whole bounded allow-list is registered for that reason.

## 8. What was actually executed (and what that proves)

**VERIFIED-HERE.** In an isolated venv built from scratch on the stack in §6:

| step | result |
| --- | --- |
| `python step1_test_mmpose.py` (the repository's own check) | `1.0.0`, exit 0 |
| `scripts/check_environment.py --repo …` | **12/12 checks pass** (`reports/environment_checks.json`) |
| config verification | `TopdownPoseEstimator` · backbone `HRNet`, channels `(64)/(48,96)/(48,96,192)/(48,96,192,384)` · head `SRPoseHead`, **`num_joints = 38`**, `upsample_log=[3,2,1,2]` · codec `MSRAHeatmap`, `input_size=(1024,1024)`, `sigma=6` · `test_cfg flip_test=True` · preprocessing mean/std `121.25/76.5`, `bgr_to_rgb=True` |
| model build from the config | **66.8 M parameters**, `TopdownPoseEstimator`/`HRNet`/`SRPoseHead` |
| checkpoint round-trip | saved a control checkpoint → loaded it through the same `init_model()` path → **all 1,969 tensors identical** |
| real image | the organisers' cephalogram, `remove_zero_padding` → 2400×1935, exactly as the repository's own val loop does |
| **forward pass** | **38 keypoints, all finite, non-empty** — no crash, no crash-workaround, `inference_topdown(bboxes=None)` |
| runtime | **20.4 s inference / 25.9 s total; peak RSS 1.82 GB; `torch.cuda.is_available() = False`; device `cpu`** on 2 vCPU |

**What this does *not* prove.** The control checkpoint in the sandbox has **random weights**
(268.3 MB, generated to match the real checkpoint's contract — same builder, same 1,969
tensors), because the real 268,846,952-byte file is not in this environment and its
distribution route is unreachable. So the run proves the *mechanism* — environment, model
construction, checkpoint loading contract, preprocessing, forward pass, output structure,
timings — and says **nothing** about landmark accuracy. Coordinates from a random-init
network are meaningless by construction (`x` range outside the image), which is why they
are not presented as model output. **Real-weight inference has not happened yet anywhere.**

## 9. Runtime plan for the operator's machine (the only remaining step)

```powershell
cd C:\Users\abdoo\dental-clinic-system\ai-validation\cldetection2023
.\.venv\Scripts\Activate.ps1

# 0) repairs (only what is missing; see §6 for why each one)
python -m pip install "setuptools<81" "numpy==1.26.4" "mmcv-lite==2.1.0"
python -m pip install -e CLdetection2023\mmpose_package\mmpose      # the vendored fork

# 1) environment proof
python scripts\check_environment.py --repo CLdetection2023 --json-out reports\environment_checks.json
python CLdetection2023\step1_test_mmpose.py

# 2) identity + security gate on the real checkpoint (reads, never executes)
python scripts\inspect_checkpoint.py --checkpoint model\model_pretrained_on_train_and_val.pth `
    --json-out reports\checkpoint_globals.json

# 3) get the real input image (Apache-2.0, from the challenge organisers)
git clone https://github.com/szuboy/CL-Detection2023.git CL-Detection2023
python scripts\extract_input.py --stack CL-Detection2023\step5_docker_and_upload\test\stack1.mha `
    --index 1 --out input\ceph_stack1_image1.png --json-out reports\input_provenance.json

# 4) the real inference
python scripts\run_inference.py --repo CLdetection2023 `
    --checkpoint model\model_pretrained_on_train_and_val.pth `
    --image input\ceph_stack1_image1.png `
    --expect-sha256 FB1A781AC1C83149B379CB15724E3B0FAE06BA2D567978F35C61E9D06B46FDCC `
    --expect-size 268846952 `
    --json-out reports\engine6_run.json --out-image output\ceph_landmarks.png
```

Optional cross-check: the same image has organiser ground truth in
`CL-Detection2023\step5_docker_and_upload\test\expected_output.json` (38 points for image id 1).
Comparing the prediction against it is a *sanity* measure on one image — it is not the
challenge metric (that needs the gated 400-image validation set, and MRE in mm needs the
per-image pixel spacing, which the test stack does not carry).

## 10. Boundaries

- No training, fine-tuning, conversion, ONNX export or optimisation. The published
  checkpoint is used as-is.
- No ERP, database, API or UI changes; no production file touched.
- No synthetic or substitute image, and no fabricated output: the input is a real
  cephalogram from the organisers, and the only numbers reported as model output will come
  from the operator's run with the real weights.
- The checkpoint and the radiograph stay out of git.
- **Functional inference ≠ clinical accuracy.** Nothing here validates diagnostic
  performance, and no autonomous-diagnosis claim is made or implied.
