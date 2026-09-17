# ai-validation / toothfairy2

Real CPU validation of **ToothFairy2** — multi-structure segmentation of CBCT
volumes (42 anatomical classes, nnU-Net).

> ## STATUS: ⚪ BLOCKED
>
> `REAL_INPUT_REQUIRES_USER_AUTHENTICATION`
>
> The input route is **ToothFairy4** (`https://ditto.ing.unimore.it/toothfairy4/`).
> It requires a free account, publishes no individual case, and offers no
> unauthenticated download. The same is true of ToothFairy3 and ToothFairy2, and
> no official repository bundles a single volume.
>
> **No inference has been run. No segmentation exists. No hardware verdict can
> be given.** Everything here is prepared up to, but not including, a real run.

This lab lives in the `dental-clinic-system` repository but is **not connected to
the ERP**: no API route, no Prisma model, no UI, no patient or Document wiring.
Nothing here is called by the application.

---

## Why ToothFairy4, and why it is still blocked

ToothFairy4 reuses data from the earlier releases, so it is the most direct route
to a volume compatible with the ToothFairy2 model. The chain is official and
documented:

```
ToothFairy2  ──Set A (P, 417)──▶  ToothFairy3  ──Set A (P, 417)──▶  ToothFairy4  Set P
             ──Set B (F,  63)──▶                ──Set B (F,  63)──▶              Set F
```

- **ToothFairy3** states its Set A (leading `P`) and Set B (leading `F`) "overlap
  with those of the ToothFairy2 dataset".
- **ToothFairy4** states "Sets P, F, and S come from ToothFairy3".
- Counts agree exactly at every step (417 / 63, and 480 = 417 + 63).

So the **population** overlap is verified. But the download is account-gated, and
**no case-ID listing is published anywhere** — not on the pages, not in the
official GitHub repos. So *individual case identity* cannot be verified from
public sources. It has to be established from the file itself, which is what
`audit_compatibility.py` is for.

Full evidence, including a numerical inconsistency in the official TF4 table and
the orientation warning: [`MODEL_PROVENANCE.md`](MODEL_PROVENANCE.md).

---

## Acquisition — the manual step only you can do

This cannot be automated and this lab will not attempt to bypass it.

1. **Create a free account:** https://ditto.ing.unimore.it/register/
2. **Open ToothFairy4:** https://ditto.ing.unimore.it/toothfairy4/
   (direct login-gated link:
   `https://ditto.ing.unimore.it/login/?next=/toothfairy4/`)
3. **Download the `P` set, or a single `P` case if the portal offers per-case
   access.** Whether it does is not visible without signing in — not guessed here.
4. **Place the volume** at:
   ```
   ai-validation/toothfairy2/input/source/<CASE>.nii.gz
   ```
5. If you do not already have a checkpoint, take the official one (same login):
   https://ditto.ing.unimore.it/toothfairy2/download/checkpoints
   → `ai-validation/toothfairy2/source/model/fold_0/checkpoint_best.pth`

Both paths are git-ignored. Neither is ever committed.

### Which case to pick

**`P381`** — the best-documented candidate:

- carries the `P` prefix → ToothFairy3 Set A → ToothFairy4 Set P, the set with the
  documented overlap;
- ToothFairy2's page documents it as the **smallest** volume, (170, 272, 345),
  which means the least CPU time and least RAM for a full-resolution 3D
  sliding-window inference.

**Do not** treat that as a guarantee. This lab cannot confirm P381 is in TF4's
download, and its shape in TF4 will likely **differ** from TF2's documented
values — TF3/TF4 use a wider field of view and different processing. A different
shape is expected, not a failure.

If P381 is unavailable, any other `P` case is equally valid; the overlap
statement is about the whole set. Fallback: any `F` case.

**Do not use `S` or `A`.** `S` was never in ToothFairy2, and `A` is TF4's own new
subset, acquired on different scanners, and the TF4 page states it does **not**
have 0.3 mm isotropic spacing.

### Fallback route

