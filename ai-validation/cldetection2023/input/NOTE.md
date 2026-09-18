# `input/` — the real input for Engine #6

The model needs a **lateral cephalometric radiograph**. Nothing here is synthetic, and no
image is committed to git (`.gitignore` excludes `input/*` except this note).

## Where the audited input comes from

| field | value |
| --- | --- |
| repository | `szuboy/CL-Detection2023` — *CL-Detection2023 Challenge Official Repository*, **Apache-2.0** |
| revision | `dc1ce2bd0a3f317de4160cde17e4a6f60371e67c` |
| file | `step5_docker_and_upload/test/stack1.mha` (41,472,328 bytes) |
| container | MetaImage · `MET_UCHAR` · `BinaryData = True` · `ElementDataFile = LOCAL` · `DimSize = 2880 2400 2` · `ElementNumberOfChannels = 3` |
| slice extracted | 1 of 2 (each slice is one lateral cephalometric radiograph) |
| output | `input/ceph_stack1_image1.png` — 2880×2400×3, sha256 `b663ed10bd190f8891e781b7e408b9e380c3a2f550a6bdca1c5414cee545d988` |

These are the organisers' own validation inputs for the baseline they published, distributed
under the repository's Apache-2.0 licence together with their reference annotations
(`expected_output.json`, 38 points per image). Using them keeps this engine honest: a real
radiograph from the model's own challenge, with no fabricated or substituted image.

## Regenerate it

```powershell
git clone https://github.com/szuboy/CL-Detection2023.git CL-Detection2023
python scripts\extract_input.py --stack CL-Detection2023\step5_docker_and_upload\test\stack1.mha `
    --index 1 --out input\ceph_stack1_image1.png --json-out reports\input_provenance.json
```

`--index 2` extracts the second radiograph in the same file. The script parses the
MetaImage header with the standard library, so `SimpleITK` is not required for this step.

## Optional cross-check (sanity only, not a metric)

`CL-Detection2023\step5_docker_and_upload\test\expected_output.json` holds the organisers'
38 reference points for each image (the third value of every point is the image id). It is
useful for one thing: confirming that a prediction lands on anatomy rather than in empty
space. It is **not** the challenge metric — that needs the gated 400-image validation set,
and MRE in millimetres needs the per-image pixel spacing, which this test stack does not
carry.
