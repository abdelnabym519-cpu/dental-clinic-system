"""pickle_scan.py — non-executing GLOBAL / STACK_GLOBAL extraction (protocols 0–5).

Why this module exists
----------------------
Two earlier blind spots in the lab/engine checkpoint scanners, both fixed here:

1. **STACK_GLOBAL was missed.** Protocol-2+ streams (what ``torch.save`` writes)
   reference globals with STACK_GLOBAL, whose operands are the two most recent
   stack pushes — NOT a self-contained argument. A GLOBAL-only scan sees
   nothing at all in a torch checkpoint.

2. **Phantom globals from stale stack strings.** A naive scanner that keeps
   every pushed string and pairs ``stack[-2]``/``stack[-1]`` at STACK_GLOBAL
   time produces fake names whenever the module operand came from a MEMO
   (BINGET) instead of a fresh push — e.g. a pickled
   ``mmengine.logging.history_buffer.HistoryBuffer`` instance carries a
   ``statistics_methods`` dict whose four values are STACK_GLOBAL dotted
   attribute references onto the *memoized class object*, and the naive
   pairing reports ``min.HistoryBuffer.min`` and friends: names that exist in
   no module. Those phantoms then block the policy gate even though the load
   itself is safe (they are attribute reads on already-constructed objects,
   not imports).

This module emulates the pickle stack faithfully enough to tell the two
apart: string pushes are tracked as strings; every other push (integers,
containers, REDUCE results, BINGET of an object, …) is tracked as a
non-string sentinel; the MEMO table (MEMOIZE / BINPUT / PPUT / PUT / BINGET)
is honoured, so a BINGET of a memoized *string* resolves to that string while
a BINGET of a memoized *object* stays a sentinel.

The rule at STACK_GLOBAL time:
  * top two stack values are both strings → a real global reference
    ``f"{module}.{name}"`` (import happens here at load time);
  * the module slot is an object → an attribute read on a constructed object
    (CPython's C unpickler does ``getattr(obj, name)`` directly; no import,
    no ``find_class`` call) → counted separately, never a new global.

``GLOBAL`` (protocol 0) carries its own argument and is always a real
reference.

Nothing is ever unpickled here: no object is constructed, no code from the
stream runs. If an opcode outside the modelled set appears, the machine
resets — a conservative failure mode that can only lose a redundant
duplicate, never miss a first occurrence of a real reference (real first
occurrences always ride on the self-contained GLOBAL opcode or on two
adjacent string pushes, both modelled).
"""
from __future__ import annotations

import pickletools
import zipfile
from pathlib import Path

_OBJ = object()   # sentinel: a stack slot holding a constructed object
_MARK = object()  # sentinel: MARK


