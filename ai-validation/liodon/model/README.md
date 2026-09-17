# model/

**`best.onnx` is not committed to this repository.**

That is deliberate. The artifact is downloaded and verified on the machine that
runs the validation:

```powershell
python scripts/download_liodon.py
```

which fetches the publisher's file and checks it against the SHA-256 recorded in
the Hugging Face registry before keeping it:

| | |
| --- | --- |
| Repository | `liodon-ai/dental-panoramic-detector` |
| Revision | `8bef2036b099e80e51f93f24de4b0c0edd366256` |
| File | `best.onnx` |
| Size | 10,605,711 bytes |
| SHA-256 | `4cee38b54203634d895ed30a8910f5d7c4cefe22b18f9116b5561d9dd6e83a71` |

Full provenance, including the sibling files' hashes and the model's declared
metrics and limitations: [`../MODEL_PROVENANCE.md`](../MODEL_PROVENANCE.md).

Why not commit it:

- **Reproducibility.** A copy in git is a copy nobody can verify. Downloading on
  the target machine and hashing it there is the only way the run can prove it
  executed *the published artifact* and not something adjacent to it.
- **Licence.** The model is **CC-BY-NC-4.0 (non-commercial)**. Redistributing it
  inside this repository would be a licensing decision, not a packaging one.
- **Size.** ~10.1 MB of binary in a source repository, for a file that has a
  canonical download location, is weight with no benefit.

A failed hash is a **hard stop**. `download_liodon.py` deletes the file and
exits non-zero; there is no override flag. The runner independently re-verifies
the hash before loading the graph, so a tampered or stale `best.onnx` cannot be
executed by accident.

---

## `STANDIN_NOT_LIODON.onnx` is not here either

If you run `scripts/selftest_pipeline.py`, it will generate a **synthetic** graph
at `model/STANDIN_NOT_LIODON.onnx` (235 KB, git-ignored).

That file is **not** the Liodon model. It contains no trained weights and no
dental AI — it only mimics the input/output *signature* so the pipeline plumbing
can be tested without the real artifact. It is never named `best.onnx`, it
declares itself synthetic inside its own ONNX metadata, and the runner prints a
banner and writes `"is_standin_not_liodon": true` whenever it is loaded.

The real local validation uses the published `best.onnx` and nothing else.
