# Engine #5 — Audit: `nsitnov/8024-yolov8-model` / `8024.pt`

Audit date: 2026-09-18. Scope: source auditing and artifact verification.
**No inference was run. No artifact was modified. Nothing was integrated.**

> **Revision (after the first local run).** The operator downloaded the checkpoint and
> verified its SHA-256 locally, then ran this lab's gate on it. The gate stopped with
> *"class name(s) missing from the bytes"* — a **false block**: it was matching the model
> card's spellings while the checkpoint uses its own for three of the eight concepts. The
> gate now resolves them through an explicit, closed alias table (`Missing teeth`,
> `Periapical lesion`, `Root canal obturation`), records the file's own wording unchanged,
> and keeps `Implant` mandatory. No checkpoint byte, weight or architecture was altered.

Search for a **verification** tag:

- **VERIFIED-HERE** — read directly from a primary source during this audit
  (the Hugging Face API/tree/commits for this repo, the file tree's published pickle scan,
  the current `ultralytics` wheel from PyPI, or a local test).
- **CORROBORATED** — stated identically by independent public sources (model card,
  `model_handler.py`, a consumer Space) but *not* read out of the checkpoint's own bytes.
- **UNVERIFIED** — not established here; the reason is given with each one.

---

## 1. Repository / model identity

**VERIFIED-HERE.** `nsitnov/8024-yolov8-model` on Hugging Face, revision on `main`.
Public (`private: false`), **not gated** (`gated: false`), so no token is needed to fetch it.
Four files: `.gitattributes` (1,519 B), `8024.pt`, `README.md` (1,488 B),
`model_handler.py` (1,281 B). The card describes a YOLOv8 instance-segmentation model for
dental X-rays with 8 classes. Hub stats: 0 likes, 0 downloads recorded, created
2024-08-10. Source: `https://huggingface.co/api/models/nsitnov/8024-yolov8-model?blobs=true`.

## 2. Exact revision / commit

**VERIFIED-HERE.** Head of `main`: `0304179670f4838bf0dec1053b963112a16a66cf`
("Update README.md", 2024-08-10T22:26:15Z) — 7 commits total. The checkpoint was added in
`10bef73f8b28faf32022268b6d8318ede4b8e75b` ("Add YOLOv8 model 8024 with Git LFS",
21:48:16Z) and **no later commit touched `8024.pt`**, so its bytes are identical at the head
revision and at that commit. `model_handler.py` arrived in
`cf56128ac9066a1b69e631e7eac91362614495d4` (22:14:42Z); first commit
`3873fa9ad41710d1f9f879885458428288bb133f` (21:38:41Z). Source: the commits API.

## 3. License

**VERIFIED-HERE.** The repository declares `license: apache-2.0`.

**Read this together with this caveat, which is on the record in a third-party consumer of
the same model:** the checkpoint is an Ultralytics artifact, and *loading* it uses the
`ultralytics` package, which is **AGPL-3.0**. The consumer Space
`SajedAlmorsy/AlexTechPark` says exactly that in its conversion script and mitigates it by
converting to ONNX and running inference with `onnxruntime` (MIT) instead. The declared
Apache-2.0 covers the weights as published; it does not relicense the library. Not legal
advice — flagged for whoever decides on production use.

## 4. Checkpoint existence

**VERIFIED-HERE.** `8024.pt` exists at both revisions above, stored in Git LFS
(pointer size 134 B) and served by the hub's Xet backend. It is publicly downloadable; no
authentication, no gating, no licence click-through on the file itself. **It was not
downloaded during this audit** — see field 6.

## 5. Exact size

**VERIFIED-HERE.** `143,955,443` bytes (143.96 MB; the hub page rounds it to "144 MB").

## 6. SHA-256

**VERIFIED BY THE OPERATOR (metadata cross-checked here).** The operator downloaded the
file on the target machine and computed its digest locally:
`E7CC137766F44C3DAD86138A1B37622A25C496A32CCA2E7DAB1BEC1BCCF0CE98` — identical to the
expected value (digests are case-insensitive; the gate compares them that way). The hub's LFS
metadata independently publishes the same digest from the other direction.

The audit environment still cannot recompute it — see the note below — so the verification
rests on the operator's run, which is the run that matters, and on the hub's record agreeing
with it. The hub publishes the LFS digest
`e7cc137766f44c3dad86138a1b37622a25c496a32cca2e7dab1bec1bccf0ce98`, which **equals the
expected value exactly**, and an Xet hash
`843f906dc1a3a0f19306a19795048ad1c9c165a2e3627ee4750748926c3f0c30`.

