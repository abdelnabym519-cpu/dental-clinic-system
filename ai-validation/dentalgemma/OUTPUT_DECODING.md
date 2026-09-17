# OUTPUT_DECODING.md — why the generated text contains `[UNK_BYTE_0x...]`

**Status of this document:** the mechanism below is established from the runtime
source and from the bytes in the reported output. What is *not* established here
is the exact value of two metadata keys in this particular GGUF file — that is a
two-second local read, and the commands are in §4. Nothing in this document has
been executed against the model in this repository; §4 is local work.

---

## 1. What was observed

An actual local run (llama.cpp `b11026`, Windows x64, CPU, Q4_K_M + mmproj f16,
exit code 0, 42.686 s, peak RSS 5.152 GiB) produced 1127 characters of text, and
the saved file contained sequences shaped like this:

```
This[UNK_BYTE_0xe29681â–is]is a dental radiograph.
```

Two separate things are wrong-looking in that line, and they have different
causes. Both are analysed below.

## 2. Root cause (a): llama.cpp's detokenizer, not this lab

`[UNK_BYTE_0x` exists in exactly one place in llama.cpp — `src/llama-vocab.cpp`,
function `llama_decode_text()`:

```cpp
static std::string llama_decode_text(const std::string & text) {
    std::string decoded_text;
    const auto cpts = unicode_cpts_from_utf8(text);
    for (const auto cpt : cpts) {
        const auto utf8 = unicode_cpt_to_utf8(cpt);
        try {
            decoded_text += unicode_utf8_to_byte(utf8);
        } catch (const std::out_of_range & /*e*/) {
            decoded_text += "[UNK_BYTE_0x";
            for (const auto c : utf8) {
                decoded_text += format("%02x", (uint8_t) c);
            }
            decoded_text += text + "]";
        }
    }
    return decoded_text;
}
```

That function is the **GPT-2 byte-level decoder**: it maps each codepoint back to
one of 256 bytes through the inverse of the byte→unicode table in
`src/unicode.cpp`. The table is built from the ranges `0x21–0x7E`, `0xA1–0xAC`,
`0xAE–0xFF` plus `256+n` for the remaining bytes. **`U+2581` (▁) is not in it**,
so the lookup throws and the `catch` writes a marker into the text.

The marker is not corruption and not a crash: it is llama.cpp reporting, in the
output stream, a codepoint it was asked to decode but cannot represent.

### Why it fired for this model

`token_to_piece()` chooses between two mutually exclusive detokenize paths, and
the choice is made **entirely from GGUF metadata** (`llama_vocab::impl::load()`):

| `tokenizer.ggml.model` | vocab type | `escape_whitespaces` | pieces decoded as |
| --- | --- | --- | --- |
| `llama` | SPM | (n/a) | SPM text, `▁` → space |
| `gemma4` | BPE | **true** | SPM text, `▁` → space (`pre` is forced to `gemma4`) |
| `gpt2`, `hybriddna`, `whitespace` | BPE | **false** | GPT-2 byte alphabet — *unless* `tokenizer.ggml.pre` is one of `gemma4`, `granite-embed-multi-311m`, `sarvam-moe`, which set it true |

And `token_to_piece()` then does:

```cpp
if (escape_whitespaces) {
    // SPM-style BPE: tokens contain ▁ for spaces
    std::string result = token_text;
    llama_unescape_whitespace(result);          // ▁ -> ' '
    return _try_copy(...);
}
std::string result = llama_decode_text(token_text);   // <-- the marker path
```

So the failure needs two things at once: **a vocabulary whose piece strings
contain `▁`**, and **metadata that selects the byte-level path**. The output
proves both:

* the codepoint in the marker is `e29681` = `E2 96 81` = **exactly `U+2581` ▁**,
  the SentencePiece space marker;
* the marker's own text carries a copy of the whole token piece (`▁is`), because
  the `catch` appends `text` before the closing bracket — which is why the piece
  then appears a second time after the `]`: `[UNK_BYTE_0xe29681▁is]` + `is`.

Neither fact can be produced by the capture layer: the string does not exist
anywhere in this lab (verified by grep over the whole repository), and the bytes
arrive already containing it.

**Conclusion (a): artifact/metadata mismatch, on the runtime's side.**
`escape_whitespaces == false` is what makes `▁` undecodable, and it is set from
`tokenizer.ggml.model` / `tokenizer.ggml.pre` — i.e. from the file, not from
anything this lab controls. The inference itself was fine: the model generated
tokens, the runtime decoded them, and the tokens it could not represent were
replaced by a truthful marker. The run's `OPERATIONAL` status is correct and its
output is not usable as-is.

**This is not a fresh regression.** `llama_decode_text()` is byte-identical in
`master` today and in `b11026` (compared via the GitHub API on 2026-09-18), so a
newer build is not expected to change this behaviour.

## 3. Root cause (b): the file was read in the wrong code page

The `â–` in the reported text is three bytes (`E2 96 81`) displayed as two
characters. That is a **Windows-1252 reading of correct UTF-8**:

* `0xE2` → `â`
* `0x96` → `–` (en dash in cp1252)
* `0x81` → *undefined in cp1252*, which is why three bytes look like two

