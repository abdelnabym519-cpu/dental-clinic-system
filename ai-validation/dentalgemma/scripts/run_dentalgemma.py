#!/usr/bin/env python3
"""
run_dentalgemma.py — run a REAL multimodal local inference, and record what
actually happened.

This is the only script here that executes a model. It does not implement the
model: it drives llama.cpp, the native runtime the model's publisher documents,
with the two GGUF files they publish.

What it does, in order:

  1. resolves a usable llama.cpp multimodal binary (llama-mtmd-cli, then
     llama-cli) and refuses to pretend an obsolete tool will do;
  2. checks the language model, the projector and the image, and hashes them;
  3. builds the exact command line and shows it before running it;
  4. runs it, draining stdout/stderr on a reader thread while sampling the child
     process for peak memory and CPU time (both have to happen at once: a child
     whose pipes are full cannot exit, so a sampler that waits for exit before
     anything reads the pipes waits forever);
  5. saves the generated text, the raw logs, the exact command and configuration,
     and a JSON report.

Success is never asserted. It is *observed*: the run is reported as OPERATIONAL
only when the process exited 0 **and** a non-empty text output file exists. If
the process exits 0 but produced no text, or the output is empty after stripping
ANSI colour codes, the run is FAILED — because an empty answer is not an answer.

Memory and CPU figures are sampled (every 0.5 s by default) rather than measured
by a profiler, and are labelled that way in the report: a short spike between
samples can be missed. Where no probe works the field is null, never a guess.

Capture is byte-exact on purpose. The child's stdout and stderr are read as
bytes, decoded as UTF-8 explicitly, and *both* forms are kept: the readable
`<stem>_response.txt` / `<stem>_llama.log`, and the untouched
`<stem>_stdout.raw` / `<stem>_stderr.raw`. Nothing that comes out of the runtime
is repaired, deleted or rewritten — including the `[UNK_BYTE_0x...]` markers
llama.cpp writes into the text when its detokenizer cannot map a piece (see
OUTPUT_DECODING.md). They are counted in the report and named on screen instead.
A byte that is not valid UTF-8 becomes U+FFFD in the readable file, and the
count is reported, so a substitution made here can never be mistaken for
something the model produced.

This path is CPU-only, and the two workarounds it needs are switches rather than
folklore:

  * **CPU-only is the default.** The validated execution mode for this lab is the
    CPU, so the command pins it explicitly: `-ngl 0` (no layers offloaded),
    `-dev none` (no GPU device is selected at all) and `--no-mmproj-offload`
    (the projector stays on the CPU). llama.cpp's own default for `-ngl` is
    *auto*, which is how a run that believed it was CPU-only ends up submitting
    vision-encoder work to a Vulkan device — on this machine's Intel iGPU that
    failed with `ggml_vulkan: device lost` and killed the process. A GPU request
    (`--ngl`, `--device`, `--mmproj-offload`) is still possible, and it is
    recorded rather than silently honoured. See LOCAL_EXECUTION.md.
  * **One decoding override is applied by default.** This GGUF's own tokenizer
    metadata selects llama.cpp's GPT-2 byte-level detokenizer, which cannot
    represent ▁ (U+2581) and writes `[UNK_BYTE_0x...]` into the text. The
    override `--override-kv tokenizer.ggml.pre=str:gemma4` selects the SPM-style
    path instead. It is an in-memory runtime setting: the file on disk is never
    written to, and its digest is recorded before the run. It is recorded as a
    workaround, never as a repair (OUTPUT_DECODING.md).

Both are *recorded*, not assumed: the report carries `execution` (what was
requested) next to `execution.device_evidence` (what the runtime's own log says
it did), and a GPU observed while CPU-only was requested is a warning, not a
silent success. The report also carries `validation_scope`, which states the one
thing this script must never imply: that the generated text is a validated
diagnosis.

Usage:
    python scripts/run_dentalgemma.py --image input\\panoramic.png
    python scripts/run_dentalgemma.py --image input\\panoramic.png --dry-run
    python scripts/run_dentalgemma.py --image input\\panoramic.png \\
        --llama-bin C:\\tools\\llama\\llama-mtmd-cli.exe --ctx 4096 --predict 256

Exit codes:
    0  inference completed and produced non-empty text   (status OPERATIONAL)
    2  usage error                       (argparse)
    3  a prerequisite is missing                         (status BLOCKED)
    4  an artifact or the image is unusable              (status BLOCKED)
    6  the model ran and failed, or produced no text     (status FAILED)
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
import re
import struct
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
MODEL_DIR = LAB / "model"

DEFAULT_PROMPT = (
    "You are a dental radiology assistant. Describe what you observe in this "
    "dental radiograph, in one short paragraph. Mention the image type, the "
    "anatomy visible, and any obvious abnormality. Do not claim a diagnosis."
)

# The tokenizer pre-tokenizer override applied by default, as an in-memory
# `--override-kv tokenizer.ggml.pre=str:<value>` (see OUTPUT_DECODING.md §4):
#
#   * the pinned DentalGemma GGUF declares a tokenizer model that puts llama.cpp
#     on its GPT-2 byte-level detokenize path (`escape_whitespaces = false`), and
#     that path cannot represent ▁ (U+2581) — it writes `[UNK_BYTE_0xe29681...]`
#     into the generated text;
#   * `gemma4` is one of the pre-tokenizers that set `escape_whitespaces = true`,
#     which is the SPM-style path that handles ▁ correctly — and the vocabulary
#     is Gemma-family, so it is also the right pre-tokenizer by name;
#   * it was confirmed on the operator's machine, and it is applied as a switch
#     rather than as a guess: `--tokenizer-pre <value>` changes it,
#     `--no-tokenizer-pre-override` removes it, and the report always records
#     which of the two happened.
DEFAULT_TOKENIZER_PRE = "gemma4"

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")

# llama.cpp writes this marker into the *text* when its detokenizer cannot map a
# token piece back to bytes: "[UNK_BYTE_0x" + the UTF-8 bytes as hex + the whole
# token text + "]". It is the runtime's own diagnostic, produced before this
# process sees a single byte, so nothing here may remove it — this lab counts and
# names it instead. The mechanism is documented in OUTPUT_DECODING.md.
UNK_BYTE_RE = re.compile(r"\[UNK_BYTE_0x([0-9a-fA-F]{2,16})")

# The hex run after "0x" is the UTF-8 encoding of one codepoint, and the token
# text that follows can itself begin with hex digits — so the run is ambiguous by
# construction ("[UNK_BYTE_0xe29681abc" could be 0xe2 0x96 0x81 or 0xe2 0x96 0x81
# followed by "abc"). It is resolved the way UTF-8 itself is: the first byte
# determines how many bytes follow. That is exact for every well-formed marker
# and needs no guessing.
def _utf8_length_from_lead_byte(byte: int) -> int | None:
    """How many bytes a UTF-8 sequence starting with this byte has."""
    if byte < 0x80:
        return 1
    if 0xC2 <= byte <= 0xDF:
        return 2
    if 0xE0 <= byte <= 0xEF:
        return 3
    if 0xF0 <= byte <= 0xF4:
        return 4
    return None                     # a continuation byte, or not a valid lead


def _decode_counting_invalid(data: bytes) -> tuple[str, list[dict]]:
    """Decode UTF-8, replacing invalid sequences and recording each one.

    A byte-level vocabulary can emit bytes that are not valid UTF-8 on their own,
    so replacement is necessary; what must never happen is that a substitution
    made *here* becomes indistinguishable from text the model produced. Each
    invalid sequence is therefore reported with its byte offset and its bytes.

    This walks the buffer instead of registering a `codecs` error handler on
    purpose: that registry is process-global and the last registration for a name
    wins, so importing this module twice in one process (which the test suite
    does) leaves earlier instances writing into a stale audit object. The first
    version of this function did exactly that, and only the suite caught it.
    """
    sequences: list[dict] = []
    parts: list[str] = []
    position = 0
    while position < len(data):
        try:
            parts.append(data[position:].decode("utf-8"))
            break
        except UnicodeDecodeError as exc:
            if exc.start:
                parts.append(data[position:position + exc.start].decode("utf-8"))
            start, end = position + exc.start, position + exc.end
            sequences.append({
                "start": start,
                "end": end,
                "bytes": data[start:end].hex(),
                "reason": exc.reason,
            })
            parts.append("\ufffd")
            position = end
    return "".join(parts), sequences


def decode_stream(raw: bytes | None, label: str) -> dict:
    """Decode one captured stream as UTF-8, accounting for every substitution."""
    data = raw or b""
    text, sequences = _decode_counting_invalid(data)
    return {
        "label": label,
        "encoding": "utf-8",
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "decode_replacements": len(sequences),
        "invalid_sequences": sequences,
        "text": text,
    }


def audit_unk_bytes(text: str) -> dict:
    """Count llama.cpp's [UNK_BYTE_0x...] markers without touching them.

    Returns counts and the codepoints they name. The text itself is never
    modified: an earlier draft of this idea was a `str.replace` that deleted the
    markers, which would have hidden a real decoding defect and destroyed the
    only evidence of it.
    """
    codes: list[str] = []
    codepoints: list[str] = []
    unresolved: list[str] = []
    count = 0

    for match in UNK_BYTE_RE.finditer(text):
        count += 1
        hex_run = match.group(1).lower()
        lead = int(hex_run[:2], 16)
        size = _utf8_length_from_lead_byte(lead)
        needed = 2 * size if size else None

        if not needed or len(hex_run) < needed:
            # Not enough hex to be the codepoint the lead byte promises: report
            # the first byte and say it could not be resolved.
            if hex_run[:2] not in unresolved:
                unresolved.append(hex_run[:2])
            continue

        candidate = hex_run[:needed]
        try:
            decoded = bytes.fromhex(candidate).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            if hex_run[:2] not in unresolved:
                unresolved.append(hex_run[:2])
            continue
        if len(decoded) != 1:
            if hex_run[:2] not in unresolved:
                unresolved.append(hex_run[:2])
            continue
        if candidate not in codes:
            codes.append(candidate)
        label = f"U+{ord(decoded):04X}"
        if label not in codepoints:
            codepoints.append(label)

    return {
        "count": count,
        # ordered by the marker's first byte, then by length: deterministic and
        # readable in a report
        "codes": sorted(codes, key=lambda c: (int(c[:2], 16), len(c), c)),
        "codepoints": sorted(codepoints, key=lambda c: int(c[2:], 16)),
        "unresolved_codes": sorted(unresolved, key=lambda c: int(c, 16)),
        "markers_preserved": True,
        "explanation": (
            "llama.cpp's detokenizer substitutes these markers; they are its own "
            "diagnostic, not text from the model and not something this lab "
            "produced. See OUTPUT_DECODING.md."
        ) if count else None,
    }


def force_utf8_console() -> None:
    """Make this script's own output survive a Windows code page.

    On Windows, printing text that the active code page cannot represent raises
    UnicodeEncodeError when stdout is redirected — which would crash the runner
    *after* a successful inference and before the report is finalised. The files
    are written explicitly as UTF-8 either way; this only protects the console
    copy. Guarded, because `reconfigure` does not exist on a replaced stream.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _load(name: str, filename: str):
    path = Path(__file__).resolve().parent / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


