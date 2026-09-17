#!/usr/bin/env python3
"""
artifacts.py — the single source of truth for what this lab expects to find.

Every value here was read from the official Hugging Face API for the exact
repository revision, not inferred and not guessed:

    https://huggingface.co/api/models/naazimsnh02/dentalgemma-1.5-4b-it-GGUF
    https://huggingface.co/api/models/naazimsnh02/dentalgemma-1.5-4b-it-GGUF/tree/main

The GGUF files are stored through Hugging Face's large-file support, and the
`lfs.oid` field in that tree listing is the **SHA-256 of the file content**.
Those are the two digest values below. They are therefore *expected* values from
the publisher's own metadata — not hashes computed by this lab and not invented.
A local run always computes its own digest and reports it as LOCAL HASH, whether
or not it matches.

Nothing in this file downloads, executes or verifies anything by itself.
"""

from __future__ import annotations

# The exact repository revision the recorded sizes and digests describe.
# Pinning it matters: a later force-push could replace the files.
GGUF_REPO = {
    "id": "naazimsnh02/dentalgemma-1.5-4b-it-GGUF",
    "revision": "81e65fb2a242aebadaeb78900d79aa5af1fd5ce7",
    "gated": False,
    "private": False,
    "license_declared": "apache-2.0",
    "last_modified": "2026-02-23T00:32:40.000Z",
    "downloads": 216,
    "likes": 0,
    "pipeline_tag": "image-text-to-text",
    "gguf_architecture": "gemma3",
    "gguf_context_length": 131072,
    "gguf_total_parameters": 4551515648,
    "used_storage_bytes": 3726927296,
}

FINETUNE_REPO = {
    "id": "naazimsnh02/dentalgemma-1.5-4b-it",
    "revision": "ffb71c2e3fb6ccf8c958696a5265ece1e2d06240",
    "gated": False,
    "license_declared": "apache-2.0",
    "last_modified": "2026-02-24T02:27:37.000Z",
    "architectures": ["Gemma3ForConditionalGeneration"],
    "safetensors_parameters": 4971331952,
    "tags_include": ["LoRA", "PEFT", "base_model:google/medgemma-1.5-4b-it"],
}

BASE_REPO = {
    "id": "google/medgemma-1.5-4b-it",
    "revision": "91850547d9f0b2fdd21aa7c5f4f3d1a8a52c243b",
    "gated": "auto",
    "license": "other",
    "license_name": "health-ai-developer-foundations",
    "license_link": "https://developers.google.com/health-ai-developer-foundations/terms",
    "last_modified": "2026-04-13T23:20:55.000Z",
    "architectures": ["Gemma3ForConditionalGeneration"],
    "safetensors_parameters": 4300079472,
    "downloads": 356784,
    "likes": 886,
}

# The two files llama.cpp needs for image input: the language model and the
# matching multimodal projector. Both are required; the projector alone cannot
# generate text and the language model alone cannot see the image.
ARTIFACTS = {
    "main": {
        "filename": "dentalgemma-4b-Q4_K_M.gguf",
        "role": "main language model, Q4_K_M quantised",
        "size_bytes": 2875676064,
        "sha256_expected": "311ea621a01960e2b4b908adbe8a0b5312201bd0025c92e387150acb3a321c03",
        "sha256_origin": "Hugging Face LFS metadata (lfs.oid) for the pinned revision",
        "xet_hash": "0676e821a7b8ee37821d02da1de2befec99d681b32953b559ad9cfbaf16a2f8f",
        "expected_architecture": "gemma3",
    },
    "mmproj": {
        "filename": "dentalgemma-mmproj-f16.gguf",
        "role": "multimodal projector (vision encoder + projection), f16",
        "size_bytes": 851251232,
        "sha256_expected": "3d03262e058316c318c6dd4868c11fdccef68ec4af6d2ebea54bd1865b8c8113",
        "sha256_origin": "Hugging Face LFS metadata (lfs.oid) for the pinned revision",
        "xet_hash": "7376495778bd7c615af8eb471ca92b2203cd48382c4a83fa04bccfa6ccf2afa1",
        "expected_architecture": "clip",
    },
}

DOWNLOAD_BASE = f"https://huggingface.co/{GGUF_REPO['id']}/resolve/{GGUF_REPO['revision']}"

# Total bytes a complete download occupies on disk.
TOTAL_BYTES = sum(a["size_bytes"] for a in ARTIFACTS.values())

# Report status vocabulary. OPERATIONAL is never set by this lab's static code:
# only a completed local inference that produced non-empty text may set it.
STATUS_UNKNOWN = "UNKNOWN"
STATUS_BLOCKED = "BLOCKED"
STATUS_FAILED = "FAILED"
STATUS_OPERATIONAL = "OPERATIONAL"
ALLOWED_STATUSES = (STATUS_UNKNOWN, STATUS_BLOCKED, STATUS_FAILED, STATUS_OPERATIONAL)


def source_url(role: str) -> str:
    """Official download URL for one artifact, at the pinned revision."""
    return f"{DOWNLOAD_BASE}/{ARTIFACTS[role]['filename']}"