The runner writes its files as UTF-8 with an explicit encoding, and it always
has; if the file is then read by a tool that assumes the ANSI code page
(`Get-Content` without `-Encoding UTF8` in PowerShell 5.1, `type`, a console
pasting into a cp1252 window), the *display* is mojibake while the file itself is
correct. Both layers are fixed differently, so it matters:
§2 needs the runtime/artifact fixed, §3 needs the file read as UTF-8.

## 4. What to run locally (2 minutes, no image, no projector, no 42 s run)

Everything here is read-only with respect to the weights.

### 4.1 The two metadata values (the direct answer)

```powershell
Select-String -Path .\output\panoramicxray_llama.log `
  -Pattern 'tokenizer\.ggml\.(model|pre|add_space_prefix)'
```

The loader prints every GGUF key while loading. The same two values are printed
by this lab's own verifier, straight from the file:

```powershell
python scripts\verify_artifacts.py --skip-metadata --json-out reports\artifact_verification.json
```

Look for the `tokenizer : model=... pre=...` line and the `risk=` value that
follows it: `unk-byte-markers-possible` is the prediction described in §2.

### 4.2 The decode path itself (the confirmation)

`llama-tokenize.exe` ships in the same `b11026` Windows build and decodes token
pieces through the *same* function as generation — but needs no image and no
projector:

```powershell
.\llama.cpp\llama-tokenize.exe -m .\model\dentalgemma-4b-Q4_K_M.gguf `
    -p "This is a dental radiograph" --no-bos
```

* **Pieces printed as `[UNK_BYTE_0xe29681...]`** → §2 confirmed: the byte-level
  path is being used for a vocabulary whose pieces contain `▁`.
* **Pieces printed with a leading space (`' This'`, `' a'`)** → the SentencePiece
  path was taken and `▁` was unescaped. Since §2 established that this
  vocabulary's pieces *do* contain `▁` (the marker's own hex says so), that
  combination would mean the metadata is fine and the markers came from
  somewhere else — stop and report it, because it would contradict the analysis
  here rather than confirm it.

### 4.3 The experiment that tests the diagnosis without touching the files

`--override-kv` changes metadata *in memory only*: the GGUF on disk stays
byte-identical, its hash does not change, and nothing is re-converted. If the
mismatch in §2 is the cause, forcing the pre-tokenizer that sets
`escape_whitespaces = true` removes the markers:

```powershell
# diagnostic run — same prompt, same image, same parameters, one metadata override
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp `
    --extra --override-kv tokenizer.ggml.pre=str:gemma4
```

Also run the same command **without** `--extra ...` to keep the two reports
side by side (the lab never overwrites the earlier files, so both survive).

Interpretation:

| Result | Meaning | Next step |
| --- | --- | --- |
| No markers with the override, markers without it | Diagnosis confirmed. The decoder now reads the pieces as SentencePiece text. | Report a corrected conversion to the GGUF publisher; keep using the override locally, and never describe an overridden run as the artifact's own behaviour. |
| Markers still present | The pre-tokenizer is not what drives it for this file. | Stop. Report the `llama-tokenize` output verbatim; do not add further overrides. |
| The model fails to load with the override | The override changed more than the decode path. | Stop and report the load error. |

Two honest caveats: this is a **runtime workaround, not a repair of the
artifact** — the correct fix belongs in the GGUF's metadata (or in the pieces),
and producing that conversion is explicitly out of scope for this lab. And a
pre-tokenizer also affects how the *prompt* is split, so an overridden run is a
diagnostic comparison, not a drop-in replacement for a clean artifact.

### 4.4 Reading the results correctly

```powershell
Get-Content .\output\panoramicxray_response.txt -Encoding UTF8
Get-Content .\output\panoramicxray_response.txt -Encoding UTF8 | Format-Hex | Select-Object -First 8
```

`-Encoding UTF8` is the whole difference between `▁` and `â–`. The runner now
also writes the runtime's bytes untouched as
`output\panoramicxray_stdout.raw`, so the text file and the raw stream can always
be compared.

## 5. What this lab changed, and what it deliberately did not

Changed (Phase 2 of this task, all inside `ai-validation/dentalgemma/`):

* stdout/stderr are captured as **bytes** and decoded explicitly, with every
  invalid sequence counted (offsets and bytes) instead of silently replaced;
* the runtime's bytes are preserved verbatim in `<stem>_stdout.raw` /
  `<stem>_stderr.raw`, so a decoding or display defect can never destroy the
  evidence again;
* `[UNK_BYTE_...]` markers are **counted and named** in the report
  (`output_integrity`) and printed on the console, and the report states that
  the readable text is not necessarily the model's raw output;
* the runner's own console output is UTF-8 with `errors="replace"`, so a Windows
  code page can no longer crash a finished run before the report is written;
* `verify_artifacts.py` / `gguf.py` now report the tokenizer metadata and the
  decode path it selects, with the runtime rule and its source cited.

Deliberately **not** done:

* the markers are **not** stripped or rewritten — that would hide a real
  decoding defect and destroy the only evidence of it (a test enforces this);
* no GGUF, projector or hash was modified, no re-download, no re-conversion, no
  fine-tuning, no prompt change, no inference-parameter change;
* nothing in the ERP or the application was touched;
* no claim is made that a real local inference now decodes cleanly. That is §4's
  job, on the machine that has the weights.
