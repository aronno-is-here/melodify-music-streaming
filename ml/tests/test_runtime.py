"""Standard-library tests for the bounded offline runtime foundation."""

from __future__ import annotations

import dataclasses
import inspect
import os
import random
import unittest
from pathlib import Path

from ml.recommender import runtime as runtime_module
from ml.recommender.runtime import (
    CPU_THREAD_ENV_VARS,
    DEFAULT_RANDOM_SEED,
    MAX_RAW_EVENTS,
    MAX_SEED,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    MAX_WORKERS,
    RUNTIME_SCHEMA_VERSION,
    THREADS_PER_NUMERIC_LIBRARY,
    RecommenderRuntimeError,
    ResourceLimitError,
    RuntimeConfigError,
    RuntimeLimits,
    configure_cpu_runtime,
    ensure_within_limit,
    get_runtime_limits,
    seed_standard_library,
    validate_dataset_shape,
    validate_non_negative_count,
)

RUNTIME_PATH = Path(runtime_module.__file__).resolve()


class RuntimeConstantTests(unittest.TestCase):
    def test_1_seed_default(self):
        self.assertEqual(DEFAULT_RANDOM_SEED, 42)

    def test_2_raw_event_hard_cap(self):
        self.assertEqual(MAX_RAW_EVENTS, 250_000)

    def test_3_user_cap(self):
        self.assertEqual(MAX_UNIQUE_USERS, 50_000)

    def test_4_song_cap(self):
        self.assertEqual(MAX_UNIQUE_SONGS, 25_000)

    def test_5_workers(self):
        self.assertEqual(MAX_WORKERS, 1)

    def test_6_numeric_threads(self):
        self.assertEqual(THREADS_PER_NUMERIC_LIBRARY, 1)


class RuntimeConfigTests(unittest.TestCase):
    def test_7_limits_are_frozen(self):
        limits = get_runtime_limits()
        self.assertIsInstance(limits, RuntimeLimits)
        with self.assertRaises(Exception):
            limits.random_seed = 0  # type: ignore[misc]

    def test_8_expected_values(self):
        limits = get_runtime_limits()
        self.assertEqual(limits.random_seed, 42)
        self.assertEqual(limits.max_raw_events, 250_000)
        self.assertEqual(limits.max_unique_users, 50_000)
        self.assertEqual(limits.max_unique_songs, 25_000)
        self.assertEqual(limits.max_workers, 1)
        self.assertEqual(limits.numeric_threads, 1)

    def test_9_repeated_calls_value_equivalent(self):
        first = get_runtime_limits()
        second = get_runtime_limits()
        self.assertEqual(first, second)

    def test_10_callers_cannot_mutate_defaults(self):
        limits = get_runtime_limits()
        with self.assertRaises(Exception):
            limits.max_raw_events = 1  # type: ignore[misc]
        self.assertEqual(get_runtime_limits().max_raw_events, 250_000)


class CpuEnvTests(unittest.TestCase):
    def setUp(self):
        self._saved = {name: os.environ.get(name) for name in (
            *CPU_THREAD_ENV_VARS,
            "CUDA_VISIBLE_DEVICES",
        )}

    def tearDown(self):
        for name, value in self._saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def test_11_omp(self):
        configure_cpu_runtime()
        self.assertEqual(os.environ["OMP_NUM_THREADS"], "1")

    def test_12_openblas(self):
        configure_cpu_runtime()
        self.assertEqual(os.environ["OPENBLAS_NUM_THREADS"], "1")

    def test_13_mkl(self):
        configure_cpu_runtime()
        self.assertEqual(os.environ["MKL_NUM_THREADS"], "1")

    def test_14_numexpr(self):
        configure_cpu_runtime()
        self.assertEqual(os.environ["NUMEXPR_NUM_THREADS"], "1")

    def test_15_veclib(self):
        configure_cpu_runtime()
        self.assertEqual(os.environ["VECLIB_MAXIMUM_THREADS"], "1")

    def test_16_cuda_visible_devices_empty(self):
        configure_cpu_runtime()
        self.assertEqual(os.environ["CUDA_VISIBLE_DEVICES"], "")

    def test_17_idempotent(self):
        first = configure_cpu_runtime()
        second = configure_cpu_runtime()
        self.assertEqual(dict(first), dict(second))
        self.assertEqual(os.environ["OMP_NUM_THREADS"], "1")
        self.assertEqual(os.environ["CUDA_VISIBLE_DEVICES"], "")

    def test_18_no_permanent_system_operation(self):
        source = RUNTIME_PATH.read_text(encoding="utf-8")
        for forbidden in ("os.system", "winreg", "setenv", "putenv", "subprocess.run"):
            self.assertNotIn(forbidden, source)
        # SETX must not appear as an invoked command (docstring mention is ok).
        code_lines = [
            line
            for line in source.splitlines()
            if not line.lstrip().startswith("#")
            and not line.lstrip().startswith("does not")
            and '"""' not in line
        ]
        joined = "\n".join(code_lines)
        self.assertNotIn("SETX", joined.replace("shell SETX", ""))


