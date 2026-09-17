# DentalGemma 1.5 4B IT — provenance record

Every value below is a **source fact**, read from the publisher's own metadata on
2026-09-17, with the exact query recorded so it can be re-checked. Nothing here is
inferred, and nothing here is a measurement of this machine.

Reproduce any of it with:

```powershell
curl.exe -s https://huggingface.co/api/models/naazimsnh02/dentalgemma-1.5-4b-it-GGUF
curl.exe -s https://huggingface.co/api/models/naazimsnh02/dentalgemma-1.5-4b-it-GGUF/tree/main
```

---

## 1. The chain, and who made which link

```
Google                          naazimsnh02 (community)         naazimsnh02 (community)
google/medgemma-1.5-4b-it   →   dentalgemma-1.5-4b-it       →   dentalgemma-1.5-4b-it-GGUF
base foundation model           LoRA fine-tune, merged          GGUF conversion + quantisation
gated, HAI-DEF terms            declared apache-2.0             declared apache-2.0
```

| Link | Repository | Made by | Verification status |
| --- | --- | --- | --- |
| Base | `google/medgemma-1.5-4b-it` | Google | Organisation-verified on Hugging Face; 886 likes; 356,784 downloads |
| Fine-tune | `naazimsnh02/dentalgemma-1.5-4b-it` | Individual contributor | **Community work — no peer review, no independent evaluation found** |
| Conversion | `naazimsnh02/dentalgemma-1.5-4b-it-GGUF` | Same individual contributor | **Community work** |

This matters for how much weight the model deserves: the *base* is Google's, the
*dental adaptation* is one person's, and the *GGUF build* the model card itself
describes as generated with llama.cpp converter scripts. The model card reports
it was built for the MedGemma Impact Challenge.

### Base model — `google/medgemma-1.5-4b-it`

| Field | Value |
| --- | --- |
| Revision | `91850547d9f0b2fdd21aa7c5f4f3d1a8a52c243b` |
| Architecture | `Gemma3ForConditionalGeneration` |
| Parameters | 4,300,079,472 (BF16) |
| Pipeline tag | `image-text-to-text` |
| Gated | **`auto`** — requires signing in and accepting the HAI-DEF terms |
| License field | `other` / `health-ai-developer-foundations` |
| License link | https://developers.google.com/health-ai-developer-foundations/terms |
| Last modified | 2026-04-13 |

### Fine-tune — `naazimsnh02/dentalgemma-1.5-4b-it`

| Field | Value |
| --- | --- |
| Revision | `ffb71c2e3fb6ccf8c958696a5265ece1e2d06240` |
| Base declared | `google/medgemma-1.5-4b-it` |
| Method (per card) | LoRA fine-tune, adapters merged into base weights, full precision |
| Architecture | `Gemma3ForConditionalGeneration` |
| Parameters | 4,971,331,952 (BF16) |
| Gated | no |
| License declared | `apache-2.0` |
| Datasets declared | `naazimsnh02/dentalgemma-vqa`, `naazimsnh02/dentalgemma-instruct` |
| Downloads / likes | 249 / 0 |

### GGUF conversion — `naazimsnh02/dentalgemma-1.5-4b-it-GGUF`

| Field | Value |
| --- | --- |
| Revision | `81e65fb2a242aebadaeb78900d79aa5af1fd5ce7` |
| Gated | **no** — no token needed to download |
| License declared | `apache-2.0` |
| GGUF architecture | `gemma3` |
| GGUF context length | 131,072 |
| GGUF total parameters | 4,551,515,648 |
| Repository storage | 3,726,927,296 B (`usedStorage`) |
| Downloads / likes | 216 / 0 |
| Last modified | 2026-02-23 |

---

## 2. The two required artifacts

Both files are required for image input. The main file cannot see an image; the
projector cannot produce text. Their sizes and digests come from Hugging Face's
own file listing, where `lfs.oid` is the SHA-256 of the file content:

| | Main language model | Multimodal projector |
| --- | --- | --- |
| Filename | `dentalgemma-4b-Q4_K_M.gguf` | `dentalgemma-mmproj-f16.gguf` |
| Size | **2,875,676,064 B** (2.68 GiB) | **851,251,232 B** (0.79 GiB) |
| SHA-256 | `311ea621a01960e2b4b908adbe8a0b5312201bd0025c92e387150acb3a321c03` | `3d03262e058316c318c6dd4868c11fdccef68ec4af6d2ebea54bd1865b8c8113` |
| Quantisation | Q4_K_M (4-bit) | f16 |
| Declared architecture | `gemma3` | `clip` (projector) |
| Role | generates the text | encodes the image into embeddings |
| Total on disk | **3,726,927,296 B (3.47 GiB)** | |

Hugging Face also records an `xetHash` for each file
(`0676e821a7b8ee37821d02da1de2befec99d681b32953b559ad9cfbaf16a2f8f` and
`7376495778bd7c615af8eb471ca92b2203cd48382c4a83fa04bccfa6ccf2afa1`). That is a
content-addressing identifier for the storage backend, **not** a SHA-256 of the
file, and this lab does not treat it as one.

`scripts/verify_artifacts.py` compares the local digest against the values above
and always prints the local digest labelled `LOCAL HASH`, so a mismatch is
visible rather than hidden. No hash was ever invented here.

---

## 3. License — source facts, and one discrepancy this lab cannot resolve

### 3.1 The base model is not Apache-2.0

