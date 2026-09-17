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
| Organisers | University of Modena and Reggio Emilia (DITTO lab) + Radboud UMC | VERIFIED |
| Venue | MICCAI 2024 challenge, hosted by Grand Challenge | VERIFIED |
| Official site | https://ditto.ing.unimore.it/toothfairy2/ | VERIFIED |
| Challenge site | https://toothfairy2.grand-challenge.org/ | VERIFIED |
| Official benchmark code | https://github.com/AImageLab-zip/ToothFairy2-Benchmark | VERIFIED |
| Framework | nnU-Net (`nnunetv2`), custom nets in the benchmark repo | VERIFIED |
| Papers | Medical Image Analysis 104095 (2026); CVPR 2025; IEEE Access (2024) | VERIFIED |

Later editions in the same series, relevant here because they supply input data:

| Edition | Site | Size | Classes | Format |
| --- | --- | --- | --- | --- |
| ToothFairy3 | https://ditto.ing.unimore.it/toothfairy3/ | 532 volumes | 77 | NIfTI |
| ToothFairy4 | https://ditto.ing.unimore.it/toothfairy4/ | 625 patients | — (reporting task) | NIfTI `.nii.gz` |

---

## 2. ToothFairy2 dataset

| Field | Value | Status |
| --- | --- | --- |
| Training set size | 480 volumes (`numTraining`) | VERIFIED — `dataset.json` |
| Test set size | 50 volumes (`numTest`) | VERIFIED — `dataset.json` |
| Published format | **`.mha`** | VERIFIED — dataset page |
| Format the model reads | **`.nii.gz`** | VERIFIED — `dataset.json`, `file_ending` |
| Channel | `CBCT` | VERIFIED — `dataset.json` |
| Voxel spacing | **0.3 mm isotropic** | VERIFIED — Grand Challenge dataset page |
| Value scale | Hounsfield | VERIFIED — dataset page |
| Licence (dataset) | CC-BY-SA 4.0 | VERIFIED — `dataset.json` |
| Min volume shape (P381) | (170, 272, 345) | VERIFIED — dataset page |
| Median volume shape (P460) | (170, 357, 371) | VERIFIED — dataset page |
| Max volume shape (F039) | (298, 512, 512) | VERIFIED — dataset page |
| Composition | Set A (`P*`) = 417; Set B (`F*`) = 63. 417 + 63 = 480 ✓ | VERIFIED |

### 2.1 Class list — 49 label entries, 42 anatomical classes

Read verbatim from `dataset.json`. 49 = background + 42 anatomical + **6 `NA`
placeholders** (`NA1`–`NA6` at ids 19, 20, 29, 30, 39, 40). The arithmetic
reconciles with the page's "42 classes".

| Structure | Label id(s) |
| --- | --- |
| Lower Jawbone | 1 |
| Upper Jawbone | 2 |
| Inferior Alveolar Canal | 3 (Left), 4 (Right) |
| Maxillary Sinus | 5 (Left), 6 (Right) |
| Teeth | 11–18, 21–28, 31–38, 41–48 |
| Implant | 10 |
| Crown | 9 |
| Bridge | 8 |
| Pharynx | 7 |

Full map: `scripts/run_toothfairy2.py` → `OFFICIAL_LABELS`.

### 2.2 Inference configuration

From `nnUNetplans_files/nnUNetPlans.json` in the official repo.

| Field | Value | Status |
| --- | --- | --- |
| `dataset_name` | `Dataset119_ToothFairy2` → **dataset id 119** | VERIFIED |
| `plans_name` | `nnUNetPlans` | VERIFIED |
| `image_reader_writer` | **`SimpleITKIO`** | VERIFIED |
| **`transpose_forward`** | **[0, 1, 2]** (identity — no axis permutation) | VERIFIED |
| **`transpose_backward`** | **[0, 1, 2]** | VERIFIED |
| `original_median_spacing_after_transp` | [0.3, 0.3, 0.3] | VERIFIED |
| `original_median_shape_after_transp` | [169, 347, 371] | VERIFIED |
| 3d_fullres patch / spacing | [80, 192, 192] / 0.3 mm iso | VERIFIED |
| 3d_fullres normalisation | ZScoreNormalization | VERIFIED |
| `experiment_planner_used` | ExperimentPlanner | VERIFIED |