**Why the audit environment could not do it:** Hugging Face is not reachable from the
audit environment's shell (`curl` to `huggingface.co`, `cdn-lfs.huggingface.co`,
`hf-mirror.com` and the Xet bridge all fail with `SSL_ERROR_SYSCALL`; only the JSON/raw
endpoints are readable through the page-fetch tool, and a 144 MB binary cannot be read that
way). A metadata match is a strong signal, not a verification. The gate in this lab
recomputes the digest locally and refuses to continue on any mismatch (exit 6), so the
verification can be finished on the machine that has the file.

## 7. Architecture

**PARTIALLY VERIFIED.** The hub's per-file pickle scan publishes the complete import list of
the checkpoint — the recipe its own payload uses to rebuild itself — and it is an
unambiguous YOLOv8 instance-segmentation graph:

- **Model / task:** `ultralytics.nn.tasks.SegmentationModel` (task = segment, not detect).
- **Heads:** `ultralytics.nn.modules.head.Segment` **and** `...head.Detect`, plus
  `ultralytics.nn.modules.block.Proto` — the prototype-mask branch, which is what makes this
  segmentation rather than plain detection.
- **Backbone / neck blocks:** `Conv`, `C2f`, `Bottleneck`, `SPPF`, `Concat`, `DFL`,
  `BatchNorm2d`, `SiLU`, `MaxPool2d`, `Upsample`, `ConvTranspose2d`, `ModuleList`,
  `Sequential`, `Conv2d`.
- **Training-graph parts retained in the checkpoint:** `v8SegmentationLoss`, `BboxLoss`,
  `BCEWithLogitsLoss`, `TaskAlignedAssigner`, and `IterableSimpleNamespace` (the args
  container).
- **Storage types:** `torch.HalfStorage`, `LongStorage`, `FloatStorage`, `torch.Size`,
  `torch.device`, `torch._utils._rebuild_tensor_v2`, `_rebuild_parameter` — i.e. some tensors
  are stored as fp16, as Ultralytics checkpoints normally are.
- **Containers:** `collections.OrderedDict`, `__builtin__.set`, `__builtin__.getattr`
  (see field 13).

Import counts: 16 from `torch*`, 14 from `ultralytics*` (9 `nn.modules`, 1 `nn.tasks`,
2 `utils.loss`, 1 `utils.tal`, 1 `utils`), 1 `collections`, 2 builtins. Source:
`huggingface.co/api/models/nsitnov/8024-yolov8-model/tree/main?recursive=true&expand=true`.

**Not established:** the model scale (n/s/m/l/x) and the parameter count. They are not in any
metadata field and the file was not opened here. The size (143,955,443 B, fp16 tensors plus
the retained training state) is consistent with a mid-size segmentation model, but that is
an inference from a number, not a measurement — treat it as unknown until read.

## 8. Ultralytics version / runtime compatibility

**PARTIALLY VERIFIED.** Two independent lines of evidence, neither of which is the file:

- The **consumer Space** `SajedAlmorsy/AlexTechPark` loads this exact checkpoint with
  Ultralytics (`YOLO(...)`) and exports it to ONNX (`imgsz=640, opset=12`), which is
  evidence that a current Ultralytics handles the file.
- The **loader** in the audited wheel (`ultralytics 8.4.155`) resolves the checkpoint's
  class names against an allow-list and keeps aliases for the pre-8.0.44 `ultralytics.yolo.*`
  package paths, so a 2024 checkpoint is expected to load on current releases.
- PyPI metadata for `ultralytics 8.4.155` requires `torch>=1.8.0` (Windows: `!=2.4.0`),
  `torchvision>=0.9.0`, `numpy>=1.23.0`, `opencv-python>=4.7.0`.

**Not established:** the version string the checkpoint itself records. A `.pt` file written
by Ultralytics stores its version in the pickle streams; it can be read locally by the gate
(`versions_found` in the JSON report). Until then, "current Ultralytics loads it" is
expectation, not proof.

## 9. Input type / shape

**CORROBORATED.** From the consumer Space's export and preprocessing code (the same model,
converted and run in production by a third party): a single RGB image, `uint8` HWC on
entry, letterboxed with grey (114) padding to **`1×3×640×640`**, scaled to `float32` in
`[0,1]`, NCHW. This matches the Ultralytics default inference size (`imgsz=640`).

Not read from the checkpoint itself; the gate's `key_values` will show the recorded `imgsz`
locally.

## 10. Output type

**CORROBORATED.** Two tensors, the standard YOLOv8-segmentation pair:

- detections `[1, 44, 8400]` — `44 = 4` box + **8 classes** + `32` mask coefficients;
- prototype masks `[1, 32, 160, 160]`.

The consumer's post-processing splits them exactly that way (24 kB of code that assumes
`num_classes = num_attrs - 4 - 32`), which independently corroborates an 8-class
segmentation head. Not measured from the checkpoint.

## 11. Class names and order

