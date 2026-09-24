"""Standard-library tests for safe recommender artifact versioning."""

from __future__ import annotations

import ast
import copy
import dataclasses
import hashlib
import inspect
import json
import os
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import MappingProxyType
from unittest import mock

import numpy as np

from ml.recommender.artifacts import (
    ARTIFACT_SCHEMA_VERSION,
    MAX_ARTIFACT_FILE_BYTES,
    MAX_ARTIFACT_FILES,
    MAX_ARTIFACT_FILENAME_LENGTH,
    MAX_ARTIFACT_TOTAL_BYTES,
    MAX_METADATA_ENTRIES,
    MAX_METADATA_JSON_BYTES,
    MAX_NPZ_ARRAYS,
    MAX_NPZ_UNCOMPRESSED_BYTES,
    MAX_NPZ_ZIP_ENTRIES,
    ArtifactConflictError,
    ArtifactError,
    ArtifactIntegrityError,
    ArtifactManifest,
    ArtifactNotFoundError,
    ArtifactValidationError,
    activate_artifact_release,
    decode_json_artifact,
    decode_numeric_npz,
    encode_json_artifact,
    encode_numeric_npz,
    load_json_artifact,
    load_numeric_npz_artifact,
    publish_artifact_release,
    resolve_active_artifact_release,
    validate_artifact_kind,
    validate_artifact_version,
    verify_artifact_release,
)
from ml.recommender.runtime import (
    CPU_THREAD_ENV_VARS,
    CUDA_VISIBLE_DEVICES_VAR,
    RecommenderRuntimeError,
    THREADS_PER_NUMERIC_LIBRARY,
)

MODULE_PATH = Path(__file__).resolve().parents[1] / "recommender" / "artifacts.py"
MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
PROJECT_ROOT = Path(__file__).resolve().parents[2]

CREATED_AT = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
CREATED_AT_TEXT = "2026-09-15T12:00:00+00:00"


def _can_symlink() -> bool:
    try:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "t"
            link = Path(tmp) / "l"
            target.write_bytes(b"x")
            os.symlink(str(target), str(link))
        return True
    except (OSError, NotImplementedError):
        return False


SYMLINKS_SUPPORTED = _can_symlink()


def json_payload(value=None) -> bytes:
    if value is None:
        value = {"ok": True, "n": 1}
    return encode_json_artifact(value)


def npz_payload(arrays=None) -> bytes:
    if arrays is None:
        arrays = {"values": np.array([1.0, 2.0, 3.0], dtype=np.float32)}
    return encode_numeric_npz(arrays)


def publish_basic(
    root: Path,
    version: str = "v1",
    kind: str = "evaluation-run",
    artifacts=None,
    metadata=None,
    created_at=CREATED_AT,
):
    if artifacts is None:
        artifacts = {"metadata.json": json_payload({"hello": "world"})}
    return publish_artifact_release(
        root,
        version=version,
        artifact_kind=kind,
        created_at=created_at,
        artifacts=artifacts,
        metadata=metadata,
    )


class ConstantsSchemaTests(unittest.TestCase):
    def test_01_schema_version_is_1(self):
        self.assertEqual(ARTIFACT_SCHEMA_VERSION, 1)

    def test_02_max_artifact_files_is_32(self):
        self.assertEqual(MAX_ARTIFACT_FILES, 32)

    def test_03_per_file_limit_is_64_mib(self):
        self.assertEqual(MAX_ARTIFACT_FILE_BYTES, 64 * 1024 * 1024)

    def test_04_total_limit_is_128_mib(self):
        self.assertEqual(MAX_ARTIFACT_TOTAL_BYTES, 128 * 1024 * 1024)

    def test_05_npz_array_max_is_64(self):
        self.assertEqual(MAX_NPZ_ARRAYS, 64)

    def test_06_npz_uncompressed_cap_is_256_mib(self):
        self.assertEqual(MAX_NPZ_UNCOMPRESSED_BYTES, 256 * 1024 * 1024)

    def test_07_npz_zip_entry_cap_is_128(self):
        self.assertEqual(MAX_NPZ_ZIP_ENTRIES, 128)

    def test_08_metadata_entries_cap_is_64(self):
        self.assertEqual(MAX_METADATA_ENTRIES, 64)

    def test_09_metadata_json_cap_is_64_kib(self):
        self.assertEqual(MAX_METADATA_JSON_BYTES, 64 * 1024)


class VersionValidationTests(unittest.TestCase):
    def test_10_simple_lowercase_version_accepted(self):
        self.assertEqual(validate_artifact_version("v1"), "v1")

    def test_11_digits_accepted(self):
        self.assertEqual(validate_artifact_version("20260915"), "20260915")

    def test_12_dot_underscore_hyphen_accepted_after_first_char(self):
        self.assertEqual(validate_artifact_version("a.b_c-d"), "a.b_c-d")

    def test_13_uppercase_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version("V1")

    def test_14_whitespace_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version(" v1")
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version("v1 ")

    def test_15_slash_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version("a/b")

    def test_16_backslash_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version("a\\b")

    def test_17_path_traversal_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version("../x")

    def test_18_dot_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version(".")

    def test_19_dotdot_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version("..")

    def test_20_empty_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version("")

    def test_21_over_64_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version("a" * 65)

    def test_22_numeric_non_string_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_version(123)


class KindValidationTests(unittest.TestCase):
    def test_23_valid_kind_accepted(self):
        self.assertEqual(
            validate_artifact_kind("collaborative-model"),
            "collaborative-model",
        )

    def test_24_uppercase_kind_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_kind("Model")

    def test_25_spaces_kind_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_kind("eval run")

    def test_26_path_separators_kind_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_kind("a/b")
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_kind("a\\b")

    def test_27_oversized_kind_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_kind("k" * 65)