artifacts = _load("dg_artifacts", "artifacts.py")


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


# --------------------------------------------------------------------------
# image probing — dimensions without any imaging dependency
# --------------------------------------------------------------------------
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff", ".webp"}


def probe_image(path: Path) -> dict:
    """Identify the image format and, where possible, its dimensions.

    A plain header read — no decoder, no dependency. A JPEG's dimensions are
    found by walking its marker segments, which is why this is a few lines
    longer than the others.
    """
    info: dict = {"path": str(path), "suffix": path.suffix.lower(),
                  "format": None, "width": None, "height": None, "mode": None}
    try:
        with open(path, "rb") as fh:
            head = fh.read(32)
            if head.startswith(b"\x89PNG\r\n\x1a\n"):
                info["format"] = "png"
                width, height = struct.unpack(">II", head[16:24])
                info.update({"width": width, "height": height})
                color_type = head[25] if len(head) > 25 else None
                info["mode"] = {0: "grayscale", 2: "rgb", 3: "palette",
                                4: "grayscale+alpha", 6: "rgba"}.get(color_type)
            elif head.startswith(b"\xff\xd8"):
                info["format"] = "jpeg"
                fh.seek(2)
                while True:
                    marker = fh.read(2)
                    if len(marker) < 2 or marker[0] != 0xFF:
                        break
                    marker_type = marker[1]
                    if marker_type in (0xD8, 0xD9) or 0xD0 <= marker_type <= 0xD7:
                        continue
                    length_bytes = fh.read(2)
                    if len(length_bytes) < 2:
                        break
                    length = struct.unpack(">H", length_bytes)[0]
                    if marker_type in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6,
                                       0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        segment = fh.read(length - 2)
                        if len(segment) >= 6:
                            info["mode"] = {1: "grayscale", 2: "rgb", 3: "palette",
                                            4: "cmyk"}.get(segment[0])
                            info["height"], info["width"] = struct.unpack(">HH", segment[1:5])
                        break
                    fh.seek(length - 2, 1)
            elif head.startswith(b"BM"):
                info["format"] = "bmp"
                if len(head) >= 26:
                    info["width"], info["height"] = struct.unpack("<ii", head[18:26])
                    info["height"] = abs(info["height"])
            elif head[:6] in (b"GIF87a", b"GIF89a"):
                info["format"] = "gif"
                info["width"], info["height"] = struct.unpack("<HH", head[6:10])
            elif head[:4] in (b"II*\x00", b"MM\x00*"):
                info["format"] = "tiff"
            elif head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                info["format"] = "webp"
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


# --------------------------------------------------------------------------
# child-process sampling (no dependency; psutil used only if present)
# --------------------------------------------------------------------------
class PROCESSCPU(ctypes.Structure):
    _fields_ = [("dwLowDateTime", ctypes.c_uint32),
                ("dwHighDateTime", ctypes.c_uint32)]


def _child_memory_windows(pid: int) -> int | None:
    """Peak working set of a live process, in bytes."""
    try:
        class _Counters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_uint32),
                ("PageFaultCount", ctypes.c_uint32),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        get_info = getattr(psapi, "GetProcessMemoryInfo", None) \
            or kernel32.GetProcessMemoryInfo
        get_info.restype = ctypes.c_int
        get_info.argtypes = [ctypes.c_void_p, ctypes.POINTER(_Counters), ctypes.c_uint32]

        # PROCESS_QUERY_LIMITED_INFORMATION (0x1000) is enough to read counters
        # and is the least privilege that works.
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return None
        try:
            counters = _Counters()
            counters.cb = ctypes.sizeof(_Counters)
            if not get_info(handle, ctypes.byref(counters), counters.cb):
                return None
            return int(counters.PeakWorkingSetSize) or None
        finally:
            kernel32.CloseHandle(ctypes.c_void_p(handle))
    except Exception:
        return None


