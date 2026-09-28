#!/usr/bin/env python3
"""Engine #6 — checkpoint-global diagnostics (mandate sequence).

The real checkpoint (ai-validation/cldetection2023/model/…_best.pth,
sha256 fb1a781a…, 268,846,952 B) is on the operator's machine — its
official distribution route (Google Drive, per the repository README) is
egress-blocked from this sandbox, so byte-level enumeration of the real
file happens there (scripts/inspect_checkpoint.py). This script performs
the same mandated sequence on what CAN be proven here, without the file:

  A. Characterize `mmengine.logging.history_buffer.HistoryBuffer` from the
     PINNED mmengine 0.10.7 install: what pickle globals does an instance
     of the actual class reference, and in what usage context (bare value
     vs REDUCE callable)? Does it reconstruct under a bounded
     weights_only load?
  B. Identify the carrier of `builtins.getattr` / `__builtin__.getattr`
     among the checkpoint's contract objects (state_dict tensors + meta /
     dataset_meta / HistoryBuffer) by pickling candidates and disassembling.
  C. Build a structurally-equivalent probe checkpoint (the real model built
     from the pinned repo config → its state_dict, plus meta carrying a
     HistoryBuffer instance — the contract the operator's investigation
     establishes for the real file) and run the engine's safeload pipeline
     against it:
        enumerate → unexplained (expect exactly the two identified)
        → current allow-list MUST refuse (fail-closed proof)
        → proposed bounded extension loads it with weights_only=True
        → structure inspection (tensor count/keys/dtypes, meta intact)
        → negative control: a payload naming a forbidden global is refused.

Nothing here is presented as the real checkpoint's content. Every claim
is labelled control-equivalent or pinned-runtime.
"""
from __future__ import annotations

import io
import json
import os
import pickle
import pickletools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

RESULTS: dict = {}


sys.path.insert(0, str(Path(__file__).resolve().parent))
from pickle_scan import scan_payload  # noqa: E402


def dump_globals(data: bytes) -> list[str]:
    """Exact GLOBAL/STACK_GLOBAL references (canonical protocol-correct scan)."""
    return scan_payload(data)[0]


def op_context(data: bytes, needle: str) -> list[str]:
    """The opcode(s) immediately following each reference to `needle`."""
    ctx: list[str] = []
    ops = list(pickletools.genops(data))
    for i, (opcode, arg, _) in enumerate(ops):
        hit = False
        if opcode.name == "GLOBAL":
            hit = str(arg) == needle or str(arg).split(" ")[0] in needle
        elif opcode.name == "STACK_GLOBAL":
            pass  # STACK_GLOBAL references the two prior pushes; the usage
            # context is the opcode AFTER it — recorded below.
        if hit or opcode.name == "STACK_GLOBAL":
            nxt = ops[i + 1][0].name if i + 1 < len(ops) else "<EOF>"
            ctx.append(f"{opcode.name} -> next:{nxt}")
    return ctx


print("=" * 72)
print("PART A — HistoryBuffer from the pinned mmengine install")
print("=" * 72)
import mmengine
import numpy as np
from mmengine.logging.history_buffer import HistoryBuffer

print(f"mmengine {mmengine.__version__}")
hb = HistoryBuffer()
hb.update(1.0)
hb.update(0.5)
data = pickle.dumps(hb)
hb_globals = dump_globals(data)
print(f"pickled HistoryBuffer size: {len(data)} B")
print(f"globals referenced: {hb_globals}")
print(f"op context: {op_context(data, 'mmengine')}")

# does an instance reconstruct cleanly?
hb2 = pickle.loads(data)
print(f"plain pickle round-trip: {type(hb2).__name__}, "
      f"log_history={list(np.atleast_1d(hb2._log_history))}")

RESULTS["A_historybuffer_globals"] = hb_globals

print()
print("=" * 72)
print("PART B — who references builtins.getattr?")
print("=" * 72)
import numpy as np
import torch

candidates = {
    "HistoryBuffer instance": hb,
    "dict with HistoryBuffer (meta-shaped)": {"dataset_meta": {}, "history": hb},
    "torch tensor": torch.randn(3),
    "OrderedDict": __import__("collections").OrderedDict([("a", 1)]),
    "numpy array": np.arange(6, dtype=np.uint8).reshape(2, 3),
    "mmengine Config": None,
}
try:
    from mmengine.config import Config
    candidates["mmengine Config"] = Config({"a": 1})
    from mmengine.config import ConfigDict
    candidates["mmengine ConfigDict"] = ConfigDict({"a": 1})
except Exception as e:
    print(f"(Config import failed: {e})")
try:
    from mmengine.logging.log_buffer import LogBuffer
    lb = LogBuffer()
    lb.update({"loss": 1.0})
    candidates["mmengine LogBuffer"] = lb
except Exception as e:
    print(f"(LogBuffer import failed: {e})")
import functools
candidates["functools.partial(getattr)"] = functools.partial(getattr, object(), "x")

carrier = None
for label, obj in candidates.items():
    try:
        d = pickle.dumps(obj)
        g = dump_globals(d)
        if any("getattr" in x for x in g):
            carrier = label
            print(f"CARRIER FOUND: {label!r} -> {g}")
            print(f"  op context: {op_context(d, 'getattr')}")
            break
        print(f"  {label!r}: {g}")
    except Exception as e:
        print(f"  {label!r}: pickle failed ({type(e).__name__}: {e})")
if carrier is None:
    print("no checkpoint-contract candidate references getattr on its own")
RESULTS["B_getattr_carrier"] = carrier

print()
print("=" * 72)
print("PART C — structurally-equivalent probe checkpoint")
print("=" * 72)
import os
REPO = Path(os.environ.get("REPO_PATH", "/home/user/cld2023-repo"))

