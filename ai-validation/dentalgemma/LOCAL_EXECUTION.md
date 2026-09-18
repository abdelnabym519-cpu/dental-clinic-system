# LOCAL_EXECUTION.md — everything you have to run yourself

Every command below runs **on your Windows machine**. None of it has been run by
the validation work that created this lab: the model files are 3.47 GiB and are
deliberately not in the repository, so the run, the timing and the memory figures
can only come from your hardware.

Nothing here installs a Python package, and nothing here touches the ERP.

**Working directory for every command:**

```powershell
cd C:\Users\abdoo\dental-clinic-system\ai-validation\dentalgemma
```

Two conventions used below:

- `[NEW]` marks a file or folder the command creates.
- Anything marked **STOP AND REPORT** means: do not continue, send the output
  back.

---

## Step 0 — get the current lab

```powershell
cd C:\Users\abdoo\dental-clinic-system
git pull origin arena/01a0afc0-dental-clinic-system
cd ai-validation\dentalgemma
```

**Expected:** a fast-forward to the commit that added this lab. If `git pull`
reports a conflict, stop and send the output.

---

## Step 1 — what does this machine already have?

```powershell
python scripts\check_environment.py
```

**Expected:** Python 3.11.x 64-bit; the i9-13900H-class CPU string and its logical
core count; ~16 GiB total RAM and a smaller "available" figure; `NVIDIA present :
False`; an Intel adapter listed (Iris Xe); `llama.cpp available : False` at this
point; both GGUF artifacts `MISSING`.

This is read-only. It installs nothing and downloads nothing.
A JSON copy lands in `logs\environment.json` `[NEW]`.

---

## Step 2 — get llama.cpp

DentalGemma's GGUF files run in llama.cpp, not in Python. Current llama.cpp has
**no** `llama-llava-cli` — that tool was replaced by `libmtmd`; the multimodal
binaries now are `llama-mtmd-cli`, `llama-cli` and `llama-server`. The model
card's example command still uses the old name and will not work on a current
build.

### Option A (recommended) — official prebuilt Windows binary

At the time this file was written, release `b11026` (2026-09-17) shipped these
x64 builds. **Check the latest release first** — builds are published daily:

```powershell
curl.exe -s https://api.github.com/repos/ggml-org/llama.cpp/releases/latest | Select-String '"tag_name"'
```

Then download, unpack, and note where the binaries landed:

```powershell
$tag = "b11026"          # <- replace with the tag you just read
# Intel Iris Xe: Vulkan is the accelerated build for an Intel iGPU
curl.exe -L -o llama.zip "https://github.com/ggml-org/llama.cpp/releases/download/$tag/llama-$tag-bin-win-vulkan-x64.zip"
```

```powershell
# If Vulkan gives trouble, this CPU-only build always works and needs no driver:
# curl.exe -L -o llama.zip "https://github.com/ggml-org/llama.cpp/releases/download/$tag/llama-$tag-bin-win-cpu-x64.zip"
```

```powershell
Expand-Archive -Path llama.zip -DestinationPath llama.cpp -Force
Get-ChildItem llama.cpp\*.exe | Select-Object Name
```

**Expected:** a list that includes `llama-mtmd-cli.exe` (and `llama-cli.exe`,
`llama-server.exe`). If `llama-mtmd-cli.exe` is absent, the build is too old —
take the newest release.

*Other builds in the same release, if you want them later: `-sycl-x64` and
`-openvino-*-x64` also target Intel hardware; `-cuda-*` and `-rocm-*` are for
NVIDIA/AMD and are irrelevant here.*

### Option B — build it yourself

Only if you already have a C++ toolchain and want to. The official instructions
are at https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md. This is
not required.

### Confirm the lab can see it

```powershell
python scripts\check_environment.py --llama-dir .\llama.cpp
```

**Expected:** `llama.cpp available : True`, a path to `llama-mtmd-cli.exe`, and a
version line such as `version: 1 (b11026)`. If it says "obsolete tool(s) present",
the build you downloaded is an old one — replace it with the latest release.
A JSON copy lands in `logs\environment.json` `[NEW]` (overwritten).

