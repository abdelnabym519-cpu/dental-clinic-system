"""
safeload.py — the torch >= 2.6 restricted-loading gate for mmpose-1.0
checkpoints (Phase 19B, engine 3 of 3).

Ported from the validated lab scripts/inspect_checkpoint.py +
scripts/run_inference.py in ai-validation/cldetection2023 (the same
allow-list, the same non-executing scan, the same fail-closed policy —
see AUDIT.md §7 for why this exists at all).

Why this is needed: from PyTorch 2.6, `torch.load` defaults to
weights_only=True, while mmengine 0.10.7 (the pinned version) calls it
without that argument. The validated repair keeps torch 2.6 and the
strict guard, and instead:

  1. scans the checkpoint's pickle globals WITHOUT executing anything
     (pickletools — the file never constructs an object);
  2. refuses to continue if any global is outside the bounded,
     documented allow-list (a security decision stays explicit);
  3. registers exactly that allow-list via
     torch.serialization.add_safe_globals and lets the strict default
     do its job.

Nothing is weakened: an unexpected global is a hard stop, and the whole
allow-list is registered (not only the names present) because torch's
unpickler also validates the types of constructed objects, and a numpy
dtype instance type (e.g. numpy.dtypes.UInt8DType) never appears as a
GLOBAL in the stream.
"""

from __future__ import annotations

import codecs
import importlib
import pickletools
import zipfile

# ---------------------------------------------------------------------------
# The allow-list: exactly what may be registered for weights_only=True.
# Keys are the pickle global names; anything the checkpoint names that is
# not here stops the load. Kept in step with the validation lab.
# ---------------------------------------------------------------------------
SAFE_GLOBAL_NAMES = (
    "torch._utils._rebuild_tensor_v2",
    "torch._utils._rebuild_parameter",
    "torch._utils._rebuild_parameter_with_state",
    "torch._utils._rebuild_parameter_with_state_dict",
    "torch._tensor._rebuild_from_type_v2",
    "torch.Size",
    "torch.device",
    "torch.FloatStorage",
    "torch.HalfStorage",
    "torch.LongStorage",
    "torch.IntStorage",
    "torch.ByteStorage",
    "torch.DoubleStorage",
    "collections.OrderedDict",
    "collections.Counter",
    "builtins.bytes",
    "builtins.set",
    "builtins.bytearray",
    "__builtin__.bytes",
    "__builtin__.set",
    "__builtin__.bytearray",
    "numpy.core.multiarray._reconstruct",
    "numpy.core.multiarray.scalar",
    "numpy._core.multiarray._reconstruct",
    "numpy._core.multiarray.scalar",
    "numpy.ndarray",
    "numpy.dtype",
    "pathlib.PosixPath",
    "pathlib.WindowsPath",
    "pathlib.PurePath",
)

NUMPY_DTYPE_NAMES = (
    "BoolDType", "Int8DType", "Int16DType", "Int32DType", "Int64DType",
    "UInt8DType", "UInt16DType", "UInt32DType", "UInt64DType",
    "Float16DType", "Float32DType", "Float64DType", "LongDoubleDType",
    "Complex64DType", "Complex128DType", "StrDType", "BytesDType",
    "ObjectDType", "VoidDType", "Datetime64DType", "Timedelta64DType",
    "StringDType", "HalfDType",
)


def allow_list_names() -> set[str]:
    """The policy, as plain strings — usable (and testable) without torch."""
    names = set(SAFE_GLOBAL_NAMES)
    names |= {f"numpy.dtypes.{name}" for name in NUMPY_DTYPE_NAMES}
    names.add("_codecs.encode")
    names.add("numpy.dtype")
    return names


def unexplained_globals(globals_found) -> list[str]:
    """The checkpoint's globals this engine has not allow-listed (must be
    empty — anything else stops the load)."""
    allowed = allow_list_names()
    return sorted(g for g in globals_found if g not in allowed)


