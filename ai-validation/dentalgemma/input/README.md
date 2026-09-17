# input/ — the test image

This folder holds the **one local image** a validation run sends to the model.
Nothing here is committed: every image extension in this directory is git-ignored.

## Patient data — read this first

A dental radiograph is patient data. Therefore:

- use a **de-identified** image — no name, no date of birth, no patient
  identifier burned into the pixels, no DICOM header carrying identity;
- **never `git add` an image from here**, and never paste one into an issue, a
  chat or a report;
- if you cannot be certain an image is de-identified, do not use it. A synthetic
  or phantom image is a perfectly good fallback for a smoke test.

The lab does not need a patient image to work. It needs an image that is safe to
put in front of a model running on your own machine.

## What to use first: the validated panoramic radiograph

Start with the **panoramic X-ray already validated in the Liodon lab**
(`..\liodon\`). Reasons:

1. it is a real dental image with known provenance, already used in this project;
2. it is a radiograph, which is one of the two image families the model card
   describes training on (dental photographs and radiographs);
3. a panoramic radiograph is a hard, honest test: it is a wide 2D projection
   containing the whole dentition, not a close-up of one tooth.

Copy it in locally — do not commit it:

```powershell
Copy-Item "C:\path\to\deidentified\panoramic.png" .\input\panoramic.png
```

**Expectation management:** the model card makes no claim about panoramic
radiography specifically. A run that produces a sensible-looking paragraph is a
pipeline success; it is *not* evidence that the model reads panoramic radiographs
well. A run that produces something vague is a plausible and reportable outcome.

## Acceptable image types

| Format | Extensions | Notes |
| --- | --- | --- |
| PNG | `.png` | best choice: lossless, and the lab can read its dimensions |
| JPEG | `.jpg`, `.jpeg` | fine; avoid re-compressing an already-compressed radiograph |
| BMP | `.bmp` | accepted |
| TIFF | `.tif`, `.tiff` | accepted; dimensions not read by the lab's header probe |
| GIF | `.gif` | accepted, rarely useful |
| WebP | `.webp` | accepted by llama.cpp; dimensions not read by the probe |

Anything else is rejected before the model is loaded. The runner reads the image
header itself (no imaging library) to report format, dimensions and colour mode,
and always records the image's SHA-256.

## Practical guidance

- **Resolution:** a radiograph of roughly 1000–3000 px on its long edge is
  sensible. Very small images (under 64 px) are flagged as a warning — they carry
  almost no information.
- **Grayscale is expected** for a radiograph, but the model handles colour; a
  clinical photograph is also a valid test.
- **Keep the original pixels.** Do not screenshot a viewer window, do not draw
  arrows or labels on the image, and do not export it through a tool that
  recompresses it — every one of those changes what the model actually sees.
- **One image per run.** The runner takes a single `--image`. Comparing several
  images means several runs, each with its own report.
- **Record what you fed it.** The report stores the path, format, dimensions and
  digest, which is what makes a later comparison meaningful.

## What this folder is not

It is not a dataset, not a benchmark, and not an evaluation set. One image proves
the pipeline runs. It cannot support a claim about accuracy, sensitivity, or
clinical usefulness — and this lab makes no such claim anywhere.
