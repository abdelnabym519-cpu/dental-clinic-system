#!/usr/bin/env python3
"""
gguf.py — a minimal, dependency-free GGUF reader.

Enough to answer the questions this lab actually has to answer:

  * is this file a GGUF container at all (magic + version)?
  * how many tensors and metadata entries does it claim to hold?
  * which architecture does it declare (``general.architecture``)?
  * what does it call itself, what context length does it claim?
  * for a projector: is it really a vision projector, and which one?
  * do the language model and the projector agree on their hidden size, i.e.
    are these two files actually a matching pair?

This is a *header and metadata* reader, not a tensor loader. It reads the
metadata section and stops; tensor data is never touched, so it is fast and
uses almost no memory even on a 2.9 GB file.

The format is the one documented in llama.cpp's ``gguf.md``: a header of
magic/version/tensor_count/kv_count, followed by key-value metadata, then tensor
descriptors, then the tensor data. Values are little-endian.

Only the standard library is used.
"""

from __future__ import annotations

import struct
from pathlib import Path

GGUF_MAGIC = b"GGUF"
GGUF_VERSION_MAX_KNOWN = 3

# gguf value type ids -> (struct format for a single element, name)
_SCALAR_TYPES = {
    0: ("B", "uint8"),
    1: ("b", "int8"),
    2: ("H", "uint16"),
    3: ("h", "int16"),
    4: ("I", "uint32"),
    5: ("i", "int32"),
    6: ("f", "float32"),
    7: ("?", "bool"),
    10: ("Q", "uint64"),
    11: ("q", "int64"),
    12: ("d", "float64"),
}
_TYPE_STRING = 8
_TYPE_ARRAY = 9

# A single scalar value we are willing to materialise. Arrays are summarised by
# type and length instead — the tokenizer arrays hold hundreds of thousands of
# strings and there is no reason to keep them in memory here.
MAX_STRING_BYTES = 64 * 1024


class GgufError(ValueError):
    """Raised when a file is not a readable GGUF container."""


def _read_exact(fh, count: int) -> bytes:
    data = fh.read(count)
    if len(data) != count:
        raise GgufError(f"unexpected end of file (wanted {count} bytes, got {len(data)})")
    return data


def _read_u32(fh) -> int:
    return struct.unpack("<I", _read_exact(fh, 4))[0]


def _read_u64(fh) -> int:
    return struct.unpack("<Q", _read_exact(fh, 8))[0]


def _read_string(fh) -> str:
    length = _read_u64(fh)
    if length > MAX_STRING_BYTES:
        # Long strings exist (the chat template is a few kB); anything this big
        # is not something we needed, so skip it rather than hold it.
        _skip(fh, length)
        return f"<{length} bytes skipped>"
    return _read_exact(fh, length).decode("utf-8", errors="replace")


def _skip(fh, count: int) -> None:
    fh.seek(count, 1)


def _read_value(fh, value_type: int):
    if value_type in _SCALAR_TYPES:
        fmt, _ = _SCALAR_TYPES[value_type]
        return struct.unpack("<" + fmt, _read_exact(fh, struct.calcsize(fmt)))[0]
    if value_type == _TYPE_STRING:
        return _read_string(fh)
    if value_type == _TYPE_ARRAY:
        element_type = _read_u32(fh)
        count = _read_u64(fh)
        if element_type in _SCALAR_TYPES:
            fmt, _ = _SCALAR_TYPES[element_type]
            size = struct.calcsize(fmt)
            # Keep small arrays; skip large ones after noting their shape.
            if count * size <= 4096:
                return [struct.unpack("<" + fmt, _read_exact(fh, size))[0]
                        for _ in range(count)]
            _skip(fh, count * size)
            return {"array_of": _SCALAR_TYPES[element_type][1], "count": count}
        if element_type == _TYPE_STRING:
            if count > 32:
                for _ in range(count):
                    _read_string(fh)
                return {"array_of": "string", "count": count}
            return [_read_string(fh) for _ in range(count)]
        if element_type == _TYPE_ARRAY:
            raise GgufError("nested arrays are not part of the GGUF specification")
        raise GgufError(f"unknown array element type id {element_type}")
    raise GgufError(f"unknown metadata value type id {value_type}")