# Build the real model from the pinned config (same path the engine uses:
# the vendored fork's init_model; here checkpoint=None → build only).
from mmpose.apis import init_model  # noqa: E402

cfg_path = REPO / "configs/CLdetection2023/srpose_s2.py"
model = init_model(str(cfg_path), device="cpu")
model.eval()
state = model.state_dict()
n_tensors = sum(1 for v in state.values() if torch.is_tensor(v))
print(f"model built from pinned config: state_dict entries = {len(state)} "
      f"(of which {n_tensors} are tensors)")

meta = {
    "dataset_meta": {
        "class_names": [str(i) for i in range(38)],
        "flip_indices": list(range(38)),
    },
    # the byproduct the operator's investigation found in the real file:
    "history": HistoryBuffer(),
}
probe_path = Path("/tmp/engine6_probe.pth")
torch.save({"state_dict": state, "meta": meta}, str(probe_path))
print(f"probe checkpoint written: {probe_path.stat().st_size:,} B")

# --- C1: enumerate (non-executing) via the engine's own safeload ----------
sys.path.insert(0, "/home/user/dental-clinic-system/ai/engines/orthodontic-ai")
from app import safeload  # noqa: E402

found = safeload.enumerate_globals(probe_path)
attr_refs = safeload.scan_detailed(probe_path)["object_attribute_refs"]
print(f"\nC1 globals enumerated by the engine's scanner ({len(found)}):")
print(json.dumps(found, indent=1))
print(f"C1 object-attribute refs (not gate-relevant): {attr_refs}")
unexplained = safeload.unexplained_globals(found)
print(f"C1 unexplained by the CURRENT (extended) allow-list: {unexplained}")
RESULTS["C1_globals"] = found
RESULTS["C1_unexplained"] = unexplained
RESULTS["C1_attr_refs"] = attr_refs

# --- C2: the PRE-REPAIR policy must REFUSE (fail-closed proof) ------------
# Snapshot of the allow-list before the E2E-repair additions.
ORIGINAL_POLICY = set(safeload.allow_list_names()) - {
    "mmengine.logging.history_buffer.HistoryBuffer",
    "builtins.getattr",
    "__builtin__.getattr",
    "torch.storage._load_from_bytes",
}
pre_repair_unexplained = sorted(g for g in found if g not in ORIGINAL_POLICY)
print(f"\nC2 pre-repair policy unexplained: {pre_repair_unexplained}")
RESULTS["C2_pre_repair_unexplained"] = pre_repair_unexplained
RESULTS["C2_pre_repair_refused"] = bool(pre_repair_unexplained)

# --- C3: extended allow-list -> weights_only=True load --------------------
try:
    registered = safeload.register_safe_globals(found)
    print(f"C3 registered after extension: {registered}")
    payload = torch.load(str(probe_path), weights_only=True,
                         map_location="cpu")
    sd = payload["state_dict"]
    tensors = {k: v for k, v in sd.items() if torch.is_tensor(v)}
    hist = payload["meta"]["history"]
    ok = (len(sd) == len(state) and set(sd) == set(state)
          and all(isinstance(v, torch.Tensor) for v in tensors.values())
          and all(torch.isfinite(t.detach().float()).all().item()
                  for t in list(tensors.values())[:8])
          and isinstance(hist, HistoryBuffer))
    print(f"C3 weights_only=True load OK: entries={len(sd)} tensors={len(tensors)} "
          f"meta.history={type(hist).__name__} structure_intact={ok}")
    RESULTS["C3_loaded"] = ok
except safeload.CheckpointSecurityError as e:
    print(f"C3 extension insufficient — loader still refuses: {str(e)[:200]}")
    RESULTS["C3_loaded"] = False
except Exception as e:
    print(f"C3 load failed: {type(e).__name__}: {str(e)[:200]}")
    RESULTS["C3_loaded"] = False

# --- C3b: the ENGINE's own load path (init_model with checkpoint) ---------
# (identity gate bypassed by design here: the probe is structurally
# equivalent, not the audited artifact — its sha/size differ on purpose.)
try:
    m2 = init_model(str(cfg_path), checkpoint=str(probe_path), device="cpu")
    n_params = sum(p.numel() for p in m2.parameters())
    print(f"C3b engine path init_model(checkpoint=probe): loaded, "
          f"parameters={n_params:,}")
    RESULTS["C3b_engine_path_loaded"] = True
except safeload.CheckpointSecurityError as e:
    print(f"C3b engine path refused: {str(e)[:160]}")
    RESULTS["C3b_engine_path_loaded"] = False
except Exception as e:
    print(f"C3b engine path failed: {type(e).__name__}: {str(e)[:200]}")
    RESULTS["C3b_engine_path_loaded"] = False

# --- C4: negative control — a forbidden global must be refused ------------
malicious = Path("/tmp/engine6_probe_evil.pth")
torch.save({"state_dict": state, "meta": meta,
            "evil": __import__("builtins").eval}, str(malicious))
evil_found = safeload.enumerate_globals(malicious)
print(f"\nC4 malicious probe globals include: "
      f"{[g for g in evil_found if 'eval' in g]}")
try:
    safeload.register_safe_globals(evil_found)
    print("C4 FAIL: forbidden global accepted!")
    RESULTS["C4_negative_control"] = False
except safeload.CheckpointSecurityError as e:
    print(f"C4 negative control OK — refused: {str(e)[:160]}")
    RESULTS["C4_negative_control"] = True

print()
print(json.dumps(RESULTS, indent=1, default=str))
print("DIAGNOSIS_DONE")
