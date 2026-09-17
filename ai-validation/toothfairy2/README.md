# ai-validation / toothfairy2

Real CPU validation of **ToothFairy2** — multi-structure segmentation of CBCT
volumes (42 anatomical classes, nnU-Net).

> ## STATUS: ⚪ BLOCKED
>
> `BLOCKED — REAL CBCT INPUT REQUIRES USER AUTHENTICATION`
>
> The official ToothFairy2 dataset requires a free account to download, there is
> **no public-access individual case**, and the test set is never released.
> Exhaustive check recorded in [`MODEL_PROVENANCE.md`](MODEL_PROVENANCE.md) §4.
>
> **No inference has been run. No segmentation exists. No hardware verdict can
> be given.** Everything here is prepared up to, but not including, a real run.

This lab is part of the `dental-clinic-system` repository but is **not connected
to the ERP**: no API route, no Prisma model, no UI, no patient or Document
wiring. Nothing here is called by the application.

---

## Why it is blocked, in one paragraph

The challenge host states plainly that a sign-up is required for the training
set and that the test set will remain private permanently. Seven channels were
checked — the DITTO pages for ToothFairy2, ToothFairy(2023) and Maxillo, the
Grand Challenge dataset page, and the file trees of all three official GitHub
repositories. Every download path requires an account, and **not one official
repository bundles a single volume** — they contain code and `dataset.json`
only. There is therefore no legitimate real CBCT this lab can obtain on its own.

---

## Acquisition — how *you* get a real volume

This is a manual, human step. It cannot be automated and this lab will not try
to circumvent it.

1. **Create a free account** at https://ditto.ing.unimore.it/register/
2. **Sign in** and open the dataset page:
   https://ditto.ing.unimore.it/toothfairy2/
   (the direct login-gated link is
   `https://ditto.ing.unimore.it/login/?next=/toothfairy2/`)
3. **Download one case.** You do not need the full dataset. Pick a **small**
   volume to keep CPU time and memory down — the dataset publishes its shapes,
   and its smallest is:
   - `P381` — shape (170, 272, 345)
4. Also download the official checkpoint if you do not already have one:
   https://ditto.ing.unimore.it/toothfairy2/download/checkpoints
   (same login gate)
5. **Place the files:**
   ```
   ai-validation/toothfairy2/
   ├── input/source/<CASE>.mha                      <- the CBCT you downloaded
   └── source/model/fold_0/checkpoint_best.pth      <- the checkpoint you downloaded
   ```

Both paths are git-ignored. Neither is ever committed.

> **On the checkpoint you already have.** The brief described it as coming from
> `MostafaMousa/GP-Segmentation-iteration-2`. That repository does not exist on
> GitHub (API: *Not Found*; the user `MostafaMousa` has 0 public repositories),
> and no official ToothFairy2 checkpoint hash is published anywhere reachable
> from here. So this lab **cannot verify that checkpoint's provenance** — only
> describe the file you point it at. See `MODEL_PROVENANCE.md` §3. This does not
> block the run; it does mean the result carries an unverified-weights caveat.

---

## Setup (Windows PowerShell)

```powershell
cd dental-clinic-system\ai-validation\toothfairy2

py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
```

The environment you prepared already has what is needed:

```
torch 2.6.0+cpu     nnunetv2 2.8.0     SimpleITK 2.5.6     nibabel 5.4.2
```

If you need to rebuild it:

```powershell
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install nnunetv2 SimpleITK nibabel numpy
pip install psutil          # optional: better RAM reporting
```

CPU only — no CUDA, no `onnxruntime-gpu`, no GPU of any kind. The runner
defaults to `-device cpu` and refuses to pretend otherwise.

---

## Workflow

### 1. Identify your input

```powershell
python scripts\inspect_cbct.py --input input\source\P381.mha `
    --source "ToothFairy2 official dataset (ditto.ing.unimore.it)"
```

Records filename, dimensions, spacing, datatype, size and **SHA-256** into
`output\input_provenance.json`. Cross-check the shape and the 0.3 mm spacing
against the official reference values the script prints.

### 2. Identify your checkpoint

```powershell
python scripts\verify_checkpoint.py
```

Hashes the file, reports its size, and reads its self-declared metadata
(`epoch`, `trainer_name`, `plans_name`, parameter count) **without running the
model**. If you obtain an official hash, pass it:

```powershell
python scripts\verify_checkpoint.py --expect-sha256 <OFFICIAL_HASH> --expect-size <BYTES>
```

A mismatch exits non-zero and tells you to stop. Without an expected value the
script says outright that it has compared nothing — it will not call an
unchecked file "verified".

### 3. See what would happen, without running

```powershell
python scripts\run_toothfairy2.py --input input\source\P381.mha --dry-run
```

Prints the nnU-Net result layout it would build, where the checkpoint would go,
where the input would be staged, and the exact command. Nothing executes.

### 4. Run the real inference

```powershell
python scripts\run_toothfairy2.py --input input\source\P381.mha
```

### 5. Read the evidence

```powershell
notepad output\run_report.json
python -c "import json;d=json.load(open('output/run_report.json'));print(d['output']['dimensions_xyz']);print(d['output']['unique_labels'])"
```

---

## What the runner does

```
real CBCT (.mha, as published)
    -> MHA -> NIfTI conversion      geometry preserved and re-asserted
    -> nnU-Net layout + env vars
    -> nnUNetv2_predict             CPU, 3d_fullres, fold 0
    -> real segmentation output
    -> label verification against the official dataset.json
    -> evidence record
