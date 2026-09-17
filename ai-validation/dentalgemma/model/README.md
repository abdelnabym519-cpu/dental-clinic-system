# model/ — where the GGUF files go

**This folder is empty in the repository, on purpose.** The two required files
total 3.47 GiB. They are git-ignored, and nothing here should ever be committed.

## What belongs here

| File | Size | Role |
| --- | --- | --- |
| `dentalgemma-4b-Q4_K_M.gguf` | 2,875,676,064 B | the language model |
| `dentalgemma-mmproj-f16.gguf` | 851,251,232 B | the multimodal projector |

## How to get them

```powershell
python ..\scripts\download_artifacts.py --all
```

That is the supported path: the URL is pinned to repository revision
`81e65fb2a242aebadaeb78900d79aa5af1fd5ce7`, the download goes to `<name>.part`,
and the file is renamed only after its SHA-256 matches the value the publisher's
own file metadata records. `--urls` prints the URLs if you prefer to fetch them
by hand, and `--check` verifies what is already on disk.

The repository is public and not gated, so no Hugging Face token is needed.

## Why both files, always

llama.cpp's multimodal support is split by design: a separate component encodes
the image into embeddings, and the language model consumes those embeddings.
Hence two files, and hence the publisher's own warning to download both.

- the **language model** alone: text-only. It cannot be shown an image.
- the **projector** alone: encodes images but generates nothing.
- **both**: what this lab tests.

`scripts/verify_artifacts.py` checks more than presence — it reads each file's
GGUF metadata and cross-checks the pair, so a mismatched combination is caught
before a 2.68 GiB model is loaded. Example of what it looks for: the projector
must declare a vision encoder, and the size it projects to must equal the hidden
size the language model expects.

## Integrity values

| File | SHA-256 | Source of the expectation |
| --- | --- | --- |
| `dentalgemma-4b-Q4_K_M.gguf` | `311ea621a01960e2b4b908adbe8a0b5312201bd0025c92e387150acb3a321c03` | Hugging Face LFS `oid` for the pinned revision |
| `dentalgemma-mmproj-f16.gguf` | `3d03262e058316c318c6dd4868c11fdccef68ec4af6d2ebea54bd1865b8c8113` | Hugging Face LFS `oid` for the pinned revision |

These are the publisher's recorded digests. The lab computes its own and prints it
labelled `LOCAL HASH` whether or not it agrees — no hash anywhere in this lab was
invented, and a disagreement is reported rather than papered over.

Hugging Face also lists an `xetHash` per file. That is a storage-backend content
identifier, **not** a SHA-256, and this lab does not treat it as one.

## If a download is interrupted

Nothing is lost and nothing is broken. A partial download sits as
`<name>.part`; delete it when you are ready and re-run. The downloader will not
overwrite a file whose size is already wrong — it reports the problem and asks you
to move or remove the file yourself, because silently replacing a 2.7 GiB file is
not a decision a script should make for you.

## If a digest does not match

Stop. Do not run the model. Send the output of
`python scripts\verify_artifacts.py` and of

```powershell
Get-FileHash .\model\dentalgemma-4b-Q4_K_M.gguf -Algorithm SHA256
```

A file that is not byte-identical to what the publisher recorded is not the
artifact this lab's provenance record describes, and treating it as such would
make every later result meaningless.

## License note

The files are downloaded from `naazimsnh02/dentalgemma-1.5-4b-it-GGUF`, which
declares Apache-2.0, while the Google base model underneath it is under the
Health AI Developer Foundations terms. That inconsistency is documented in
`../MODEL_PROVENANCE.md` §3 and is **not** resolved by this lab. Check it against
your intended use before going beyond local research validation.