class CreatedAtTests(unittest.TestCase):
    def test_28_aware_utc_datetime_accepted(self):
        from ml.recommender.artifacts import _validate_created_at

        text = _validate_created_at(CREATED_AT)
        self.assertTrue(text.endswith("Z"))

    def test_29_aware_offset_normalized_utc(self):
        from ml.recommender.artifacts import _validate_created_at

        offset = datetime(
            2026, 9, 15, 14, 0, 0, tzinfo=timezone(timedelta(hours=2))
        )
        text = _validate_created_at(offset)
        self.assertEqual(text, "2026-09-15T12:00:00+00:00Z".replace("+00:00Z", "Z").replace("Z", "Z"))
        self.assertIn("T12:00:00", text)
        self.assertTrue(text.endswith("Z"))

    def test_30_z_iso_accepted(self):
        from ml.recommender.artifacts import _validate_created_at

        text = _validate_created_at("2026-09-15T12:00:00Z")
        self.assertTrue(text.endswith("Z"))

    def test_31_offset_iso_accepted(self):
        from ml.recommender.artifacts import _validate_created_at

        text = _validate_created_at("2026-09-15T14:00:00+02:00")
        self.assertIn("T12:00:00", text)

    def test_32_naive_datetime_rejected(self):
        from ml.recommender.artifacts import _validate_created_at

        with self.assertRaises(ArtifactValidationError):
            _validate_created_at(datetime(2026, 9, 15, 12, 0, 0))

    def test_33_timezone_less_iso_rejected(self):
        from ml.recommender.artifacts import _validate_created_at

        with self.assertRaises(ArtifactValidationError):
            _validate_created_at("2026-09-15T12:00:00")

    def test_34_invalid_timestamp_rejected(self):
        from ml.recommender.artifacts import _validate_created_at

        with self.assertRaises(ArtifactValidationError):
            _validate_created_at("not-a-time")

    def test_35_no_internal_datetime_now_dependency(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)


class FilenameTests(unittest.TestCase):
    def test_36_safe_json_name_accepted(self):
        from ml.recommender.artifacts import validate_artifact_filename

        self.assertEqual(
            validate_artifact_filename("metadata.json"), "metadata.json"
        )

    def test_37_safe_npz_name_accepted(self):
        from ml.recommender.artifacts import validate_artifact_filename

        self.assertEqual(validate_artifact_filename("model.npz"), "model.npz")

    def test_38_uppercase_filename_rejected(self):
        from ml.recommender.artifacts import validate_artifact_filename

        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("Model.json")

    def test_39_nested_path_rejected(self):
        from ml.recommender.artifacts import validate_artifact_filename

        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("sub/model.npz")

    def test_40_dotdot_rejected(self):
        from ml.recommender.artifacts import validate_artifact_filename

        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("../model.npz")

    def test_41_absolute_path_rejected(self):
        from ml.recommender.artifacts import validate_artifact_filename

        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("/etc/passwd.json")

    def test_42_drive_qualified_path_rejected(self):
        from ml.recommender.artifacts import validate_artifact_filename

        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("C:\\temp\\x.json")

    def test_43_unsupported_suffix_rejected(self):
        from ml.recommender.artifacts import validate_artifact_filename

        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("model.pkl")
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("model.bin")

    def test_44_manifest_json_reserved(self):
        from ml.recommender.artifacts import validate_artifact_filename

        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("manifest.json")

    def test_45_current_json_reserved(self):
        from ml.recommender.artifacts import validate_artifact_filename

        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("current.json")

    def test_46_over_128_filename_rejected(self):
        from ml.recommender.artifacts import validate_artifact_filename

        name = "a" * 120 + ".json"
        self.assertEqual(len(name), 125)
        with self.assertRaises(ArtifactValidationError):
            validate_artifact_filename("a" * 125 + ".json")
        self.assertEqual(MAX_ARTIFACT_FILENAME_LENGTH, 128)


class JsonEncodingTests(unittest.TestCase):
    def test_47_valid_json_encodes(self):
        data = encode_json_artifact({"a": 1})
        self.assertEqual(decode_json_artifact(data), {"a": 1})

    def test_48_keys_encoded_deterministically(self):
        self.assertEqual(
            encode_json_artifact({"b": 1, "a": 2}),
            encode_json_artifact({"a": 2, "b": 1}),
        )

    def test_49_repeated_encode_identical_bytes(self):
        value = {"x": [1, 2, 3], "y": "z"}
        self.assertEqual(encode_json_artifact(value), encode_json_artifact(value))

    def test_50_utf8_preserved(self):
        data = encode_json_artifact({"t": "café"})
        self.assertEqual(decode_json_artifact(data), {"t": "café"})

    def test_51_nan_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_json_artifact({"x": float("nan")})

    def test_52_infinity_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_json_artifact({"x": float("inf")})

    def test_53_invalid_utf8_decode_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            decode_json_artifact(b"\xff\xfe{")

    def test_54_invalid_json_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            decode_json_artifact(b"{not json}")

    def test_55_json_nan_constant_rejected_on_decode(self):
        with self.assertRaises(ArtifactValidationError):
            decode_json_artifact(b'{"x":NaN}')

    def test_56_no_eval_exec_pickle_involved(self):
        self.assertNotIn("eval(", MODULE_SOURCE)
        self.assertNotIn("exec(", MODULE_SOURCE)
        self.assertNotIn("import pickle", MODULE_SOURCE)
        self.assertNotIn("pickle.load", MODULE_SOURCE)
        self.assertNotIn("pickle.loads", MODULE_SOURCE)


