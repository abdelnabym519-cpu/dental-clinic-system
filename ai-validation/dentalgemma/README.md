# ai-validation / dentalgemma

Isolated validation lab for **DentalGemma 1.5 4B IT** — a community dental
fine-tune of Google's MedGemma, run locally through llama.cpp.

> ## STATUS: ⚪ UNKNOWN — NOT OPERATIONAL
>
> **Nothing in this folder has been run against the model.** The two GGUF files
> are not in this repository (they are 3.47 GiB and git-ignored), no inference has
> been executed, and no runtime figure exists. `STATUS` stays `UNKNOWN` until a
> real local run produces real text on your machine and writes it to disk.
>
> What *has* been established, without running anything: the provenance chain, the
> exact artifact identities, the runtime the publisher documents, and the license
> situation. See `MODEL_PROVENANCE.md`.

This lab lives inside the `dental-clinic-system` repository but is **not
connected to the ERP**: no API route, no Prisma model, no UI, no patient wiring.
Nothing in the application references it. No production dependency was added.

---

## What this lab is for

One question, answered honestly: **can this model produce dental-image text
locally, on this machine, on the CPU — and what does it cost in time and memory?**

It is deliberately not an accuracy evaluation. No ground truth is used, no metric
is computed, and nothing here says the output is correct.

```
real GGUF weights → llama.cpp (native, CPU) → one local dental image
                  → generated text → measured runtime, peak RAM, CPU time
                  → JSON report → human-readable record
```

## The chain, briefly

```
google/medgemma-1.5-4b-it          base foundation model, gated, HAI-DEF terms
        ↓ fine-tuned (LoRA, merged)
naazimsnh02/dentalgemma-1.5-4b-it  community dental fine-tune, declares apache-2.0
        ↓ converted + quantised (llama.cpp)
naazimsnh02/dentalgemma-1.5-4b-it-GGUF   the files this lab runs
```

Three different things made by two different parties. `MODEL_PROVENANCE.md`
separates them properly and records where the license story is inconsistent.

## Required artifacts

| File | Size | Role |
| --- | --- | --- |
| `dentalgemma-4b-Q4_K_M.gguf` | 2,875,676,064 B (2.68 GiB) | the language model |
| `dentalgemma-mmproj-f16.gguf` | 851,251,232 B (0.79 GiB) | the multimodal projector |

**Both are required.** The model card is explicit, and llama.cpp's architecture
makes it structural: the projector encodes the image, the language model writes
the answer. Either one alone cannot do the task this lab exists to test.

Downloaded from the official repository at a pinned revision
(`81e65fb2a242aebadaeb78900d79aa5af1fd5ce7`) — not from `main`, so a later
force-push cannot silently change what you get. The repository is public and not
gated, so no Hugging Face token is needed.

## Quick start (Windows)

Do this in order. Every command is explained in full in `LOCAL_EXECUTION.md`.

```powershell
# 0. from: C:\Users\abdoo\dental-clinic-system\ai-validation\dentalgemma

python scripts\check_environment.py           # this machine, and what is missing
python scripts\download_artifacts.py --all    # 3.47 GiB, hash-verified
python scripts\verify_artifacts.py            # sizes, digests, GGUF headers, pairing
python scripts\verify_artifacts.py --model-dir D:\dentalgemma\model   # weights on another drive
python scripts\run_dentalgemma.py --image input\panoramic.png --dry-run
python scripts\run_dentalgemma.py --image input\panoramic.png
```

## Layout

| Path | What it is |
| --- | --- |
| `MODEL_PROVENANCE.md` | The provenance chain, artifact identities, license facts, publisher inconsistencies |
| `LOCAL_EXECUTION.md` | **Every command you must run yourself**, in order, with expected results |
| `report.schema.json` | JSON Schema for the run report, including the four allowed statuses |
| `reports/run_report.template.json` | The report template — committed with `"status": "UNKNOWN"` |
| `scripts/artifacts.py` | Single source of truth for sizes, digests, repositories |
| `scripts/sysinfo.py` | CPU / RAM / GPU / llama.cpp detection, standard library only |
| `scripts/gguf.py` | Minimal GGUF header and metadata reader (no dependencies) |
| `scripts/check_environment.py` | Read-only environment report |
| `scripts/collect_system_info.py` | Machine-readable snapshot of this machine |
| `scripts/download_artifacts.py` | Pinned-revision download, hash-verified, never destructive |
| `scripts/verify_artifacts.py` | Presence, size, SHA-256, GGUF validity, and whether the two files form a pair. `--model-dir` reads them from anywhere |
| `scripts/run_dentalgemma.py` | **The only script that runs a model** |
| `OUTPUT_DECODING.md` | The `[UNK_BYTE_0x...]` markers in the generated text: cause, evidence, and the local diagnostic |
| `input/README.md` | Acceptable test images, and the rules about patient data |
| `model/README.md` | What goes in `model/`, and why nothing there is committed |
| `tests/` | Static and unit tests that need no model, no GPU and no network |

