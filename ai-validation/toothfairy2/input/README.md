# input/

**Nothing real is stored in this repository.** Both subfolders are git-ignored.

```
input/
├── source/     the CBCT exactly as downloaded (original .mha or .nii.gz)
└── nifti/      format-converted copy handed to the inference pipeline
```

## Where the data comes from

**ToothFairy4** (`https://ditto.ing.unimore.it/toothfairy4/`) — chosen because it
reuses the earlier releases' data, so it is the most direct route to a volume
compatible with the ToothFairy2 model. **It requires an account.** The same is
true of ToothFairy3 and of ToothFairy2 itself. No public-access case exists; this
was checked, not assumed.

Related but distinct paths:

| Path | Link | Note |
| --- | --- | --- |
| ToothFairy4 | https://ditto.ing.unimore.it/toothfairy4/ | `P` and `F` sets overlap ToothFairy2 |
| ToothFairy3 | https://ditto.ing.unimore.it/toothfairy3/ | publishes the official `fix_orientation.py` |
| ToothFairy2 | https://ditto.ing.unimore.it/toothfairy2/ | `.mha`; most direct provenance match |

Prefer a **`P`** case (Set A, the largest verified-overlapping set), fall back to
**`F`**. Do **not** use `S` — never in ToothFairy2 — or `A` — not 0.3 mm isotropic
and from different scanners.

> **Cohort overlap is verified; individual case identity is not.** No case-ID
> listing is published for any release, so no specific case can be proven to be
> the same scan in both datasets until its file is measured. See
> [`../MODEL_PROVENANCE.md`](../MODEL_PROVENANCE.md) §4.

Once you have a volume, place it in `input/source/` and record:

| Field | Where it comes from |
| --- | --- |
| filename | the publisher's name, e.g. `P381.mha` |
| dimensions | `scripts/inspect_cbct.py` |
| spacing | `scripts/inspect_cbct.py` |
| datatype | `scripts/inspect_cbct.py` |
| size | `scripts/inspect_cbct.py` |
| orientation | `scripts/inspect_cbct.py` |
| intensity range | `scripts/inspect_cbct.py` |
| source | the official page it came from |
| SHA-256 | `scripts/inspect_cbct.py` |

`scripts/inspect_cbct.py` writes all of that into `output/input_provenance.json`,
so the input to a run is identified by hash rather than by filename.

## Format

ToothFairy4 and ToothFairy3 publish **`.nii.gz`**, which is already what the
model expects — the official `dataset.json` declares `file_ending: .nii.gz`.
No conversion is needed on that route.

ToothFairy2 itself publishes **`.mha`**; if you use that fallback route, the
runner converts it. The model expects **NIfTI**.

Converting the *input format* with SimpleITK is not model conversion. It
preserves geometry: origin, spacing and direction are carried across and are
re-asserted afterwards by the inspector. The original `.mha` is always kept
alongside; it is never replaced.

## On synthetic volumes

No synthetic or fabricated volume may be used as the input to a real
validation. A synthetic file may exercise the *inspector script* — that is a
test of the script, not of the model — but it must never be presented as
evidence that ToothFairy2 works. The distinction is the whole point of this lab.

## Compatibility audit

Before any inference, run the audit — a volume existing in ToothFairy4 does
**not** imply it is valid input for the ToothFairy2 model:

```powershell
python scripts\audit_compatibility.py --input input\source\<CASE>.nii.gz --case <CASE>
```

It compares spacing, intensity scale, orientation and shape against official
ToothFairy2 values and returns `VERIFIED`, `UNKNOWN` or `INCOMPATIBLE`. Expect
`UNKNOWN` on orientation: ToothFairy2 does not publish its orientation, so the
match cannot be confirmed from documentation alone.

The originals in `input/source/` are **never modified**. `--emit-lps` writes a
derived copy under `input/nifti/` using the officially published ToothFairy
orientation transform.
