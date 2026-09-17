# Liodon Dental Panoramic Detector — artifact provenance

Everything on this page was read from the publisher's own registry records and
source files. Nothing here is inferred, reconstructed, or guessed.

Read on: 2026-09-17 (UTC), via the Hugging Face registry API and the official
Space's raw files.

---

## 1. Model source

| Field | Value |
| --- | --- |
| Publisher | **Liodon AI** |
| Model repository | `liodon-ai/dental-panoramic-detector` |
| Repository URL | https://huggingface.co/liodon-ai/dental-panoramic-detector |
| Model card file | `README.md` (2,643 bytes) |
| Pinned revision | `8bef2036b099e80e51f93f24de4b0c0edd366256` |
| Last modified | 2026-06-28T21:53:00Z |
| Licence | **CC-BY-NC-4.0** — non-commercial |
| Pipeline tag | `object-detection` |
| Library name | `ultralytics` |
| Declared base model | `yolo11n` |

## 2. Inference reference implementation

The publisher also ships a Gradio Space containing the reference preprocessing,
inference, and postprocessing code:

| Field | Value |
| --- | --- |
| Space | `liodon-ai/dental-panoramic-detector-space` |
| Space URL | https://huggingface.co/spaces/liodon-ai/dental-panoramic-detector-space |
| Reference file | `app.py` (5,562 bytes) |
| SDK | Gradio 6.19.0 |

`scripts/run_liodon.py` in this lab re-implements that reference. See
`deviations_from_reference` in any `detections.json` for the one documented
departure (an off-by-one defect in the reference NMS).

## 3. Published artifact — the file this validation uses

**`best.onnx`**

| Field | Value |
| --- | --- |
| Size | **10,605,711 bytes** (10.11 MiB) |
| SHA-256 | **`4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71`** |
| LFS object id | `d59eafb965b71a952c326f6d8673e16750182e5b` |
| Source of the hash | Hugging Face registry API, `?blobs=true` (Git LFS `sha256`) |

This is the authoritative hash. `scripts/download_liodon.py` verifies the
downloaded bytes against it, and `scripts/run_liodon.py` re-verifies it before
loading the graph. A mismatch stops the run.

## 4. Other files published alongside it (not used here)

| File | Size (bytes) | SHA-256 |
| --- | --- | --- |
| `best.pt` | 5,452,442 | `6943ceb0f96109cb1955d0e487a8f20aa8edb8fc9d0186b7ecf682fef9be27aa` |
| `last.pt` | 5,452,442 | `ddea8bd1282469183870d309d3c82d09455dd549fd9852b7f58c99f8d8ef1268` |
| `epoch0.pt` | 15,911,649 | `bfba3f1fc127ae28336056e4738b3acdebfcfd909a6f045f0fa4e991cf4844c2` |
| `epoch20.pt` | 15,914,657 | `550c1cdf0ad1e808a8c9466c2a9d278e0ab7cc48cf2e748c3cbffc9c22508283` |
| `epoch40.pt` | 15,918,113 | `c77dc4add3b4115b67ba4c8f37fb18feb21908672a4c3863f0aef2b869590080` |
| `README.md` | 2,643 | (blob `227551481de3d56478dc9a1b31217884a5b8f62a`) |
| `.gitattributes` | 1,519 | (blob `a6344aac8c09253b3b630fb776ae94478aa0275b`) |

`best.pt` is the PyTorch source of the ONNX export and is **not** needed for a
CPU/ONNX validation. The `epoch*.pt` files are intermediate training
checkpoints; they are not used here, and no training of any kind is performed.

There is also a third-party re-upload, `brunosalme/dental-panoramic-detector`,
carrying identical tags. This lab uses the **publisher's** repository only.

## 5. Model facts as declared by the publisher

| Field | Value |
| --- | --- |
| Architecture | YOLO11-N (`yolo11n`), Ultralytics |
| Task | Object detection |
| Classes | `0 caries`, `1 periapical_lesion`, `2 impacted_tooth` |
| Input resolution | 640 × 640 |
| Recommended `conf` | 0.45 |
| Recommended `iou` | 0.35 |
| Training data | DENTEX + OralXrays-9 (CVPR 2025), 9,928 panoramic X-rays, 39,715 boxes |
| Validation | DENTEX val, 46 images / 182 boxes |
| mAP50 | 0.622 |
| mAP50-95 | 0.406 |
| Precision | 0.630 |
| Recall | 0.614 |
| Converged | epoch 27/57 (early stopping, patience 30) |

Dataset: `liodon-ai/dental-panoramic-xray-yolo`.

## 6. What the publisher itself says about limitations

Quoted from the model card, because it matters for how results are read:

- `impacted_tooth` — "highest quality class … closest to clinical-grade."
- `periapical_lesion` — "treat as a flag to look closer, not a diagnosis."
- `caries` — "recall is limited at panoramic resolution. Use as a screening
  hint, not a count."
- The Space carries a clinical disclaimer: decision-support aid only, all
  findings must be confirmed by a licensed dental professional, not FDA
  cleared for diagnostic use.

## 7. Expected JSON surface of `best.onnx`

Not yet observed directly — the artifact has not been downloaded in Arena, so
the graph has not been opened. The expectation below is derived from the
publisher's reference code and is checked by the runner at load time:

| | Name (expected) | Shape (expected) | Dtype |
| --- | --- | --- | --- |
| Input | `images` | `[1, 3, 640, 640]` | `tensor(float)` |
| Output | `output0` | `[1, 7, 8400]` | `tensor(float)` |

Derivation: 7 channels = 4 box + 3 classes; 8400 anchors = 80² + 40² + 20² for
the P3/P4/P5 detection levels at 640 px. The reference `app.py` does
`output[0].squeeze(0).T`, which only makes sense for a `(1, 4+nc, N)` layout.

**The runner does not assume any of this.** It reads the actual input/output
names, shapes and dtypes from the graph, and takes the class names and `imgsz`
from the model's own ONNX metadata when present. The table above is a
prediction to be confirmed on first real run — not a finding.