def _child_memory_posix(pid: int) -> int | None:
    """Peak resident set from VmHWM — the kernel's own high-water mark."""
    try:
        with open(f"/proc/{pid}/status", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("VmHWM:"):
                    return int(line.split()[1]) * 1024
    except Exception:
        return None
    return None


def _child_cpu_posix(pid: int) -> float | None:
    """Cumulative CPU seconds (user + system) for the child."""
    try:
        with open(f"/proc/{pid}/stat", encoding="ascii") as fh:
            fields = fh.read().rsplit(")", 1)[1].split()
        ticks = os.sysconf("SC_CLK_TCK")
        # after the comm field: state, ppid, ... utime is field 14, stime 15
        return (int(fields[11]) + int(fields[12])) / ticks
    except Exception:
        return None


def _child_cpu_windows(pid: int) -> float | None:
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        kernel32.GetProcessTimes.argtypes = [ctypes.c_void_p,
                                             ctypes.POINTER(PROCESSCPU),
                                             ctypes.POINTER(PROCESSCPU),
                                             ctypes.POINTER(PROCESSCPU),
                                             ctypes.POINTER(PROCESSCPU)]
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return None
        try:
            creation, exit_, kernel, user = (PROCESSCPU(), PROCESSCPU(),
                                             PROCESSCPU(), PROCESSCPU())
            if not kernel32.GetProcessTimes(handle, ctypes.byref(creation),
                                            ctypes.byref(exit_), ctypes.byref(kernel),
                                            ctypes.byref(user)):
                return None

            def to_seconds(counter) -> float:
                ticks = (counter.dwHighDateTime << 32) | counter.dwLowDateTime
                return ticks / 1e7          # 100 ns units

            return to_seconds(kernel) + to_seconds(user)
        finally:
            kernel32.CloseHandle(ctypes.c_void_p(handle))
    except Exception:
        return None


def _psutil_child(pid: int):
    try:
        import psutil
        return psutil.Process(pid)
    except Exception:
        return None


def monitor(proc: subprocess.Popen, interval: float) -> dict:
    """Sample a running child until it exits. Returns what was observed."""
    observed = {"peak_rss_bytes": 0, "cpu_seconds": None, "samples": 0,
                "probe": None, "note": None}
    ps = _psutil_child(proc.pid)

    while True:
        pid = proc.pid
        peak = None
        cpu = None
        if ps is not None:
            try:
                info = ps.memory_info()
                peak = int(getattr(info, "peak_wset", 0) or info.rss)
                times = ps.cpu_times()
                cpu = float(times.user + times.system)
                observed["probe"] = "psutil"
            except Exception:
                ps = None
        if peak is None:
            if os.name == "nt":
                peak = _child_memory_windows(pid)
                cpu = _child_cpu_windows(pid)
                if peak is not None:
                    observed["probe"] = "Windows GetProcessMemoryInfo"
            else:
                peak = _child_memory_posix(pid)
                cpu = _child_cpu_posix(pid)
                if peak is not None:
                    observed["probe"] = "/proc/<pid>/status (VmHWM)"
        if peak:
            observed["peak_rss_bytes"] = max(observed["peak_rss_bytes"], int(peak))
            observed["samples"] += 1
        if cpu is not None:
            observed["cpu_seconds"] = float(cpu)

        if proc.poll() is not None:
            break
        time.sleep(interval)

    if not observed["peak_rss_bytes"]:
        observed["note"] = ("no memory probe worked for this platform; peak memory "
                            "is reported as null rather than estimated")
    else:
        observed["note"] = (f"sampled every {interval:.2f}s; a spike between samples "
                            f"can be missed ({observed['samples']} samples)")
    return observed


# --------------------------------------------------------------------------
def read_child_async(proc: subprocess.Popen, timeout: float, box: dict) -> None:
    """Drain the child's pipes on a background thread, into ``box``.

    This has to be a thread, and the reason is a defect this lab already hit: the
    sampler in :func:`monitor` only returns once the child exits, but a child whose
    stdout/stderr pipes are full will not exit until somebody reads them. llama.cpp
    logs far more than the 64 KiB pipe buffer while loading a 4B model, so reading
    the pipes *after* sampling deadlocks — the run would sit there until the
    timeout, then be killed, and report FAILED with an empty log. Draining
    concurrently is what makes the sampler and the output reader independent.
    """
    try:
        box["stdout"], box["stderr"] = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        box["timed_out"] = True
        proc.kill()
        try:
            box["stdout"], box["stderr"] = proc.communicate(timeout=60)
        except Exception:
            box.setdefault("stdout", b"")
            box.setdefault("stderr", b"")
    except Exception as exc:                                    # pragma: no cover
        box["error"] = f"{type(exc).__name__}: {exc}"
        box.setdefault("stdout", b"")
        box.setdefault("stderr", b"")


def resolve_execution_policy(args) -> dict:
    """Decide, once, how the runtime will be invoked — and record the decision.

    The lab's validated execution mode is the CPU, so the default pins it instead
    of trusting llama.cpp's defaults (`-ngl auto`, projector on the first GPU
    backend it finds — which on this machine's Intel iGPU is the Vulkan device
    that lost the device during the vision encode and killed the process).

    An explicit GPU request always wins over the default, and is *recorded*: it is
    never silently ignored, and never silently granted either. `build_command`
    and the report both read this same dict, so the command that ran and the
    record of what was requested cannot drift apart.

    Defined as a pure function of the parsed arguments so that it can be tested
    without a model, and so that every branch is visible in one place.
    """
    cpu_only = bool(getattr(args, "cpu_only", True))
    ngl = getattr(args, "ngl", None)
    device = getattr(args, "device", None)
    requested_mmproj_offload = getattr(args, "mmproj_offload", None)   # None = follow the policy
    tokenizer_pre = getattr(args, "tokenizer_pre", DEFAULT_TOKENIZER_PRE)
    if tokenizer_pre is None:                       # defensive: the flag has a default
        tokenizer_pre = DEFAULT_TOKENIZER_PRE

    gpu_requested_by: list[str] = []
    if ngl is not None and ngl != 0:
        gpu_requested_by.append(f"--ngl {ngl}")
    if device and device.strip() and device.strip().lower() != "none":
        gpu_requested_by.append(f"--device {device}")
    if requested_mmproj_offload:
        gpu_requested_by.append("--mmproj-offload")

    if gpu_requested_by and cpu_only:
        cpu_only = False
        reason = ("CPU-only mode was switched off because the command line asked for "
                  "GPU work (" + ", ".join(gpu_requested_by) + "); this run is not the "
                  "validated CPU path and may hit the Vulkan failure again")
    elif cpu_only:
        reason = "CPU-first default for this validation lab; no GPU flag was given"
    else:
        reason = ("CPU-only mode was disabled with --no-cpu-only: no layer count, no "
                  "device and no projector placement is pinned, so the runtime's own "
                  "defaults apply (on this machine that means the Vulkan device)")

    if cpu_only:
        effective_ngl = 0
        effective_device = "none"
    else:
        effective_ngl = ngl                       # None: leave the flag out entirely
        effective_device = device

    if requested_mmproj_offload is None:
        mmproj_offload = not cpu_only
        mmproj_offload_source = ("CPU-only policy" if cpu_only
                                 else "the runtime's own default (no flag passed)")
    else:
        mmproj_offload = bool(requested_mmproj_offload)
        mmproj_offload_source = "--mmproj-offload / --no-mmproj-offload"

    workarounds: list[str] = []
    if cpu_only:
        workarounds.append("CPU-only execution (-ngl 0, -dev none, --no-mmproj-offload): "
                           "no GPU layer is offloaded and no GPU device is selected")
    if tokenizer_pre:
        workarounds.append(f"tokenizer pre-tokenizer override in memory "
                           f"(--override-kv tokenizer.ggml.pre=str:{tokenizer_pre}): "
                           f"the GGUF on disk is not modified")

    notes: list[str] = []
    extra_flags = list(getattr(args, "extra", None) or [])
    if any("tokenizer.ggml.pre" in str(part) for part in extra_flags):
        # llama.cpp keeps overrides in an unordered_map and inserts without
        # overwriting, so the *first* occurrence of a key wins — which is this
        # lab's, because --extra is appended last. Say so rather than let the
        # passthrough look like it changed something.
        notes.append(
            "the passthrough --extra also carries a tokenizer.ggml.pre override; the "
            "runtime keeps overrides in a map and the first occurrence wins, so the "
            "lab's own value (if enabled) is the one that takes effect — use "
            "--tokenizer-pre to change it, or --no-tokenizer-pre-override to drop it")

    return {
        "cpu_only": cpu_only,
        "reason": reason,
        "gpu_requested_by": gpu_requested_by,
        "ngl": effective_ngl,
        "device": effective_device,
        "mmproj_offload": mmproj_offload,
        "mmproj_offload_source": mmproj_offload_source,
        "tokenizer_pre_override": tokenizer_pre or None,
        "tokenizer_pre_override_source": (
            "--tokenizer-pre (the documented default for the pinned DentalGemma GGUF)"
            if tokenizer_pre else
            "disabled by --no-tokenizer-pre-override; the runtime's own metadata applies"),
        "workarounds": workarounds,
        # Filled in later: metadata is read from the file, evidence from the run.
        "tokenizer_metadata": None,
        "override_matches_metadata": None,
        "device_evidence": None,
        "notes": notes,
    }


def build_command(binary: Path, main: Path, mmproj: Path, image: Path,
                  args, policy: dict | None = None) -> list[str]:
    """The exact argv this run will use, in the order llama.cpp documents."""
    policy = policy if policy is not None else resolve_execution_policy(args)
    cmd = [
        str(binary),
        "-m", str(main),
        "--mmproj", str(mmproj),
        "--image", str(image),
        "-p", args.prompt,
        "-c", str(args.ctx),
        "-n", str(args.predict),
        "--temp", str(args.temp),
        "--seed", str(args.seed),
    ]
    # `-t 0` is not "auto" on every build — some treat a non-positive thread count
    # as an error. Omit the flag entirely and let llama.cpp choose.
    if args.threads:
        cmd += ["-t", str(args.threads)]
    if policy["ngl"] is not None:
        cmd += ["-ngl", str(policy["ngl"])]
    if policy["device"]:
        cmd += ["-dev", str(policy["device"])]
    if not policy["mmproj_offload"]:
        cmd += ["--no-mmproj-offload"]
    elif getattr(args, "mmproj_offload", None):
        # the runtime default already offloads the projector; say it explicitly
        # when it was asked for, so the recorded command states the intent
        cmd += ["--mmproj-offload"]
    if policy["tokenizer_pre_override"]:
        cmd += ["--override-kv",
                f"tokenizer.ggml.pre=str:{policy['tokenizer_pre_override']}"]
    if args.extra:
        cmd += list(args.extra)
    return cmd


# --------------------------------------------------------------------------
# what the runtime's own log says about where the work ran
# --------------------------------------------------------------------------
# Read from llama.cpp b11026, so the patterns are the runtime's own wording:
#
#   src/llama.cpp          "using device %s (%s) ..." — one line per device the
#                          model was told to use; absent when it uses none
#   src/llama-model.cpp    "offloading %d repeating layers to GPU" and
#                          "offloaded %d/%d layers to GPU" — printed by a build
#                          with GPU support even when the answer is 0
#   tools/mtmd/clip.cpp    "CLIP using %s backend" / "CLIP using CPU backend" —
#                          which backend holds the projector
#
# Deliberately *not* a usage signal: the loader enumerates backend DLLs at
# startup (ggml_backend_load_all), so "ggml_vulkan:" lines appear in the log of
# a run that never submits anything to the GPU. That is why the verdict below is
# built from the three lines above and the Vulkan mentions are recorded only as a
# count.
DEVICE_USED_RE = re.compile(r"using device\s+(\S+)")
LAYERS_OFFLOADED_RE = re.compile(r"offloaded\s+(\d+)\s*/\s*(\d+)\s+layers to GPU")
REPEATING_LAYERS_RE = re.compile(r"offloading\s+(\d+)\s+repeating layers to GPU")
CLIP_BACKEND_RE = re.compile(r"CLIP using\s+(.+?)\s+backend")
DEVICE_LOST_RE = re.compile(r"device lost", re.IGNORECASE)
ENCODE_FAILURE_RE = re.compile(r"Failed to encode mtmd batch|mtmd_batch_encode", re.IGNORECASE)
VULKAN_RE = re.compile(r"ggml_vulkan|vulkan", re.IGNORECASE)

# Windows reports this for an unrecoverable process fault (fast-fail). It is the
# code the operator's run exited with while the Vulkan device was being lost.
WINDOWS_FAST_FAIL = 0xC0000409


def inspect_runtime_log(stdout_text: str, stderr_text: str) -> dict:
    """What the runtime's own output says about CPU vs GPU — nothing more.

    Absence of evidence is reported as absence: a log that does not state its
    device yields `not-stated-in-log`, never a claim in either direction.
    """
    combined = (stdout_text or "") + "\n" + (stderr_text or "")

    devices_used = [line.strip() for line in combined.splitlines()
                    if "using device" in line]
    offloaded = LAYERS_OFFLOADED_RE.search(combined)
    clip = CLIP_BACKEND_RE.search(combined)
    vulkan_mentions = len(VULKAN_RE.findall(combined))

    layers_offloaded = f"{offloaded.group(1)}/{offloaded.group(2)}" if offloaded else None
    clip_backend = clip.group(1).strip() if clip else None

    gpu_offload_observed = bool(devices_used)
    if offloaded and int(offloaded.group(1)) > 0:
        gpu_offload_observed = True

    if gpu_offload_observed:
        verdict = "gpu-work-observed"
    elif (layers_offloaded is not None and layers_offloaded.startswith("0/")) \
            or (clip_backend and clip_backend.upper().startswith("CPU")):
        verdict = "cpu-only-confirmed-by-log"
    else:
        verdict = "not-stated-in-log"

    return {
        "source": "the child's own stdout/stderr, read as text without modification",
        "clip_backend": clip_backend,
        "device_names": [match.group(1) for match in DEVICE_USED_RE.finditer(combined)],
        "layers_offloaded": layers_offloaded,
        "repeating_layers_offloaded": (REPEATING_LAYERS_RE.search(combined).group(1)
                                       if REPEATING_LAYERS_RE.search(combined) else None),
        "devices_used": devices_used,
        "gpu_offload_observed": gpu_offload_observed,
        "device_lost": bool(DEVICE_LOST_RE.search(combined)),
        "mtmd_encode_failure": bool(ENCODE_FAILURE_RE.search(combined)),
        "vulkan_mentions": vulkan_mentions,
        "vulkan_note": ("Vulkan mentions are informational: the backend DLL is loaded and "
                        "its devices are enumerated at startup even when nothing is "
                        "submitted to the GPU, so a mention is not usage."),
        "verdict": verdict,
    }


def describe_failure(exit_code: int | None, evidence: dict) -> list[str]:
    """Plain-language notes for a failed run, from what was observed only."""
    notes: list[str] = []
    if evidence.get("device_lost"):
        notes.append("the runtime's log reports a lost GPU device "
                     "(ggml_vulkan: device lost): the Vulkan backend failed while it was "
                     "in use. This is the failure the CPU-only default exists for; see "
                     "LOCAL_EXECUTION.md")
        if exit_code == WINDOWS_FAST_FAIL:
            notes.append(f"exit code {exit_code} is 0x{WINDOWS_FAST_FAIL:08X}, the code "
                         f"Windows reports when a process is terminated by an "
                         f"unrecoverable fault — consistent with a fault inside the "
                         f"graphics driver rather than with a model or prompt problem")
        elif exit_code is not None and exit_code > 255:
            notes.append(f"exit code {exit_code} is 0x{exit_code & 0xFFFFFFFF:08X}, a "
                         f"Windows status code rather than a small process exit code")
    if evidence.get("mtmd_encode_failure"):
        notes.append("the runtime failed inside mtmd_batch_encode (image encoding), "
                     "before any text generation started")
    if evidence.get("gpu_offload_observed"):
        notes.append("the log shows the model used a GPU device; if that was not asked "
                     "for with --ngl/--device/--mmproj-offload, report it — the validated "
                     "path is meant to be CPU-only")
    return notes


# `-dev none` is llama.cpp's own way of saying "no GPU device", and it is present
# in the build this lab documents (b11026). A much older build would reject it as
# an unknown device, and that must produce a way forward rather than a puzzle.
PIN_REJECTED_RE = re.compile(r"invalid device|unknown argument|unrecognized argument",
                             re.IGNORECASE)


def cpu_pin_rejected_hint(log_text: str, policy: dict) -> list[str]:
    """A way forward if a build refuses one of the CPU-only pins."""
    if not policy.get("cpu_only") or not log_text or not PIN_REJECTED_RE.search(log_text):
        return []
    return ["the runtime rejected one of the CPU-only pins (see the log line above). "
            "Some llama.cpp builds predate `-dev none`; update to the current release, "
            "or run the equivalent CPU-only command with --no-cpu-only --ngl 0 "
            "--no-mmproj-offload (LOCAL_EXECUTION.md, step 7)"]


def read_tokenizer_metadata(path: Path) -> dict:
    """Read the two GGUF keys that decide the detokenize path — never fatal.

    This is the metadata the runtime itself will read, so it is worth showing next
    to the override: it is what the override is *for*. It is deliberately not
    allowed to decide anything — if the reader fails, that is recorded and the
    documented override still applies, because the file at this path is expected
    to be the pinned artifact (whose digest was just checked) and its decode path
    has been observed locally.
    """
    try:
        gguf = _load("dg_gguf", "gguf.py")
        parsed = gguf.read_metadata(path)
        metadata = parsed.get("metadata", {})
        model = metadata.get("tokenizer.ggml.model")
        pre = metadata.get("tokenizer.ggml.pre")
        risk = gguf.tokenizer_decode_risk(model, pre)
        return {
            "read": True,
            "metadata_read_completely": bool(parsed.get("metadata_read")),
            "model": model,
            "pre": pre,
            "escape_whitespaces": risk["escape_whitespaces"],
            "decode_path": risk["decode_path"],
            "risk": risk["risk"],
            "note": risk["note"],
        }
    except Exception as exc:
        return {
            "read": False,
            "metadata_read_completely": False,
            "model": None,
            "pre": None,
            "escape_whitespaces": None,
            "decode_path": None,
            "risk": "unknown",
            "error": f"{type(exc).__name__}: {exc}",
            "note": ("the GGUF metadata could not be read, so the decode path could not "
                     "be cross-checked; the documented override still applies and this "
                     "failure is recorded rather than guessed around"),
        }


def write_report(report: dict, out_dir: Path, logs_dir: Path, tag: str) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "run_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False),
                           encoding="utf-8")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = logs_dir / f"run_{stamp}_{tag}.json"
    log_path.write_text(json.dumps(report, indent=2, ensure_ascii=False),
                        encoding="utf-8")
    return report_path, log_path


