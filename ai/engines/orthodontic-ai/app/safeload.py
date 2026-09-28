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
    # --- additions forced by the audited real checkpoint (E2E repair) ----
    # torch 2.6's zip pickling references this when rebuilding storages
    # from the archive's data files: a pure data reader (storage bytes ->
    # storage object), no code from the checkpoint executes.
    "torch.storage._load_from_bytes",
    # The audited 268,846,952-byte checkpoint (sha256 fb1a781a…, per
    # AUDIT.md §5-6) names exactly two globals beyond the set above —
    # found by the operator's checkpoint scan, resolved here against the
    # pinned runtime (AUDIT.md §10):
    #
    # mmengine.logging.history_buffer.HistoryBuffer — a log-history data
    #   container from the pinned mmengine 0.10.7. Its pickled instance
    #   state is (int, two numpy arrays, a dict of class method
    #   references); reconstruction is the default __setstate__ (dict
    #   update) — no code from the checkpoint runs. The dict's four
    #   dotted method names are STACK_GLOBAL attribute reads on the
    #   memoised class object (no import, no find_class gate).
    #   Sandbox proof: ai-validation/cldetection2023/scripts/
    #   diagnose_globals.py, parts A/C (structurally-equivalent probe
    #   loads under weights_only=True with this entry added).
    "mmengine.logging.history_buffer.HistoryBuffer",
    # getattr — attribute READ only. It is deliberately NOT in the lab's
    # FORBIDDEN_BUILTINS (which excludes code-execution primitives:
    # eval/exec/compile/open/__import__/…). Registered as the real
    # builtin resolved from the runtime (never a re-implementation): the
    # object graph it can touch is itself restricted to registered safe
    # globals. Final confirmation of usage context on the real file
    # happens via inspect_checkpoint.py --context before the operator's
    # load (AUDIT.md §10).
    "builtins.getattr",
    "__builtin__.getattr",
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


# ---------------------------------------------------------------------------
# Scan machinery (protocols 0–5). Kept in step with
# ai-validation/cldetection2023/scripts/pickle_scan.py (single canonical
# algorithm; the engine is deployed separately, so this is a copy).
#
# A STACK_GLOBAL whose module slot is a MEMOISED OBJECT (BINGET) is an
# attribute read on an already-constructed object — CPython's C unpickler
# performs getattr(obj, name) directly, with no import and no find_class
# call. Tracking the stack and the memo table lets the scanner tell those
# apart instead of pairing stale strings into phantom globals (which would
# then block the policy gate for names that exist in no module).
# ---------------------------------------------------------------------------
_OBJ = object()   # stack slot holding a constructed object
_MARK = object()  # MARK

_STRING_PUSH = frozenset({
    "SHORT_BINUNICODE", "UNICODE", "BINUNICODE", "BINUNICODE8",
    "SHORT_BINSTRING", "BINSTRING",
})
_OBJ_PUSH = frozenset({
    "SHORT_BINBYTES", "BINBYTES", "BINBYTES8",
    "BININT", "BININT1", "BININT2", "BININT4", "BININT8",
    "LONG1", "LONG4", "BINFLOAT", "LONG_BINFLOAT",
    "NEWTRUE", "NEWFALSE", "NONE",
    "EMPTY_DICT", "EMPTY_LIST", "EMPTY_SET", "EMPTY_TUPLE",
    "NEXT_BUFFER",
})
_POPTOMARK_PUSH1 = frozenset({"TUPLE", "LIST", "SETITEMS", "REDUCE"})
_POPN_PUSH1 = {"TUPLE1": 1, "TUPLE2": 2, "TUPLE3": 3, "BUILD": 2}
_NO_STACK_EFFECT = frozenset({"PROTO", "FRAME", "STOP"})


def _scan_payload(payload: bytes, found: set[str],
                  attr_refs: set[str]) -> None:
    """Record every real global reference in one pickle payload (no object
    is ever constructed). See the module note above for the rule at
    STACK_GLOBAL time."""
    stack: list = []
    memo: dict[int, object] = {}
    next_memo = 0

    def pop_to_mark() -> None:
        nonlocal stack
        while stack:
            value = stack.pop()
            if value is _MARK:
                break

    try:
        for opcode, arg, _ in pickletools.genops(payload):
            n = opcode.name
            if n in _STRING_PUSH:
                stack.append(arg if isinstance(arg, str)
                             else arg.decode("utf-8", "replace"))
            elif n in _OBJ_PUSH:
                stack.append(_OBJ)
            elif n == "MARK":
                stack.append(_MARK)
            elif n == "POP":
                if stack:
                    stack.pop()
            elif n == "POP_MARK":
                pop_to_mark()
            elif n == "MEMOIZE":
                if stack:
                    memo[next_memo] = stack[-1]
                    next_memo += 1
            elif n == "BINGET":
                stack.append(memo.get(int(arg), _OBJ))
            elif n in ("PPUT", "PUT", "BINPUT"):
                if stack:
                    memo[int(arg)] = stack.pop()
            elif n in ("BINPERSID", "PERSID"):
                if stack:
                    stack.pop()
                stack.append(_OBJ)
            elif n == "GLOBAL":
                module, _, name = str(arg).partition(" ")
                found.add(f"{module}.{name}")
                stack.append(_OBJ)  # the resolved object goes on the stack
            elif n == "STACK_GLOBAL":
                if len(stack) >= 2:
                    module, name = stack[-2], stack[-1]
                    if isinstance(module, str) and isinstance(name, str):
                        found.add(f"{module}.{name}")
                    elif isinstance(name, str):
                        attr_refs.add(name)
                    # consume the operands, push the resolved object — leaving
                    # them would pair stale strings into phantom globals
                    del stack[-2:]
                    stack.append(_OBJ)
            elif n in _POPTOMARK_PUSH1:
                pop_to_mark()
                stack.append(_OBJ)
            elif n in _POPN_PUSH1:
                for _ in range(_POPN_PUSH1[n]):
                    if stack:
                        stack.pop()
                stack.append(_OBJ)
            elif n == "APPENDS":
                pop_to_mark()
            elif n in _NO_STACK_EFFECT:
                continue
            else:
                stack, memo, next_memo = [], {}, 0  # unknown op: reset
    except Exception:
        pass  # malformed stream: whatever was captured stands; the load gate
              # still refuses anything not explicitly allow-listed


def scan_detailed(path) -> dict:
    """Non-executing scan: {"globals": [...], "object_attribute_refs": [...]}.

    A torch.save() artifact is a zip containing one or more .pkl payloads;
    a legacy single-file pickle is handled too. pickletools.genops decodes
    the op stream without constructing any object.
    """
    found: set[str] = set()
    attr_refs: set[str] = set()
    try:
        with zipfile.ZipFile(path) as archive:
            payloads = [archive.read(n) for n in archive.namelist()
                        if n.endswith(".pkl")]
    except zipfile.BadZipFile:
        with open(path, "rb") as fh:
            data = fh.read()
        payloads = [data] if data[:1] in (b"\x80", b"(") else []
    for payload in payloads:
        _scan_payload(payload, found, attr_refs)
    return {"globals": sorted(found),
            "object_attribute_refs": sorted(attr_refs)}


def enumerate_globals(path) -> list[str]:
    """Non-executing scan of the checkpoint's pickle globals."""
    return scan_detailed(path)["globals"]


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