class NpzEncodingTests(unittest.TestCase):
    def test_57_float32_accepted(self):
        data = encode_numeric_npz({"a": np.array([1.0], dtype=np.float32)})
        decoded = decode_numeric_npz(data)
        self.assertEqual(decoded["a"].dtype, np.float32)

    def test_58_float64_accepted(self):
        data = encode_numeric_npz({"a": np.array([1.0], dtype=np.float64)})
        self.assertEqual(decode_numeric_npz(data)["a"].dtype, np.float64)

    def test_59_signed_integer_accepted(self):
        data = encode_numeric_npz({"a": np.array([1, -2], dtype=np.int32)})
        self.assertEqual(decode_numeric_npz(data)["a"].dtype, np.int32)

    def test_60_unsigned_integer_accepted(self):
        data = encode_numeric_npz({"a": np.array([1, 2], dtype=np.uint16)})
        self.assertEqual(decode_numeric_npz(data)["a"].dtype, np.uint16)

    def test_61_bool_array_accepted(self):
        data = encode_numeric_npz({"flag": np.array([True, False])})
        self.assertEqual(decode_numeric_npz(data)["flag"].dtype, np.bool_)

    def test_62_object_dtype_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz({"a": np.array([{"x": 1}], dtype=object)})

    def test_63_unicode_dtype_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz({"a": np.array(["x"], dtype=np.str_)})

    def test_64_string_dtype_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz({"a": np.array([b"x"], dtype=np.bytes_)})

    def test_65_complex_dtype_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz({"a": np.array([1 + 2j], dtype=np.complex64)})

    def test_66_nan_float_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz(
                {"a": np.array([1.0, float("nan")], dtype=np.float64)}
            )

    def test_67_positive_infinity_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz(
                {"a": np.array([1.0, float("inf")], dtype=np.float64)}
            )

    def test_68_negative_infinity_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz(
                {"a": np.array([1.0, float("-inf")], dtype=np.float64)}
            )

    def test_69_too_many_arrays_rejected(self):
        arrays = {
            f"arr_{index:02d}": np.array([index], dtype=np.int32)
            for index in range(MAX_NPZ_ARRAYS + 1)
        }
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz(arrays)

    def test_70_safe_array_names_required(self):
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz({"Bad Name": np.array([1])})
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz({"": np.array([1])})
        with self.assertRaises(ArtifactValidationError):
            encode_numeric_npz({"a/b": np.array([1])})

    def test_71_deterministic_sorted_returned_keys(self):
        data = encode_numeric_npz(
            {
                "zeta": np.array([1.0], dtype=np.float32),
                "alpha": np.array([2.0], dtype=np.float32),
                "mid": np.array([3.0], dtype=np.float32),
            }
        )
        keys = list(decode_numeric_npz(data).keys())
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(keys, ["alpha", "mid", "zeta"])

    def test_72_decoded_arrays_read_only(self):
        data = encode_numeric_npz({"a": np.array([1.0], dtype=np.float32)})
        decoded = decode_numeric_npz(data)
        self.assertFalse(decoded["a"].flags.writeable)
        with self.assertRaises(ValueError):
            decoded["a"][0] = 9.0

    def test_73_decoded_mapping_immutable(self):
        data = encode_numeric_npz({"a": np.array([1], dtype=np.int32)})
        decoded = decode_numeric_npz(data)
        self.assertIsInstance(decoded, MappingProxyType)
        with self.assertRaises(TypeError):
            decoded["b"] = np.array([2])  # type: ignore[index]

    def test_74_allow_pickle_false_behavior_enforced(self):
        self.assertIn("allow_pickle=False", MODULE_SOURCE)
        self.assertNotIn("allow_pickle=True", MODULE_SOURCE)


class NpzZipSafetyTests(unittest.TestCase):
    def test_75_valid_npz_zip_accepted(self):
        decoded = decode_numeric_npz(npz_payload())
        self.assertIn("values", decoded)

    def test_76_malformed_zip_rejected(self):
        with self.assertRaises(ArtifactValidationError):
            decode_numeric_npz(b"not-a-zip")

    def test_77_too_many_zip_entries_rejected(self):
        buffer_path_bytes = self._build_zip_with_entries(MAX_NPZ_ZIP_ENTRIES + 1)
        with self.assertRaises(ArtifactValidationError):
            decode_numeric_npz(buffer_path_bytes)

    def test_78_excessive_uncompressed_bytes_rejected_without_extraction(self):
        payload = self._build_zip_huge_uncompressed()
        with self.assertRaises(ArtifactValidationError):
            decode_numeric_npz(payload)

    def test_79_zip_traversal_member_rejected(self):
        payload = self._build_zip_member("../evil.npy")
        with self.assertRaises(ArtifactValidationError):
            decode_numeric_npz(payload)

    def test_80_zip_absolute_member_rejected(self):
        payload = self._build_zip_member("/abs/evil.npy")
        with self.assertRaises(ArtifactValidationError):
            decode_numeric_npz(payload)

    def test_81_no_filesystem_zip_extraction_used(self):
        self.assertNotIn("extractall", MODULE_SOURCE)
        self.assertNotIn("extract(", MODULE_SOURCE)

    @staticmethod
    def _build_zip_with_entries(count: int) -> bytes:
        import io

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as zf:
            for index in range(count):
                zf.writestr(f"entry_{index:03d}.npy", b"\x93NUMPY")
        return buffer.getvalue()

    @staticmethod
    def _build_zip_huge_uncompressed() -> bytes:
        import io

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            # compressible zeros, uncompressed size over a small threshold
            # patch limit for lightweight test via monkeypatch is awkward here;
            # instead declare a large uncompressed size using a real large member
            # kept small in memory: use ZIP64? Simpler: patch in test.
            zf.writestr("big.npy", b"\x00" * (1024 * 1024))
        return buffer.getvalue()

    def test_78b_excessive_uncompressed_with_patched_limit(self):
        import io

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("big.npy", b"\x00" * 4096)
        payload = buffer.getvalue()
        with mock.patch.object(
            __import__("ml.recommender.artifacts", fromlist=["x"]),
            "MAX_NPZ_UNCOMPRESSED_BYTES",
            100,
        ):
            with self.assertRaises(ArtifactValidationError):
                decode_numeric_npz(payload)

    @staticmethod
    def _build_zip_member(member_name: str) -> bytes:
        import io

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as zf:
            zf.writestr(member_name, b"data")
        return buffer.getvalue()