def main() -> int:
    force_utf8_console()
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--main", default=None,
                    help="Main GGUF (default: the published filename in model\\)")
    ap.add_argument("--mmproj", default=None,
                    help="Multimodal projector GGUF (default: the published filename)")
    ap.add_argument("--image", required=False,
                    help="A local dental image. Required for a real run.")
    ap.add_argument("--prompt", default=DEFAULT_PROMPT,
                    help="Text prompt sent with the image")
    ap.add_argument("--llama-bin", default=None,
                    help="Explicit path to llama-mtmd-cli / llama-cli")
    ap.add_argument("--llama-dir", default=None,
                    help="Folder containing an unpacked llama.cpp release")
    ap.add_argument("--ctx", type=int, default=4096, help="Context size (-c)")
    ap.add_argument("--predict", type=int, default=320,
                    help="Maximum tokens to generate (-n)")
    ap.add_argument("--temp", type=float, default=0.1,
                    help="Sampling temperature (publisher suggests 0.1)")
    ap.add_argument("--seed", type=int, default=42,
                    help="Fixed seed, so a rerun of the same command is comparable")
    ap.add_argument("--threads", type=int, default=0,
                    help="Threads (-t). 0 = let llama.cpp decide")
    ap.add_argument("--ngl", type=int, default=None,
                    help="GPU layers (-ngl). Any value other than 0 leaves CPU-only mode, "
                         "and is recorded as an explicit GPU request; omit it to stay on "
                         "the validated CPU path")
    ap.add_argument("--device", default=None,
                    help="GPU device list for llama.cpp (-dev), e.g. Vulkan0. 'none' means "
                         "'no GPU device', which is what CPU-only mode passes. Anything "
                         "else leaves CPU-only mode")
    ap.add_argument("--cpu-only", dest="cpu_only", action="store_true", default=True,
                    help="Pin the run to the CPU (default): -ngl 0, -dev none and "
                         "--no-mmproj-offload. This is the validated execution mode")
    ap.add_argument("--no-cpu-only", dest="cpu_only", action="store_false",
                    help="Do not pin anything: llama.cpp's own defaults decide where the "
                         "model and the projector run. Not the validated path")
    ap.add_argument("--mmproj-offload", dest="mmproj_offload", action="store_true",
                    default=None,
                    help="Let the projector run on a GPU device (leaves CPU-only mode)")
    ap.add_argument("--no-mmproj-offload", dest="mmproj_offload", action="store_false",
                    help="Keep the projector on the CPU (already the default in CPU-only "
                         "mode; accepted so existing commands keep working)")
    ap.add_argument("--tokenizer-pre", default=DEFAULT_TOKENIZER_PRE, metavar="PRE",
                    help="Value for --override-kv tokenizer.ggml.pre=str:<PRE>, applied in "
                         "memory only. Default: gemma4, the documented decoding workaround "
                         "for the pinned DentalGemma GGUF (OUTPUT_DECODING.md)")
    ap.add_argument("--no-tokenizer-pre-override", dest="tokenizer_pre",
                    action="store_const", const="",
                    help="Pass no tokenizer override at all: the runtime's own metadata "
                         "applies, and [UNK_BYTE_...] markers are likely for this artifact")
    ap.add_argument("--extra", nargs=argparse.REMAINDER, default=None,
                    help="Verbatim extra flags appended after the known ones")
    ap.add_argument("--timeout", type=float, default=1800.0,
                    help="Seconds before the child is terminated")
    ap.add_argument("--sample-interval", type=float, default=0.5,
                    help="Memory/CPU sampling period in seconds")
    ap.add_argument("--output-dir", default=None, help="Default: lab\\output")
    ap.add_argument("--logs-dir", default=None, help="Default: lab\\logs")
    ap.add_argument("--dry-run", action="store_true",
                    help="Check prerequisites and print the command; run nothing")
    ap.add_argument("--expect-main-sha256", default=None)
    ap.add_argument("--expect-mmproj-sha256", default=None)
    args = ap.parse_args()

    out_dir = Path(args.output_dir) if args.output_dir else LAB / "output"
    logs_dir = Path(args.logs_dir) if args.logs_dir else LAB / "logs"

    main_gguf = Path(args.main) if args.main \
        else MODEL_DIR / artifacts.ARTIFACTS["main"]["filename"]
    mmproj_gguf = Path(args.mmproj) if args.mmproj \
        else MODEL_DIR / artifacts.ARTIFACTS["mmproj"]["filename"]

    print("=" * 78)
    print(" DentalGemma 1.5 4B IT — real multimodal local inference (llama.cpp)")
    print("=" * 78)
    print(f"\n  main   : {main_gguf}")
    print(f"  mmproj : {mmproj_gguf}")
    print(f"  image  : {args.image if args.image else '(not given)'}")
    # The execution policy is resolved once, here, and the same dict is used to
    # build the command and to fill the report: the record cannot drift from the
    # argv that actually ran.
    policy = resolve_execution_policy(args)
    print(f"  mode    : " + ("CPU-only (validated path)" if policy["cpu_only"]
                              else "GPU allowed (not the validated path)"))
    print(f"            {policy['reason']}")

    report: dict = {
        "schema": "dentalgemma.run_report/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": "DentalGemma 1.5 4B IT (GGUF, Q4_K_M)",
        "base_model": artifacts.BASE_REPO["id"],
        "finetune_model": artifacts.FINETUNE_REPO["id"],
        "gguf_repository": artifacts.GGUF_REPO["id"],
        "gguf_revision": artifacts.GGUF_REPO["revision"],
        "main_artifact": str(main_gguf),
        "mmproj_artifact": str(mmproj_gguf),
        "main_size_bytes": None,
        "mmproj_size_bytes": None,
        "main_sha256": None,
        "mmproj_sha256": None,
        "runtime": None,
        "cpu": None,
        "ram_gb": None,
        "cuda": False,
        "input": args.image,
        "input_sha256": None,
        "input_image": None,
        "command": None,
        "config": {},
        "inference_success": False,
        "inference_seconds": None,
        "peak_ram_gb": None,
        "output_path": None,
        "output_chars": None,
        "exit_code": None,
        # Present in every report, before any run: a BLOCKED report has nothing to
        # capture, and saying that with null beats omitting the keys and leaving a
        # consumer to guess whether the fields exist.
        "capture": None,
        "output_integrity": None,
        # `execution` is known before the run (it is the requested policy) and
        # `device_evidence` inside it is null until the runtime has spoken.
        "execution": policy,
        "validation_scope": {
            "functional_inference": False,
            "clinical_validation": False,
            "statement": (
                "This report records whether the model produced text locally on this "
                "machine, on the CPU, and what that cost. It is not a clinical "
                "evaluation: no ground truth, no accuracy metric, and the publisher does "
                "not release this model as a medical device. Any generated text is "
                "unvalidated model output and must not be used for patient care. A run "
                "counts as a success here when text was produced — never because the "
                "text is correct, which this lab does not measure."
            ),
        },
        "status": artifacts.STATUS_UNKNOWN,
        "notes": [],
    }

    def finish(status: str, code: int) -> int:
        report["status"] = status
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        report_path, log_path = write_report(report, out_dir, logs_dir, "dentalgemma")
        print(f"\n  status : {status}")
        print(f"  Wrote {report_path}")
        print(f"  Wrote {log_path}")
        return code

    # ---- prerequisites ----------------------------------------------------
    # Everything that can be checked without the model is checked *before* the
    # model is needed, and every problem is reported in one pass. The alternative —
    # stopping at the first one — means the user fixes a path, runs again, and
    # discovers the next problem, each round trip costing a 3.47 GiB download and a
    # machine they cannot ask questions about. So: collect, then decide.
    sysinfo = _load("dg_sysinfo", "sysinfo.py")
    missing: list[str] = []
    for label, path in (("main GGUF", main_gguf), ("mmproj GGUF", mmproj_gguf)):
        if not path.is_file():
            missing.append(f"{label} not found: {path}")
            print(f"\n[STOP] {label} not found: {path}")

    image: Path | None = None
    image_bad_format = False
    if not args.image:
        missing.append("no image supplied")
        print("\n[STOP] --image is required for a real multimodal run.")
        print("       See input/README.md for acceptable image types.")
    else:
        image = Path(args.image)
        if not image.is_file():
            missing.append(f"image not found: {image}")
            print(f"\n[STOP] image not found: {image}")
        elif image.suffix.lower() not in IMAGE_EXTENSIONS:
            image_bad_format = True
            print(f"\n[STOP] unsupported image extension: {image.suffix}")
            print(f"       Accepted: {', '.join(sorted(IMAGE_EXTENSIONS))}")

    if image_bad_format and image is not None:
        # recorded even when the missing artifacts already decide the outcome: the
        # report is the record of the attempt, not of the first problem found
        report["notes"].append(f"unsupported image extension {image.suffix}")
    if missing:
        if any("GGUF" in problem for problem in missing):
            print("\n       Run: python scripts/download_artifacts.py --all")
        report["notes"].extend(missing)
        return finish(artifacts.STATUS_BLOCKED, 3)
    if image_bad_format:
        report["notes"].append(f"unsupported image extension {image.suffix}"
                               if image else "unsupported image extension")
        return finish(artifacts.STATUS_BLOCKED, 4)

    report["main_size_bytes"] = main_gguf.stat().st_size
    report["mmproj_size_bytes"] = mmproj_gguf.stat().st_size
    print(f"\n  main size   : {report['main_size_bytes']:,} B")
    print(f"  mmproj size : {report['mmproj_size_bytes']:,} B")

    # ---- llama.cpp --------------------------------------------------------
    llama = sysinfo.llama_cpp(binary_hint=args.llama_bin,
                              extra_dirs=[args.llama_dir] if args.llama_dir else [])
    binary = None
    if args.llama_bin and Path(args.llama_bin).is_file():
        binary = Path(args.llama_bin)
    for name in ("llama-mtmd-cli", "llama-cli"):
        if name in llama["binaries"]:
            binary = Path(llama["binaries"][name]["path"])
            break
    if binary is None:
        print("\n[STOP] no usable llama.cpp multimodal binary found.")
        if llama["obsolete_found"]:
            print(f"       Found only obsolete tool(s): {', '.join(llama['obsolete_found'])}")
            print("       llama.cpp replaced the LLaVA CLI with libmtmd; use")
            print("       llama-mtmd-cli (or llama-cli) from a current build.")
        print("       See LOCAL_EXECUTION.md step 2 for the official Windows build.")
        report["runtime"] = "llama.cpp (not found)"
        report["notes"].append("llama.cpp binary missing")
        return finish(artifacts.STATUS_BLOCKED, 3)

    version_line = llama["binaries"].get(binary.name, {}).get("version_line")
    report["runtime"] = {
        "name": "llama.cpp",
        "binary": str(binary),
        "version": version_line,
        "obsolete_tools_present": llama["obsolete_found"],
    }
    print(f"  runtime     : {binary.name}  ({version_line or 'version not reported'})")

    # ---- image ------------------------------------------------------------
    # Presence, extension and the header itself were already checked above; here
    # the image becomes part of the record that is attached to the run.
    assert image is not None
    info = probe_image(image)
    report["input_image"] = info
    report["input"] = str(image)
    report["input_sha256"] = sha256_of(image)
    print(f"  image       : {info.get('format') or 'unknown format'} "
          f"{info.get('width')}x{info.get('height')} {info.get('mode') or ''}".rstrip())
    print(f"  image sha256: {report['input_sha256']}")
    if (info.get("width") or 0) < 64 or (info.get("height") or 0) < 64:
        print("  [WARN] very small image; a radiograph is usually much larger")

    # ---- hashes of the model files ---------------------------------------
    print("\n  hashing model files (this reads 3.47 GiB)...")
    report["main_sha256"] = sha256_of(main_gguf)
    report["mmproj_sha256"] = sha256_of(mmproj_gguf)
    expected_main = args.expect_main_sha256 or artifacts.ARTIFACTS["main"]["sha256_expected"]
    expected_mm = args.expect_mmproj_sha256 or artifacts.ARTIFACTS["mmproj"]["sha256_expected"]
    hash_ok = True
    for label, got, expected in (("main", report["main_sha256"], expected_main),
                                 ("mmproj", report["mmproj_sha256"], expected_mm)):
        if got != expected:
            hash_ok = False
            print(f"  [WARN] {label} sha256 does not match the published value")
            print(f"         LOCAL HASH : {got}")
            print(f"         published  : {expected}")
    if hash_ok:
        print("  both files match the published SHA-256 values")
    else:
        report["notes"].append("SHA-256 mismatch against the published digest")

    # ---- the tokenizer metadata the override is for ------------------------
    # Read from the file itself, and shown next to the override. It is evidence,
    # not an input: the override is applied because the operator's run showed the
    # broken decode path for this pinned artifact, and a metadata quirk must not
    # be able to switch the workaround off silently.
    tokenizer_metadata = read_tokenizer_metadata(main_gguf)
    policy["tokenizer_metadata"] = tokenizer_metadata
    risk = tokenizer_metadata.get("risk")
    if risk == "unk-byte-markers-possible":
        policy["override_matches_metadata"] = True
        metadata_line = ("metadata selects the GPT-2 byte-level decode path "
                         "(escape_whitespaces=false): exactly the condition the override "
                         "below addresses")
    elif risk == "none":
        policy["override_matches_metadata"] = False
        metadata_line = ("metadata already selects a whitespace-escaped decode path; the "
                         "override is redundant here — it is still applied, so the run "
                         "stays comparable with the documented one")
        policy["notes"].append(
            "the GGUF's own metadata does not show the decode path this override "
            "addresses; the override was applied anyway and is recorded (check "
            "tokenizer_metadata before trusting either)")
    else:
        policy["override_matches_metadata"] = None
        metadata_line = "no decode-path prediction could be made from the metadata"

    if tokenizer_metadata.get("read"):
        print(f"  tokenizer   : model={tokenizer_metadata['model']} "
              f"pre={tokenizer_metadata['pre'] if tokenizer_metadata['pre'] is not None else '(missing)'}"
              f"  risk={risk}")
        if not tokenizer_metadata.get("metadata_read_completely"):
            print("                (the metadata section was only partially readable)")
    else:
        print(f"  tokenizer   : metadata not readable ({tokenizer_metadata.get('error')})")
    print(f"                {metadata_line}")

    # ---- command ----------------------------------------------------------
    cmd = build_command(binary, main_gguf, mmproj_gguf, image, args, policy=policy)
    report["command"] = cmd
    report["config"] = {
        "ctx": args.ctx, "predict": args.predict, "temp": args.temp,
        "seed": args.seed, "threads": args.threads, "ngl": policy["ngl"],
        "cpu_only": policy["cpu_only"],
        "device": policy["device"],
        "mmproj_offload": policy["mmproj_offload"],
        "tokenizer_pre_override": policy["tokenizer_pre_override"],
        # kept, with its original meaning: the projector is on the CPU
        "no_mmproj_offload": not policy["mmproj_offload"],
        "sample_interval_seconds": args.sample_interval,
        "timeout_seconds": args.timeout,
    }
    print("\n  command:")
    print("    " + " ".join(f'"{part}"' if " " in part else part for part in cmd))
    print(f"  workaround  : " + ("; ".join(policy["workarounds"])
                                  if policy["workarounds"] else "none"))

    if args.dry_run:
        print("\n  --dry-run: nothing was executed.")
        report["notes"].append("dry run: prerequisites checked, no inference attempted")
        return finish(artifacts.STATUS_UNKNOWN, 0)

    # ---- run --------------------------------------------------------------
    print(f"\n  running (timeout {args.timeout:.0f}s, sampling every "
          f"{args.sample_interval:.2f}s)...")
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    try:
        # No text=True: the runtime's bytes are read as bytes. Decoding is done
        # explicitly afterwards (decode_stream) so that any substitution this lab
        # performs is counted and reported rather than invisible.
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except Exception as exc:
        print(f"\n[STOP] could not start the runtime: {type(exc).__name__}: {exc}")
        report["notes"].append(f"could not start runtime: {exc}")
        return finish(artifacts.STATUS_FAILED, 6)

    monitor_task: dict = {}
    timed_out = False
    stdout = stderr = ""
    box: dict = {}
    reader = threading.Thread(target=read_child_async,
                              args=(proc, args.timeout, box), daemon=True)
    reader.start()
    # The sampler runs here, on this thread; the reader thread owns the pipes.
    try:
        monitor_task = monitor(proc, args.sample_interval)
    finally:
        reader.join(timeout=180)
    timed_out = bool(box.get("timed_out"))
    if box.get("error"):
        report["notes"].append(f"output reader: {box['error']}")
    elapsed = time.perf_counter() - t0
    finished = datetime.now(timezone.utc)

    # ---- decode the captured bytes, and keep the bytes --------------------
    stdout_audit = decode_stream(box.get("stdout"), "stdout")
    stderr_audit = decode_stream(box.get("stderr"), "stderr")
    stdout, stderr = stdout_audit["text"], stderr_audit["text"]

    # The readable files keep exactly the semantics they had before — ANSI colour
    # codes stripped, surrounding whitespace trimmed — so nothing that reads them
    # changes. The .raw files are new and are the untouched byte streams, which is
    # what makes it possible to tell a decoding defect from a display defect later.
    text = ANSI_RE.sub("", stdout or "").strip()
    raw_log = ANSI_RE.sub("", stderr or "").strip()

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = image.stem
    text_path = out_dir / f"{stem}_response.txt"
    log_path = out_dir / f"{stem}_llama.log"
    stdout_raw_path = out_dir / f"{stem}_stdout.raw"
    stderr_raw_path = out_dir / f"{stem}_stderr.raw"
    if text:
        text_path.write_text(text, encoding="utf-8")
    log_path.write_text((stderr or "") + ("\n" if stderr else ""), encoding="utf-8")
    stdout_raw_path.write_bytes(box.get("stdout") or b"")
    stderr_raw_path.write_bytes(box.get("stderr") or b"")

    markers = audit_unk_bytes(text)
    decoding_clean = (markers["count"] == 0
                      and stdout_audit["decode_replacements"] == 0)

    report.update({
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "inference_seconds": round(elapsed, 3),
        "exit_code": proc.returncode,
        "peak_ram_gb": round(monitor_task.get("peak_rss_bytes", 0) / 2**30, 3)
                        if monitor_task.get("peak_rss_bytes") else None,
        "peak_rss_bytes": monitor_task.get("peak_rss_bytes") or None,
        "cpu_seconds": monitor_task.get("cpu_seconds"),
        "memory_probe": monitor_task.get("probe"),
        "memory_note": monitor_task.get("note"),
        "timed_out": timed_out,
        "stdout_chars": len(stdout or ""),
        "stderr_chars": len(stderr or ""),
        "response_path": str(text_path) if text else None,
        "llama_log_path": str(log_path),
        # Everything below is additive: the fields above keep their meaning.
        "capture": {
            "encoding": "utf-8",
            "stdout_bytes": stdout_audit["bytes"],
            "stdout_sha256": stdout_audit["sha256"],
            "stderr_bytes": stderr_audit["bytes"],
            "stderr_sha256": stderr_audit["sha256"],
            "stdout_decode_replacements": stdout_audit["decode_replacements"],
            "stderr_decode_replacements": stderr_audit["decode_replacements"],
            "invalid_utf8_sequences": (stdout_audit["invalid_sequences"]
                                       + stderr_audit["invalid_sequences"]),
            "ansi_stripped_from_readable_text": True,
            "readable_text_is_raw": False,
            "raw_stdout_path": str(stdout_raw_path),
            "raw_stderr_path": str(stderr_raw_path),
            "note": ("the .raw files are the child's bytes, unmodified; the .txt/.log "
                     "files are the same streams with ANSI escapes removed and "
                     "invalid UTF-8 replaced, which is counted above"),
        },
        "output_integrity": {
            **markers,
            "decoding_clean": decoding_clean,
            "note": ("decoding_clean is False when the runtime wrote [UNK_BYTE_...] "
                     "markers or when this lab had to substitute a byte. It does not "
                     "change `status`: OPERATIONAL still means 'real inference "
                     "produced non-empty text', not 'the text is correct'."),
        },
    })

    # ---- what the runtime's own log says about where the work ran ---------
    evidence = inspect_runtime_log(stdout, stderr)
    policy["device_evidence"] = evidence
    if policy["cpu_only"] and evidence["gpu_offload_observed"]:
        policy["notes"].append(
            "CPU-only mode was requested, but the runtime's log shows GPU work (a device "
            "was selected, or layers were offloaded to it). This run is not the validated "
            "CPU path — do not treat its figures as the CPU figures")
    elif policy["cpu_only"] and evidence["verdict"] == "not-stated-in-log":
        policy["notes"].append(
            "CPU-only mode was requested and the command line pins it (-ngl 0, -dev none, "
            "--no-mmproj-offload), but the runtime's log does not state which device it "
            "used: the request is recorded, the runtime's own confirmation is absent")

    print(f"\n  exit code   : {proc.returncode}"
          + ("  (killed after timeout)" if timed_out else ""))
    print(f"  duration    : {elapsed:.2f} s")
    # `is not None`, not truthiness: a measured peak rounds to 0.0 GiB for a very
    # small child, and 0.0 is falsy — testing the value would print "not
    # measurable" for a measurement that did happen.
    print(f"  peak RAM    : "
          + (f"{report['peak_ram_gb']} GiB  ({monitor_task.get('probe')})"
             if report["peak_ram_gb"] is not None
             else "not measurable on this platform"))
    if report.get("cpu_seconds") is not None:
        print(f"  cpu time    : {report['cpu_seconds']:.2f} s")

    if text:
        print(f"\n  generated text ({len(text)} chars):")
        print("  " + "-" * 74)
        for line in text.splitlines()[:20]:
            print(f"  {line}")
        if len(text.splitlines()) > 20:
            print(f"  ... ({len(text.splitlines()) - 20} more lines, see the file)")
        print("  " + "-" * 74)

    # ---- say out loud what the runtime did to the text --------------------
    if markers["count"]:
        named = ", ".join(markers["codepoints"]) or "codepoints that could not be resolved"
        codes = ", ".join(markers["codes"]) or ", ".join(markers["unresolved_codes"])
        print("\n" + "!" * 78)
        print(f" {markers['count']} [UNK_BYTE_...] marker(s) in the generated text, "
              f"naming {named}")
        print(f" (hex: {codes}) — written by llama.cpp's detokenizer, left exactly as")
        print(" it emitted them. The text above is NOT the model's raw output: the")
        print(" runtime replaced part of it. See OUTPUT_DECODING.md.")
        print("!" * 78)
    if stdout_audit["decode_replacements"]:
        print(f"\n  [WARN] {stdout_audit['decode_replacements']} byte sequence(s) on stdout were "
              f"not valid UTF-8 and were replaced by U+FFFD in the readable file")
        print(f"         the bytes are preserved in {stdout_raw_path.name}")
    print(f"\n  raw streams : {stdout_raw_path.name}, {stderr_raw_path.name} "
          f"(stdout {stdout_audit['bytes']:,} B, stderr {stderr_audit['bytes']:,} B)")

    # ---- CPU vs GPU, as the runtime itself reported it ---------------------
    print("  device use  : " + {
        "cpu-only-confirmed-by-log": "CPU-only, confirmed by the runtime's own log",
        "gpu-work-observed": "a GPU device was used (see the lines below)",
        "not-stated-in-log": "not stated by the runtime's log",
    }[evidence["verdict"]])
    if evidence["clip_backend"]:
        print(f"                projector backend : {evidence['clip_backend']}")
    if evidence["layers_offloaded"]:
        print(f"                layers to GPU     : {evidence['layers_offloaded']}")
    for line in evidence["devices_used"][:3]:
        print(f"                {line}")
    if evidence["vulkan_mentions"]:
        print(f"                {evidence['vulkan_mentions']} Vulkan mention(s) in the log "
              f"(loading/enumerating the backend is not using it)")
    for note in policy["notes"]:
        print(f"  [WARN] {note}")

    # ---- verdict ----------------------------------------------------------
    success = (not timed_out) and proc.returncode == 0 and bool(text)
    report["inference_success"] = success
    report["output_path"] = str(text_path) if text else None
    report["output_chars"] = len(text)
    report["validation_scope"]["functional_inference"] = success

    machine = sysinfo.cpu_model()
    memory = sysinfo.memory_bytes()
    report["cpu"] = machine or None
    report["ram_gb"] = round(memory["total"] / 2**30, 2) if memory["total"] else None
    report["cuda"] = bool(sysinfo.nvidia_gpus()["present"])

    if success:
        if policy["cpu_only"] and not evidence["gpu_offload_observed"]:
            where = "on the CPU"
        elif evidence["gpu_offload_observed"]:
            where = "with GPU work (the runtime's log shows a GPU device)"
        else:
            where = "(device not stated by the runtime's log)"
        print("\n" + "=" * 78)
        print(f" SUCCESS — the model produced text on this machine, {where}")
        print(f" {len(text)} characters written to {text_path.name}")
        print(" Functional inference only: no accuracy was measured and this is not a")
        print(" validated diagnosis. See validation_scope in the report.")
        print("=" * 78)
        return finish(artifacts.STATUS_OPERATIONAL, 0)

    if timed_out:
        report["notes"].append("killed after the timeout; consider a larger --timeout")
    if proc.returncode != 0:
        report["notes"].append(f"runtime exited with code {proc.returncode}")
    if not text:
        report["notes"].append("no text was produced on stdout")
        tail = (raw_log or "").splitlines()[-15:]
        if tail:
            print("\n  last lines from the runtime log:")
            for line in tail:
                print(f"    {line}")
    # A failure is described from what was observed, and nothing is attributed to
    # the model that the runtime's own log does not support.
    failure_notes = (describe_failure(proc.returncode, evidence)
                     + cpu_pin_rejected_hint(stdout + "\n" + stderr, policy))
    for note in failure_notes:
        report["notes"].append(note)
        print(f"  [cause] {note}")

    print("\n" + "=" * 78)
    print(" FAILED — no usable text output was produced")
    print("=" * 78)
    return finish(artifacts.STATUS_FAILED, 6)


if __name__ == "__main__":
    raise SystemExit(main())