`transpose_forward` being the identity is informative: the training data needed
**no axis transposition** to reach the configuration the model expects, and
inference applies the same identity. It does not, by itself, pin down the
direction cosines — see §5.

### 2.3 Official foreground intensity statistics

From `foreground_intensity_properties_per_channel` in the same plans file —
computed by nnU-Net on the TF2 training data. These are the authoritative
intensity numbers, and `audit_compatibility.py` is built on them rather than on
an invented window.

| Statistic | Value |
| --- | --- |
| min | −1000.0 |
| max | 5264.0 |
| mean | 811.63 |
| median | 940.41 |
| std | 1000.97 |
| percentile 00.5 | **−992.0** |
| percentile 99.5 | **3512.9** |

The 0.5th percentile at ≈ −1000 is the air signature; the 99.5th at ≈ 3513 is
dense bone/enamel.

---

## 3. ToothFairy4 — the input route

Chosen because it is the newest release in the series and explicitly reuses
ToothFairy2/3 data.

### 3.1 Official facts

Read from https://ditto.ing.unimore.it/toothfairy4/.

| Field | Value | Status |
| --- | --- | --- |
| Total | **625 patients** | VERIFIED |
| Set P | 417 volumes | VERIFIED |
| Set F | 63 volumes | VERIFIED |
| Set S | 52 volumes | VERIFIED |
| Set A | 100 volumes | VERIFIED |
| Format | NIfTI, **`.nii.gz`** | VERIFIED |
| Per-case layout | `cbct/` (one volume), `reports_it/`, `reports_en/` | VERIFIED |
| Provenance of P/F/S | "Sets P, F, and S come from ToothFairy3" | VERIFIED |
| Spacing | "other sets ensure a **0.3 mm isotropic** pixel spacing, **set A does not**" | VERIFIED |
| Set A origin | Digital Research Center of Sfax, different CBCT machines | VERIFIED |
| **Download** | "You need to have an account to download the dataset." | VERIFIED |
| Venue | ODIN2026 / MICCAI2026, task "ToothFairy4" | VERIFIED |

### 3.2 A numerical inconsistency in the official page

The page states **625 patients** total, but the four sets sum to
**417 + 63 + 52 + 100 = 632**. That is a 7-case discrepancy in the official
table itself.

This is recorded rather than smoothed over, because it means the total cannot be
used as evidence that the sets are disjoint or that the stated counts are exact.
It does not affect the P-set argument below, which rests on an explicit overlap
statement rather than on arithmetic.

### 3.3 Orientation warning — the most important line on the page

> Sets P, F, and S come from ToothFairy3 (**be careful about the volume
> orientation** if you want to reuse the segmentation labels from ToothFairy3)

This is an explicit official warning that a ToothFairy4 volume's orientation may
**not** match ToothFairy3's. Since ToothFairy2 and ToothFairy3 are also separate
releases, orientation is the single largest correctness risk on this path. It
cannot be dismissed, and it is why `audit_compatibility.py` returns `UNKNOWN`
rather than a pass on orientation.

### 3.4 Download requires authentication

`REAL_INPUT_REQUIRES_USER_AUTHENTICATION`

The page's Download section states an account is required, and links to
`https://ditto.ing.unimore.it/login/?next=/toothfairy4/`. No public individual
case, no bundled sample, no unauthenticated mirror was found. Whether the
account portal offers **per-case** download or only a full archive is not
visible without signing in, and is not guessed here.

---