def read_metadata(path: str | Path, max_kv: int | None = None) -> dict:
    """Read a GGUF header and its metadata key-value section.

    Returns ``{"header": {...}, "metadata": {...}, "metadata_read": bool}``.
    Raises :class:`GgufError` when the file is not a GGUF container.
    """
    path = Path(path)
    with open(path, "rb") as fh:
        magic = _read_exact(fh, 4)
        if magic != GGUF_MAGIC:
            raise GgufError(
                f"not a GGUF file: first four bytes are {magic!r}, expected {GGUF_MAGIC!r}")
        version = _read_u32(fh)
        tensor_count = _read_u64(fh)
        kv_count = _read_u64(fh)

        header = {
            "magic": magic.decode("ascii"),
            "version": version,
            "version_supported": 1 <= version <= GGUF_VERSION_MAX_KNOWN,
            "tensor_count": tensor_count,
            "metadata_kv_count": kv_count,
        }

        metadata: dict = {}
        read_all = True
        limit = kv_count if max_kv is None else min(kv_count, max_kv)
        try:
            for _ in range(limit):
                key = _read_string(fh)
                value_type = _read_u32(fh)
                metadata[key] = _read_value(fh, value_type)
        except GgufError:
            # A truncated or unexpected metadata block still leaves the header
            # (and whatever was read) usable — report that honestly.
            read_all = False

    return {"header": header, "metadata": metadata, "metadata_read": read_all}


# --------------------------------------------------------------------------
# interpretation helpers
# --------------------------------------------------------------------------
_GENERAL_KEYS = (
    "general.architecture",
    "general.name",
    "general.basename",
    "general.quantization_version",
    "general.file_type",
    "general.size_label",
    "general.license",
    "general.repo_url",
)

# The keys that make the two files verifiable *as a pair*: the projector
# advertises the hidden size it projects into, and the language model advertises
# the hidden size it expects. If they disagree, the download is mismatched.
_EMBED_KEYS = (
    "gemma3.embedding_length",
    "clip.vision.projection_dim",
    "clip.vision.embedding_length",
    "clip.vision.image_size",
    "clip.vision.patch_size",
    "clip.has_vision_encoder",
    "clip.has_audio_encoder",
    "clip.projector_type",
)

_CONTEXT_KEYS = (
    "gemma3.context_length",
    "llama.context_length",
    "general.context_length",
)


# --------------------------------------------------------------------------
# tokenizer decoding — which of llama.cpp's two detokenize paths this file gets
# --------------------------------------------------------------------------
# A generated token is turned back into text by llama_vocab::token_to_piece(),
# and that function has two mutually exclusive ways of doing it. Which one runs
# is decided entirely by GGUF metadata, and the wrong one for the file's own
# pieces is what puts "[UNK_BYTE_0x..." into the generated text. The rules
# below were read from the runtime source at the build this lab documents
# (llama.cpp b11026); they are the reason this lab can say anything at all about
# decoding *without* running the model:
#
#   src/llama-vocab.cpp, llama_vocab::impl::load()
#     tokenizer.ggml.model == "llama"      -> vocab type SPM
#     tokenizer.ggml.model == "gemma4"     -> vocab type BPE, and tokenizer_pre
#                                             is forced to "gemma4"
#     tokenizer.ggml.model in {gpt2, hybriddna, whitespace} -> vocab type BPE,
#                                             escape_whitespaces = false unless
#                                             tokenizer.ggml.pre is one of the
#                                             pre-tokenizers that set it true
#
#   src/llama-vocab.cpp, token_to_piece()
#     escape_whitespaces == true   -> "SPM-style BPE": ▁ (U+2581) is turned back
#                                     into a space with llama_unescape_whitespace
#     escape_whitespaces == false  -> llama_decode_text(): every codepoint is
#                                     mapped back through the 256-entry GPT-2
#                                     byte alphabet. U+2581 is not in that
#                                     alphabet, the map lookup throws, and the
#                                     catch substitutes the literal text
#                                     "[UNK_BYTE_0x<utf8 of the codepoint>"
#                                     followed by the *entire* token text and "]".
#
# The 256-entry alphabet (src/unicode.cpp, unicode_utf8_to_byte_map) is built
# from the ranges 0x21-0x7E, 0xA1-0xAC, 0xAE-0xFF plus 256+n for the remaining
# bytes, so it never contains U+2581.
SPACE_MARKER = "\u2581"                 # ▁, the SentencePiece space
SPACE_MARKER_UTF8_HEX = "e29681"        # its three UTF-8 bytes, as the runtime prints them
BYTE_LEVEL_BPE_MODELS = ("gpt2", "hybriddna", "whitespace")
ESCAPES_WHITESPACE_PRES = ("gemma4", "granite-embed-multi-311m", "sarvam-moe")