ToothFairy2 itself (`https://ditto.ing.unimore.it/toothfairy2/`) publishes `.mha`
files and is the same account gate. It is the more direct provenance match, but
its files need the MHA→NIfTI step first. This lab supports both.

> **On the checkpoint you already have.** The brief described it as coming from
> `MostafaMousa/GP-Segmentation-iteration-2`. That repository does not exist on
> GitHub (API: *Not Found*; that user has 0 public repositories), and no official
> ToothFairy2 checkpoint hash is published anywhere reachable. So this lab
> **cannot verify that checkpoint's provenance** — only describe the file you
> point it at. See `MODEL_PROVENANCE.md` §6. It does not block the run; it does
> mean the result carries an unverified-weights caveat.

---

## Setup (Windows PowerShell)

```powershell
cd dental-clinic-system\ai-validation\toothfairy2
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

The environment already prepared has what is needed:

```
torch 2.6.0+cpu   nnunetv2 2.8.0   SimpleITK 2.5.6   nibabel 5.4.2
```

To rebuild:

```powershell
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install nnunetv2 SimpleITK nibabel numpy
pip install psutil          # optional: better RAM reporting
```

CPU only — no CUDA, no GPU. The runner defaults to `-device cpu`.

---

## Workflow

### 1. Identify your input

```powershell
python scripts\inspect_cbct.py --input input\source\P381.nii.gz `
    --source "ToothFairy4 official dataset (ditto.ing.unimore.it)"
```

Records filename, dimensions, spacing, **orientation**, datatype, size and
SHA-256 into `output\input_provenance.json`.

### 2. Audit compatibility — do not skip this

```powershell
python scripts\audit_compatibility.py --input input\source\P381.nii.gz --case P381
```

This is the step that replaces optimism with evidence. It checks the volume
against official ToothFairy2 requirements and returns one of:

| Verdict | Meaning |
| --- | --- |
| `VERIFIED` | every checkable property matches official TF2 values |
| `UNKNOWN` | something decisive could not be established — **not** a pass |
| `INCOMPATIBLE` | a property positively conflicts — **do not run inference** |

Checks performed, each with its source recorded:

- **spacing** vs the official 0.3 mm isotropic (nnU-Net resamples, so a mismatch
  is a note rather than a failure)
- **intensity** vs the official nnU-Net foreground statistics (min −1000,
  max 5264, p0.5 −992, p99.5 3513) — catches a volume that has already been
  normalised or windowed to 0–255, which would produce meaningless output
- **orientation**, decoded from the direction matrix and cross-checkable
- **shape** against TF2's documented min/median/max band

Expect `UNKNOWN` on orientation. ToothFairy2 **does not publish its orientation**,
so the match cannot be confirmed from documentation. That is the honest result,
not a defect in the audit.

If you want the officially-sanctioned orientation transform applied to a
**derived copy** (the original is never modified):

```powershell
python scripts\audit_compatibility.py --input input\source\P381.nii.gz --case P381 --emit-lps
```

### 3. Identify your checkpoint

```powershell
python scripts\verify_checkpoint.py
```

Hashes and describes it, reading self-declared metadata without running the model.
Pass `--expect-sha256`/`--expect-size` if you have official values; a mismatch
exits non-zero. With no expected value it says outright that it compared nothing.

### 4. See the plan without running it

```powershell
python scripts\run_toothfairy2.py --input input\source\P381.nii.gz --dry-run
```

### 5. Run the real inference

```powershell
python scripts\run_toothfairy2.py --input input\source\P381.nii.gz
```

---

## What the runner does

```
real CBCT (.nii.gz or .mha)
    -> MHA -> NIfTI if needed      geometry re-asserted, aborts on mismatch
    -> nnU-Net layout + env vars
    -> nnUNetv2_predict            CPU, 3d_fullres, fold 0
    -> real segmentation
    -> label verification against the official dataset.json
    -> evidence record
```

Grounded in official values, not guesses:

