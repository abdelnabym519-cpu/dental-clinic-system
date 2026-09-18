# Engine #5 — `nsitnov/8024-yolov8-model` (YOLOv8-seg, dental X-rays)

**Scope of this lab: source auditing and artifact verification only. No inference has been
run, here or anywhere. Nothing in this folder is integrated with the ERP.**

The model under audit is a YOLOv8 instance-segmentation checkpoint published on Hugging
Face as [`nsitnov/8024-yolov8-model`](https://huggingface.co/nsitnov/8024-yolov8-model),
file `8024.pt`, expected SHA-256
`e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98` (143,955,443 bytes).
The audit's 16 required fields are answered in [`AUDIT.md`](AUDIT.md); the current
classification is **BLOCKED**, and this README explains exactly what unblocks it.

## Why this lab exists

Hugging Face's scanners label `8024.pt` **Unsafe**. The label is not a verdict on the
uploader — every Ultralytics `.pt` file is a pickle, and this one references
`__builtin__.getattr`, which is both a normal part of how those checkpoints rebuild
themselves and the classic obfuscation primitive. The scanner reports *which names* the
file references; it cannot say how they are called, and it cannot tell a normal checkpoint
from a crafted one that reuses the same names.

So the audit is split in two, and the split is the point:

1. **What the file asks for** — `scripts/inspect_checkpoint.py`, which decodes the
   checkpoint without constructing a single object from it. It never imports torch, never
   unpickles, and cannot run checkpoint code.
2. **What the file *is*** — size + SHA-256 compared against the audited artifact, plus the
   class names read out of the checkpoint's own bytes.

Both must pass before the checkpoint is loaded anywhere.

## Files

| Path | What it is |
| --- | --- |
| `AUDIT.md` | The 16-field audit report and the current classification |
| `scripts/inspect_checkpoint.py` | The non-executing inspector / gate (stdlib only) |
| `tests/test_checkpoint_inspector.py` | 34 tests, including the proof that a hostile pickle is not executed |
| `model/` | Where `8024.pt` goes on the operator's machine (kept out of git) |
| `input/` | Where a dental X-ray goes, later (kept out of git) |

The inspector needs **no third-party packages** — not torch, not numpy, not ultralytics.
That is deliberate: a tool that needs the library under suspicion cannot be used to
decide whether to trust it. This was verified in an environment where all three are absent.

## The gate (run this on the machine that has the file)

```powershell
cd ai-validation\yolov8-8024
python scripts\inspect_checkpoint.py --checkpoint model\8024.pt `
    --json-out reports\checkpoint_inspection.json `
    --dis-out  reports\checkpoint_ops.txt
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Gate passed: identity matches the audited artifact, every pickle global is an expected Ultralytics/torch name, every expected class name is present |
| `1` | Missing / unreadable / not a torch or pickle container |
| `3` | A forbidden global (`os`, `subprocess`, `socket`, `eval`, `exec`, …) — **do not load** |
| `4` | An unrecognised global — send the JSON, do not load |
| `5` | An expected class name is missing from the bytes — not the audited segmentation checkpoint |
| `6` | Size or SHA-256 differs from the audited artifact — **do not load** |

What a passing run proves: the bytes are the audited revision, and the pickle asks for
exactly the classes this checkpoint is expected to need. What it does **not** prove: that
the file is benign, and it is not a substitute for the restricted load below.

`reports\checkpoint_ops.txt` is the full `pickletools.dis` of every pickle member — the
line-by-line record of what the pickle does, for whoever wants to read the REDUCE sites
rather than trust a summary.

## Step 2 — loading, with the restricted loader (NOT authorised yet)

Do not run this until the gate above returns 0 and the next step is explicitly authorised.
It is written down here so that it is not improvised later.

```powershell
pip install ultralytics==8.4.155          # AGPL-3.0 — see AUDIT.md field 3
$env:ULTRALYTICS_SAFE_LOAD = "1"          # opt-in; default is the unrestricted torch.load
python -c "from ultralytics import YOLO; m = YOLO(r'model\8024.pt'); print(m.task, m.names)"
```

With `ULTRALYTICS_SAFE_LOAD=1`, Ultralytics 8.4.155 loads with `torch.load(..., weights_only=True)`
and registers only the per-checkpoint globals that (a) come from the `ultralytics.nn.*` /
`torch.nn.modules.*` / `ultralytics.utils.{loss,tal}` namespaces and (b) resolve to real
`torch.nn.Module` subclasses. `builtins.getattr` — the one import the scanners call
dangerous — is replaced by an attribute-only wrapper, and anything outside the allow-list
raises `UnpicklingError` instead of executing. The path needs **torch ≥ 2.6**; on older
torch Ultralytics silently disables it, so check the torch version before trusting the
result. Source: `ultralytics/nn/tasks.py` (`_SafeLoad`, `torch_safe_load`) and
`ultralytics/utils/__init__.py:73` (`SAFE_LOAD = env_bool("ULTRALYTICS_SAFE_LOAD")`),
read from the 8.4.155 wheel during this audit.

On this lab's target machine (Python 3.11.9, torch 2.14.0+cpu, NumPy 1.26.4, no CUDA) the
restricted path is available and everything stays on the CPU (`map_location="cpu"` in the
loader itself).

## Tests

```powershell
python -m unittest discover -s tests -v
```

34 tests. The load-bearing one is `TestNothingIsExecuted`: a pickle whose payload would
create a file if it were ever unpickled is inspected, reported as forbidden, and the file
is never created.

## Boundaries

- No inference, training, fine-tuning, conversion, ONNX export or optimisation was
  performed for this engine — see the report for what is still blocked.
- No ERP, database, API or UI changes; this lab is self-contained.
- The model binary and any patient image stay on the operator's machine and out of git
  (see `.gitignore`).