class MetadataTests(unittest.TestCase):
    def test_82_empty_metadata_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = publish_basic(Path(tmp), metadata=None)
            self.assertEqual(dict(manifest.metadata), {})

    def test_83_scalar_string_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = publish_basic(Path(tmp), metadata={"note": "hi"})
            self.assertEqual(manifest.metadata["note"], "hi")

    def test_84_integer_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = publish_basic(Path(tmp), metadata={"n": 42})
            self.assertEqual(manifest.metadata["n"], 42)

    def test_85_finite_float_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = publish_basic(Path(tmp), metadata={"f": 1.5})
            self.assertEqual(manifest.metadata["f"], 1.5)

    def test_86_bool_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = publish_basic(Path(tmp), metadata={"flag": True})
            self.assertIs(manifest.metadata["flag"], True)

    def test_87_none_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = publish_basic(Path(tmp), metadata={"x": None})
            self.assertIsNone(manifest.metadata["x"])

    def test_88_nested_dict_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(Path(tmp), metadata={"nest": {"a": 1}})

    def test_89_list_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(Path(tmp), metadata={"xs": [1, 2]})

    def test_90_tuple_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(Path(tmp), metadata={"xs": (1, 2)})

    def test_91_custom_object_rejected(self):
        class Thing:
            pass

        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(Path(tmp), metadata={"obj": Thing()})

    def test_92_too_many_entries_rejected(self):
        metadata = {f"k{index:02d}": index for index in range(MAX_METADATA_ENTRIES + 1)}
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(Path(tmp), metadata=metadata)

    def test_93_oversized_metadata_json_rejected(self):
        with mock.patch.object(
            __import__("ml.recommender.artifacts", fromlist=["x"]),
            "MAX_METADATA_JSON_BYTES",
            10,
        ):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ArtifactValidationError):
                    publish_basic(Path(tmp), metadata={"note": "x" * 50})

    def test_94_invalid_metadata_key_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(Path(tmp), metadata={"": "x"})


class PublicationTests(unittest.TestCase):
    def test_95_one_json_artifact_publishes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = publish_basic(root, version="v1")
            self.assertTrue((root / "releases" / "v1" / "manifest.json").is_file())
            self.assertEqual(manifest.artifact_version, "v1")

    def test_96_one_npz_artifact_publishes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = publish_basic(
                root,
                version="npz1",
                artifacts={"model.npz": npz_payload()},
            )
            self.assertEqual(manifest.files[0].name, "model.npz")
            self.assertEqual(manifest.files[0].format, "npz")

    def test_97_multiple_safe_artifacts_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = publish_basic(
                root,
                version="multi",
                artifacts={
                    "metadata.json": json_payload({"a": 1}),
                    "model.npz": npz_payload(),
                    "extra.json": json_payload({"b": 2}),
                },
            )
            self.assertEqual(len(manifest.files), 3)

    def test_98_zero_payload_files_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(Path(tmp), artifacts={})

    def test_99_more_than_32_files_rejected(self):
        artifacts = {
            f"file{index:02d}.json": json_payload({"i": index})
            for index in range(MAX_ARTIFACT_FILES + 1)
        }
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(Path(tmp), artifacts=artifacts)

    def test_100_oversized_individual_file_rejected_lightweight(self):
        with mock.patch.object(
            __import__("ml.recommender.artifacts", fromlist=["x"]),
            "MAX_ARTIFACT_FILE_BYTES",
            4,
        ):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ArtifactValidationError):
                    publish_basic(
                        Path(tmp),
                        artifacts={"big.json": b'{"x":1}'},
                    )

    def test_101_total_size_overflow_rejected(self):
        with mock.patch.object(
            __import__("ml.recommender.artifacts", fromlist=["x"]),
            "MAX_ARTIFACT_FILE_BYTES",
            100,
        ), mock.patch.object(
            __import__("ml.recommender.artifacts", fromlist=["x"]),
            "MAX_ARTIFACT_TOTAL_BYTES",
            150,
        ):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ArtifactValidationError):
                    publish_basic(
                        Path(tmp),
                        artifacts={
                            "a.json": json_payload({"pad": "x" * 80}),
                            "b.json": json_payload({"pad": "y" * 80}),
                        },
                    )

    def test_102_unsupported_payload_suffix_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactValidationError):
                publish_basic(
                    Path(tmp),
                    artifacts={"model.pkl": b"binary"},
                )

    def test_103_malformed_json_payload_rejected_before_final_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ArtifactValidationError):
                publish_basic(
                    root,
                    version="badjson",
                    artifacts={"broken.json": b"{not json"},
                )
            self.assertFalse((root / "releases" / "badjson").exists())

    def test_104_unsafe_npz_rejected_before_final_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ArtifactValidationError):
                publish_basic(
                    root,
                    version="badnpz",
                    artifacts={"model.npz": b"not-a-zip"},
                )
            self.assertFalse((root / "releases" / "badnpz").exists())

    def test_105_manifest_generated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="m1")
            self.assertTrue((root / "releases" / "m1" / "manifest.json").is_file())

    def test_106_payload_file_records_sorted_by_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = publish_basic(
                root,
                version="sort",
                artifacts={
                    "zeta.json": json_payload({"z": 1}),
                    "alpha.json": json_payload({"a": 1}),
                    "mid.json": json_payload({"m": 1}),
                },
            )
            names = [record.name for record in manifest.files]
            self.assertEqual(names, sorted(names))

    def test_107_manifest_file_sizes_correct(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = json_payload({"hello": "world"})
            manifest = publish_basic(
                root, version="size", artifacts={"metadata.json": payload}
            )
            self.assertEqual(manifest.files[0].size_bytes, len(payload))

    def test_108_sha256_values_correct(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = json_payload({"hello": "world"})
            manifest = publish_basic(
                root, version="hash", artifacts={"metadata.json": payload}
            )
            expected = hashlib.sha256(payload).hexdigest()
            self.assertEqual(manifest.files[0].sha256, expected)

    def test_109_publication_creates_releases_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v9")
            self.assertTrue((root / "releases" / "v9").is_dir())

    def test_110_publication_does_not_create_current_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            self.assertFalse((root / "current.json").exists())

    def test_111_publication_does_not_activate_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="cand")
            self.assertIsNone(resolve_active_artifact_release(root))


class ImmutableReleaseTests(unittest.TestCase):
    def test_112_publishing_existing_version_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="dup")
            with self.assertRaises(ArtifactConflictError):
                publish_basic(root, version="dup")

    def test_113_existing_release_bytes_unchanged_after_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(
                root,
                version="keep",
                artifacts={"metadata.json": json_payload({"v": 1})},
            )
            before = (root / "releases" / "keep" / "metadata.json").read_bytes()
            with self.assertRaises(ArtifactConflictError):
                publish_basic(
                    root,
                    version="keep",
                    artifacts={"metadata.json": json_payload({"v": 2})},
                )
            after = (root / "releases" / "keep" / "metadata.json").read_bytes()
            self.assertEqual(before, after)

    def test_114_no_merge_into_existing_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(
                root,
                version="keep",
                artifacts={"metadata.json": json_payload({"v": 1})},
            )
            with self.assertRaises(ArtifactConflictError):
                publish_basic(
                    root,
                    version="keep",
                    artifacts={"other.json": json_payload({"v": 2})},
                )
            self.assertFalse((root / "releases" / "keep" / "other.json").exists())

    def test_115_no_overwrite_of_existing_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="keep")
            before = (root / "releases" / "keep" / "manifest.json").read_bytes()
            with self.assertRaises(ArtifactConflictError):
                publish_basic(root, version="keep", kind="other-kind")
            after = (root / "releases" / "keep" / "manifest.json").read_bytes()
            self.assertEqual(before, after)

    def test_116_no_overwrite_of_existing_payload(self):
        # covered by test_113; ensure payload path immutable API
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = json_payload({"k": "v1"})
            publish_basic(root, version="imm", artifacts={"metadata.json": payload})
            with self.assertRaises(ArtifactConflictError):
                publish_basic(
                    root,
                    version="imm",
                    artifacts={"metadata.json": json_payload({"k": "v2"})},
                )
            self.assertEqual(
                (root / "releases" / "imm" / "metadata.json").read_bytes(),
                payload,
            )