| Parameter | Value | Source |
| --- | --- | --- |
| dataset id | `119` | `nnUNetPlans.json` → `Dataset119_ToothFairy2` |
| plans | `nnUNetPlans` | same |
| config | `3d_fullres`, patch [80,192,192], 0.3 mm | same |
| input name | `<caseID>_0000.nii.gz` | nnU-Net convention + `channel_names` |
| labels | 49 entries, 42 classes | `dataset.json` |

Enforced: no training, no fine-tuning, no conversion, no architecture change;
the MHA→NIfTI step is an input-format change only and **aborts if geometry was
not preserved**; CPU by default; the original file is never overwritten; no
synthetic input is accepted.

## What it records

`output/run_report.json` — checkpoint path/size/hash, input path/size/hash,
conversion geometry check, resolved configuration **and where each value came
from**, the exact command and return code, wall-clock inference seconds, RSS and
peak working set, and for the output: path, size, **SHA-256**, dimensions,
`unique_labels`, label names, and any labels not in the official map.

Timing is wall-clock around the `nnUNetv2_predict` call — the real cost on your
machine, not an estimate.

---

## Label verification

Checked against the **official** label map. Structures from the brief:

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

Any label not in the official `dataset.json` is flagged as `unknown_labels`. One
case will not contain all 42 classes — `Implant`, `Crown`, `Bridge` appear only
where the patient has them. Their absence is expected. What is verified is that
the labels present are the model's real label space.

---

## Verification status

| Claim | Status |
| --- | --- |
| TF2 dataset size, format, licence, labels, ids | **VERIFIED** — official `dataset.json` |
| TF2 dataset id 119, plans, patch, spacing, reader | **VERIFIED** — official `nnUNetPlans.json` |
| TF2 official intensity percentiles | **VERIFIED** — same file |
| TF4 composition (P417/F63/S52/A100), `.nii.gz`, layout | **VERIFIED** — official TF4 page |
| TF4 → TF3 → TF2 **cohort** overlap | **VERIFIED** — two official statements + exact counts |
| TF4 **case-level** identity with TF2 | **NOT VERIFIED** — no case-ID listing published |
| TF4/TF3/TF2 download requires an account | **VERIFIED** — all three pages |
| TF2 and TF4 orientation | **NOT PUBLISHED — UNKNOWN** |
| Orientation decoder (vs nibabel `aff2axcodes`) | **VERIFIED in Arena** — 5/5 cases |
| `audit_compatibility.py` verdicts (VERIFIED / UNKNOWN / INCOMPATIBLE paths) | **VERIFIED in Arena** |
| `inspect_cbct.py`, `verify_checkpoint.py` mechanics and stop-paths | **VERIFIED in Arena** |
| `run_toothfairy2.py` preflight and `--dry-run` planning | **VERIFIED in Arena** |
| **Real CBCT obtainable without authentication** | **NO — BLOCKED** |
| Checkpoint provenance | **UNVERIFIED** |
| `run_toothfairy2.py` completing a real inference | **NOT RUN — untested beyond preflight** |
| Segmentation output, runtime, RAM | **UNKNOWN** |

Scripts were exercised against small fabricated volumes purely to test **script
mechanics** — geometry parsing, orientation decoding, HU detection, stop-paths,
command planning. That is not validation of the model, and no synthetic volume
was ever treated as a CBCT for a real run.

---

## Stop conditions

The lab stops, rather than working around, if:

1. the official source requires authentication and no public sample exists — **met**
2. no real CBCT can be obtained legitimately
3. the checkpoint is invalid
4. inference needs a GPU and cannot run on CPU
5. inference fails on memory or time
6. any step would require guessing a URL or an artifact
7. compatibility cannot be shown

**Condition 1 is met.** No URL is guessed, no placeholder volume is substituted,
and no result is claimed.

---

## Clinical disclaimer

A segmentation being produced is not a segmentation being correct, and neither is
a diagnosis. Any output from this lab is decision-support material requiring
review by a licensed clinician. Not a medical device. Not clinically validated here.