```

Grounded in official facts, not guesses:

| Parameter | Value | Where it came from |
| --- | --- | --- |
| dataset id | `119` | `nnUNetPlans.json` → `Dataset119_ToothFairy2` |
| plans | `nnUNetPlans` | same file |
| config | `3d_fullres` (patch [80,192,192], 0.3 mm) | same file |
| input name | `<caseID>_0000.nii.gz` | nnU-Net convention + `channel_names` in `dataset.json` |
| labels | 49 entries, 42 classes | `dataset.json` |

Constraints the runner enforces:

- **No training, no fine-tuning, no conversion, no architecture change.** It
  invokes `nnUNetv2_predict` against the published checkpoint.
- **The MHA→NIfTI step is an input-format change only.** Origin, spacing,
  direction and size are re-read after writing, and the run **aborts** if the
  geometry was not preserved. The original `.mha` is always kept.
- **CPU by default.** `--device cpu`.
- **No synthetic input.** The runner requires a real volume and stops if none is
  present.

## What it records

`output/run_report.json`:

| Field | Contents |
| --- | --- |
| `checkpoint` | path, size, SHA-256, self-declared metadata |
| `input` | path, size, SHA-256 |
| `conversion` | geometry-preservation check |
| `configuration` | dataset id, trainer, plans, config, fold, device — and where each came from |
| `inference` | exact command, return code, wall-clock seconds |
| `memory` | RSS before/after, peak working set |
| `output` | file path, size, **SHA-256**, dimensions, `unique_labels`, label names, any unknown labels |
| `label_verification` | which watched structures are present, and whether every label is one the official `dataset.json` defines |

Timing is wall-clock around the `nnUNetv2_predict` call — the model's real cost
on this machine, not an estimate.

---

## Label verification

The runner checks the output against the **official** label map, not a
hand-written one. Structures from the brief and their ids:

| Structure | id(s) |
| --- | --- |
| Lower Jawbone | 1 |
| Upper Jawbone | 2 |
| Inferior Alveolar Canal | 3, 4 |
| Maxillary Sinus | 5, 6 |
| Teeth | 11–18, 21–28, 31–38, 41–48 |
| Implant | 10 |
| Crown | 9 |
| Bridge | 8 |

Any label present in the output that is **not** in the official `dataset.json`
is flagged as `unknown_labels`. A single case will not contain all 42 classes —
`Implant`, `Crown` and `Bridge` appear only where the patient actually has them.
Absence of those is expected, not a failure. What is being verified is that the
labels present are the model's real label space.

---

## Verification status

| Claim | Status |
| --- | --- |
| Dataset size, format, licence, class list, label ids | **VERIFIED** — official `dataset.json` |
| Dataset id 119, plans name, patch size, spacing | **VERIFIED** — official `nnUNetPlans.json` |
| Dataset requires an account; test set never released | **VERIFIED** — official Grand Challenge page |
| No public individual case exists | **VERIFIED** — 7 channels checked |
| `inspect_cbct.py` mechanics (MHA + NIfTI, geometry, hashing) | **VERIFIED in Arena** |
| `verify_checkpoint.py` stop-paths (missing / mismatch) | **VERIFIED in Arena** |
| `run_toothfairy2.py` preflight and `--dry-run` planning | **VERIFIED in Arena** |
| **Real CBCT obtainable without authentication** | **NO — BLOCKED** |
| Checkpoint provenance | **UNVERIFIED** |
| `run_toothfairy2.py` completing a real inference | **NOT RUN — untested beyond preflight** |
| Segmentation output, runtime, RAM | **UNKNOWN** |

The scripts were exercised against tiny fabricated files purely to test **script
mechanics** — that they parse geometry, hash correctly, refuse bad input and
plan the right command. That is not validation of the model, and no synthetic
file was ever treated as a CBCT for a real run.

---

## Stop conditions

The lab stops, rather than working around, if:

1. the official source requires authentication and no public sample exists — **met**
2. no real CBCT can be obtained legitimately
3. the checkpoint is invalid
4. inference needs a GPU and cannot run on CPU
5. inference fails on memory or time
6. any step would require guessing a URL or an artifact

**Condition 1 is met.** Nothing is worked around. No URL is guessed, no
placeholder volume is substituted, and no result is claimed.

---

## What is needed to unblock

One thing only: **a real CBCT volume and the official checkpoint, downloaded
from the account-gated official source above.**

Once `input/source/<CASE>.mha` and `source/model/fold_0/checkpoint_best.pth`
exist, this is the single command that runs the real validation:

```powershell
python scripts\run_toothfairy2.py --input input\source\<CASE>.mha
```

Until then the honest verdict is ⚪ **Blocked** — not 🟢, and not 🔴 either: it has
not failed, it has not been attempted.

---

## Clinical disclaimer

A segmentation being produced is not a segmentation being correct, and neither
is a diagnosis. Any output from this lab is decision-support material requiring
review by a licensed clinician. Not a medical device. Not clinically validated here.