`google/medgemma-1.5-4b-it` carries `license: other` with
`license_name: health-ai-developer-foundations`. The terms of use
(last modified 15 November 2024) state, among other things:

- **"Model Derivatives"** is defined to include "all modifications to HAI-DEF"
  and "all works based on HAI-DEF" — a fine-tune of MedGemma therefore **is** a
  Model Derivative under these terms.
- **"Distribution"** is defined to include "providing or making HAI-DEF or its
  functionality available as a hosted service via API, web access, or any other
  electronic or remote means" (**Hosted Service**).
- To reproduce or distribute HAI-DEF or a Model Derivative, five conditions
  apply, including carrying the Section 3.2 use restrictions into any agreement,
  passing on the Agreement, and shipping a specific **Notice** text file.
- Use restrictions include not using it in ways that could cause a health
  regulatory authority to treat Google as the manufacturer of a medical device.
- **"Clinical Use"** is defined as "any use in diagnosis or treatment of patients
  (including as part of a research study)".
- Outputs: Google does not claim ownership of your original outputs, and you are
  solely responsible for them. The models are provided "AS IS" without warranty.

Source: https://developers.google.com/health-ai-developer-foundations/terms

### 3.2 The discrepancy

The fine-tune and the GGUF repository both declare **`apache-2.0`** on Hugging
Face, while the base they are derived from is under the HAI-DEF terms and is
gated. Apache-2.0 terms cannot be granted over a base whose own terms the
derivative's publisher does not control, and an Apache-2.0-only redistribution
would not obviously satisfy Section 3.1's five conditions.

**This lab takes no position on which terms govern the GGUF files.** It records
both declarations and moves on. What follows from it, plainly:

- local, non-clinical validation on your own machine — this lab's purpose — is
  the least complicated use, and is what the remaining steps describe;
- **integrating this model into the ERP would be a different matter.** A hosted,
  multi-tenant clinical system is within the terms' definition of Distribution /
  Hosted Service, and clinical use is a defined, restricted term. That is a
  question for whoever owns licensing decisions — not something this lab should
  assume, and not something a validation run settles.

### 3.3 Self-reported quality claims

The model cards list metrics, and mark them `"verified": false`:

| Task | Metric | Value | Verified |
| --- | --- | --- | --- |
| Dental X-ray VQA | validation loss | 0.1585 | **false** |
| Dental clinical case assessment | validation loss | 0.0224 | **false** |

Loss is not accuracy, the values are self-reported and unverified, the datasets
are the author's own, and no independent evaluation of this model was found.
Nothing in this lab reproduces, endorses or repeats these numbers.

---

## 4. Runtime expectations, from the publishers' own documentation

| Fact | Source |
| --- | --- |
| llama.cpp is the documented runtime for these GGUF files | GGUF model card |
| A Q4_K_M 4-bit model "requires approximately ~2.5GB to 3GB RAM" | GGUF model card |
| The card recommends Q4_K_M or higher; aggressive quantisation degrades quality | GGUF model card |
| Multimodal needs both `-m` and `--mmproj` | llama.cpp `docs/multimodal.md` |
| By default the projector is offloaded to a GPU; `--no-mmproj-offload` prevents that | llama.cpp `docs/multimodal.md` |
| Current multimodal tools are `llama-mtmd-cli`, `llama-cli`, `llama-server` | llama.cpp `docs/multimodal.md` |
| **Gemma 3 vision is "very experimental, only used for demo purpose"** | llama.cpp `docs/multimodal/gemma3.md` |
| The card's example uses `llama-llava-cli`, which llama.cpp has since replaced with `libmtmd` | GGUF model card vs llama.cpp PRs #12849 / #13012 |

Three inconsistencies in the publisher's own material are recorded here rather
than smoothed over:

1. the card's CLI example uses the **obsolete** `llama-llava-cli`, and filenames
   (`dentalgemma-1.5-4b-it.Q4_K_M.gguf`, `mmproj-dentalgemma-1.5-4b-it-f16.gguf`)
   that do **not** match the files actually in the repository;
2. the card says "Supported Context: 8,192 tokens" while the GGUF metadata
   reports `context_length = 131072`;
3. the card's image-encoder description says SigLIP, which is consistent with
   Gemma 3 vision, but the projector file itself is what settles it — this lab
   reads the GGUF metadata instead of trusting the prose.

`run_dentalgemma.py` uses `llama-mtmd-cli` (falling back to `llama-cli`), the
tools llama.cpp currently documents, and refuses to run a binary it recognises as
obsolete.

---

**Observed tokenizer metadata discrepancy.** An actual local run produced text
containing `[UNK_BYTE_0xe29681...]`, which is llama.cpp's own detokenizer marker
for a codepoint it cannot map — `U+2581` (▁). That means the vocabulary's pieces
contain `▁` while the file's `tokenizer.ggml.model` / `tokenizer.ggml.pre` select
the GPT-2 byte-level decode path instead of the SentencePiece one. This is a
property of the published artifact's metadata, not of this lab, and it is
documented in `OUTPUT_DECODING.md` together with the two-key local check and the
runtime-side override that tests the cause. No conversion, re-download or file
mutation is performed here.

## 5. What this record does not claim

- It does not claim the model is accurate, safe, or clinically useful.
- It does not claim the model has been run. **It has not been run by this lab.**
- It does not claim the license question is settled.
- It does not claim the published digests are what a local download will produce;
  it claims they are what the publisher's metadata says, and that a local run
  should compare against them and report the result either way.
