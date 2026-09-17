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


def build_command(binary: Path, main: Path, mmproj: Path, image: Path,
                  args) -> list[str]:
    """The exact argv this run will use, in the order llama.cpp documents."""
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
    if args.ngl is not None:
        cmd += ["-ngl", str(args.ngl)]
    if args.no_mmproj_offload:
        cmd += ["--no-mmproj-offload"]
    if args.extra:
        cmd += list(args.extra)
    return cmd


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
                    help="GPU layers (-ngl). Omit for the default; this lab does "
                         "not require a GPU")
    ap.add_argument("--no-mmproj-offload", action="store_true",
                    help="Keep the projector on the CPU")
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

    # ---- command ----------------------------------------------------------
    cmd = build_command(binary, main_gguf, mmproj_gguf, image, args)
    report["command"] = cmd
    report["config"] = {
        "ctx": args.ctx, "predict": args.predict, "temp": args.temp,
        "seed": args.seed, "threads": args.threads, "ngl": args.ngl,
        "no_mmproj_offload": args.no_mmproj_offload,
        "sample_interval_seconds": args.sample_interval,
        "timeout_seconds": args.timeout,
    }
    print("\n  command:")
    print("    " + " ".join(f'"{part}"' if " " in part else part for part in cmd))

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

    print(f"\n  exit code   : {proc.returncode}"
          + ("  (killed after timeout)" if timed_out else ""))
    print(f"  duration    : {elapsed:.2f} s")
    print(f"  peak RAM    : "
          + (f"{report['peak_ram_gb']} GiB  ({monitor_task.get('probe')})"
             if report["peak_ram_gb"] else "not measurable on this platform"))
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

    # ---- verdict ----------------------------------------------------------
    success = (not timed_out) and proc.returncode == 0 and bool(text)
    report["inference_success"] = success
    report["output_path"] = str(text_path) if text else None
    report["output_chars"] = len(text)

    machine = sysinfo.cpu_model()
    memory = sysinfo.memory_bytes()
    report["cpu"] = machine or None
    report["ram_gb"] = round(memory["total"] / 2**30, 2) if memory["total"] else None
    report["cuda"] = bool(sysinfo.nvidia_gpus()["present"])

    if success:
        print("\n" + "=" * 78)
        print(" SUCCESS — the model produced text on this machine, on the CPU")
        print(f" {len(text)} characters written to {text_path.name}")
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

    print("\n" + "=" * 78)
    print(" FAILED — no usable text output was produced")
    print("=" * 78)
    return finish(artifacts.STATUS_FAILED, 6)


if __name__ == "__main__":
    raise SystemExit(main())
