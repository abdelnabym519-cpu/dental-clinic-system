# Engine #6 — CLdetection2023 (cephalometric landmark detection)

**Status of this engine: environment repaired and proven; real-weight inference still
pending on the machine that holds the checkpoint.** The full audit is in
[`AUDIT.md`](AUDIT.md); the evidence is in [`reports/`](reports/).

The model under audit is the MICCAI CLDetection2023 winning solution by team SUTD-VLG —
38 cephalometric landmarks on lateral X-rays, HRNet-W48 backbone with an SRPose head.

## What was wrong, in one paragraph

`mim install "mmcv>=2.0.0"` picks **mmcv 2.2.0**, and this repository's vendored mmpose fork
asserts `2.0.0rc4 <= mmcv <= 2.1.0`; the fallback was a source build, which failed on
`pkg_resources`. Fixing that alone is not enough, though: `torch >= 2.6` changed
`torch.load`'s default to `weights_only=True` while `mmengine 0.10.7` still calls it without
that argument, so **checkpoint loading fails on this stack no matter how MMCV is resolved** —
and `xtcocotools` breaks on NumPy 2.x, and setuptools ≥ 81 removed `pkg_resources`.

## The repairs (torch 2.6 kept — no downgrade)

| repair | why |
| --- | --- |
| `mmcv-lite==2.1.0` instead of `mmcv` | prebuilt wheel, inside the fork's window; the model path needs only `mmcv.cnn`/registry, and the fork's two `mmcv.ops` imports are optional and unused |
| `setuptools<81` | `mmengine.utils.package_utils.get_installed_path` imports `pkg_resources` |
| `numpy==1.26.4` | `xtcocotools` is built against NumPy 1.x (`numpy.dtype size changed` on 2.x) |
| allow-listed `add_safe_globals` + strict `weights_only=True` | loads an mmpose-1.0 checkpoint on torch 2.6 **without** disabling the guard |
| `opencv-python-headless` (Linux only) | `xtcocotools` pulls full `opencv-python`, whose wheel needs `libGL.so.1` |

## Files

| path | what it is |
| --- | --- |
| `AUDIT.md` | the 10-step audit: repository, dataset constraint, checkpoint, input provenance, dependency matrix, findings, evidence, runtime plan |
| `scripts/check_environment.py` | verifies the stack against the fork's own declared ranges (12 checks) |
| `scripts/inspect_checkpoint.py` | reads the checkpoint's pickle globals **without executing anything**; exits non-zero on an unexpected global or an identity mismatch |
| `scripts/extract_input.py` | turns the organisers' `stack1.mha` into a real cephalogram PNG, with provenance and hashes |
| `scripts/run_inference.py` | the real CPU inference: gate → allow-list → `init_model` → real image → landmarks → JSON report + overlay |
| `tests/test_engine6_contract.py` | 26 tests, runnable with a bare Python 3 (no torch needed) |
| `reports/` | environment checks, checkpoint-globals output, the control run, and this engine's validation report |

## Run it (Windows, from this folder)

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install "setuptools<81" "numpy==1.26.4" "mmcv-lite==2.1.0"

python scripts\check_environment.py --repo CLdetection2023
python scripts\inspect_checkpoint.py --checkpoint model\model_pretrained_on_train_and_val.pth

python scripts\extract_input.py --stack CL-Detection2023\step5_docker_and_upload\test\stack1.mha `
    --index 1 --out input\ceph_stack1_image1.png

python scripts\run_inference.py --repo CLdetection2023 `
    --checkpoint model\model_pretrained_on_train_and_val.pth `
    --image input\ceph_stack1_image1.png `
    --expect-sha256 FB1A781AC1C83149B379CB15724E3B0FAE06BA2D567978F35C61E9D06B46FDCC `
    --expect-size 268846952 `
    --json-out reports\engine6_run.json --out-image output\ceph_landmarks.png
```

`--repo` points at your clone of `5k5000/CLdetection2023` (the folder containing `configs/`
and `mmpose_package/`); adjust it if you cloned somewhere other than `cldetection2023\CLdetection2023`.

Exit codes from `run_inference.py`: `0` inference completed, `6` checkpoint identity mismatch,
`4` metainfo unresolvable, `1` file missing, `5` output not structurally valid, `3` (from
`inspect_checkpoint.py`) an unexpected pickle global.

## What is proven, and what is not

- **Proven here:** the environment works end to end (12/12 checks), the model builds from the
  config (66.8 M parameters, `TopdownPoseEstimator`/`HRNet`/`SRPoseHead`, 38 joints), a
  checkpoint loads through `init_model()` with the strict guard on, and a real cephalogram
  goes through the repository's own preprocessing and pipeline to produce **38 finite
  landmarks** — 20.4 s inference, 1.82 GB peak RSS, CPU only.
- **Not proven here:** anything about the real weights. The control checkpoint used purely to
  prove the mechanism has **random weights** — the real 268,846,952-byte file is not in the
  validation environment and its distribution route is unreachable from it. Landmark quality,
  accuracy and clinical usefulness are **untested**, and the run above says nothing about them.

**Functional inference ≠ clinical accuracy.** No diagnostic claim is made, and none may be
inferred from a successful run.