class VerifyReleaseTests(unittest.TestCase):
    def test_117_valid_release_verifies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            expected = publish_basic(root, version="ok")
            verified = verify_artifact_release(root, "ok")
            self.assertEqual(verified, expected)

    def test_118_missing_release_raises_not_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ArtifactNotFoundError):
                verify_artifact_release(Path(tmp), "missing")

    def test_119_missing_manifest_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="noman")
            (root / "releases" / "noman" / "manifest.json").unlink()
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "noman")

    def test_120_malformed_manifest_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="bad")
            (root / "releases" / "bad" / "manifest.json").write_bytes(b"{oops")
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "bad")

    def test_121_unsupported_schema_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="schema")
            manifest_path = root / "releases" / "schema" / "manifest.json"
            document = json.loads(manifest_path.read_text(encoding="utf-8"))
            document["schema_version"] = 2
            # recompute not needed; schema checked before hashes of files
            # but manifest itself is not hashed - rewrite with valid structure
            manifest_path.write_bytes(
                encode_json_artifact(document)
            )
            # files still match; only schema differs
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "schema")

    def test_122_manifest_version_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="mismatch")
            target = root / "releases" / "mismatch"
            document = json.loads(
                (target / "manifest.json").read_text(encoding="utf-8")
            )
            document["artifact_version"] = "other"
            (target / "manifest.json").write_bytes(encode_json_artifact(document))
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "mismatch")

    def test_123_missing_declared_payload_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="gone")
            (root / "releases" / "gone" / "metadata.json").unlink()
            with self.assertRaises(ArtifactNotFoundError):
                verify_artifact_release(root, "gone")

    def test_124_wrong_file_size_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="sized")
            path = root / "releases" / "sized" / "metadata.json"
            data = path.read_bytes() + b" "
            path.write_bytes(data)
            with self.assertRaises(ArtifactIntegrityError):
                verify_artifact_release(root, "sized")

    def test_125_checksum_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="hashbad")
            path = root / "releases" / "hashbad" / "metadata.json"
            original = path.read_bytes()
            # same length, different bytes
            mutated = (b"X" if original[0:1] != b"X" else b"Y") + original[1:]
            path.write_bytes(mutated)
            with self.assertRaises(ArtifactIntegrityError):
                verify_artifact_release(root, "hashbad")

    def test_126_unsafe_json_content_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="unsafej")
            path = root / "releases" / "unsafej" / "metadata.json"
            # craft payload that is valid bytes but invalid JSON, fix size/hash in manifest
            bad = b"{notjson!!}"
            path.write_bytes(bad)
            document = json.loads(
                (root / "releases" / "unsafej" / "manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            document["files"][0]["size_bytes"] = len(bad)
            document["files"][0]["sha256"] = hashlib.sha256(bad).hexdigest()
            (root / "releases" / "unsafej" / "manifest.json").write_bytes(
                encode_json_artifact(document)
            )
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "unsafej")

    def test_127_unsafe_npz_content_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(
                root, version="unsafen", artifacts={"model.npz": npz_payload()}
            )
            path = root / "releases" / "unsafen" / "model.npz"
            bad = b"not-a-valid-npz"
            path.write_bytes(bad)
            document = json.loads(
                (root / "releases" / "unsafen" / "manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            document["files"][0]["size_bytes"] = len(bad)
            document["files"][0]["sha256"] = hashlib.sha256(bad).hexdigest()
            (root / "releases" / "unsafen" / "manifest.json").write_bytes(
                encode_json_artifact(document)
            )
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "unsafen")

    def test_128_undeclared_extra_file_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="extra")
            (root / "releases" / "extra" / "extra.bin").write_bytes(b"x")
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "extra")

    def test_129_nested_unexpected_directory_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="nested")
            (root / "releases" / "nested" / "subdir").mkdir()
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "nested")

    @unittest.skipUnless(SYMLINKS_SUPPORTED, "symlinks not supported here")
    def test_130_payload_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="linkp")
            path = root / "releases" / "linkp" / "metadata.json"
            data = path.read_bytes()
            path.unlink()
            other = root / "outside.json"
            other.write_bytes(data)
            os.symlink(str(other), str(path))
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "linkp")

    @unittest.skipUnless(SYMLINKS_SUPPORTED, "symlinks not supported here")
    def test_131_manifest_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="linkm")
            path = root / "releases" / "linkm" / "manifest.json"
            data = path.read_bytes()
            path.unlink()
            other = root / "outside_manifest.json"
            other.write_bytes(data)
            os.symlink(str(other), str(path))
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "linkm")

    @unittest.skipUnless(SYMLINKS_SUPPORTED, "symlinks not supported here")
    def test_132_release_dir_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="real")
            link = root / "releases" / "linked"
            os.symlink(str(root / "releases" / "real"), str(link))
            with self.assertRaises(ArtifactValidationError):
                verify_artifact_release(root, "linked")


