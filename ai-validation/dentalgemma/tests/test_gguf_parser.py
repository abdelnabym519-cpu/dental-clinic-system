#!/usr/bin/env python3
"""
test_gguf_parser.py — unit tests for scripts/gguf.py, with synthetic fixtures.

Everything in this file is built in a temporary directory by the test itself. The
bytes are a *hand-assembled GGUF header*, not a model: they exist to prove the
parser reads the container format correctly, and they are deleted with the
temporary directory when the test finishes. No real weights are involved, none
are downloaded, and nothing here should ever be mistaken for a model.

Why the parser has to be right: it is what stands between "these two files are a
pair" and a 2.68 GiB load that fails confusingly inside llama.cpp. A parser that
silently accepts anything would make the lab's verification step decorative.

Usage:
    python -m unittest discover -s tests -v
    python tests/test_gguf_parser.py
"""

from __future__ import annotations

import importlib.util
import struct
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
SCRIPTS = LAB / "scripts"


def _load(name: str, filename: str):
    path = SCRIPTS / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, module)
    spec.loader.exec_module(module)
    return module


gguf = _load("dg_gguf_test", "gguf.py")

# gguf metadata value type ids, repeated here so a change in gguf.py cannot
# silently change what these fixtures mean
UINT32, STRING, ARRAY, BOOL, FLOAT32 = 4, 8, 9, 7, 6


def kv_string(key: str, value: str) -> bytes:
    key_bytes = key.encode()
    value_bytes = value.encode()
    return (struct.pack("<Q", len(key_bytes)) + key_bytes
            + struct.pack("<I", STRING)
            + struct.pack("<Q", len(value_bytes)) + value_bytes)


def kv_uint32(key: str, value: int) -> bytes:
    key_bytes = key.encode()
    return (struct.pack("<Q", len(key_bytes)) + key_bytes
            + struct.pack("<I", UINT32) + struct.pack("<I", value))


def kv_bool(key: str, value: bool) -> bytes:
    key_bytes = key.encode()
    return (struct.pack("<Q", len(key_bytes)) + key_bytes
            + struct.pack("<I", BOOL) + struct.pack("<?", value))


def kv_int_array(key: str, values: list[int]) -> bytes:
    key_bytes = key.encode()
    body = struct.pack("<I", 5) + struct.pack("<Q", len(values))
    body += b"".join(struct.pack("<i", v) for v in values)
    return struct.pack("<Q", len(key_bytes)) + key_bytes + struct.pack("<I", ARRAY) + body


def kv_string_array(key: str, values: list[str]) -> bytes:
    key_bytes = key.encode()
    body = struct.pack("<I", STRING) + struct.pack("<Q", len(values))
    for value in values:
        raw = value.encode()
        body += struct.pack("<Q", len(raw)) + raw
    return struct.pack("<Q", len(key_bytes)) + key_bytes + struct.pack("<I", ARRAY) + body


def make_gguf(version: int, tensor_count: int, kvs: list[bytes],
              magic: bytes = b"GGUF", truncate_after: int | None = None) -> bytes:
    blob = (magic
            + struct.pack("<I", version)
            + struct.pack("<Q", tensor_count)
            + struct.pack("<Q", len(kvs)))
    blob += b"".join(kvs)
    if truncate_after is not None:
        blob = blob[:truncate_after]
    return blob


MAIN_KVS = [
    kv_string("general.architecture", "gemma3"),
    kv_string("general.name", "dentalgemma-4b"),
    kv_uint32("general.file_type", 15),
    kv_uint32("gemma3.embedding_length", 2560),
    kv_uint32("gemma3.context_length", 131072),
    kv_uint32("gemma3.block_count", 34),
]

MMPROJ_KVS = [
    kv_string("general.architecture", "clip"),
    kv_string("general.name", "dentalgemma-mmproj"),
    kv_string("clip.projector_type", "gemma3"),
    kv_bool("clip.has_vision_encoder", True),
    kv_bool("clip.has_audio_encoder", False),
    kv_uint32("clip.vision.projection_dim", 2560),
    kv_uint32("clip.vision.image_size", 896),
    kv_uint32("clip.vision.patch_size", 14),
]


class FixtureMixin(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="dentalgemma_gguf_fixture_")
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, blob: bytes) -> Path:
        path = self.tmp / name
        path.write_bytes(blob)
        return path


class TestHeader(FixtureMixin):
    def test_valid_header_is_read(self):
        path = self.write("main.gguf", make_gguf(3, 291, MAIN_KVS))
        parsed = gguf.read_metadata(path)
        self.assertEqual(parsed["header"]["magic"], "GGUF")
        self.assertEqual(parsed["header"]["version"], 3)
        self.assertTrue(parsed["header"]["version_supported"])
        self.assertEqual(parsed["header"]["tensor_count"], 291)
        self.assertEqual(parsed["header"]["metadata_kv_count"], len(MAIN_KVS))
        self.assertTrue(parsed["metadata_read"])

    def test_wrong_magic_is_rejected(self):
        path = self.write("bad.bin", make_gguf(3, 10, MAIN_KVS, magic=b"ZZZZ"))
        with self.assertRaises(gguf.GgufError) as ctx:
            gguf.read_metadata(path)
        self.assertIn("not a GGUF file", str(ctx.exception))

    def test_truncated_file_is_rejected(self):
        blob = make_gguf(3, 10, MAIN_KVS)[:12]      # header cut in half
        path = self.write("short.gguf", blob)
        with self.assertRaises(gguf.GgufError) as ctx:
            gguf.read_metadata(path)
        self.assertIn("unexpected end of file", str(ctx.exception))

    def test_empty_file_is_rejected(self):
        path = self.write("empty.gguf", b"")
        with self.assertRaises(gguf.GgufError):
            gguf.read_metadata(path)

    def test_unknown_version_is_reported_not_hidden(self):
        path = self.write("future.gguf", make_gguf(99, 1, MAIN_KVS))
        parsed = gguf.read_metadata(path)
        self.assertFalse(parsed["header"]["version_supported"])


