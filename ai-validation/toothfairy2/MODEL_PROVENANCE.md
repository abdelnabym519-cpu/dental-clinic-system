# ToothFairy2 — model and data provenance

Every fact below is either **VERIFIED** (read from an official source during this
work, with the source named) or explicitly marked **UNVERIFIED**. Nothing is
inferred and presented as fact. Where this lab could not establish something, it
says so rather than filling the gap.

Read: 2026-09-17.

---

## 1. The model / challenge

| Field | Value | Status |
| --- | --- | --- |
| Name | ToothFairy2: Multi-Structure Segmentation in CBCT Volumes | VERIFIED |
| Organisers | University of Modena and Reggio Emilia (DITTO lab) + Radboud University Medical Center | VERIFIED |
| Venue | MICCAI 2024 challenge, hosted by Grand Challenge | VERIFIED |
| Official site | https://ditto.ing.unimore.it/toothfairy2/ | VERIFIED |
| Challenge site | https://toothfairy2.grand-challenge.org/ | VERIFIED |
| Official benchmark code | https://github.com/AImageLab-zip/ToothFairy2-Benchmark | VERIFIED |
| Framework | nnU-Net (`nnunetv2`), with custom architectures in the benchmark repo | VERIFIED |
| Papers | Medical Image Analysis 104095 (2026); CVPR 2025; IEEE Access (2024) | VERIFIED |

## 2. Dataset

### 2.1 What the official sources state

| Field | Value | Status |
| --- | --- | --- |
| Training set size | 480 volumes (`numTraining`) | VERIFIED — `dataset.json` |
| Test set size | 50 volumes (`numTest`) | VERIFIED — `dataset.json` |
| Published format | **`.mha`** | VERIFIED — dataset page |
| Required format for the model | **`.nii.gz`** | VERIFIED — `dataset.json`, `file_ending: .nii.gz` |
| Channel | `CBCT` (`channel_names: {"0": "CBCT"}`) | VERIFIED — `dataset.json` |
| Voxel spacing | **0.3 mm isotropic** | VERIFIED — Grand Challenge dataset page |
| Value scale | Hounsfield | VERIFIED — dataset page |
| Licence (dataset) | CC-BY-SA 4.0 | VERIFIED — `dataset.json` |
| Min volume shape (P381) | (170, 272, 345) | VERIFIED — dataset page |
| Median volume shape (P460) | (170, 357, 371) | VERIFIED — dataset page |
| Max volume shape (F039) | (298, 512, 512) | VERIFIED — dataset page |
| Sets | Set A (`P*`, 417) overlaps the 2023 ToothFairy set; Set B (`F*`, 63) is new, wider field of view | VERIFIED — dataset page |

### 2.2 The class list — 49 label entries, 42 anatomical classes

Read verbatim from `dataset.json` in the official benchmark repository.

The dataset page says "42 classes". `dataset.json` contains 49 entries: 1
background + 42 anatomical classes + **6 `NA` placeholders** (`NA1`–`NA6` at ids
19, 20, 29, 30, 39, 40). The arithmetic reconciles: 49 − 1 − 6 = 42. The `NA`
slots are reserved/unused ids, not structures.

The structures named in the validation brief, with their official ids:

| Structure | Label id(s) |
| --- | --- |
| Lower Jawbone | 1 |
| Upper Jawbone | 2 |
| Inferior Alveolar Canal | 3 (Left), 4 (Right) |
| Maxillary Sinus | 5 (Left), 6 (Right) |
| Teeth | 11–18, 21–28, 31–38, 41–48 (32 individual FDI-derived classes) |
| Implant | 10 |
| Crown | 9 |
| Bridge | 8 |
| Pharynx | 7 |
| Background | 0 |

Full list with every tooth name: `scripts/run_toothfairy2.py` → `OFFICIAL_LABELS`.

### 2.3 Inference configuration

Read from `nnUNetplans_files/nnUNetPlans.json` in the official repo.

| Field | Value | Status |
| --- | --- | --- |
| `dataset_name` | **`Dataset119_ToothFairy2`** → dataset id **119** | VERIFIED |
| `plans_name` | `nnUNetPlans` | VERIFIED |
| 3d_fullres patch size | [80, 192, 192] | VERIFIED |
| 3d_fullres spacing | [0.3, 0.3, 0.3] mm | VERIFIED |
| 3d_fullres batch size | 2 | VERIFIED |
| 3d_fullres normalisation | ZScoreNormalization | VERIFIED |
| 2d patch size / spacing | [384, 384] / [0.3, 0.3] | VERIFIED |
| `use_mask_for_norm` | False | VERIFIED |

Dataset id **119** is what makes the runner's `-d 119` argument grounded rather
than guessed. Override with `--dataset-id` if your checkpoint was trained under
a different id.

---

## 3. The checkpoint — UNVERIFIED

**This lab has no verified copy of the official checkpoint, and cannot obtain one.**

| Field | Value | Status |
| --- | --- | --- |
| Official checkpoint download | https://ditto.ing.unimore.it/toothfairy2/download/checkpoints | VERIFIED (URL exists) |
| Can it be downloaded without an account? | **No** | VERIFIED — the page sits behind the site's login |
| Official hash / size | **not published anywhere this lab can reach** | **UNVERIFIED** |