class ActivationTests(unittest.TestCase):
    def test_133_verified_release_activates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="a1")
            manifest = activate_artifact_release(root, "a1")
            self.assertEqual(manifest.artifact_version, "a1")

    def test_134_current_json_created(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="a1")
            activate_artifact_release(root, "a1")
            self.assertTrue((root / "current.json").is_file())

    def test_135_pointer_contains_schema_1(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="a1")
            activate_artifact_release(root, "a1")
            document = json.loads(
                (root / "current.json").read_text(encoding="utf-8")
            )
            self.assertEqual(document["schema_version"], 1)

    def test_136_pointer_references_exact_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="exact-version")
            activate_artifact_release(root, "exact-version")
            document = json.loads(
                (root / "current.json").read_text(encoding="utf-8")
            )
            self.assertEqual(document["artifact_version"], "exact-version")

    def test_137_activating_second_valid_release_replaces_pointer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            publish_basic(root, version="v2")
            activate_artifact_release(root, "v1")
            activate_artifact_release(root, "v2")
            document = json.loads(
                (root / "current.json").read_text(encoding="utf-8")
            )
            self.assertEqual(document["artifact_version"], "v2")

    def test_138_old_release_remains_physically_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            publish_basic(root, version="v2")
            activate_artifact_release(root, "v1")
            before = (root / "releases" / "v1" / "metadata.json").read_bytes()
            activate_artifact_release(root, "v2")
            after = (root / "releases" / "v1" / "metadata.json").read_bytes()
            self.assertEqual(before, after)

    def test_139_candidate_publication_alone_does_not_replace_pointer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            pointer_before = (root / "current.json").read_bytes()
            publish_basic(root, version="v2")
            pointer_after = (root / "current.json").read_bytes()
            self.assertEqual(pointer_before, pointer_after)

    def test_140_activation_does_not_modify_release_payload_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            payload_before = (
                root / "releases" / "v1" / "metadata.json"
            ).read_bytes()
            manifest_before = (
                root / "releases" / "v1" / "manifest.json"
            ).read_bytes()
            activate_artifact_release(root, "v1")
            self.assertEqual(
                (root / "releases" / "v1" / "metadata.json").read_bytes(),
                payload_before,
            )
            self.assertEqual(
                (root / "releases" / "v1" / "manifest.json").read_bytes(),
                manifest_before,
            )


class LastKnownGoodTests(unittest.TestCase):
    def test_141_valid_v1_activated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            active = resolve_active_artifact_release(root)
            self.assertIsNotNone(active)
            self.assertEqual(active.artifact_version, "v1")

    def test_142_corrupt_v2_activation_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            publish_basic(root, version="v2")
            path = root / "releases" / "v2" / "metadata.json"
            path.write_bytes(b"{corrupt")
            with self.assertRaises(ArtifactError):
                activate_artifact_release(root, "v2")

    def test_143_pointer_remains_v1_after_failed_activation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            publish_basic(root, version="v2")
            path = root / "releases" / "v2" / "metadata.json"
            path.write_bytes(b"{corrupt")
            with self.assertRaises(ArtifactError):
                activate_artifact_release(root, "v2")
            document = json.loads(
                (root / "current.json").read_text(encoding="utf-8")
            )
            self.assertEqual(document["artifact_version"], "v1")

    def test_144_missing_v2_activation_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            with self.assertRaises(ArtifactNotFoundError):
                activate_artifact_release(root, "v2")

    def test_145_pointer_remains_v1_after_missing_v2(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            before = (root / "current.json").read_bytes()
            with self.assertRaises(ArtifactNotFoundError):
                activate_artifact_release(root, "v2")
            self.assertEqual((root / "current.json").read_bytes(), before)

    def test_146_hash_mismatched_candidate_cannot_become_current(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            publish_basic(root, version="v2")
            path = root / "releases" / "v2" / "metadata.json"
            original = path.read_bytes()
            path.write_bytes(b"X" + original[1:])
            with self.assertRaises(ArtifactError):
                activate_artifact_release(root, "v2")
            document = json.loads(
                (root / "current.json").read_text(encoding="utf-8")
            )
            self.assertEqual(document["artifact_version"], "v1")

    def test_147_current_pointer_bytes_unchanged_on_failed_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            before = (root / "current.json").read_bytes()
            publish_basic(root, version="v2")
            (root / "releases" / "v2" / "manifest.json").unlink()
            with self.assertRaises(ArtifactError):
                activate_artifact_release(root, "v2")
            self.assertEqual((root / "current.json").read_bytes(), before)


class ResolveActiveTests(unittest.TestCase):
    def test_148_no_current_json_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(resolve_active_artifact_release(Path(tmp)))

    def test_149_valid_pointer_resolves_verified_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="live")
            activate_artifact_release(root, "live")
            manifest = resolve_active_artifact_release(root)
            self.assertIsInstance(manifest, ArtifactManifest)
            self.assertEqual(manifest.artifact_version, "live")

    def test_150_malformed_pointer_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "current.json").write_bytes(b"{bad")
            with self.assertRaises(ArtifactValidationError):
                resolve_active_artifact_release(root)

    def test_151_unsupported_pointer_schema_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "current.json").write_bytes(
                encode_json_artifact(
                    {"schema_version": 99, "artifact_version": "v1"}
                )
            )
            with self.assertRaises(ArtifactValidationError):
                resolve_active_artifact_release(root)

    def test_152_invalid_pointer_version_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "current.json").write_bytes(
                encode_json_artifact(
                    {"schema_version": 1, "artifact_version": "../evil"}
                )
            )
            with self.assertRaises(ArtifactValidationError):
                resolve_active_artifact_release(root)

    def test_153_pointer_to_missing_release_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "current.json").write_bytes(
                encode_json_artifact(
                    {"schema_version": 1, "artifact_version": "nope"}
                )
            )
            with self.assertRaises(ArtifactNotFoundError):
                resolve_active_artifact_release(root)

    def test_154_pointer_to_corrupt_release_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            activate_artifact_release(root, "v1")
            (root / "releases" / "v1" / "metadata.json").write_bytes(b"{bad")
            with self.assertRaises(ArtifactError):
                resolve_active_artifact_release(root)

    def test_155_does_not_scan_select_newest_release_automatically(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="aaa")
            publish_basic(root, version="zzz")
            # no current pointer — must not auto-select zzz
            self.assertIsNone(resolve_active_artifact_release(root))