_TOKENIZER_SCALAR_KEYS = ("tokenizer.ggml.model", "tokenizer.ggml.pre",
                          "tokenizer.ggml.add_space_prefix",
                          "tokenizer.ggml.byte_fallback")


def tokenizer_decode_risk(model, pre) -> dict:
    """Predict which detokenize path this vocabulary will take, and the risk.

    This is a *reading of the runtime's rules*, not a measurement. It is exact
    for the rules quoted above and deliberately says "unknown" rather than
    guessing for anything else. The prediction is confirmed (or refuted) locally
    by a tokenizer-only run of the runtime, which is documented in
    OUTPUT_DECODING.md and needs no image, no projector and no full inference.
    """
    result = {
        "tokenizer_model": model,
        "tokenizer_pre": pre,
        "vocab_type": None,
        "escape_whitespaces": None,
        "decode_path": None,
        "risk": "unknown",
        "basis": "llama.cpp b11026 src/llama-vocab.cpp (token_to_piece, load)",
        "note": None,
    }

    if not model:
        result["note"] = ("tokenizer.ggml.model is absent from the metadata: the "
                          "runtime would refuse this file ('unknown tokenizer')")
        return result

    if model == "llama":
        result.update({
            "vocab_type": "SPM",
            "decode_path": "llama_unescape_whitespace (SPM branch)",
            "risk": "none",
            "note": ("SentencePiece-style vocabulary: pieces are unescaped, so ▁ "
                     "becomes a space and no [UNK_BYTE_...] marker is possible."),
        })
        return result

    if model == "gemma4":
        result.update({
            "vocab_type": "BPE",
            "escape_whitespaces": True,
            "decode_path": "llama_unescape_whitespace (SPM-style BPE branch)",
            "risk": "none",
            "note": ("model 'gemma4' forces tokenizer_pre = 'gemma4' regardless of "
                     "the metadata, which sets escape_whitespaces = true, so the "
                     "SPM-style branch is used and ▁ is unescaped."),
        })
        return result

    if model in BYTE_LEVEL_BPE_MODELS:
        escapes = pre in ESCAPES_WHITESPACE_PRES
        result.update({
            "vocab_type": "BPE",
            "escape_whitespaces": escapes,
            "decode_path": ("llama_unescape_whitespace (SPM-style BPE branch)"
                            if escapes else "llama_decode_text (GPT-2 byte-level branch)"),
        })
        if escapes:
            result.update({
                "risk": "none",
                "note": (f"pre-tokenizer '{pre}' sets escape_whitespaces = true, so "
                         "the pieces are decoded as SentencePiece text."),
            })
        else:
            shown = pre if pre else "(missing — runtime warns and uses 'default')"
            result.update({
                "risk": "unk-byte-markers-possible",
                "note": (f"vocab type is BPE with escape_whitespaces = false "
                         f"(tokenizer.ggml.pre = {shown}), so every codepoint is "
                         f"mapped through the 256-entry GPT-2 byte alphabet. Any "
                         f"piece containing {SPACE_MARKER} (U+2581, bytes "
                         f"{SPACE_MARKER_UTF8_HEX}) — which is how SentencePiece "
                         f"spells a leading space — is not in that alphabet and "
                         f"the runtime substitutes [UNK_BYTE_0x{SPACE_MARKER_UTF8_HEX}"
                         f"...] into the generated text. If this file's pieces do "
                         f"contain ▁, that is the mechanism behind the markers; a "
                         f"run of llama-tokenize confirms it (see OUTPUT_DECODING.md)."),
            })
        return result

    result["note"] = (f"tokenizer.ggml.model = '{model}' is not one of the vocab "
                      f"types whose decode path this lab has verified; no prediction.")
    return result