## Dependencies

**None are required.** Every script is standard library only, deliberately: this
lab must be runnable on a machine where nothing has been installed for it, and
the model runs in llama.cpp, not in Python.

`psutil` is optional and only improves memory/CPU figures. See
`requirements.txt`.

## Design decisions worth knowing

**Success is observed, never asserted.** `scripts/run_dentalgemma.py` reports
`OPERATIONAL` only when the process exited 0 **and** a non-empty response file
exists on disk. Exit 0 with empty output is `FAILED`, because an empty answer is
not an answer. The committed template stays `UNKNOWN`.

**Nothing here invents a hash.** The expected digest comes from the publisher's
own file metadata. The local digest is always printed as `LOCAL HASH`, matching
or not.

**Nothing here deletes.** A mismatched download is kept for inspection and
reported; a file with the wrong size is never overwritten. Re-running the
downloader is a no-op when a file is already correct.

**Memory figures are sampled, not profiled.** The child process is polled (0.5 s
by default) for peak working set / `VmHWM`. That can miss a spike between
samples, and the report labels the figure with its probe and that caveat. Where no
probe works the field is `null`, never a guess.

**llama.cpp version drift is handled explicitly.** Current llama.cpp replaced the
LLaVA CLI with `libmtmd`; the multimodal tools now are `llama-mtmd-cli`,
`llama-cli` and `llama-server`. The runner prefers `llama-mtmd-cli` → `llama-cli`,
and if it finds only an obsolete binary it says so and stops instead of producing
a confusing error.

**Windows compatibility is built in, not bolted on.** No Unix-only imports
(`resource`, `fork`, `fcntl`), no hard-coded `/tmp`, no shell pipelines, UTF-8
console output enforced, and the CPU/RAM/GPU probes use `ctypes` and `winreg` on
Windows rather than shelling out to tools that may not exist.

**The child's output is drained while it runs, not after.** The sampler in
`run_dentalgemma.py` returns only once the child exits, and a child whose pipes are
full cannot exit — llama.cpp logs far more than the 64 KiB pipe buffer while
loading a 4B model. Reading stdout/stderr after sampling therefore deadlocked
against the sampler until the timeout. A reader thread now owns the pipes. This was
found by testing the failure paths, not by reading the code, and there is a
regression test for it (`tests/test_cli_contract.py::TestOutputDraining`).

**`-t 0` is not passed.** Some llama.cpp builds treat a non-positive thread count
as an error rather than "auto", so the flag is omitted entirely unless a count is
given, and llama.cpp chooses.

**The runtime's bytes are kept, and the text is never repaired.** stdout and
stderr are captured as bytes, decoded as UTF-8 explicitly, and written twice: the
readable `<stem>_response.txt` / `<stem>_llama.log`, and the untouched
`<stem>_stdout.raw` / `<stem>_stderr.raw`. If a byte is not valid UTF-8 it becomes
U+FFFD in the readable file *and the substitution is counted in the report*, so a
change made by this lab can never be mistaken for something the model produced.

**`[UNK_BYTE_0x...]` is counted, never deleted.** Those markers are written into
the text by llama.cpp's own detokenizer when it cannot map a token piece. Stripping
them would hide a real decoding defect and destroy the only evidence of it, so the
report counts them, names the codepoints, sets `output_integrity.decoding_clean`
to `false`, and prints a warning. A test asserts that no code here rewrites them.
See `OUTPUT_DECODING.md`.

**`status` is about text, not about quality.** `OPERATIONAL` means "real inference
produced non-empty text" — it has never meant "the text is correct". A run whose
output carries markers is still `OPERATIONAL`, and `output_integrity` is where
that distinction lives.

**Every blocker is reported in one pass.** Missing artifacts, a missing image and
an unusable image extension are collected before the run decisions, so the first
attempt on a machine that cannot be debugged interactively lists everything that
has to be fixed — rather than one problem per attempt, at 3.47 GiB each.

## What has been validated, and where

Run here, in the repository, with no model present and no network access:

