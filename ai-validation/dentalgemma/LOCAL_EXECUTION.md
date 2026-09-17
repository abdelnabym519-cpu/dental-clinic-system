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

Expect several minutes on the first run (the 2.68 GiB file is read from disk and
a 4B model is loaded), and well under a minute for the generation itself.

Useful knobs, all recorded in the report:

```powershell
# shorter answer, faster
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --predict 128

# keep the vision encoder on the CPU instead of the iGPU
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --no-mmproj-offload

# pin the thread count (the i9 has 20 logical cores; llama.cpp's default is fine)
python scripts\run_dentalgemma.py --image input\panoramic.png --llama-dir .\llama.cpp --threads 8
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

==============================================================================
 SUCCESS — the model produced text on this machine, on the CPU
 <n> characters written to panoramic_response.txt
==============================================================================
  status : OPERATIONAL
```

**Files produced:** `output\panoramic_response.txt`,
`output\panoramic_llama.log`, `output\run_report.json`, `logs\run_<UTC>_dentalgemma.json` `[NEW]`.

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