---

## Step 3 — download the two GGUF files

3.47 GiB total. The repository is public and **not gated**, so no Hugging Face
account or token is involved.

```powershell
python scripts\download_artifacts.py --all
```

**Expected:** two progress-reporting downloads, each ending in
`OK  <filename>  <bytes>  sha256 verified`. Files land in `model\` `[NEW]`.

This is safe to re-run and safe to interrupt:

- an already-correct file is left alone (re-running is a no-op);
- a download goes to `<name>.part` and is renamed only after the SHA-256 matches
  the publisher's recorded value;
- a mismatch is reported and the partial file is **kept for inspection**, never
  renamed and never deleted.

Useful variants:

```powershell
python scripts\download_artifacts.py --urls      # print the pinned URLs, download nothing
python scripts\download_artifacts.py --check     # verify what is already on disk
python scripts\download_artifacts.py --role main # just the 2.68 GiB language model
```

If you would rather download by hand, `--urls` prints exactly which URLs and
digests to expect. Avoid PowerShell's `Invoke-WebRequest` for files this size
(the `curl` alias in Windows PowerShell 5.1 is *not* curl); use `curl.exe -L -C -`,
or `hf download naazimsnh02/dentalgemma-1.5-4b-it-GGUF --revision 81e65fb2a242aebadaeb78900d79aa5af1fd5ce7`.

---

## Step 4 — verify the artifacts, and compute their local hashes

```powershell
python scripts\verify_artifacts.py
```

**Expected, for each of the two files:** size matches the published byte count,
`sha256 : match`, a `GGUF : magic=GGUF version=3 ...` line, `architecture=gemma3`
for the language model and `architecture=clip` for the projector. Then the pairing
section: `OK` on every check, and
`RESULT: both artifacts are present, match the published size and digest, are
readable GGUF containers, and form a pair.`

Exit code is `0` when everything passes and `1` when it does not.

If you keep the weights somewhere other than `model\` — a second drive is a
reasonable choice for 3.47 GiB — point the verifier and the runner at that folder
instead of copying the files:

```powershell
python scripts\verify_artifacts.py --model-dir D:\dentalgemma\model
python scripts\run_dentalgemma.py --image input\panoramic.png `
    --main D:\dentalgemma\model\dentalgemma-4b-Q4_K_M.gguf `
    --mmproj D:\dentalgemma\model\dentalgemma-mmproj-f16.gguf `
    --llama-dir .\llama.cpp
```

`--dry-run` is worth adding to the second command the first time: it checks every
path and prints the exact argv without loading the model.

Independent cross-check with Windows' own tool, so you are not trusting one script:

```powershell
Get-FileHash .\model\dentalgemma-4b-Q4_K_M.gguf -Algorithm SHA256 | Format-List
Get-FileHash .\model\dentalgemma-mmproj-f16.gguf -Algorithm SHA256 | Format-List
```

**Expected — these exact digests:**

| File | SHA-256 |
| --- | --- |
| `dentalgemma-4b-Q4_K_M.gguf` | `311ea621a01960e2b4b908adbe8a0b5312201bd0025c92e387150acb3a321c03` |
| `dentalgemma-mmproj-f16.gguf` | `3d03262e058316c318c6dd4868c11fdccef68ec4af6d2ebea54bd1865b8c8113` |

*These are the publisher's recorded values (Hugging Face LFS `oid`), not hashes
invented here.* **If either digest differs, STOP AND REPORT** with the full output
of `verify_artifacts.py` and the `Get-FileHash` results. Do not run a model whose
files do not match.

A JSON copy lands in `reports\artifact_verification.json` `[NEW]`.

---

## Step 5 — prepare the test image