def _scan_payload(payload: bytes, found: set[str]) -> None:
    """Record every global named in one pickle payload (no object is ever
    constructed).

    The protocol-0 opcode is GLOBAL (arg = 'module name'). From protocol 2
    on, the reference is STACK_GLOBAL, whose two operands are the two most
    recently pushed strings (module, then name). Both forms are captured —
    torch.save() writes protocol 2+, so a GLOBAL-only scan would see
    nothing at all (the lab's inspect script had that blind spot; this
    engine closes it).
    """
    stack: list[str] = []
    for opcode, arg, _ in pickletools.genops(payload):
        if opcode.name == "GLOBAL":
            module, _, name = str(arg).partition(" ")
            found.add(f"{module}.{name}")
        elif opcode.name == "STACK_GLOBAL":
            if len(stack) >= 2:
                module, name = stack[-2], stack[-1]
                found.add(f"{module}.{name}")
        elif opcode.name in ("SHORT_BINUNICODE", "UNICODE", "BINUNICODE"):
            value = arg if isinstance(arg, str) else str(arg, "utf-8", "replace")
            stack.append(value)
        elif opcode.name in ("SHORT_BINBYTES", "BINBYTES", "BINBYTES8"):
            stack.append(str(arg, "utf-8", "replace") if isinstance(arg, (bytes, bytearray)) else "")


def enumerate_globals(path) -> list[str]:
    """Non-executing scan of the checkpoint's pickle globals.

    A torch.save() artifact is a zip containing one or more .pkl payloads;
    a legacy single-file pickle is handled too. pickletools.genops decodes
    the op stream without constructing any object.
    """
    found: set[str] = set()
    try:
        with zipfile.ZipFile(path) as archive:
            payloads = [archive.read(n) for n in archive.namelist() if n.endswith(".pkl")]
    except zipfile.BadZipFile:
        payloads = [open(path, "rb").read()]
    for payload in payloads:
        _scan_payload(payload, found)
    return sorted(found)


def build_allow_list() -> dict[str, object]:
    """Resolve the allow-list names to objects, skipping what this install
    lacks (e.g. numpy 1.x vs 2.x module paths)."""
    import numpy as np

    resolved: dict[str, object] = {}
    alias = {"__builtin__": "builtins"}
    for full in SAFE_GLOBAL_NAMES:
        module_name, _, attr = full.rpartition(".")
        module_name = alias.get(module_name, module_name)
        if module_name.startswith("numpy.dtypes"):
            continue  # handled generically below
        try:
            resolved[full] = getattr(importlib.import_module(module_name), attr)
        except Exception:
            continue
    # numpy's dtype *classes* (numpy >= 1.25 exposes one per scalar type):
    # the unpickler needs the dtype *instance* types, not just numpy.dtype
    for name in dir(np.dtypes):
        if name.endswith("DType"):
            resolved[f"numpy.dtypes.{name}"] = getattr(np.dtypes, name)
    resolved["_codecs.encode"] = codecs.encode
    resolved["numpy.dtype"] = np.dtype
    return resolved


class CheckpointSecurityError(RuntimeError):
    """The checkpoint names globals outside the bounded allow-list."""


def register_safe_globals(globals_found) -> list[str]:
    """Register exactly the checkpoint's globals; return the list registered.

    Unknown globals raise — registering is a security decision, so it stays
    explicit and bounded rather than permissive.
    """
    unknown = unexplained_globals(globals_found)
    if unknown:
        raise CheckpointSecurityError(
            "the checkpoint names globals this engine has not allow-listed: "
            + ", ".join(unknown)
            + " — refusing to load"
        )
    import torch

    allow = build_allow_list()
    # Register the whole (bounded) allow-list, not only the names found in
    # the file: torch's unpickler also validates the types of constructed
    # objects, and a numpy dtype instance type never appears as a GLOBAL.
    # Objects are passed (not (obj, name) pairs) so the registry keys are
    # their real module paths.
    torch.serialization.add_safe_globals(list(allow.values()))
    return sorted(set(globals_found))