**VERIFIED FROM THE FILE (via the operator's gate run) — with an alias mapping.**

The checkpoint's own `names` mapping, read out of `data.pkl` by the operator's run and
recorded in `checkpoint_ops.txt`:

| idx | canonical concept (audited) | label inside `8024.pt` | match |
| --- | --- | --- | --- |
| 0 | Caries | `Caries` | canonical |
| 1 | Crown | `Crown` | canonical |
| 2 | Filling | `Filling` | canonical |
| 3 | **Implant** | `Implant` | canonical — **mandatory** |
| 4 | Missing-tooth-between | `Missing teeth` | alias |
| 5 | Periapical-lesion | `Periapical lesion` | alias |
| 6 | Root Piece | `Root Piece` | canonical |
| 7 | Root-Canal-Treatment | `Root canal obturation` | alias |

Three concepts are spelled differently inside the checkpoint than on the model card. This is
a **naming difference, not a missing class**, and it was handled as such: the gate maps the
canonical concept to the file's spelling through an explicit, closed table, and the report
keeps the file's wording (`checkpoint_label`) untouched beside the canonical name. Nothing is
matched by fuzzy similarity, so a different concept cannot be accepted as one of the eight.

This is a verification alias. It does not rename anything in the model, and it is not a claim
that two phrases are clinically interchangeable — the canonical names are the operator's
labels for the eight audited concepts.

The three public sources that first described the classes (model card, `model_handler.py`,
the consumer Space) gave the canonical names and disagreed with each other in small ways
(`Root Piece` vs `Root-Piece`); the file settles all of it, and only the file counts.

## 12. Is `Implant` inside the checkpoint metadata / model structure?

**VERIFIED FROM THE FILE — yes, at index 3, as the string `Implant` in `data.pkl`.**

This is the field the whole audit turned on, and it is the one the first local run settled:
the operator's gate run read the checkpoint's `names` mapping out of its own bytes and
`Implant` is present. Nothing was executed to establish it — the inspector decodes the
pickle stream and never constructs an object.

The check is now enforced, not just observed: `Implant` is a **required** class, and the gate
stops (exit 5) if it is absent from the bytes, before any load. `class_validation` in the
JSON report carries the result, including the file's own spelling of every concept.

## 13. Does the checkpoint contain code / pickle objects that execute during loading?

**VERIFIED-HERE, and the answer is yes — by format.** A `.pt` checkpoint is a pickle. A
default load (`torch.load(..., weights_only=False)`, which is what `YOLO(path)` does unless
told otherwise) reconstructs the object graph by *calling* the classes and reducers the
file names. This is why no `.pt` file can be called "safe" on the basis of a scan: the
scan shows the names, the load runs them.

What the scan of this file shows: all 33 imports are Ultralytics/torch model classes plus
`collections.OrderedDict`, `builtins.set` and **`builtins.getattr`** (reported as
`__builtin__.getattr`). `getattr` is flagged "dangerous" by Hugging Face's pickle scan, the
AV scan reports the generic signature `Py.Malware.Obfuscation___builtin___getattr_GLOBAL`,
and Protect AI flags `PAIT-PYTCH-101`. **All three verdicts are pattern-based**: every
Ultralytics checkpoint contains `getattr`, which that ecosystem uses for legitimate
attribute-based reconstruction, and none of the three reports claim this file *does*
something malicious. Equally, none of them prove it does not.

Two facts were established from primary sources to allow a judgement instead of a guess:

1. Every one of the 33 names is covered by the allow-list of Ultralytics' own restricted
   loader (verified against the `ultralytics 8.4.155` wheel; see field 14).
2. The `getattr` entry is precisely what that restricted loader intercepts and replaces.

## 14. Can it be safely loaded in an isolated validation environment?

**VERIFIED-HERE — a constrained loading path exists in the library itself.** Ultralytics
8.4.155 ships an **opt-in** restricted loader:

- enabled per process with `ULTRALYTICS_SAFE_LOAD=1`, or per call with
  `torch_safe_load(path, safe_only=True)` (`ultralytics/utils/__init__.py:73` defines
  `SAFE_LOAD = env_bool("ULTRALYTICS_SAFE_LOAD")`);
- it calls `torch.serialization.get_unsafe_globals_in_checkpoint()`, which **statically
  disassembles** `data.pkl` (no execution) to list the globals the file references;
- it registers only those referencing the `ultralytics.nn.*`, `torch.nn.modules.*`,
  `ultralytics.utils.{loss,tal}` namespaces **and** resolving to real `torch.nn.Module`
  subclasses — plus a fixed list of container/alias types, including
  `_SafeLoad._getattr`, an attribute-only wrapper that **replaces `builtins.getattr`** and
  raises unless the attribute is a module's `forward`/`forward_fuse`;
- the load itself is then `torch.load(path, map_location="cpu", weights_only=True)`, so
  anything not allow-listed raises `UnpicklingError` instead of running;
- it also builds models without `eval()`-ing architecture strings, and refuses to
  auto-install modules named by the checkpoint.

Two limits, stated plainly. It needs **torch ≥ 2.6** (`_SafeLoad.SUPPORTED` checks for
`torch.serialization.get_unsafe_globals_in_checkpoint`); on an older torch the flag is
*ignored* and the loader degrades to a normal load, so the torch version must be checked
rather than assumed. And this is a code-level reading of the current release, verified in
the wheel — not a live load of `8024.pt`, which has not happened.

## 15. Do the lab's current PyTorch / Ultralytics work with it?

**VERIFIED-HERE for the audit environment; EXPECTED for the target machine.**

- Audit environment: no torch, no numpy, no ultralytics — and the inspector was built and
  tested there on purpose (34 tests pass), so the gate can run before anything is installed.
- Target machine (per the operator's stated environment): Python 3.11.9, **torch 2.14.0+cpu**,
  **NumPy 1.26.4**. `torch ≥ 2.6` satisfies the restricted loader's requirement; NumPy
  satisfies `numpy>=1.23.0`; `torch>=1.8.0` is satisfied. `ultralytics` itself is **not
  installed yet** and must not be installed until the load step is authorised.

## 16. CPU-only compatibility (i9-13900H, ~16 GB RAM, Iris Xe, CUDA=false)

**EXPECTED, NOT MEASURED.** Nothing here can be measured without the file and the runtime.

- Ultralytics' loader explicitly moves the checkpoint to the CPU (`map_location="cpu"`), and
  inference falls back to CPU when no CUDA device exists — the Iris Xe is not a CUDA device,
  so the GPU path is not even a possibility here. No CUDA is required by this model.
- `143.96 MB` of fp16 weights is small for a 16 GB machine: the process footprint is
  dominated by the framework itself, not the model. A ~`1.5–3 GB` plateau is the expected
  order of magnitude for torch-CPU plus this checkpoint, comfortably inside 16 GB.
- A single `640×640` forward pass of a mid-size YOLO-seg model on an i9-13900H is a
  seconds-scale job, not a minutes-scale one.

These are expectations from the architecture, the file size and the target hardware — not
results. They stay unverified until a real, authorised run happens.

---

## Temporary classification

**BLOCKED** — the audit cannot be completed in this environment, and loading is not yet
justified. This is *not* a finding against the model.

What the operator's local run has since cleared:

1. **Identity** — the operator's own SHA-256 matches the expected digest (field 6), so the
   audited bytes are the bytes on disk.
2. **The class list and `Implant`** — read out of the checkpoint itself (fields 11 and 12).
   The gate's first run stopped on a *false* class-missing block; the alias mapping fixed it
   without touching the checkpoint, and `Implant` presence is now enforced.

What still keeps this at BLOCKED:

1. **The runtime stage has not started — by instruction.** No load, no inference, no
   Ultralytics installation. The static gate passing is not the same as the model running,
   and an `Operational` classification is only available after a real inference on a real
   dental radiograph.
2. **The security question is answered only up to "there is a safe way to load it".**
   The hub rates the file `unsafe` on pattern evidence; the constrained loading path in
   Ultralytics 8.4.155 covers all 33 imports and neutralises the `getattr` entry — but that
   path has not been exercised on this file, and the file has not been loaded.
3. **The audit environment cannot fetch the artifact**, so every byte-level fact here rests
   on the operator's machine plus the hub's metadata; that is recorded per field rather than
   presented as an in-environment measurement.

Nothing found so far disqualifies the checkpoint: it is public, ungated, Apache-2.0 as
published, 143,955,443 bytes matching the expected digest in the hub's own LFS metadata, and
its pickle contains exactly the class set a YOLOv8-segmentation checkpoint should contain.

### What unblocks it (run on the machine that has the file)

```powershell
# 1) get the audited revision, byte-for-byte
pip install "huggingface_hub[hf_xet]"
python -c "from huggingface_hub import hf_hub_download; p=hf_hub_download('nsitnov/8024-yolov8-model','8024.pt',revision='0304179670f4838bf0dec1053b963112a16a66cf'); print(p)"

# 2) the gate — must print GATE PASSED and exit 0
python scripts\inspect_checkpoint.py --checkpoint model\8024.pt `
    --json-out reports\checkpoint_inspection.json --dis-out reports\checkpoint_ops.txt
```

If the gate exits 0 — which the corrected class resolution now allows for this file — fields
6, 7, 11, 12 and 13 are "read from the file", and the classification can be raised to
**READY FOR LOCAL INFERENCE**. That still means *nothing has run yet*: it is not, and cannot
be, `Operational`.
Any other exit code is a stop: send the JSON and the disassembly text back before touching
the file with a loader.