class CountValidationTests(unittest.TestCase):
    def test_19_zero_raw_events_accepted(self):
        self.assertEqual(
            validate_non_negative_count("raw_event_count", 0, MAX_RAW_EVENTS), 0
        )

    def test_20_cap_raw_events_accepted(self):
        self.assertEqual(
            validate_non_negative_count("raw_event_count", MAX_RAW_EVENTS, MAX_RAW_EVENTS),
            MAX_RAW_EVENTS,
        )

    def test_21_cap_plus_one_rejected(self):
        with self.assertRaises(ResourceLimitError):
            validate_non_negative_count(
                "raw_event_count", MAX_RAW_EVENTS + 1, MAX_RAW_EVENTS
            )

    def test_22_negative_rejected(self):
        with self.assertRaises(ResourceLimitError):
            validate_non_negative_count("raw_event_count", -1, MAX_RAW_EVENTS)

    def test_23_float_rejected(self):
        with self.assertRaises(RuntimeConfigError):
            validate_non_negative_count("raw_event_count", 1.0, MAX_RAW_EVENTS)

    def test_24_bool_rejected(self):
        with self.assertRaises(RuntimeConfigError):
            validate_non_negative_count("raw_event_count", True, MAX_RAW_EVENTS)

    def test_ensure_within_limit_matches(self):
        self.assertEqual(ensure_within_limit("raw_event_count", 5, MAX_RAW_EVENTS), 5)
        with self.assertRaises(ResourceLimitError):
            ensure_within_limit("raw_event_count", MAX_RAW_EVENTS + 1, MAX_RAW_EVENTS)


class UserValidationTests(unittest.TestCase):
    def test_25_zero_users_accepted(self):
        self.assertEqual(
            validate_non_negative_count("unique_user_count", 0, MAX_UNIQUE_USERS), 0
        )

    def test_26_user_cap_accepted(self):
        self.assertEqual(
            validate_non_negative_count(
                "unique_user_count", MAX_UNIQUE_USERS, MAX_UNIQUE_USERS
            ),
            MAX_UNIQUE_USERS,
        )

    def test_27_user_cap_plus_one_rejected(self):
        with self.assertRaises(ResourceLimitError):
            validate_non_negative_count(
                "unique_user_count", MAX_UNIQUE_USERS + 1, MAX_UNIQUE_USERS
            )

    def test_28_invalid_type_rejected(self):
        with self.assertRaises(RuntimeConfigError):
            validate_non_negative_count("unique_user_count", "10", MAX_UNIQUE_USERS)
        with self.assertRaises(RuntimeConfigError):
            validate_non_negative_count("unique_user_count", False, MAX_UNIQUE_USERS)


class SongValidationTests(unittest.TestCase):
    def test_29_zero_songs_accepted(self):
        self.assertEqual(
            validate_non_negative_count("unique_song_count", 0, MAX_UNIQUE_SONGS), 0
        )

    def test_30_song_cap_accepted(self):
        self.assertEqual(
            validate_non_negative_count(
                "unique_song_count", MAX_UNIQUE_SONGS, MAX_UNIQUE_SONGS
            ),
            MAX_UNIQUE_SONGS,
        )

    def test_31_song_cap_plus_one_rejected(self):
        with self.assertRaises(ResourceLimitError):
            validate_non_negative_count(
                "unique_song_count", MAX_UNIQUE_SONGS + 1, MAX_UNIQUE_SONGS
            )

    def test_32_invalid_type_rejected(self):
        with self.assertRaises(RuntimeConfigError):
            validate_non_negative_count("unique_song_count", 1.5, MAX_UNIQUE_SONGS)
        with self.assertRaises(RuntimeConfigError):
            validate_non_negative_count("unique_song_count", True, MAX_UNIQUE_SONGS)


class DatasetShapeTests(unittest.TestCase):
    def test_33_valid_combined_accepted(self):
        result = validate_dataset_shape(1_000, 100, 50)
        self.assertEqual(result, (1_000, 100, 50))

    def test_34_one_exceeded_dimension_rejects(self):
        with self.assertRaises(ResourceLimitError):
            validate_dataset_shape(MAX_RAW_EVENTS + 1, 10, 10)
        with self.assertRaises(ResourceLimitError):
            validate_dataset_shape(1, MAX_UNIQUE_USERS + 1, 10)
        with self.assertRaises(ResourceLimitError):
            validate_dataset_shape(1, 1, MAX_UNIQUE_SONGS + 1)

    def test_35_validation_does_not_mutate_input(self):
        events, users, songs = 10, 20, 30
        validate_dataset_shape(events, users, songs)
        self.assertEqual((events, users, songs), (10, 20, 30))


class SeedingTests(unittest.TestCase):
    def test_36_seed_zero_accepted(self):
        self.assertEqual(seed_standard_library(0), 0)

    def test_37_seed_42_accepted(self):
        self.assertEqual(seed_standard_library(42), 42)

    def test_38_max_seed_accepted(self):
        self.assertEqual(seed_standard_library(MAX_SEED), MAX_SEED)

    def test_39_negative_seed_rejected(self):
        with self.assertRaises(RuntimeConfigError):
            seed_standard_library(-1)

    def test_40_seed_above_max_rejected(self):
        with self.assertRaises(RuntimeConfigError):
            seed_standard_library(MAX_SEED + 1)

    def test_41_bool_seed_rejected(self):
        with self.assertRaises(RuntimeConfigError):
            seed_standard_library(True)

    def test_42_repeated_seeding_reproduces_sequence(self):
        seed_standard_library(42)
        first = [random.random() for _ in range(5)]
        seed_standard_library(42)
        second = [random.random() for _ in range(5)]
        self.assertEqual(first, second)


