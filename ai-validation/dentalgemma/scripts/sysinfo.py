#!/usr/bin/env python3
"""
sysinfo.py — hardware / runtime detection for the DentalGemma lab.

Standard library only. `psutil` is used when it happens to be installed, but
nothing here requires it: on Windows the same facts come from `ctypes`,
`winreg` and the WMI-free registry keys, and on Linux from `/proc` and `/sys`.
Every function degrades to an honest "unknown" instead of raising, because a
detection failure must never look like a hardware fact.

Shared by `check_environment.py`, `collect_system_info.py` and
`run_dentalgemma.py` so the three can never disagree about the same machine.
"""

from __future__ import annotations

import ctypes
import glob
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

# --------------------------------------------------------------------------
# interpreters and OS
# --------------------------------------------------------------------------
def python_info() -> dict:
    return {
        "version": platform.python_version(),
        "implementation": platform.python_implementation(),
        "executable": sys.executable,
        "bits": 64 if sys.maxsize > 2**32 else 32,
    }


def os_info() -> dict:
    return {
        "system": platform.system(),
        "release": platform.release(),
        "version": platform.version(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "is_windows": os.name == "nt",
    }


# --------------------------------------------------------------------------
# CPU
# --------------------------------------------------------------------------
def cpu_model() -> str:
    """Best-effort CPU model string. Returns "" when it cannot be determined."""
    if os.name == "nt":
        try:
            import winreg

            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            with key:
                value, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            if value:
                return " ".join(str(value).split())
        except Exception:
            pass
    elif sys.platform == "darwin":
        try:
            out = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"],
                                 capture_output=True, text=True, timeout=10)
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip()
        except Exception:
            pass
    else:
        try:
            with open("/proc/cpuinfo", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if line.lower().startswith("model name"):
                        return line.split(":", 1)[1].strip()
        except Exception:
            pass
    return platform.processor() or ""


def logical_cpu_count() -> int | None:
    return os.cpu_count()


# --------------------------------------------------------------------------
# memory
# --------------------------------------------------------------------------
class _MemoryStatusEx(ctypes.Structure):
    """MEMORYSTATUSEX (Windows). Pure ctypes, harmless on every platform."""

    _fields_ = [
        ("dwLength", ctypes.c_uint32),
        ("dwMemoryLoad", ctypes.c_uint32),
        ("ullTotalPhys", ctypes.c_uint64),
        ("ullAvailPhys", ctypes.c_uint64),
        ("ullTotalPageFile", ctypes.c_uint64),
        ("ullAvailPageFile", ctypes.c_uint64),
        ("ullTotalVirtual", ctypes.c_uint64),
        ("ullAvailVirtual", ctypes.c_uint64),
        ("ullAvailExtendedVirtual", ctypes.c_uint64),
    ]


def memory_bytes() -> dict:
    """``{"total": int|None, "available": int|None, "source": str}``.

    ``available`` is what a run can actually use; Windows distinguishes it from
    "free" (which excludes standby cache), so `ullAvailPhys` is the right field.
    """
    try:
        import psutil  # optional

        vm = psutil.virtual_memory()
        return {"total": int(vm.total), "available": int(vm.available),
                "source": "psutil"}
    except Exception:
        pass

    if os.name == "nt":
        try:
            status = _MemoryStatusEx()
            status.dwLength = ctypes.sizeof(_MemoryStatusEx)
            fn = ctypes.windll.kernel32.GlobalMemoryStatusEx
            fn.restype = ctypes.c_int
            fn.argtypes = [ctypes.POINTER(_MemoryStatusEx)]
            if fn(ctypes.byref(status)):
                return {"total": int(status.ullTotalPhys),
                        "available": int(status.ullAvailPhys),
                        "source": "GlobalMemoryStatusEx"}
        except Exception:
            pass

    total = available = None
    try:
        with open("/proc/meminfo", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("MemTotal"):
                    total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable"):
                    available = int(line.split()[1]) * 1024
        if total:
            return {"total": total, "available": available, "source": "/proc/meminfo"}
    except Exception:
        pass

    try:
        page = int(os.sysconf("SC_PAGE_SIZE"))
        total = int(os.sysconf("SC_PHYS_PAGES")) * page
        available = int(os.sysconf("SC_AVPHYS_PAGES")) * page
        return {"total": total, "available": available, "source": "sysconf"}
    except Exception:
        return {"total": None, "available": None, "source": "unavailable"}


# --------------------------------------------------------------------------
# GPUs
# --------------------------------------------------------------------------
def nvidia_gpus() -> dict:
    """NVIDIA hardware, detected through nvidia-smi when it exists.

    Deliberately does not treat "nvidia-smi is missing" as "no NVIDIA GPU" on
    its own: the CUDA runtime libraries are also checked, because a machine can
    have the driver's libraries without the tool on PATH. What is reported is
    what was actually observed, with the evidence named.
    """
    result = {"present": False, "smi_path": None, "gpus": [], "evidence": []}

    smi = shutil.which("nvidia-smi")
    if smi:
        result["smi_path"] = smi
        result["evidence"].append(f"nvidia-smi found at {smi}")
        try:
            out = subprocess.run(
                [smi, "--query-gpu=name,memory.total,driver_version",
                 "--format=csv,noheader"],
                capture_output=True, text=True, timeout=30)
            if out.returncode == 0:
                for line in out.stdout.strip().splitlines():
                    if line.strip():
                        result["gpus"].append(line.strip())
                result["present"] = bool(result["gpus"])
        except Exception as exc:
            result["evidence"].append(f"nvidia-smi call failed: {type(exc).__name__}")

    if not result["present"]:
        libs = []
        for pattern in ("/usr/lib/x86_64-linux-gnu/libcuda.so*",
                        str(Path(os.environ.get("SystemRoot", r"C:\\Windows"))
                            / "System32" / "nvcuda.dll"),
                        "/usr/lib64/libcuda.so*"):
            libs += glob.glob(pattern)
        if libs:
            result["evidence"].append("CUDA runtime library present: " + libs[0])
        else:
            result["evidence"].append("no nvidia-smi and no CUDA runtime library found")

    return result


def intel_gpus() -> dict:
    """Intel display adapter detection.

    Windows: the display-adapter class key in the registry lists every adapter
    with its driver description, which needs no WMI and no extra software.
    Linux: the PCI vendor id 0x8086 behind the DRM cards.
    """
    result = {"present": False, "adapters": [], "evidence": []}

    if os.name == "nt":
        try:
            import winreg

            class_key = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, class_key) as root:
                index = 0
                while True:
                    try:
                        sub_name = winreg.EnumKey(root, index)
                    except OSError:
                        break
                    index += 1
                    if not sub_name.isdigit():
                        continue
                    try:
                        with winreg.OpenKey(root, sub_name) as sub:
                            desc, _ = winreg.QueryValueEx(sub, "DriverDesc")
                        if desc:
                            result["adapters"].append(str(desc))
                    except Exception:
                        continue
            result["evidence"].append(
                "display adapters from registry: " + (", ".join(result["adapters"]) or "none"))
        except Exception as exc:
            result["evidence"].append(f"registry query failed: {type(exc).__name__}")
    else:
        try:
            for vendor_file in glob.glob("/sys/class/drm/card*/device/vendor"):
                with open(vendor_file, encoding="ascii") as fh:
                    vendor = fh.read().strip().lower()
                if vendor in ("0x8086", "0x8086\n"):
                    result["adapters"].append(vendor_file.split("/")[4])
            if result["adapters"]:
                result["evidence"].append("Intel PCI vendor 0x8086 behind DRM card(s)")
        except Exception as exc:
            result["evidence"].append(f"/sys scan failed: {type(exc).__name__}")

    result["present"] = any(
        "intel" in adapter.lower() for adapter in result["adapters"]
    ) or bool(result["adapters"] and os.name != "nt")
    return result


# --------------------------------------------------------------------------
# llama.cpp
# --------------------------------------------------------------------------
# Ordered by suitability for multimodal work. `llama-llava-cli` is listed last
# only so it can be *recognised and flagged as obsolete* rather than mistaken
# for a working tool: llama.cpp replaced the LLaVA CLI with libmtmd (PR #12849 /
# #13012), and the current multimodal binaries are llama-mtmd-cli, llama-cli and
# llama-server.
LLAMA_BINARIES = ("llama-mtmd-cli", "llama-cli", "llama-server", "llama-llava-cli")
OBSOLETE_BINARIES = ("llama-llava-cli", "llava-cli", "gemma3-cli")


def _run_version(binary: Path) -> dict:
    """Ask a llama.cpp binary for its version. Returns what actually happened."""
    for flag in ("--version", "--help"):
        try:
            out = subprocess.run([str(binary), flag], capture_output=True,
                                 text=True, timeout=60)
            text = (out.stdout or "") + (out.stderr or "")
            version = None
            for line in text.splitlines():
                lowered = line.lower()
                if "version" in lowered and any(ch.isdigit() for ch in line):
                    version = line.strip()
                    break
            first = next((l.strip() for l in text.splitlines() if l.strip()), "")
            if version or first:
                return {"flag_used": flag, "version_line": version,
                        "first_line": first[:200], "exit_code": out.returncode}
        except Exception as exc:
            last = f"{type(exc).__name__}: {exc}"
            continue
    return {"error": "no response to --version or --help"}


def llama_cpp(binary_hint: str | None = None, extra_dirs: list[str] | None = None) -> dict:
    """Locate llama.cpp executables and, when found, ask for a version.

    ``binary_hint`` may be a full path to a specific executable. ``extra_dirs``
    are searched for the known binary names (e.g. an unpacked Windows release).
    """
    found: dict[str, dict] = {}

    search_dirs: list[Path] = []
    for d in (extra_dirs or []):
        search_dirs.append(Path(d))
    if binary_hint:
        hint_path = Path(binary_hint)
        if hint_path.is_file():
            found["explicit"] = {"path": str(hint_path), **_run_version(hint_path)}
        else:
            search_dirs.append(hint_path if hint_path.is_dir() else hint_path.parent)

    for name in LLAMA_BINARIES:
        on_path = shutil.which(name)
        if on_path:
            found[name] = {"path": on_path, "source": "PATH", **_run_version(Path(on_path))}
            continue
        for directory in search_dirs:
            if not directory.exists():
                continue
            for candidate in (directory / name,
                              directory / f"{name}.exe",
                              directory / "build" / "bin" / name,
                              directory / "build" / "bin" / f"{name}.exe"):
                if candidate.is_file():
                    found[name] = {"path": str(candidate),
                                   "source": f"searched {directory}",
                                   **_run_version(candidate)}
                    break
            if name in found:
                break

    usable = [n for n in found if n not in OBSOLETE_BINARIES] or list(found)
    preferred = next((n for n in LLAMA_BINARIES if n in found and n not in OBSOLETE_BINARIES), None)
    obsolete_found = [n for n in found if n in OBSOLETE_BINARIES]

    return {
        "available": bool(found),
        "binaries": found,
        "preferred": preferred,
        "obsolete_found": obsolete_found,
        "usable_multimodal": bool(preferred),
        "searched_dirs": [str(d) for d in search_dirs],
    }


def format_bytes(value: int | None) -> str:
    if not value:
        return "unknown"
    return f"{value / 2**30:.2f} GiB"