### 3.1 On the checkpoint described in the task brief

The brief stated that the real checkpoint was obtained from a GitHub repository
`MostafaMousa/GP-Segmentation-iteration-2`, with:

```
sha256  B2158B30AA531AF8F9EDE05FBC02591CFFFF1829F608AA61614766C0C784CF15
size    247,563,030 bytes
```

**That repository does not exist.** Checked against the GitHub API:

```
GET /repos/MostafaMousa/GP-Segmentation-iteration-2   ->  "Not Found"
GET /search/repositories?q=GP-Segmentation-iteration-2 ->  total_count: 0
GET /users/MostafaMousa                                ->  public_repos: 0
```

Consequences, stated plainly:

1. **The stated source cannot be confirmed and does not appear to exist.** Where
   that checkpoint actually came from is unknown to this lab.
2. **The stated hash cannot be checked against anything.** A hash is only
   meaningful against a reference. No official ToothFairy2 checkpoint hash is
   published in any source reachable here, so `B2158B30…` cannot be confirmed
   as "the official checkpoint" — only as "a file that hashes to this".
3. **The size is plausible but unverifiable.** ~248 MB is a normal size for an
   nnU-Net 3d_fullres checkpoint (this would be roughly consistent with a
   ~30 M-parameter network), but plausibility is not verification.

This is recorded as **UNVERIFIED**, not as a failure and not as a pass. Use
`scripts/verify_checkpoint.py` to produce the facts about whatever file you
actually hold; if you obtain an official hash, pass it with `--expect-sha256`.
Until then, treat the checkpoint's provenance as an open question.

### 3.2 What `verify_checkpoint.py` can and cannot do

It **can**: hash the file, report its size, and read its self-declared metadata
(`epoch`, `trainer_name`, `plans_name`, parameter count) without running the model.

It **cannot**: authenticate the file. A self-describing checkpoint can describe
itself wrongly. Reading metadata is evidence, not proof of origin.

---

## 4. Real CBCT input — BLOCKED

**This is the blocking finding, and it is the reason no inference has been run.**

The official Grand Challenge dataset page states, verbatim:

> The training set, ToothFairy2 Dataset, is publicly available under a CC BY-SA
> license here. **Please note that a sign-up will be required to download it.**
> The test set will not be publicly released and will remain private even after
> the end of the challenge.

So:

| Question | Answer | How established |
| --- | --- | --- |
| Is the dataset public? | Yes, in principle — CC BY-SA | Official GC page |
| Can it be downloaded without an account? | **No — sign-up required** | Official GC page, and the DITTO download page redirects to login |
| Is the test set ever available? | **No — never released, permanently private** | Official GC page |
| Is there a public individual case? | **No** — see the checks below | Exhaustive check, recorded below |
| Is any volume bundled with the official code? | **No** | GitHub tree inspection of 3 official repos |

### 4.1 Every channel checked

| Channel | Result |
| --- | --- |
| `ditto.ing.unimore.it/toothfairy2/` | "You need to have an account to download the dataset." |
| `ditto.ing.unimore.it/toothfairy/` (2023 edition) | Same — account required |
| `ditto.ing.unimore.it/maxillo` (original) | Same — account required |
| `toothfairy2.grand-challenge.org/dataset/` | "a sign-up will be required"; test set never released |
| `AImageLab-zip/ToothFairy2-Benchmark` (official code) | 325 entries, 210 `.py`. **0 data files.** Only non-code asset is a 1.2 MB thumbnail PNG. **0 releases.** |
| `AImageLab-zip/alveolar_canal` (official, prior work) | 159 entries. **0 data files.** 0 releases. |
| `potpov/New-Maxillo-Dataset-Segmentation` (official baseline) | 37 entries. **0 data files.** |

The only official public assets this lab could retrieve are **code and
configuration** — `dataset.json`, the three `nnUNet*Plans.json` files, and
Python source. No imaging data is published anywhere reachable without an account.

### 4.2 What this means

There is no public-access real CBCT for ToothFairy2. Acquiring one requires a
free account on the DITTO site, which is a manual, human, authenticated step
that this lab cannot perform and will not attempt to circumvent.

Per the task's own stop condition:

> If the official source requires authentication and no public sample exists,
> stop and write: `BLOCKED — REAL CBCT INPUT REQUIRES USER AUTHENTICATION`

**That condition is met.**

---

## 5. Summary of what is and is not known

| Item | Status |
| --- | --- |
| Model identity, framework, official sites | **VERIFIED** |
| Dataset size, format, licence, class list, label ids | **VERIFIED** |
| Dataset id (119), plans name, patch size, spacing | **VERIFIED** |
| Dataset requires an account; test set never released | **VERIFIED** |
| No public individual case exists | **VERIFIED** (7 channels checked) |
| Local validation scripts work (mechanics, stop-paths) | **VERIFIED in Arena** |
| Real CBCT input obtainable without authentication | **NO — BLOCKED** |
| Checkpoint provenance | **UNVERIFIED** |
| Checkpoint actually loads and runs | **UNKNOWN** |
| Inference result, runtime, RAM | **UNKNOWN — never run** |