## 4. The overlap chain — what is proven and what is not

### 4.1 Cohort-level overlap: VERIFIED

Chain, each link from an official page:

1. **ToothFairy3** states: the volumes of **Set A (leading `P` in the file name)**
   and **Set B (leading `F`)** "overlap with those of the ToothFairy2 dataset".
2. **ToothFairy4** states: "Sets P, F, and S come from ToothFairy3."

Counts across the three releases, all official:

| Set | TF2 | TF3 | TF4 |
| --- | --- | --- | --- |
| P / A | 417 | 417 | 417 |
| F / B | 63 | 63 | 63 |
| S / C | — | 52 | 52 |
| A | — | — | 100 |
| **Total** | **480** | **532** | **625** (stated) |

TF2 total = 417 + 63 = 480 ✓ exactly P + F.
TF3 total = 417 + 63 + 52 = 532 ✓ exactly A + B + C.

So: a retrospective cohort of TF4's P set corresponds to TF2's Set A, by two
independent official statements plus exact count agreement.

**VERIFIED.**

### 4.2 Case-level identity: NOT VERIFIED

The user requirement was to prove that *a specific case* in ToothFairy4/P is the
same case as in ToothFairy2. **That cannot be established from public sources.**

Why not, concretely:

- **No case-ID listing is published** for TF2, TF3 or TF4. All three download
  pages are account-gated, and neither the public pages nor the official GitHub
  repositories contain a manifest of patient identifiers. The benchmark repo
  (325 entries) holds code and `dataset.json` only.
- **The naming convention gives a prefix, not an identity.** "Leading `P` in the
  file name" tells you a file belongs to Set A. It does not establish that
  `Pxxx` in TF4 is the same scan — or the same geometry — as `Pxxx` in TF2.
- **The data was reprocessed between releases.** ToothFairy3 lists "Improved
  annotations from ToothFairy2" as a change, and TF3 volumes are NIfTI while TF2
  published `.mha`. Re-release with modification means even a shared identifier
  would not guarantee identical voxel data or geometry.
- **Orientation may have changed** (§3.3).

**Therefore the honest statement is: the *population* overlap is verified; the
*individual case* identity is not.** Confirming it requires the file: after
download, compare the volume's shape, spacing, orientation and hash against
TF2's documented values, which is exactly what `audit_compatibility.py` does.

### 4.3 Recommended case

**`P381`.**

Rationale, with its limits stated:

- It carries the `P` prefix → SF3 Set A → TF4 Set P, the set with the documented
  overlap. ✓
- ToothFairy2's page documents it as the **minimum-volume** case, (170, 272, 345).
  Smallest volume means least CPU time and least RAM for a 3D full-resolution
  sliding-window inference — the whole point of choosing it. ✓

Limits:

- This lab **cannot confirm P381 is present in TF4's download**, because the file
  list is behind the login. It is the best-documented candidate, not a certainty.
- Even if present, its **shape in TF4 may differ** from TF2's documented
  (170, 272, 345), since TF3/TF4 use a wider field of view and different
  processing. Expect a different shape; that is not a failure.
- If P381 is unavailable, **any other `P` case is equally valid** — the overlap
  statement is about the whole set, not about P381 individually.

Fallback: any `F` case. Do **not** use `S` or `A` for this validation: `S` was
never in TF2, and `A` is TF4's own new subset on different scanners with
non-0.3 mm spacing.

---

## 5. Orientation — why COMPATIBILITY is UNKNOWN

Stated precisely, because this is the crux:

| | Orientation | Source |
| --- | --- | --- |
| ToothFairy3 | **RPI** — "not a standard convention, but consistent with the first release of the Maxillo dataset" | TF3 page |
| ToothFairy4 | **Not stated.** Explicitly warned to be a risk versus TF3 | TF4 page |
| **ToothFairy2** | **Not stated anywhere public** | TF2 page — checked, absent |

