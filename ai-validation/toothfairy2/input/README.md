# input/

**Nothing real is stored in this repository.** Both subfolders are git-ignored.

```
input/
├── source/     the CBCT exactly as downloaded (original .mha or .nii.gz)
└── nifti/      format-converted copy handed to the inference pipeline
```

## Where the data comes from

The official ToothFairy2 dataset. **It requires an account** — see
[`../README.md`](../README.md) sections *Acquisition* and the BLOCKER note.
There is no public-access case; this was checked, not assumed.

Once you have a volume, place it in `input/source/` and record:

| Field | Where it comes from |
| --- | --- |
| filename | the publisher's name, e.g. `P381.mha` |
| dimensions | `scripts/inspect_cbct.py` |
| spacing | `scripts/inspect_cbct.py` |
| datatype | `scripts/inspect_cbct.py` |
| size | `scripts/inspect_cbct.py` |
| source | the official page it came from |
| SHA-256 | `scripts/inspect_cbct.py` |

`scripts/inspect_cbct.py` writes all of that into `output/input_provenance.json`,
so the input to a run is identified by hash rather than by filename.

## Format

The dataset is published as **`.mha`**. The model expects **NIfTI**
(`.nii.gz`) — the official `dataset.json` declares `file_ending: .nii.gz`.

Converting the *input format* with SimpleITK is not model conversion. It
preserves geometry: origin, spacing and direction are carried across and are
re-asserted afterwards by the inspector. The original `.mha` is always kept
alongside; it is never replaced.

## On synthetic volumes

No synthetic or fabricated volume may be used as the input to a real
validation. A synthetic file may exercise the *inspector script* — that is a
test of the script, not of the model — but it must never be presented as
evidence that ToothFairy2 works. The distinction is the whole point of this lab.