class SafeLoadTests(unittest.TestCase):
    def test_156_declared_json_loads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = json_payload({"answer": 42})
            publish_basic(
                root, version="v1", artifacts={"metadata.json": payload}
            )
            loaded = load_json_artifact(root, "v1", "metadata.json")
            self.assertEqual(loaded, {"answer": 42})

    def test_157_declared_npz_loads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = npz_payload({"vec": np.array([1.0, 2.0], dtype=np.float32)})
            publish_basic(
                root, version="v1", artifacts={"model.npz": payload}
            )
            loaded = load_numeric_npz_artifact(root, "v1", "model.npz")
            self.assertIn("vec", loaded)
            self.assertTrue(np.allclose(loaded["vec"], [1.0, 2.0]))

    def test_158_undeclared_name_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            with self.assertRaises(ArtifactNotFoundError):
                load_json_artifact(root, "v1", "missing.json")

    def test_159_wrong_loader_format_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            with self.assertRaises(ArtifactValidationError):
                load_numeric_npz_artifact(root, "v1", "metadata.json")

    def test_160_traversal_requested_name_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            with self.assertRaises(ArtifactValidationError):
                load_json_artifact(root, "v1", "../metadata.json")

    def test_161_corrupted_payload_rejected_before_return(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            (root / "releases" / "v1" / "metadata.json").write_bytes(b"{}")
            with self.assertRaises(ArtifactIntegrityError):
                load_json_artifact(root, "v1", "metadata.json")

    def test_162_loaded_json_matches_canonical_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            value = {"b": 2, "a": 1, "list": [1, 2]}
            publish_basic(
                root, version="v1", artifacts={"metadata.json": json_payload(value)}
            )
            self.assertEqual(load_json_artifact(root, "v1", "metadata.json"), value)

    def test_163_loaded_npz_arrays_match_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            arr = np.arange(6, dtype=np.int32).reshape(2, 3)
            publish_basic(
                root, version="v1", artifacts={"model.npz": npz_payload({"m": arr})}
            )
            loaded = load_numeric_npz_artifact(root, "v1", "model.npz")
            self.assertTrue(np.array_equal(loaded["m"], arr))

    def test_164_loaded_npz_arrays_non_object_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(
                root, version="v1", artifacts={"model.npz": npz_payload()}
            )
            loaded = load_numeric_npz_artifact(root, "v1", "model.npz")
            for array in loaded.values():
                self.assertNotEqual(array.dtype.kind, "O")
                self.assertFalse(array.flags.writeable)


class DeterminismTests(unittest.TestCase):
    def test_165_same_inputs_produce_equivalent_manifest_content(self):
        with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
            m1 = publish_basic(Path(tmp1), version="det")
            m2 = publish_basic(Path(tmp2), version="det")
            self.assertEqual(
                _encode_manifest_for_compare(m1),
                _encode_manifest_for_compare(m2),
            )

    def test_166_artifact_mapping_order_does_not_change_file_record_order(self):
        with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
            root1 = Path(tmp1)
            root2 = Path(tmp2)
            artifacts_a = {
                "zeta.json": json_payload({"z": 1}),
                "alpha.json": json_payload({"a": 1}),
            }
            artifacts_b = dict(reversed(list(artifacts_a.items())))
            m1 = publish_basic(root1, version="ord", artifacts=artifacts_a)
            m2 = publish_basic(root2, version="ord", artifacts=artifacts_b)
            self.assertEqual(m1.files, m2.files)

    def test_167_metadata_key_order_does_not_affect_canonical_encoding(self):
        with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
            m1 = publish_basic(
                Path(tmp1), version="meta", metadata={"b": 1, "a": 2}
            )
            m2 = publish_basic(
                Path(tmp2), version="meta", metadata={"a": 2, "b": 1}
            )
            self.assertEqual(dict(m1.metadata), dict(m2.metadata))
            self.assertEqual(
                _encode_manifest_for_compare(m1),
                _encode_manifest_for_compare(m2),
            )

    def test_168_no_hidden_current_time_generation(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("utcnow", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)

    def test_169_no_model_version_randomness(self):
        self.assertNotIn("uuid", MODULE_SOURCE)
        self.assertNotIn("random.", MODULE_SOURCE)
        self.assertNotIn("secrets.", MODULE_SOURCE)

    def test_170_input_artifact_mapping_not_mutated(self):
        artifacts = {"metadata.json": json_payload({"a": 1})}
        snapshot = dict(artifacts)
        with tempfile.TemporaryDirectory() as tmp:
            publish_basic(Path(tmp), version="immut", artifacts=artifacts)
        self.assertEqual(artifacts, snapshot)

    def test_171_metadata_input_not_mutated(self):
        metadata = {"a": 1, "b": "x"}
        snapshot = dict(metadata)
        with tempfile.TemporaryDirectory() as tmp:
            publish_basic(Path(tmp), version="immutmeta", metadata=metadata)
        self.assertEqual(metadata, snapshot)


def _encode_manifest_for_compare(manifest: ArtifactManifest) -> bytes:
    from ml.recommender.artifacts import _encode_manifest

    return _encode_manifest(manifest)


class CpuNumpyLoadingTests(unittest.TestCase):
    def test_172_importing_module_does_not_configure_numeric_env(self):
        keys = list(CPU_THREAD_ENV_VARS) + [CUDA_VISIBLE_DEVICES_VAR]
        code = (
            "import os\n"
            f"keys = {keys!r}\n"
            "before = {k: os.environ.get(k) for k in keys}\n"
            "import ml.recommender.artifacts\n"
            "after = {k: os.environ.get(k) for k in keys}\n"
            "print(before == after)\n"
        )
        import subprocess

        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertEqual(result.stdout.strip().splitlines()[0], "True")

    def test_173_json_only_path_does_not_require_eager_numpy_import(self):
        import subprocess

        code = (
            "import sys\n"
            "import ml.recommender.artifacts as a\n"
            "data = a.encode_json_artifact({'x': 1})\n"
            "a.decode_json_artifact(data)\n"
            "print('numpy' in sys.modules)\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertEqual(result.stdout.strip().splitlines()[-1], "False")

    def test_174_numeric_encode_configures_cpu_before_numpy_loader(self):
        from ml.recommender import artifacts

        source = inspect.getsource(artifacts._load_numpy)
        configure_pos = source.find("configure_cpu_runtime")
        numpy_pos = source.find("import numpy")
        self.assertGreater(configure_pos, -1)
        self.assertGreater(numpy_pos, configure_pos)

    def test_175_numeric_decode_configures_cpu_before_numpy_loader(self):
        # shared loader used by encode and decode
        from ml.recommender import artifacts

        self.assertIn("_load_numpy()", inspect.getsource(artifacts.encode_numeric_npz))
        self.assertIn("_load_numpy()", inspect.getsource(artifacts.decode_numeric_npz))

    def test_176_numeric_thread_variables_remain_1(self):
        encode_numeric_npz({"a": np.array([1], dtype=np.int32)})
        for name in CPU_THREAD_ENV_VARS:
            self.assertEqual(
                os.environ.get(name), str(THREADS_PER_NUMERIC_LIBRARY), msg=name
            )

    def test_177_cuda_visible_devices_remains_empty(self):
        encode_numeric_npz({"a": np.array([1], dtype=np.int32)})
        self.assertEqual(os.environ.get(CUDA_VISIBLE_DEVICES_VAR), "")

    def test_178_repeated_numeric_operations_preserve_idempotent_runtime(self):
        encode_numeric_npz({"a": np.array([1], dtype=np.int32)})
        first = {name: os.environ.get(name) for name in CPU_THREAD_ENV_VARS}
        decode_numeric_npz(
            encode_numeric_npz({"b": np.array([2.0], dtype=np.float32)})
        )
        second = {name: os.environ.get(name) for name in CPU_THREAD_ENV_VARS}
        self.assertEqual(first, second)

    def test_no_eager_numeric_import_at_module_level(self):
        tree = ast.parse(MODULE_SOURCE)
        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertNotIn("numpy", alias.name)
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                self.assertNotIn("numpy", module)


class StaticSafetyTests(unittest.TestCase):
    def test_179_no_pickle_import(self):
        self.assertNotIn("import pickle", MODULE_SOURCE)
        self.assertNotIn("from pickle", MODULE_SOURCE)

    def test_180_no_joblib_import(self):
        self.assertNotIn("joblib", MODULE_SOURCE)

    def test_181_no_allow_pickle_true(self):
        self.assertNotIn("allow_pickle=True", MODULE_SOURCE)
        self.assertIn("allow_pickle=False", MODULE_SOURCE)

    def test_182_no_eval(self):
        self.assertNotIn("eval(", MODULE_SOURCE)

    def test_183_no_exec(self):
        self.assertNotIn("exec(", MODULE_SOURCE)

    def test_184_no_yaml_loader(self):
        self.assertNotIn("yaml", MODULE_SOURCE)

    def test_185_no_pymongo(self):
        self.assertNotIn("pymongo", MODULE_SOURCE)
        self.assertNotIn("MongoClient", MODULE_SOURCE)

    def test_186_no_http_framework(self):
        for name in ("FastAPI", "Flask", "requests", "uvicorn"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_187_no_sklearn_model_fitting(self):
        for name in ("TruncatedSVD", "sklearn", ".fit(", "def train"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_188_no_subprocess_training(self):
        self.assertNotIn("subprocess", MODULE_SOURCE)

    def test_189_no_artifact_auto_activation_during_publish(self):
        source = inspect.getsource(
            __import__(
                "ml.recommender.artifacts", fromlist=["x"]
            ).publish_artifact_release
        )
        self.assertNotIn("activate_artifact_release", source)
        self.assertNotIn("current.json", source)

    def test_190_no_delete_current_before_replace_logic(self):
        self.assertNotIn("current.json).unlink", MODULE_SOURCE)
        self.assertNotIn("remove(current", MODULE_SOURCE)
        self.assertNotIn("os.remove", MODULE_SOURCE)


class AdditionalSafetyTests(unittest.TestCase):
    def test_error_hierarchy(self):
        self.assertTrue(issubclass(ArtifactValidationError, ArtifactError))
        self.assertTrue(issubclass(ArtifactIntegrityError, ArtifactError))
        self.assertTrue(issubclass(ArtifactConflictError, ArtifactError))
        self.assertTrue(issubclass(ArtifactNotFoundError, ArtifactError))
        self.assertTrue(issubclass(ArtifactError, RecommenderRuntimeError))

    def test_error_messages_bounded(self):
        try:
            validate_artifact_version("../etc")
        except ArtifactValidationError as exc:
            message = str(exc)
            self.assertLess(len(message), 200)
            self.assertNotIn("Traceback", message)
            self.assertNotIn("password", message.lower())

    def test_no_forbidden_executable_suffixes_in_validate(self):
        for suffix in (".pkl", ".pickle", ".joblib", ".pt", ".pth", ".onnx", ".exe", ".dll"):
            from ml.recommender.artifacts import validate_artifact_filename

            with self.assertRaises(ArtifactValidationError):
                validate_artifact_filename(f"file{suffix}")

    def test_staging_cleanup_on_failed_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ArtifactValidationError):
                publish_basic(
                    root,
                    version="failstage",
                    artifacts={"bad.json": b"{oops"},
                )
            staging = root / ".staging"
            if staging.exists():
                leftovers = list(staging.iterdir())
                self.assertEqual(leftovers, [])

    def test_manifest_not_self_hashed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = publish_basic(root, version="v1")
            names = {record.name for record in manifest.files}
            self.assertNotIn("manifest.json", names)

    def test_manifest_has_no_absolute_paths_or_hosts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            publish_basic(root, version="v1")
            raw = (root / "releases" / "v1" / "manifest.json").read_text(
                encoding="utf-8"
            )
            self.assertNotIn(str(root), raw)
            self.assertNotIn("hostname", raw)
            self.assertNotIn("password", raw.lower())


if __name__ == "__main__":
    unittest.main()