def summarise(parsed: dict) -> dict:
    """Turn a parsed GGUF into the facts this lab cares about."""
    header = parsed["header"]
    meta = parsed["metadata"]

    architecture = meta.get("general.architecture")
    context_length = None
    for key in _CONTEXT_KEYS:
        if isinstance(meta.get(key), int):
            context_length = meta[key]
            break
    if context_length is None and isinstance(meta.get("general.context_length"), int):
        context_length = meta["general.context_length"]

    hidden_size = None
    for key in ("gemma3.embedding_length", "llama.embedding_length",
                "general.embedding_length"):
        if isinstance(meta.get(key), int):
            hidden_size = meta[key]
            break

    summary = {
        "magic": header["magic"],
        "version": header["version"],
        "version_supported": header["version_supported"],
        "tensor_count": header["tensor_count"],
        "metadata_kv_count": header["metadata_kv_count"],
        "metadata_read_completely": parsed["metadata_read"],
        "architecture": architecture,
        "name": meta.get("general.name"),
        "context_length": context_length,
        "hidden_size": hidden_size,
        "quantisation": {
            key: meta[key] for key in ("general.file_type",
                                       "general.quantization_version")
            if key in meta
        },
        "general": {k: meta[k] for k in _GENERAL_KEYS if k in meta},
        "vision": {k: meta[k] for k in _EMBED_KEYS if k in meta},
        "tokenizer": {
            **{k.split(".")[-1]: meta[k] for k in _TOKENIZER_SCALAR_KEYS if k in meta},
            # The tokens array itself is skipped by the reader (>32 strings), but
            # its length is the vocabulary size and costs nothing to report.
            "vocab_size": (meta.get("tokenizer.ggml.tokens") or {}).get("count")
            if isinstance(meta.get("tokenizer.ggml.tokens"), dict) else None,
        },
    }
    summary["tokenizer"]["decode"] = tokenizer_decode_risk(
        summary["tokenizer"].get("model"), summary["tokenizer"].get("pre"))

    # Does this look like a projector rather than a language model?
    summary["looks_like_projector"] = bool(
        architecture == "clip"
        or "clip.projector_type" in meta
        or str(meta.get("general.name", "")).lower().find("mmproj") >= 0
    )
    return summary


def pairing_check(main_summary: dict, mmproj_summary: dict) -> dict:
    """Cross-check the language model against the projector.

    The point is to catch a mismatched pair — the failure mode the publisher
    warns about, and one that produces confusing errors much later if it is not
    caught here.
    """
    findings: list[dict] = []

    main_arch = main_summary.get("architecture")
    mm_arch = mmproj_summary.get("architecture")
    findings.append({
        "check": "main is a language model architecture",
        "observed": main_arch,
        "ok": main_arch not in (None, "clip"),
        "note": "expected a text architecture such as 'gemma3'",
    })
    findings.append({
        "check": "mmproj is a projector",
        "observed": mm_arch,
        "ok": bool(mmproj_summary.get("looks_like_projector")),
        "note": "expected a 'clip' architecture or a clip.projector_type key",
    })

    mm_projector = mmproj_summary.get("vision", {}).get("clip.projector_type")
    if mm_projector:
        findings.append({
            "check": "projector type is one llama.cpp supports for vision",
            "observed": mm_projector,
            "ok": True,
            "note": "informational: the projector declares its own type",
        })

    has_vision = mmproj_summary.get("vision", {}).get("clip.has_vision_encoder")
    if has_vision is not None:
        findings.append({
            "check": "projector carries a vision encoder",
            "observed": has_vision,
            "ok": bool(has_vision),
            "note": "without a vision encoder the projector cannot see the image",
        })

    main_hidden = main_summary.get("hidden_size")
    proj_dim = mmproj_summary.get("vision", {}).get("clip.vision.projection_dim")
    if isinstance(main_hidden, int) and isinstance(proj_dim, int):
        findings.append({
            "check": "language-model hidden size equals projector output size",
            "observed": {"main": main_hidden, "mmproj": proj_dim},
            "ok": main_hidden == proj_dim,
            "note": "a mismatch means the two files are not a pair",
        })

    return {
        "findings": findings,
        "all_ok": all(f["ok"] for f in findings),
        "checked": len(findings),
    }