class _Machine:
    """A faithful-enough stack/memo emulation of one pickle payload."""

    def __init__(self) -> None:
        self.stack: list = []
        self.memo: dict[int, object] = {}
        self._next_memo = 0
        self.globals: list[str] = []
        self.object_attribute_refs: list[str] = []
        self.context: dict[str, list[str]] = {}

    # -- stack helpers ------------------------------------------------------
    def _push(self, value) -> None:
        self.stack.append(value)

    def _pop_to_mark(self) -> int:
        popped = 0
        while self.stack:
            value = self.stack.pop()
            if value is _MARK:
                break
            popped += 1
        return popped

    def _reset(self) -> None:
        self.stack = []
        self.memo = {}
        self._next_memo = 0

    # -- reference capture ---------------------------------------------------
    def _capture(self, module: str, name: str, following_ops: list[str]) -> None:
        ref = f"{module}.{name}"
        self.globals.append(ref)
        if ref not in self.context:
            self.context[ref] = following_ops

    # -- main loop -----------------------------------------------------------
    def run(self, payload: bytes) -> None:
        ops = list(pickletools.genops(payload))
        for i, (opcode, arg, _pos) in enumerate(ops):
            n = opcode.name
            if n in _STRING_PUSH:
                self._push(arg if isinstance(arg, str)
                           else arg.decode("utf-8", "replace"))
            elif n in _OBJ_PUSH:
                self._push(_OBJ)
            elif n == "MARK":
                self._push(_MARK)
            elif n == "POP":
                self.stack.pop() if self.stack else None
            elif n == "POP_MARK":
                self._pop_to_mark()
            elif n == "MEMOIZE":
                if self.stack:
                    self.memo[self._next_memo] = self.stack[-1]
                    self._next_memo += 1
            elif n == "BINGET":
                self._push(self.memo.get(int(arg), _OBJ))
            elif n in ("PPUT", "PUT", "BINPUT"):
                if self.stack:
                    self.memo[int(arg)] = self.stack.pop()
            elif n == "BINPERSID":
                if self.stack:
                    self.stack.pop()
                self._push(_OBJ)
                self.memo[self._next_memo] = _OBJ
                self._next_memo += 1
            elif n == "PERSID":
                if self.stack:
                    self.stack.pop()
                self._push(_OBJ)
            elif n == "GLOBAL":
                module, _, name = str(arg).partition(" ")
                self._capture(module, name, _following_ops(ops, i))
                self._push(_OBJ)  # the resolved object goes on the stack
            elif n == "STACK_GLOBAL":
                if len(self.stack) >= 2:
                    module, name = self.stack[-2], self.stack[-1]
                    if isinstance(module, str) and isinstance(name, str):
                        self._capture(module, name, _following_ops(ops, i))
                    elif isinstance(name, str):
                        # getattr(already-constructed object, name) — no import
                        self.object_attribute_refs.append(name)
                    # consume the operands, push the resolved object
                    self.stack = self.stack[:-2]
                    self._push(_OBJ)
                # (len < 2: malformed stream — the reset below will not fire;
                #  the capture simply did not happen, which is conservative)
            elif n in _POPTOMARK_PUSH1:
                self._pop_to_mark()
                self._push(_OBJ)
            elif n in _POPN_PUSH1:
                k = _POPN_PUSH1[n]
                for _ in range(k):
                    self.stack.pop() if self.stack else None
                self._push(_OBJ)
            elif n == "APPENDS":
                self._pop_to_mark()
            elif n in _NO_STACK_EFFECT:
                continue
            else:
                self._reset()  # unknown opcode: fail conservatively


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


def _following_ops(ops: list, i: int, n: int = 6) -> list[str]:
    return [op.name for op, _, _ in ops[i + 1:i + 1 + n]]


def scan_payload(payload: bytes) -> tuple[list[str], list[str], dict[str, list[str]]]:
    """(global names, object-attribute refs, context) for one payload."""
    m = _Machine()
    try:
        m.run(payload)
    except Exception:
        # a stream that cannot even be opcode-decoded is reported by callers
        # as unparseable; never crash the inspection
        pass
    return m.globals, m.object_attribute_refs, m.context


def payloads_of(path: Path) -> tuple[list[bytes], str]:
    """(payloads, container kind) for a torch zip archive or raw pickle file."""
    try:
        with zipfile.ZipFile(path) as archive:
            payloads = [archive.read(n) for n in archive.namelist()
                        if n.endswith(".pkl")]
            if payloads:
                return payloads, "torch-zip"
    except zipfile.BadZipFile:
        pass
    data = Path(path).read_bytes()
    if data[:1] in (b"\x80", b"("):
        return [data], "pickle-stream"
    return [], "not-a-pickle"


def scan_file(path: Path) -> dict:
    """Full non-executing scan of a checkpoint file.

    Returns {"globals": [...], "object_attribute_refs": [...],
             "context": {ref: [following opcodes]}, "container": str}.
    """
    payloads, kind = payloads_of(path)
    globals_found: list[str] = []
    attr_refs: list[str] = []
    context: dict[str, list[str]] = {}
    for payload in payloads:
        g, a, c = scan_payload(payload)
        globals_found.extend(g)
        attr_refs.extend(a)
        for ref, ops in c.items():
            context.setdefault(ref, ops)
    return {
        "globals": sorted(set(globals_found)),
        "object_attribute_refs": sorted(set(attr_refs)),
        "context": context,
        "container": kind,
    }
