# Engine #6 — CLdetection2023 · validation report

| field | value |
| --- | --- |
| **engine** | 6 — CLdetection2023 (cephalometric landmark detection, 38 landmarks) |
| **repository** | `5k5000/CLdetection2023` (Apache-2.0, vendored mmpose fork 1.0.0) |
| **revision** | `18d17d193497…` (head of `master`, 2026-07-28); single-image script `6a889ba23962`, README `d1a01536ad89` |
| **checkpoint** | `model/model_pretrained_on_train_and_val.pth` (supplied by the operator) |
| **checkpoint_sha256** | `FB1A781AC1C83149B379CB15724E3B0FAE06BA2D567978F35C61E9D06B46FDCC` (verified by the operator; not recomputable in the validation environment) |
| **checkpoint_size** | 268,846,952 bytes |
| **python_version** | 3.11.2 (audit env) · 3.10.11 (operator's venv) — both supported by the pinned wheels |
| **torch_version** | 2.6.0 (**kept — no downgrade**; see the torch ≥ 2.6 finding) |
| **torch_cuda** | `torch.cuda.is_available() = False` · build 12.4 · device pinned to `cpu` |
| **mmcv_version** | **2.1.0 (mmcv-lite)** — prebuilt wheel, inside the fork's `[2.0.0rc4, 2.1.0]` window |
| **mmengine_version** | 0.10.7 — inside `[0.6.0, 1.0.0]` |
| **mmpose_version** | 1.0.0 (the repository's own vendored fork, editable install) |
| **device** | `cpu` — `inference_topdown` never touched a GPU; 2 vCPU in the audit env |
| **input_source** | `szuboy/CL-Detection2023` @ `dc1ce2bd0a3f317de4160cde17e4a6f60371e67c`, `step5_docker_and_upload/test/stack1.mha` (Apache-2.0) → slice 1 |
| **input_sha256** | `b663ed10bd190f8891e781b7e408b9e380c3a2f550a6bdca1c5414cee545d988` (extracted PNG) |
| **input_dimensions** | 2880×2400×3 → 1935×2400 after the repository's `remove_zero_padding` |
| **config** | `configs/CLdetection2023/srpose_s2.py` — `TopdownPoseEstimator` · `HRNet` W48 (`(64)/(48,96)/(48,96,192)/(48,96,192,384)`) · `SRPoseHead` · **`num_joints = 38`** · `MSRAHeatmap`, `input_size = (1024, 1024)`, `sigma = 6` · `flip_test = True` |
| **landmark_count** | **38** keypoints returned, all finite, non-empty (control run — see below) |
| **inference_seconds** | **20.38 s** (single 1024×1024 forward + flip test) |
| **total_seconds** | **25.91 s** (hash + allow-list + build + load + preprocess + forward + overlay + report) |
| **peak_ram** | **1.82 GB** RSS (`resource.ru_maxrss`; psutil used when available) |
| **exit_code** | 0 (`run_inference.py`), 0 (`step1_test_mmpose.py`), 12/12 environment checks |
| **functional_inference** | **mechanism proven; real-weight inference not yet run** |
| **clinical_validation** | **NOT VALIDATED** |
| **status** | **⚪ BLOCKED (for the engine's acceptance criterion)** — environment: 🟡 OPERATIONAL WITH WORKAROUND |
| **failure_reasons** | the real checkpoint is not present in the validation environment, and its distribution route (Google Drive, as given in the repository README) is unreachable from it — so no real-weight landmark output exists yet |
| **workarounds** | ① `mmcv-lite 2.1.0` instead of a full `mmcv` source build; ② `setuptools < 81` for `pkg_resources`; ③ `numpy 1.26.4` for the `xtcocotools` ABI; ④ `opencv-python-headless` on Linux; ⑤ `torch.serialization.add_safe_globals` with a bounded allow-list so torch 2.6 keeps `weights_only=True`; ⑥ CWD-independent dataset-metainfo resolution |

## Evidence

| artifact | what it shows |
| --- | --- |
| `reports/environment_checks.json` | **12/12 checks pass**: torch, MMCV window, MMEngine window, mmpose 1.0.0, NumPy 1.x ABI, `xtcocotools` import, `pkg_resources`, mmpose inference API + `SRPoseHead` + `MSRAHeatmap`, config present, version ranges cross-checked against the fork's own `__init__.py` |
| `reports/engine6_control_run.json` | the control run: 38 landmarks, 20.38 s, 1.82 GB, CPU-only — **random weights**, so coordinates are withheld |
| `reports/checkpoint_globals.json` | *(to be produced on the operator's machine)* the real checkpoint's pickle globals + sha256/size gate |
| `reports/engine6_run.json` | *(to be produced on the operator's machine)* the real run with the supplied weights |

## Why this is not 🟢

The acceptance criterion for this engine is **real landmark inference from the supplied
pretrained weights on a real lateral cephalometric radiograph**. What ran here used a control
checkpoint with **random weights** generated from the same config (1969 tensors +
`dataset_meta`, mirroring the real file's contract), because the real 268,846,952-byte file
could not be brought into this environment. The mechanism is proven end to end; the model's
output is not. Reporting 🟢 on that basis would be exactly the failure mode this lab exists
to prevent.

One command closes it — see `AUDIT.md` §9 (or `README.md` "Run it"). The operator's run
writes `reports/engine6_run.json` and `output/ceph_landmarks.png`; at that point
`functional_inference = true` with real weights, and the status moves to
🟡 OPERATIONAL WITH WORKAROUND (workarounds ①–⑥ are still required) — or 🟢 only if the
allow-list registration is judged unnecessary, which it is not on torch ≥ 2.6.

## Findings worth carrying forward

1. **The reported `pkg_resources` error was a side effect, not the cause.** The cause is the
   fork's `mmcv ≤ 2.1.0` window versus `mim`'s unpinned `"mmcv>=2.0.0"` → mmcv 2.2.0 → source
   build. `mmcv-lite 2.1.0` is a prebuilt wheel inside the window, and the model path never
   needs `mmcv.ops`.
2. **torch ≥ 2.6 would have stopped inference even with a perfect MMCV.** `torch.load` now
   defaults to `weights_only=True`; `mmengine 0.10.7` calls it without that argument, so
   `init_pose_estimator()` raises `_pickle.UnpicklingError`. Fixed by allow-listing the
   checkpoint's own reconstruction primitives — **not** by downgrading torch and **not** by
   disabling the guard. Registering only the file's GLOBAL names is insufficient; the
   unpickler also validates constructed types (e.g. `numpy.dtypes.UInt8DType`).
3. **`inference_single_image.py` is not a single-image script.** It iterates a COCO
   annotation file and computes MRE/SDR per landmark, so it cannot run without the
   access-gated CLDetection2023 dataset. The faithful single-image path is that pipeline
   minus the ground-truth loop — which is what `run_inference.py` implements.
4. **The pretrained backbone URL is never fetched.** `mmpose.apis.init_model` nulls
   `config.model.backbone.init_cfg` itself, so no download from `download.openmmlab.com`
   happens; the checkpoint supplies all weights.