* **112 tests, all passing** (`python -m unittest discover -s tests -v`, Python
  3.11.2). They cover the GGUF reader against synthetic containers, the report
  template's honesty, artifact identities, the CLI contract (`--help`, BLOCKED on
  missing prerequisites, `--dry-run`, the `LOCAL HASH` output, refusal of wrong
  sizes and digests, Windows-safety and CPU-only assertions), pipe draining,
  byte-exact output capture, and that every command printed in these documents
  uses flags the scripts accept.
* Every script parses under `ast.parse(..., feature_version=(3, 9))`, so the
  documented Python floor is enforced rather than asserted.
* The failure paths were executed for real: missing artifacts, missing image,
  wrong extension, an unrecognised image header, a non-GGUF file and a hollow
  container were all driven through the scripts and produced `BLOCKED` / failure
  exits with honest reports.
* The capture path is tested end to end against a **synthetic runtime** (a script
  named `llama-mtmd-cli` that emits bytes we choose): the incident text is
  reproduced byte for byte, the markers survive, the raw streams match the child's
  bytes exactly, invalid UTF-8 is counted rather than hidden, ANSI escapes are
  stripped from the readable file only, and timeout / non-zero exit / empty output
  still produce `FAILED`.

**Not validated — and not claimed:** no GGUF file was downloaded or opened, no
llama.cpp binary was run, no image was fed to the model, and no inference of any
kind was performed. Nothing here has produced text. `status` remains `UNKNOWN`
until a real run on the target machine produces non-empty output.

## Reports and outputs

| File | Contents |
| --- | --- |
| `output/<image>_response.txt` | the generated text — the artifact that proves the run |
| `output/<image>_llama.log` | raw runtime stderr, kept verbatim |
| `output/run_report.json` | machine-readable record of the latest run |
| `logs/run_<UTC>.json` | immutable copy of each run |
| `logs/environment.json` | output of `check_environment.py` |
| `reports/system_info.json` | output of `collect_system_info.py` |
| `reports/artifact_verification.json` | output of `verify_artifacts.py` |

`run_report.json` follows `report.schema.json` and carries the model identity,
both artifact sizes and digests, the runtime and its version, CPU and RAM, CUDA
presence, the input image and its digest, the **exact command line**, the
configuration, timing, peak RAM, CPU seconds, the output path, and the status. Two
additive blocks record the capture itself: `capture` (byte counts, digests of the
raw streams, how many bytes needed replacing) and `output_integrity` (marker
count, the codepoints they name, and whether the text came through untouched).

## Limitations

1. **Not run yet, by anyone.** `UNKNOWN` is the honest status.
2. **No accuracy claim.** No ground truth, no metric, no evaluation. A model
   producing text is not a model producing correct text.
3. **Gemma 3 vision in llama.cpp is officially "very experimental, only used for
   demo purpose"** (llama.cpp's own words). A partial or odd result is a
   plausible outcome of this lab, and would be reported as such.
4. **A panoramic radiograph is a 2D projection.** The model card describes
   training on dental photographs and radiographs; nothing found claims
   panoramic-specific validation. Feeding one is a reasonable smoke test, not a
   demonstration of competence on it.
5. **The dental adaptation is one person's community work**, with self-reported,
   `"verified": false` metrics on the author's own datasets. No independent
   evaluation was found.
6. **The license chain does not resolve cleanly.** The derivative declares
   Apache-2.0 while the base is under Google's HAI-DEF terms, which define both
   "Model Derivatives" and hosted distribution broadly. See
   `MODEL_PROVENANCE.md` §3. Local research validation is one thing; putting this
   behind the ERP's UI would be another, and that decision is not this lab's to
   make.
7. **Quantisation is lossy.** Q4_K_M is a 4-bit build; the publisher notes that
   aggressive quantisation can degrade reasoning and image interpretation.
8. **One image, one prompt, one machine.** A pass proves the pipeline works here,
   not that it works generally.
9. **The projector is f16.** 0.79 GiB of the download exists purely to encode the
   image.

## Clinical and research disclaimer

**Not a medical device. Not clinically validated. Not a diagnostic tool.**

This lab exists to measure whether a local runtime works, on one machine, for
research purposes. Any text it produces is unvalidated model output that may be
plausible and wrong. It must not be used for diagnosis, treatment planning, or
any decision affecting a patient, and it must not be presented to a clinician or
a patient as an assessment. The publisher's own card says the same and adds that
all AI-generated assessments must be validated by licensed dental professionals.

Any image used must be de-identified and must never be committed to this
repository.