class TestMetadataValues(FixtureMixin):
    def test_scalars_strings_bools_and_arrays(self):
        kvs = [
            kv_string("general.architecture", "gemma3"),
            kv_uint32("gemma3.context_length", 131072),
            kv_bool("clip.has_vision_encoder", True),
            kv_int_array("tokenizer.ggml.token_type", [1, 2, 3]),
            kv_string_array("tokenizer.ggml.tokens", ["<s>", "</s>", "tooth"]),
        ]
        path = self.write("mixed.gguf", make_gguf(3, 5, kvs))
        meta = gguf.read_metadata(path)["metadata"]
        self.assertEqual(meta["general.architecture"], "gemma3")
        self.assertEqual(meta["gemma3.context_length"], 131072)
        self.assertIs(meta["clip.has_vision_encoder"], True)
        self.assertEqual(meta["tokenizer.ggml.token_type"], [1, 2, 3])
        self.assertEqual(meta["tokenizer.ggml.tokens"], ["<s>", "</s>", "tooth"])

    def test_large_arrays_are_summarised_not_materialised(self):
        """A real tokenizer array holds ~262k strings; it must not be held."""
        kvs = [kv_string_array("tokenizer.ggml.tokens",
                              [f"tok{i}" for i in range(500)])]
        path = self.write("bigvocab.gguf", make_gguf(3, 1, kvs))
        meta = gguf.read_metadata(path)["metadata"]
        self.assertEqual(meta["tokenizer.ggml.tokens"],
                         {"array_of": "string", "count": 500})

    def test_truncated_metadata_reports_partial_read(self):
        blob = make_gguf(3, 3, MAIN_KVS)
        path = self.write("cut.gguf", blob[:len(blob) - 8])
        parsed = gguf.read_metadata(path)
        self.assertFalse(parsed["metadata_read"],
                         "a metadata block that could not be finished must say so")
        self.assertEqual(parsed["header"]["magic"], "GGUF")


class TestSummarise(FixtureMixin):
    def test_language_model_summary(self):
        path = self.write("main.gguf", make_gguf(3, 291, MAIN_KVS))
        summary = gguf.summarise(gguf.read_metadata(path))
        self.assertEqual(summary["architecture"], "gemma3")
        self.assertEqual(summary["name"], "dentalgemma-4b")
        self.assertEqual(summary["context_length"], 131072)
        self.assertEqual(summary["hidden_size"], 2560)
        self.assertFalse(summary["looks_like_projector"])
        self.assertEqual(summary["quantisation"]["general.file_type"], 15)

    def test_projector_summary(self):
        path = self.write("mmproj.gguf", make_gguf(3, 601, MMPROJ_KVS))
        summary = gguf.summarise(gguf.read_metadata(path))
        self.assertEqual(summary["architecture"], "clip")
        self.assertTrue(summary["looks_like_projector"])
        self.assertIs(summary["vision"]["clip.has_vision_encoder"], True)
        self.assertEqual(summary["vision"]["clip.vision.projection_dim"], 2560)


class TestPairing(FixtureMixin):
    def summaries(self, main_kvs=None, mm_kvs=None):
        main = gguf.summarise(gguf.read_metadata(
            self.write("main.gguf", make_gguf(3, 291, main_kvs or MAIN_KVS))))
        mm = gguf.summarise(gguf.read_metadata(
            self.write("mmproj.gguf", make_gguf(3, 601, mm_kvs or MMPROJ_KVS))))
        return main, mm

    def test_matching_pair_passes(self):
        main, mm = self.summaries()
        result = gguf.pairing_check(main, mm)
        self.assertTrue(result["all_ok"], result["findings"])
        self.assertGreater(result["checked"], 0)

    def test_mismatched_projection_dimension_fails(self):
        mm_kvs = [kv for kv in MMPROJ_KVS
                  if not kv.startswith(struct.pack("<Q", len(b"clip.vision.projection_dim")))]
        mm_kvs.append(kv_uint32("clip.vision.projection_dim", 1152))  # wrong size
        main, mm = self.summaries(mm_kvs=mm_kvs)
        result = gguf.pairing_check(main, mm)
        self.assertFalse(result["all_ok"])
        self.assertTrue(any("hidden size" in f["check"] for f in result["findings"]))

    def test_projector_without_vision_encoder_fails(self):
        mm_kvs = [kv for kv in MMPROJ_KVS
                  if not kv.startswith(struct.pack("<Q", len(b"clip.has_vision_encoder")))]
        mm_kvs.append(kv_bool("clip.has_vision_encoder", False))
        main, mm = self.summaries(mm_kvs=mm_kvs)
        result = gguf.pairing_check(main, mm)
        self.assertFalse(result["all_ok"])

    def test_language_model_is_not_accepted_as_a_projector(self):
        """Handing the same file twice must not pass a pairing check."""
        main = gguf.summarise(gguf.read_metadata(
            self.write("main.gguf", make_gguf(3, 291, MAIN_KVS))))
        result = gguf.pairing_check(main, main)
        self.assertFalse(result["all_ok"])


class TestNoModelWasTouched(unittest.TestCase):
    def test_real_model_directory_has_no_weights(self):
        """The lab must ship without any GGUF file (they are git-ignored)."""
        model_dir = LAB / "model"
        weights = list(model_dir.glob("*.gguf")) if model_dir.exists() else []
        self.assertEqual(weights, [],
                         f"the repository must not contain model weights: {weights}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