See `input\README.md` for what is acceptable. The short version: a **real
de-identified dental radiograph**, ideally the panoramic image already validated
in `..\liodon\`, copied in locally. It must never be committed.

```powershell
New-Item -ItemType Directory -Force input | Out-Null
# example: copy your de-identified panoramic radiograph in as panoramic.png
Copy-Item "C:\path\to\your\deidentified\panoramic.png" .\input\panoramic.png
Get-ChildItem .\input
```

**Expected:** your image appears in `input\`. `git status` must **not** list it —
`input/*.png` and friends are git-ignored on purpose.

---

## Step 6 — rehearse without running the model

```powershell
python scripts\run_dentalgemma.py --image input\panoramic.png --dry-run --llama-dir .\llama.cpp
```

**Expected:** the image's format and dimensions, the digest of every input, both
model files hashing to the published values, and then the **exact command line**
it would run, ending with `--dry-run: nothing was executed.` and status `UNKNOWN`.

This checks every prerequisite without loading a 4B model. If anything is wrong,
it fails here — in seconds — instead of two minutes into a real run.

---

## Step 7 — the real run

```powershell
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp
```

That single command is the whole validated path. It already includes the two
things this model needs on this machine — **CPU-only execution** and the
**tokenizer pre-tokenizer override** — and it records both in the report. The rest
of this step explains what those two are, why they are defaults, and how to turn
them off.

Expect several minutes on the first run (the 3.47 GiB of weights are read from
disk), and well under a minute for the generation itself.

### Why CPU-only is the default (`-ngl 0`, `-dev none`, `--no-mmproj-offload`)

llama.cpp does **not** default to the CPU. Its `-ngl` default is *auto* (as many
layers as fit on the GPU), and the projector goes to the first GPU backend that
answers. On this machine that is the Intel Iris Xe through the Vulkan backend, and
a run that only *looked* CPU-only died inside the vision encode:

```
ggml_vulkan: device lost on Vulkan0
mtmd_batch_encode: error
Failed to encode mtmd batch
```

with exit code `3221226505` (`0xC0000409`, the code Windows reports for an
unrecoverable process fault). The markers above come from the operator's local run
on this machine and are quoted as reported; nothing in this repository has
executed them.

So the runner pins the CPU explicitly:

| flag | what it stops |
| --- | --- |
| `-ngl 0` | any layer being offloaded to a GPU (`-ngl` defaults to *auto*) |
| `-dev none` | llama.cpp selecting a GPU device at all (`-dev none` is its own "no GPU device") |
| `--no-mmproj-offload` | the SigLIP vision encoder being placed on the iGPU |

These are the runtime's own flags, not a new mechanism: `-ngl`/`-dev` live in
llama.cpp's `common/arg.cpp`, `--no-mmproj-offload` sets `mmproj_use_gpu = false`
in `tools/mtmd/mtmd-cli.cpp`. The runner adds nothing to the runtime.

**The report says which mode ran, and what the runtime itself reported**:

```powershell
Get-Content .\output\run_report.json | Select-String "cpu_only" -Context 2,2
```

* `execution.cpu_only` — `true` when the run was pinned to the CPU.
* `execution.gpu_requested_by` — the exact flags that asked for a GPU, if any.
* `execution.device_evidence` — what the runtime's own log said: the projector's
  backend (`CLIP using CPU backend`), the layer count (`offloaded 0/35 layers to
  GPU`), and a verdict of `cpu-only-confirmed-by-log`, `gpu-work-observed` or
  `not-stated-in-log`. A GPU observed while CPU-only was requested is a warning in
  the report, not a silent success. (Vulkan lines in the log are *not* evidence of
  use: the backend DLL is loaded and its devices enumerated at startup either way.)

`--cpu-only` is on by default; `--no-cpu-only` is the switch that turns the whole
policy off and lets the runtime choose.

One fallback, in case you are on a much older llama.cpp build that does not know
`-dev none`: the runner notices that error and says so in the report, and the
equivalent CPU-only command is

```powershell
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp `
    --no-cpu-only --ngl 0 --no-mmproj-offload
```

which pins the same two things (`-ngl 0` keeps every layer on the CPU,
`--no-mmproj-offload` keeps the projector there) without `-dev none`. Updating to
the current release is the better fix; the build this lab documents is `b11026`.

**Asking for a GPU is possible, and it is recorded.** Any of these leaves CPU-only
mode, and the report states which flag did it:

```powershell
# let llama.cpp put as many layers as fit on the Vulkan device
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --ngl auto

# or name the device and let the projector follow it
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --device Vulkan0

# or do not pin anything at all and take the runtime's defaults
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --no-cpu-only
```

On this machine those are the runs that fail. `--ngl auto` and `--ngl 0` also
switch CPU-only mode off/keep it on respectively; `--device none` means the same
thing as staying CPU-only.

### Why the tokenizer override is the default

The pinned GGUF's own metadata sends llama.cpp down its GPT-2 byte-level
detokenizer, which cannot represent `▁` and writes `[UNK_BYTE_0xe29681...]` into
the text. The runner therefore passes, in memory only:

```
--override-kv tokenizer.ggml.pre=str:gemma4
```

That is the value confirmed on this machine. It is a **runtime workaround, not a
repair** — the real fix belongs in the GGUF's metadata, which this lab must not
touch — and the file on disk is only ever read: its SHA-256 is recorded before the
run, and no code path here writes to it. The full reasoning is in
`OUTPUT_DECODING.md`; the runner also *reads* the file's `tokenizer.ggml.model` /
`tokenizer.ggml.pre` and prints them next to the override, so you can see whether
the file agrees with the workaround (`execution.override_matches_metadata`).

```powershell
# use a different pre-tokenizer value
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --tokenizer-pre llama3

# do not pass any override (expect the markers back on this artifact)
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --no-tokenizer-pre-override
```

### Other useful knobs, all recorded in the report

```powershell
# shorter answer, faster
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --predict 128

# pin the thread count (the i9 has 20 logical cores; llama.cpp's default is fine)
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --threads 8

# the same command, checked without running anything: prints the exact argv
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --dry-run
```

**Expected on success:**

```
  runtime     : llama-mtmd-cli.exe  (version ...)
  ...
  exit code   : 0
  duration    : <seconds> s
  peak RAM    : <GiB>  (Windows GetProcessMemoryInfo)
  generated text (<n> chars):
  ------------------------------------------------------------------------
  <the model's answer>
  ------------------------------------------------------------------------

  device use  : CPU-only, confirmed by the runtime's own log
                projector backend : CPU
                layers to GPU     : 0/35

==============================================================================
 SUCCESS — the model produced text on this machine, on the CPU
 <n> characters written to panoramic_response.txt
 Functional inference only: no accuracy was measured and this is not a
 validated diagnosis. See validation_scope in the report.
==============================================================================
  status : OPERATIONAL
```

The last two lines are not decoration: success here means *text was produced*, not
that the text is correct. `validation_scope.clinical_validation` is `false` in
every report, and no run of this lab may be read as a diagnosis.

**Files produced:** `output\panoramic_response.txt`,
`output\panoramic_llama.log`, `output\panoramic_stdout.raw`,
`output\panoramic_stderr.raw`, `output\run_report.json`,
`logs\run_<UTC>_dentalgemma.json` `[NEW]`.

Exit code `0` means success. `3` means a prerequisite is missing (status
`BLOCKED`), `4` means an artifact or the image is unusable, `6` means the model
ran and failed or produced no text (status `FAILED`).

---

## Step 8 — collect the machine record and the report

```powershell
python scripts\collect_system_info.py --llama-dir .\llama.cpp
Get-Content .\output\run_report.json | Select-Object -First 40
```

**Expected:** `reports\system_info.json` `[NEW]` with the CPU model, RAM, disk
free space, GPU detection and the llama.cpp version; then the run report, whose
`status` field must read `OPERATIONAL` and whose `inference_success` must be
`true` — and both only if `output\panoramic_response.txt` actually contains text.

### The fields to record from that report

These are the ten values that describe the run, and they are all in
`output\run_report.json` (the same JSON is copied to `logs\`):

| field in `run_report.json` | what it is |
| --- | --- |
| `exit_code` | the runtime's exit code (`0` is required for success) |
| `inference_seconds` | wall-clock seconds for the inference |
| `peak_ram_gb` / `peak_rss_bytes` | sampled peak memory (`memory_probe` names the probe) |
| `cpu_seconds` | CPU time the child used |
| `command` | the exact argv, verbatim |
| `main_sha256`, `mmproj_sha256` | the two artifact digests as hashed on this machine |
| `output_path` | the file the text was written to |
| `execution.workarounds` | the CPU-only pins and the tokenizer override this run used |
| `execution.device_evidence` | what the runtime's log said about the device |
| `status` | `OPERATIONAL`, `FAILED`, `BLOCKED` or `UNKNOWN` |

```powershell
$r = Get-Content .\output\run_report.json -Raw | ConvertFrom-Json
$r | Select-Object status, exit_code, inference_seconds, peak_ram_gb, cpu_seconds
$r.main_sha256
$r.mmproj_sha256
$r.output_path
$r.execution.workarounds
$r.execution.device_evidence.verdict
$r.validation_scope
```

---

## Step 8b — if the text contains `[UNK_BYTE_0x...]`, read this first

Those markers are written by llama.cpp's detokenizer, before this lab sees a
single byte; the inference itself succeeded. The full analysis, the proof, and the
one-command overrides that test the cause are in **`OUTPUT_DECODING.md`**.

Three local checks, in increasing cost — the first two need no image, no
projector and no 42-second run:

```powershell
# 1. what the file actually declares (read from the GGUF header, no model load)
python scripts\verify_artifacts.py --skip-metadata --json-out reports\artifact_verification.json

# 2. the same decoding path the generation used, without generating anything
.\llama.cpp\llama-tokenize.exe -m .\model\dentalgemma-4b-Q4_K_M.gguf `
    -p "This is a dental radiograph" --no-bos

# 3. read the saved text as UTF-8 — "â–" instead of "▁" is a code-page problem,
#    not a decoding one
Get-Content .\output\panoramicxray_response.txt -Encoding UTF8
```

**Expected:** step 1 prints a `tokenizer : model=... pre=...` line and a `risk=`
value — `unk-byte-markers-possible` is the condition described in
`OUTPUT_DECODING.md`. Step 2 shows the pieces the runtime derives; if they read
`[UNK_BYTE_0xe29681...]`, the decode-path mismatch is confirmed and the fix belongs
in the GGUF's metadata, not in this lab.

---

## Step 9 — record the test suite result (optional, fast)

```powershell
python -m unittest discover -s tests -v
```

**Expected:** `OK`, with the count of tests run. These tests need no model, no
GPU and no network.

---

## STOP conditions — do not continue, send the output

| Situation | What to send |
| --- | --- |
| `verify_artifacts.py` reports a size or SHA-256 mismatch | the full output **and** the two `Get-FileHash` results |
| `verify_artifacts.py` reports `not a valid GGUF container` | the full output |
| the pairing section prints `FAIL` | the full output |
| any step exits with code `3` or `4` | the full command and its complete output |
| the run reports `FAILED` with `no text was produced on stdout` | the last 30 lines of `output\panoramic_llama.log` |
| the run is killed after the timeout | the timeout value used, plus the log tail |
| Windows runs out of memory | the `peak RAM` line from the report and the failure text |
| anything asks you to disable a safety check or to trust an unverified hash | stop and report; no step here requires that |

## What a successful run does **not** prove

It does not prove the model is accurate, safe, or suitable for patients. It proves
one thing: that the real published weights ran on this machine, on the CPU, and
produced text — with the runtime and memory cost recorded next to them. Accuracy
is a separate question that this lab does not attempt and cannot answer.

It also does not prove that the model is "operational" on its own. The run
described in Step 7 depends on two documented workarounds — CPU-only execution and
the `tokenizer.ggml.pre` override — so the honest classification is **operational
with workarounds**, on this machine, on the CPU. A run that had to be forced onto
the CPU is not evidence that the model works on the GPU; likewise a run whose text
had to be decoded through a different pre-tokenizer is not evidence that the GGUF's
own metadata is correct. Both facts are in the report, and neither may be dropped
when the result is quoted.
