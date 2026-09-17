# ai-validation / liodon — Liodon Dental Panoramic Detector

Standalone CPU validation of a published dental-AI model, run from inside the
`dental-clinic-system` repository but **entirely independent of the ERP**.

```
ai-validation/
└── liodon/
    ├── model/               best.onnx lands here (NOT committed — see model/README.md)
    ├── input/               put panoramic X-ray(s) here
    ├── output/              detections.json + annotated.png + run_report.json
    ├── scripts/             download / run / check / self-test
    ├── logs/                timestamped run reports, append-only runs.jsonl
    ├── requirements.txt
    ├── README.md
    └── MODEL_PROVENANCE.md
```

> **No integration.** Nothing here imports from, writes to, or is called by the
> ERP. No API endpoint, no Prisma model, no UI, no patient or Document wiring has
> been added. See [§ Where this could go later](#where-this-could-go-later) for a
> map of future options — a map, not a change.

---

## Quick start (Windows PowerShell)

```powershell
git clone https://github.com/abdelnabym519-cpu/dental-clinic-system.git
cd dental-clinic-system

# this branch carries the lab
git checkout ai-validation/liodon

py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
pip install -r ai-validation\liodon\requirements.txt
pip install psutil          # optional: more precise RAM reporting

python ai-validation\liodon\scripts\check_environment.py
python ai-validation\liodon\scripts\download_liodon.py

# put a panoramic X-ray somewhere, then:
python ai-validation\liodon\scripts\run_liodon.py --input C:\path\to\panoramic.png
```

Results appear in `ai-validation\liodon\output\` — `detections.json`,
`annotated.png`, `run_report.json`.

> Replace `ai-validation/liodon` with the branch name you actually have. The
> scripts resolve their own `model/`, `output/` and `logs/` directories relative
> to **the script file**, so they work from any working directory. Only
> `--input` is resolved relative to where you run the command, so an absolute
> path is the least surprising thing to pass.

If `Activate.ps1` is blocked by execution policy, either allow it for the
session (`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`) or skip
activation and call the interpreter directly, e.g.
`.\.venv\Scripts\python.exe ai-validation\liodon\scripts\run_liodon.py --input C:\x.png`.

---

## What is being validated

| | |
| --- | --- |
| Model | Liodon Dental Panoramic Detector |
| Repository | `liodon-ai/dental-panoramic-detector` (Hugging Face) |
| Artifact | `best.onnx` — 10,605,711 bytes |
| SHA-256 | `4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71` |
| Architecture | YOLO11-N (Ultralytics), ONNX export |
| Classes | `caries`, `periapical_lesion`, `impacted_tooth` |
| Runtime | ONNX Runtime **CPU** only — `CPUExecutionProvider` |
| Licence | CC-BY-NC-4.0 (non-commercial) |

Full provenance, including every sibling file's hash and the publisher's own
stated limitations: [`MODEL_PROVENANCE.md`](MODEL_PROVENANCE.md).

## What this lab does NOT do

No training. No fine-tuning. No retraining. No conversion. No quantisation. No
weight modification. No CUDA. No NVIDIA. No `onnxruntime-gpu`. No cloud. No paid
API. No remote inference. No ERP integration.

The published artifact is downloaded and executed exactly as published.

---

## Workflow

### 1. Check the environment

```powershell
python ai-validation\liodon\scripts\check_environment.py
```

Reports Python version, whether `onnxruntime` is installed and is the **CPU**
build, whether `CPUExecutionProvider` is available (and warns if a CUDA provider
is present, which would mean `onnxruntime-gpu` got installed by mistake), and
whether the artifact is present and hashes correctly. Exit code `0` means ready.

### 2. Download and verify the artifact

```powershell
python ai-validation\liodon\scripts\download_liodon.py
```

Downloads `best.onnx` at the pinned revision into `ai-validation/liodon/model/`
and verifies **size and SHA-256** against the published values. On mismatch it
deletes the file and exits non-zero — there is no override flag, by design.

Re-running is safe and cheap: an already-present, already-verified file is
accepted without re-downloading. Use `--force` to re-download regardless.

### 3. Supply a panoramic X-ray

Any of `.png .jpg .jpeg .bmp .tif .tiff .webp`. Panoramic images are wide
(roughly 2:1 to 3:1); the runner letterboxes to 640×640 exactly as the
publisher's reference code does.

> Only use images you are permitted to use. Panoramic radiographs may contain
> burned-in patient identifiers. Nothing in this lab uploads anything anywhere —
> all processing is local — but check before sharing outputs.

### 4. Run inference

```powershell
python ai-validation\liodon\scripts\run_liodon.py --input C:\path\to\panoramic.png
```

Or a whole folder:

```powershell
python ai-validation\liodon\scripts\run_liodon.py --input C:\path\to\folder\
```

### 5. Read the results

```powershell
notepad ai-validation\liodon\output\detections.json
notepad ai-validation\liodon\output\run_report.json
start   ai-validation\liodon\output\annotated.png
```

---

## Command reference

```
python ai-validation\liodon\scripts\run_liodon.py --input <path> [options]

  --input PATH          image file, or folder of images        (required)
  --model PATH          default: ai-validation/liodon/model/best.onnx
  --output-dir PATH     default: ai-validation/liodon/output
  --conf FLOAT          confidence threshold                   (default 0.45)
  --iou FLOAT           NMS IoU threshold                      (default 0.35)
  --imgsz INT           default: model metadata, else 640
  --warmup INT          warmup calls before the measured one   (default 1)
  --intra-threads INT   ONNX Runtime intra-op threads
  --inter-threads INT   ONNX Runtime inter-op threads
  --log-dir PATH        default: ai-validation/liodon/logs
  --no-log              do not append to the run log
  --quiet               suppress the console summary
```

`--conf`, `--iou` and `--imgsz` default to the publisher's recommended operating
point. Changing them changes what the model reports, so any measurement quoted
elsewhere should state the settings used — which is why every output file
records them.

Exit codes: `0` ok · `3` model missing · `4` hash mismatch · `5` input missing ·
`6` session failed · `7` shape mismatch · `8` inference error.

---

## Outputs

```
ai-validation/liodon/output/
├── detections.json     every detection: class, confidence, bounding box
├── annotated.png       the input with boxes, labels and a legend drawn on
└── run_report.json     timings, memory, providers, model identity, hashes
```

With `--input` pointing at a folder, each image gets its own
`output/<image-name>/` subfolder so runs do not overwrite each other.

### `detections.json`

Detection records are written in **the model's own output format**: absolute
pixel coordinates, `xyxy`, in the coordinate space of the original image. That
is what the publisher's postprocessing produces, so nothing is forced on top of
it. The format is stated explicitly inside each record rather than left implicit.

```json
{
  "schema": "liodon.detections/1",
  "is_standin_not_liodon": false,
  "engine": {
    "repository": "liodon-ai/dental-panoramic-detector",
    "revision": "8bef2036b099e80e51f93f24de4b0c0edd366256",
    "artifact_sha256": "4cee38b5…e83a71",
    "artifact_verified": true
  },
  "runtime": { "execution_provider": "CPUExecutionProvider", "…": "…" },
  "model_io": { "inputs": [ … ], "outputs": [ … ], "metadata": { … } },
  "parameters": { "conf": 0.45, "iou": 0.35, "imgsz": 640, "…": "…" },
  "classes": { "0": "caries", "1": "periapical_lesion", "2": "impacted_tooth" },
  "image": { "width": 2400, "height": 1200, "sha256": "…" },
  "detection_count": 3,
  "counts_by_class": { "caries": 1, "periapical_lesion": 1, "impacted_tooth": 1 },
  "detections": [
    {
      "class_id": 0,
      "class_name": "caries",
      "confidence": 0.71,
      "bbox": {
        "format": "xyxy",
        "units": "pixels",
        "coordinate_space": "original_image",
        "x1": 637.5, "y1": 431.25, "x2": 862.5, "y2": 618.75,
        "width": 225.0, "height": 187.5
      }
    }
  ],
  "raw_model_output": { "shape": [1, 7, 8400], "…": "…" },
  "timings_ms": { "…": "…" },
  "fidelity": { "…": "…" },
  "deviations_from_reference": [ { "…": "…" } ]
}
```

Class names and `imgsz` are read from the ONNX file's own metadata when present,
so they follow the artifact rather than a hand-copied table. The `confidence`
values are the model's raw per-class scores (argmax over channels 4+), which is
exactly what the reference implementation uses.

### `run_report.json` — the instrumentation

Per image, `timings_ms` contains:

| Key | Meaning |
| --- | --- |
| `decode_ms` | reading and converting the image to RGB |
| `preprocess_ms` | letterbox + normalise + NCHW |
| `inference_ms` | the measured model call (after warmup) |
| `inference_cold_ms` | the first call, before warmup — the honest cold-start number |
| `inference_all_ms` | every call, in order |
| `postprocess_ms` | decode + confidence filter + NMS |
| `draw_ms` | annotation overlay (cosmetic, not part of the model) |
| `total_ms` | full per-image wall clock |

Plus model load time, the active execution provider, process RSS before/after,
and peak working set on Windows.

**These numbers are measurements of the machine that produced them.** They are
written into the report by the run itself. No number for any particular laptop
is predicted anywhere in this lab; your run is what establishes it.

---

## Verifying the pipeline without the real model

`scripts/make_standin_onnx.py` builds a **synthetic** ONNX graph with the same
I/O signature (`images [1,3,640,640]` → `output0 [1,7,8400]`) and fabricated
boxes. It contains no trained weights and no dental AI, and it is never named
`best.onnx`.

```powershell
python ai-validation\liodon\scripts\make_standin_onnx.py
python ai-validation\liodon\scripts\selftest_pipeline.py
```

The self-test asserts letterbox geometry against hand-computed coordinates,
checks the decode, the confidence filter, and that NMS suppresses a planted
duplicate, and confirms the output files are produced. Useful as a smoke test on
a new machine before spending a download.

Guard rails around it:

- the runner refuses any file whose SHA-256 does not match the published hash;
- `--allow-standin` is the only way past that, and it is honoured **only** for a
  file that declares `STANDIN_NOT_LIODON=true` in its own ONNX metadata — so it
  can never be used to run a real weight file with a bad hash;
- whenever the stand-in is loaded, a banner is printed and
  `"is_standin_not_liodon": true` is written into `detections.json`.

The real local validation uses the published `best.onnx` and nothing else.

---

## A defect in the publisher's reference code

The Space's `_nms` is:

```python
order = order[1:][[_iou(boxes[i], boxes[j]) < iou_thresh for j in order]]
```

`order[1:]` is evaluated before the comprehension, so the slice has *n−1*
elements while the mask is built over the untruncated `order` and has *n*.
NumPy raises `IndexError`.

This was reproduced in Arena by running the publisher's `_iou`/`_nms` snippet
**verbatim**: it fails for 1 box and for 2 boxes, i.e. as soon as any detection
clears the confidence threshold.

This is an off-by-one indexing slip, not a difference of intent — the rule the
code expresses is standard greedy NMS. `run_liodon.py` implements that same rule
without the defect, and records the deviation inside every `detections.json`
under `deviations_from_reference`, so the evidence trail is explicit rather than
silent.

---

## Verification status

| Claim | Status |
| --- | --- |
| Model repository, revision, licence, class list | verified against the HF registry API |
| `best.onnx` size and SHA-256 | verified against the HF registry API (LFS metadata) |
| Preprocessing/postprocessing semantics | verified from the publisher's reference `app.py` |
| Reference NMS raises `IndexError` | **reproduced in Arena** against the verbatim snippet |
| Runner plumbing (letterbox, decode, NMS, output writing, instrumentation) | **verified in Arena** end-to-end against the stand-in graph, 20/20 checks |
| Stop-paths (missing model, hash mismatch, stand-in guard) | **verified in Arena**, exit codes as designed |
| **Model actually loads and infers on this artifact, on Windows** | **NOT YET TESTED** — first real evidence comes from your machine |
| Inference speed / RAM on the target laptop | **UNKNOWN** until you run it |
| Detection quality on your images | **UNKNOWN** until you run it |

Known gap: `huggingface.co` was not reachable from the Arena sandbox, so the
`.onnx` bytes could not be downloaded or hashed there. The hash used for
verification is the publisher's own LFS SHA-256 from the registry API, not a
locally recomputed one. Your first `download_liodon.py` run closes that gap.

---

## Stop conditions

The run stops, rather than working around, if:

- the published artifact cannot be found,
- `best.onnx` is absent,
- inference would require training,
- CPU inference is not possible,
- the artifact does not match the published hash,
- preprocessing or postprocessing cannot be determined.

In every one of those cases the correct action is to stop and report — never to
substitute, convert, re-export, quantise or retrain a weight file.

---

## Where this could go later

**Nothing is integrated, and nothing here is a plan to integrate.** This section
records where a future, separately-scoped task *might* connect Liodon to the ERP,
for reference only.

| Candidate | Why it fits | Honest gap |
| --- | --- | --- |
| `Document.annotations` (`Json?`) + existing `GET/PUT /api/patients/[id]/documents/[documentId]/annotations` | A detection (`class`, `confidence`, `bbox`) maps naturally onto the existing `Annotation` shape; `DocumentType` already has `XRAY` | That field holds **clinician** annotations; machine output needs a source/method marker or a reviewer can't tell which is which |
| A new model, e.g. `DocumentAIAnalysis` linked to `Document` | Keeps model id, revision, weights hash, params and runtime — auditable and separable from clinician work | Requires a Prisma schema change (out of scope) |
| `AISkillExecution` | Already the generic "an AI thing ran" ledger (`skill`, `input`, `output`, `duration`, `cost`) | Generic log, not a clinical record; no `Document` foreign key |
| `DentalChartEntry` | `ToothCondition` already includes `CARIES`, `ABSCESS`, `PERIODONTAL`; per-tooth | **Liodon emits pixel boxes, not FDI tooth numbers.** Bridging that needs a tooth-numbering step neither the model nor the ERP currently provides |
| `Patient.aiSummary` / `aiSummaryAt` | Already exists | Free-text summary; a list of boxes does not fit |

Constraints any future work must respect:

- **`hospitalId` on everything** — multi-tenancy is application-level, and a new
  row without it is a cross-clinic leak.
- **`middleware.ts` lets every `/api/*` through** to the route handler, so any
  new route must call `requireAuthAndRole` itself or it is silently public.
- **Move bytes by storage key**, not filesystem path (`lib/storage`).
- **A 10 MB upload cap exists**; panoramic PNGs can exceed it.
- **CC-BY-NC-4.0 is non-commercial** — a hard constraint independent of anything
  technical.
- **Where it runs is architectural.** A local ONNX process cannot execute inside
  a Next.js route handler, and the ERP's existing AI is remote/OpenRouter. Those
  are different deployment stories and should not be conflated.

---

## Clinical disclaimer

Carried over from the publisher, and true here as well: this is a
decision-support aid. Every finding must be reviewed and confirmed by a licensed
dental professional. It is not cleared by the FDA for diagnostic use. Nothing in
this folder is a medical device or a diagnosis.