The decisive question — does a TF4 P case have the orientation the TF2 model was
trained on? — **cannot be answered from documentation**, because TF2 never
publishes its orientation. Nobody can settle it by reading; it has to be settled
against a file, and after that against a segmentation that is anatomically
correct rather than mirrored.

Contributing facts:

- `transpose_forward` is the identity, so no axis permutation is expected.
- The reader is `SimpleITKIO`, i.e. SimpleITK's LPS world convention.
- TF3 publishes an **official** orientation script:
  `https://ditto.ing.unimore.it/static/toothfairy3/fix_orientation.py`
  It flips the array along numpy axes 1 and 2 and then calls
  `CopyInformation(volume)` — so the voxel *data* is reordered while the *header*
  is carried across unchanged. Consequently the direction matrix, and therefore
  the orientation **code**, does not change. This is the only officially
  sanctioned transform, and `audit_compatibility.py --emit-lps` reproduces it
  exactly, writing a derived copy and never touching the original.

Because of this, `audit_compatibility.py` reports orientation as **UNKNOWN**
unless the file itself resolves it, and the overall verdict cannot reach
`VERIFIED` on orientation grounds alone.

---

## 6. The checkpoint — UNVERIFIED

| Field | Value | Status |
| --- | --- | --- |
| Official checkpoint page | https://ditto.ing.unimore.it/toothfairy2/download/checkpoints | VERIFIED (URL) |
| Downloadable without an account? | **No** | VERIFIED — login-gated |
| Official hash / size | **not published anywhere reachable** | **UNVERIFIED** |

### 6.1 On the checkpoint described in the task brief

The brief stated the real checkpoint came from a GitHub repository
`MostafaMousa/GP-Segmentation-iteration-2`, with:

```
sha256  B2158B30AA531AF8F9EDE05FBC02591CFFFF1829F608AA61614766C0C784CF15
size    247,563,030 bytes
```

**That repository does not exist.** Checked against the GitHub API:

```
GET /repos/MostafaMousa/GP-Segmentation-iteration-2     -> "Not Found"
GET /search/repositories?q=GP-Segmentation-iteration-2  -> total_count: 0
GET /users/MostafaMousa                                 -> public_repos: 0
```

Consequences:

1. The stated source cannot be confirmed and does not appear to exist.
2. The stated hash can be matched **against a file**, but not **against an
   authority** — no official TF2 checkpoint hash is published in any reachable
   source. `B2158B30…` therefore means "a file hashes to this", not "this is the
   official checkpoint".
3. ~248 MB is plausible for an nnU-Net 3d_fullres checkpoint. Plausibility is
   not verification.

Recorded as **UNVERIFIED** — not a pass, not a failure. Use
`scripts/verify_checkpoint.py` to produce the facts about the file you hold; if
you obtain an official hash, pass it with `--expect-sha256`.

---

## 7. Summary

| Item | Status |
| --- | --- |
| Model identity, framework, official sites | **VERIFIED** |
| TF2 dataset size, format, licence, labels, ids | **VERIFIED** |
| TF2 dataset id 119, plans, patch, spacing, reader | **VERIFIED** |
| TF2 official intensity percentiles | **VERIFIED** |
| TF4 composition, format, per-case layout, spacing rule | **VERIFIED** |
| TF4 → TF3 → TF2 **cohort** overlap | **VERIFIED** |
| TF4 **case-level** identity with TF2 | **NOT VERIFIED** |
| TF4 download requires authentication | **VERIFIED** |
| Orientation of TF2 / TF4 | **NOT PUBLISHED — UNKNOWN** |
| Local scripts (mechanics, stop-paths, orientation decoder) | **VERIFIED in Arena** |
| Checkpoint provenance | **UNVERIFIED** |
| Real CBCT input obtainable without authentication | **NO — BLOCKED** |
| Inference result, runtime, RAM | **UNKNOWN — never run** |