class ErrorSafetyTests(unittest.TestCase):
    def test_43_limit_exception_is_package_specific(self):
        with self.assertRaises(ResourceLimitError) as ctx:
            validate_non_negative_count("raw_event_count", MAX_RAW_EVENTS + 1, MAX_RAW_EVENTS)
        self.assertIsInstance(ctx.exception, RecommenderRuntimeError)

    def test_44_error_contains_field_name_and_limit(self):
        with self.assertRaises(ResourceLimitError) as ctx:
            validate_non_negative_count(
                "raw_event_count", MAX_RAW_EVENTS + 1, MAX_RAW_EVENTS
            )
        message = str(ctx.exception)
        self.assertIn("raw_event_count", message)
        self.assertIn(str(MAX_RAW_EVENTS), message)

    def test_45_no_environment_dump_in_error(self):
        secretish = "SECRET_TOKEN_VALUE_XYZ"
        os.environ["MELODIFY_TEST_SECRET"] = secretish
        try:
            with self.assertRaises(ResourceLimitError) as ctx:
                validate_non_negative_count(
                    "raw_event_count", MAX_RAW_EVENTS + 1, MAX_RAW_EVENTS
                )
            message = str(ctx.exception)
            self.assertNotIn(secretish, message)
            self.assertNotIn("MELODIFY_TEST_SECRET", message)
            self.assertNotIn("PATH=", message)
            self.assertNotIn("HOME", message)
        finally:
            os.environ.pop("MELODIFY_TEST_SECRET", None)

    def test_46_no_secret_like_content(self):
        with self.assertRaises(RuntimeConfigError) as ctx:
            validate_non_negative_count("unique_user_count", True, MAX_UNIQUE_USERS)
        message = str(ctx.exception)
        for forbidden in ("password", "token", "secret", "mongodb://", "http://", "C:\\"):
            self.assertNotIn(forbidden, message.lower())

    def test_47_validation_error_is_deterministic(self):
        messages = []
        for _ in range(3):
            try:
                validate_non_negative_count(
                    "raw_event_count", MAX_RAW_EVENTS + 1, MAX_RAW_EVENTS
                )
            except ResourceLimitError as exc:
                messages.append(str(exc))
        self.assertEqual(len(messages), 3)
        self.assertEqual(len(set(messages)), 1)


class ImportSafetyTests(unittest.TestCase):
    def _source(self) -> str:
        return RUNTIME_PATH.read_text(encoding="utf-8")

    def test_48_no_database_import(self):
        source = self._source()
        for forbidden in ("pymongo", "MongoClient", "motor", "mysql", "psycopg"):
            self.assertNotIn(forbidden, source)

    def test_49_no_http_server_import(self):
        source = self._source()
        for forbidden in ("fastapi", "flask", "django", "http.server", "socketserver"):
            self.assertNotIn(forbidden, source)

    def test_50_no_numpy_scipy_sklearn_import(self):
        source = self._source()
        for forbidden in ("numpy", "scipy", "sklearn", "joblib", "pandas"):
            self.assertNotIn(forbidden, source)

    def test_51_no_subprocess_training_invocation(self):
        source = self._source()
        for forbidden in ("subprocess", "multiprocessing", "torch", "tensorflow"):
            self.assertNotIn(forbidden, source)


class ModuleContractTests(unittest.TestCase):
    def test_import_side_effect_is_light(self):
        source = RUNTIME_PATH.read_text(encoding="utf-8")
        tree_free_names = ("os.environ", "configure_cpu_runtime")
        # Importing the module must not itself call configure at module level.
        module_level = source.split('"""')[2] if source.count('"""') >= 2 else source
        body_lines = [
            line
            for line in source.splitlines()
            if line.startswith("os.environ[") or line.startswith("configure_cpu_runtime(")
        ]
        self.assertEqual(body_lines, [])
        self.assertNotIn("if __name__", source.split("def ")[0])
        del tree_free_names, module_level

    def test_schema_version_present(self):
        self.assertEqual(RUNTIME_SCHEMA_VERSION, 1)

    def test_runtime_limits_is_frozen_dataclass(self):
        self.assertTrue(dataclasses.is_dataclass(RuntimeLimits))
        self.assertTrue(RuntimeLimits.__dataclass_params__.frozen)

    def test_no_mutable_module_global_dict_as_contract(self):
        source = RUNTIME_PATH.read_text(encoding="utf-8")
        self.assertNotIn("_LIMITS = {}", source)
        self.assertNotIn("LIMITS: dict", source)
        self.assertIn("@dataclass(frozen=True)", source)


if __name__ == "__main__":
    unittest.main()
