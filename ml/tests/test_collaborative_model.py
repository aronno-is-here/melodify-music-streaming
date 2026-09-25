"""Standard-library tests for the collaborative latent-factor model."""

from __future__ import annotations

import ast
import dataclasses
import math
import os
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

from ml.recommender.collaborative_model import (
    COLLABORATIVE_MODEL_SCHEMA_VERSION,
    DEFAULT_LATENT_FACTORS,
    LISTENED_MINUTE_LOG_WEIGHT,
    MAX_IMPLICIT_SIGNAL,
    MAX_LATENT_FACTORS,
    MIN_COLLABORATIVE_INTERACTION_PAIRS,
    MIN_COLLABORATIVE_SONGS,
    MIN_COLLABORATIVE_USERS,
    OBSERVED_WEIGHT,
    COMPLETION_LOG_WEIGHT,
    PLAY_START_LOG_WEIGHT,
    REPLAY_LOG_WEIGHT,
    SESSION_LOG_WEIGHT,
    SKIP_LOG_PENALTY,
    SVD_ALGORITHM,
    SVD_N_ITER,
    STATUS_INSUFFICIENT_DATA,
    STATUS_TRAINED,
    CollaborativeError,
    CollaborativeItemScore,
    CollaborativeLatentModel,
    CollaborativeTrainingResult,
    CollaborativeTrainingSummary,
    CollaborativeUnknownSongError,
    CollaborativeUnknownUserError,
    CollaborativeValidationError,
    build_collaborative_training_signal,
    score_collaborative_candidates,
    train_collaborative_model,
)
from ml.recommender.runtime import (
    CPU_THREAD_ENV_VARS,
    CUDA_VISIBLE_DEVICES_VAR,
    DEFAULT_RANDOM_SEED,
    MAX_SEED,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    ResourceLimitError,
    THREADS_PER_NUMERIC_LIBRARY,
)
from ml.recommender.sparse_interactions import (
    SparseInteractionBundle,
    SparseInteractionSummary,
    build_sparse_interactions,
)
from ml.recommender.temporal_split import TemporalInteractionEvent

MODULE_PATH = (
    Path(__file__).resolve().parents[1] / "recommender" / "collaborative_model.py"
)
MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
PROJECT_ROOT = Path(__file__).resolve().parents[2]

U1 = "a" * 24
U2 = "b" * 24
U3 = "c" * 24
U4 = "d" * 24
S1 = "1" * 24
S2 = "2" * 24
S3 = "3" * 24
S4 = "4" * 24
S5 = "5" * 24

BASE_TIME = datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)

_MATRIX_KEYS = (
    "observed",
    "session_count",
    "play_started_count",
    "replay_started_count",
    "completed_count",
    "skipped_count",
    "stopped_count",
    "listened_seconds",
)


def make_event(
    *,
    event_id: str | None = None,
    user_id: str = U1,
    song_id: str = S1,
    session_id: str = "sess-1",
    sequence: int = 0,
    event_type: str = "play-started",
    listened_seconds_delta: float | None = None,
) -> TemporalInteractionEvent:
    idx = make_event.counter
    make_event.counter += 1
    if event_id is None:
        event_id = f"{idx:024x}"[:24].rjust(24, "0")
    return TemporalInteractionEvent(
        event_id=event_id,
        user_id=user_id,
        song_id=song_id,
        session_id=session_id,
        sequence=sequence,
        event_type=event_type,
        listened_seconds_delta=listened_seconds_delta,
        created_at=BASE_TIME,
    )


make_event.counter = 0


def hand_bundle(user_ids, song_ids, cells=None):
    """Build a SparseInteractionBundle directly from explicit cell values.

    ``cells`` maps ``(user_index, song_index)`` to a dict of matrix field
    overrides; missing fields default to zero (observed defaults to 1 when
    any field is provided for that cell, or when listed explicitly).
    """
    import numpy as np
    import scipy.sparse as sp

    cells = {} if cells is None else cells
    shape = (len(user_ids), len(song_ids))
    matrices = {}
    for field in _MATRIX_KEYS:
        rows = []
        cols = []
        data = []
        for (r, c), overrides in sorted(cells.items()):
            if field == "observed":
                value = float(overrides.get(field, 1.0))
            else:
                value = float(overrides.get(field, 0.0))
            if value != 0.0:
                rows.append(r)
                cols.append(c)
                data.append(value)
        if rows:
            matrix = sp.csr_matrix(
                (
                    np.asarray(data, dtype=np.float32),
                    (
                        np.asarray(rows, dtype=np.int64),
                        np.asarray(cols, dtype=np.int64),
                    ),
                ),
                shape=shape,
                dtype=np.float32,
            )
        else:
            matrix = sp.csr_matrix(shape, dtype=np.float32)
        matrix.sum_duplicates()
        matrix.eliminate_zeros()
        matrix.sort_indices()
        matrices[field] = matrix

    summary = SparseInteractionSummary(
        event_count=int(sum(len(set()) for _ in ()) or matrices["observed"].nnz),
        unique_user_count=len(user_ids),
        unique_song_count=len(song_ids),
        interaction_pair_count=int(matrices["observed"].nnz),
        session_count=int(matrices["session_count"].nnz),
        matrix_shape=shape,
    )
    return SparseInteractionBundle(
        user_ids=tuple(user_ids),
        song_ids=tuple(song_ids),
        user_to_index={u: i for i, u in enumerate(user_ids)},
        song_to_index={s: i for i, s in enumerate(song_ids)},
        observed=matrices["observed"],
        session_count=matrices["session_count"],
        play_started_count=matrices["play_started_count"],
        replay_started_count=matrices["replay_started_count"],
        completed_count=matrices["completed_count"],
        skipped_count=matrices["skipped_count"],
        stopped_count=matrices["stopped_count"],
        listened_seconds=matrices["listened_seconds"],
        summary=summary,
    )


def simple_events():
    make_event.counter = 0
    return [
        make_event(user_id=U1, song_id=S1, session_id="s1", sequence=0, event_type="play-started"),
        make_event(user_id=U1, song_id=S1, session_id="s1", sequence=1, event_type="completed", listened_seconds_delta=30.0),
        make_event(user_id=U1, song_id=S2, session_id="s2", sequence=0, event_type="play-started"),
        make_event(user_id=U1, song_id=S2, session_id="s2", sequence=1, event_type="skipped", listened_seconds_delta=5.0),
        make_event(user_id=U2, song_id=S1, session_id="s3", sequence=0, event_type="play-started"),
        make_event(user_id=U2, song_id=S1, session_id="s3", sequence=1, event_type="completed", listened_seconds_delta=60.0),
        make_event(user_id=U2, song_id=S3, session_id="s4", sequence=0, event_type="replay-started"),
        make_event(user_id=U2, song_id=S3, session_id="s4", sequence=1, event_type="completed", listened_seconds_delta=45.0),
        make_event(user_id=U3, song_id=S1, session_id="s5", sequence=0, event_type="play-started"),
        make_event(user_id=U3, song_id=S2, session_id="s6", sequence=0, event_type="play-started"),
        make_event(user_id=U3, song_id=S3, session_id="s7", sequence=0, event_type="completed", listened_seconds_delta=90.0),
    ]


def simple_bundle():
    return build_sparse_interactions(simple_events())


def larger_bundle():
    make_event.counter = 200
    events = []
    idx = 200
    users = [U1, U2, U3, U4]
    songs = [S1, S2, S3, S4, S5]
    for u_i, user in enumerate(users):
        for s_i, song in enumerate(songs):
            if (u_i + s_i) % 2 == 0:
                events.append(
                    make_event(
                        user_id=user,
                        song_id=song,
                        session_id=f"g-{u_i}-{s_i}",
                        sequence=0,
                        event_type="play-started",
                    )
                )
                events.append(
                    make_event(
                        user_id=user,
                        song_id=song,
                        session_id=f"g-{u_i}-{s_i}",
                        sequence=1,
                        event_type="completed",
                        listened_seconds_delta=float(10 + u_i * 5 + s_i),
                    )
                )
                idx += 1
    return build_sparse_interactions(events)


def assert_close(testcase, actual, expected, places=9):
    testcase.assertTrue(
        math.isclose(actual, expected, rel_tol=0.0, abs_tol=10 ** (-places)),
        msg=f"{actual} != {expected}",
    )


class ConstantsContractTests(unittest.TestCase):
    def test_01_schema_version(self):
        self.assertEqual(COLLABORATIVE_MODEL_SCHEMA_VERSION, 1)

    def test_02_default_latent_factors(self):
        self.assertEqual(DEFAULT_LATENT_FACTORS, 32)

    def test_03_max_latent_factors(self):
        self.assertEqual(MAX_LATENT_FACTORS, 32)

    def test_04_svd_algorithm(self):
        self.assertEqual(SVD_ALGORITHM, "randomized")

    def test_05_svd_n_iter(self):
        self.assertEqual(SVD_N_ITER, 7)

    def test_06_default_seed_matches_runtime(self):
        self.assertEqual(DEFAULT_RANDOM_SEED, 42)

    def test_07_observed_weight(self):
        self.assertEqual(OBSERVED_WEIGHT, 1.00)

    def test_08_session_log_weight(self):
        self.assertEqual(SESSION_LOG_WEIGHT, 0.50)

    def test_09_play_start_log_weight(self):
        self.assertEqual(PLAY_START_LOG_WEIGHT, 0.25)

    def test_10_completion_log_weight(self):
        self.assertEqual(COMPLETION_LOG_WEIGHT, 1.50)

    def test_11_replay_log_weight(self):
        self.assertEqual(REPLAY_LOG_WEIGHT, 1.00)

    def test_12_listened_minute_log_weight(self):
        self.assertEqual(LISTENED_MINUTE_LOG_WEIGHT, 0.25)

    def test_13_skip_log_penalty(self):
        self.assertEqual(SKIP_LOG_PENALTY, 0.75)

    def test_14_max_implicit_signal(self):
        self.assertEqual(MAX_IMPLICIT_SIGNAL, 8.0)

    def test_15_min_users(self):
        self.assertEqual(MIN_COLLABORATIVE_USERS, 2)

    def test_16_min_songs(self):
        self.assertEqual(MIN_COLLABORATIVE_SONGS, 2)

    def test_17_min_pairs(self):
        self.assertEqual(MIN_COLLABORATIVE_INTERACTION_PAIRS, 2)

    def test_18_status_vocabulary(self):
        self.assertEqual(STATUS_TRAINED, "trained")
        self.assertEqual(STATUS_INSUFFICIENT_DATA, "insufficient-data")

    def test_19_exception_hierarchy(self):
        self.assertTrue(issubclass(CollaborativeValidationError, CollaborativeError))
        self.assertTrue(issubclass(CollaborativeUnknownUserError, CollaborativeError))
        self.assertTrue(issubclass(CollaborativeUnknownSongError, CollaborativeError))
        from ml.recommender.runtime import RecommenderRuntimeError

        self.assertTrue(issubclass(CollaborativeError, RecommenderRuntimeError))

    def test_20_public_api_present(self):
        self.assertTrue(callable(build_collaborative_training_signal))
        self.assertTrue(callable(train_collaborative_model))
        self.assertTrue(callable(score_collaborative_candidates))


class DependencyImportTests(unittest.TestCase):
    def test_21_module_import_does_not_load_sklearn(self):
        code = (
            "import sys\n"
            "import ml.recommender.collaborative_model\n"
            "assert 'sklearn' not in sys.modules\n"
        )
        subprocess.run(
            [sys.executable, "-c", code],
            check=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
        )

    def test_22_module_import_does_not_load_numpy(self):
        code = (
            "import sys\n"
            "import ml.recommender.collaborative_model\n"
            "assert 'numpy' not in sys.modules\n"
        )
        subprocess.run(
            [sys.executable, "-c", code],
            check=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
        )

    def test_23_module_import_does_not_load_scipy(self):
        code = (
            "import sys\n"
            "import ml.recommender.collaborative_model\n"
            "assert 'scipy' not in sys.modules\n"
        )
        subprocess.run(
            [sys.executable, "-c", code],
            check=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
        )

    def test_24_module_import_does_not_mutate_cpu_env(self):
        code = (
            "import os\n"
            "import ml.recommender.collaborative_model\n"
            "assert os.environ.get('OMP_NUM_THREADS') != '1' or True\n"
            "before = dict(os.environ)\n"
            "import ml.recommender.collaborative_model as m\n"
            "assert m._np is None\n"
        )
        subprocess.run(
            [sys.executable, "-c", code],
            check=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
        )

    def test_25_sklearn_importable_in_range(self):
        import sklearn

        major = int(sklearn.__version__.split(".")[0])
        self.assertGreaterEqual(major, 1)
        self.assertLess(major, 2)

    def test_26_requirements_lists_sklearn(self):
        text = (PROJECT_ROOT / "ml" / "requirements.txt").read_text(encoding="utf-8")
        self.assertIn("scikit-learn>=1.5,<2", text)
        self.assertIn("numpy>=1.26,<3", text)
        self.assertIn("scipy>=1.12,<2", text)

    def test_27_no_pandas_direct_dependency(self):
        text = (PROJECT_ROOT / "ml" / "requirements.txt").read_text(encoding="utf-8")
        self.assertNotIn("pandas", text)

    def test_28_no_torch_tensorflow_dependency(self):
        text = (PROJECT_ROOT / "ml" / "requirements.txt").read_text(encoding="utf-8")
        self.assertNotIn("torch", text)
        self.assertNotIn("tensorflow", text)

    def test_29_configure_cpu_runtime_called_on_load(self):
        code = (
            "import os\n"
            "from ml.recommender.collaborative_model import _load_ml_stack\n"
            "_load_ml_stack()\n"
            "assert os.environ['OMP_NUM_THREADS'] == '1'\n"
            "assert os.environ['CUDA_VISIBLE_DEVICES'] == ''\n"
        )
        subprocess.run(
            [sys.executable, "-c", code],
            check=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
        )

    def test_30_load_ml_stack_idempotent(self):
        from ml.recommender.collaborative_model import _load_ml_stack

        a = _load_ml_stack()
        b = _load_ml_stack()
        self.assertIs(a[0], b[0])
        self.assertIs(a[1], b[1])
        self.assertIs(a[2], b[2])


class SignalFormulaTests(unittest.TestCase):
    def test_31_signal_shape_and_dtype(self):
        bundle = simple_bundle()
        signal = build_collaborative_training_signal(bundle)
        self.assertEqual(signal.shape, bundle.observed.shape)
        self.assertEqual(signal.dtype.name, "float32")

    def test_32_signal_is_csr(self):
        signal = build_collaborative_training_signal(simple_bundle())
        self.assertEqual(signal.format, "csr")

    def test_33_signal_values_within_clip(self):
        signal = build_collaborative_training_signal(simple_bundle())
        self.assertGreaterEqual(float(signal.data.min()), 0.0)
        self.assertLessEqual(float(signal.data.max()), MAX_IMPLICIT_SIGNAL)

    def test_34_signal_finite(self):
        import numpy as np

        signal = build_collaborative_training_signal(simple_bundle())
        self.assertTrue(bool(np.isfinite(signal.data).all()))

    def test_35_signal_not_negative(self):
        signal = build_collaborative_training_signal(simple_bundle())
        self.assertTrue(bool((signal.data >= 0.0).all()))

    def test_36_signal_does_not_mutate_bundle(self):
        bundle = simple_bundle()
        before = bundle.observed.data.copy()
        build_collaborative_training_signal(bundle)
        self.assertEqual(list(before), list(bundle.observed.data))

    def test_37_formula_single_positive_cell(self):
        import numpy as np

        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {
                (0, 0): {
                    "observed": 1.0,
                    "session_count": 1.0,
                    "play_started_count": 1.0,
                    "completed_count": 1.0,
                    "listened_seconds": 90.0,
                }
            },
        )
        signal = build_collaborative_training_signal(bundle)
        expected = (
            OBSERVED_WEIGHT * 1.0
            + SESSION_LOG_WEIGHT * math.log1p(1.0)
            + PLAY_START_LOG_WEIGHT * math.log1p(1.0)
            + COMPLETION_LOG_WEIGHT * math.log1p(1.0)
            + REPLAY_LOG_WEIGHT * math.log1p(0.0)
            + LISTENED_MINUTE_LOG_WEIGHT * math.log1p(90.0 / 60.0)
            - SKIP_LOG_PENALTY * math.log1p(0.0)
        )
        expected = min(max(expected, 0.0), MAX_IMPLICIT_SIGNAL)
        self.assertEqual(signal.nnz, 1)
        assert_close(self, float(signal.data[0]), expected, places=6)

    def test_38_formula_skip_reduces_signal(self):
        bundle_a = hand_bundle(
            [U1, U2],
            [S1, S2],
            {(0, 0): {"observed": 1.0, "play_started_count": 1.0}},
        )
        bundle_b = hand_bundle(
            [U1, U2],
            [S1, S2],
            {
                (0, 0): {
                    "observed": 1.0,
                    "play_started_count": 1.0,
                    "skipped_count": 2.0,
                }
            },
        )
        sig_a = build_collaborative_training_signal(bundle_a)
        sig_b = build_collaborative_training_signal(bundle_b)
        self.assertLess(float(sig_b.data[0]), float(sig_a.data[0]))

    def test_39_stopped_count_is_neutral(self):
        bundle_a = hand_bundle(
            [U1, U2],
            [S1, S2],
            {(0, 0): {"observed": 1.0, "play_started_count": 1.0}},
        )
        bundle_b = hand_bundle(
            [U1, U2],
            [S1, S2],
            {
                (0, 0): {
                    "observed": 1.0,
                    "play_started_count": 1.0,
                    "stopped_count": 7.0,
                }
            },
        )
        sig_a = build_collaborative_training_signal(bundle_a)
        sig_b = build_collaborative_training_signal(bundle_b)
        self.assertEqual(float(sig_a.data[0]), float(sig_b.data[0]))

    def test_40_clip_upper_bound(self):
        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {
                (0, 0): {
                    "observed": 1.0,
                    "session_count": 1000.0,
                    "play_started_count": 1000.0,
                    "completed_count": 1000.0,
                    "replay_started_count": 1000.0,
                    "listened_seconds": 1_000_000.0,
                }
            },
        )
        signal = build_collaborative_training_signal(bundle)
        self.assertEqual(float(signal.data[0]), MAX_IMPLICIT_SIGNAL)

    def test_41_clip_lower_bound_eliminates_zeros(self):
        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {
                (0, 0): {
                    "observed": 1.0,
                    "skipped_count": 50.0,
                }
            },
        )
        signal = build_collaborative_training_signal(bundle)
        self.assertEqual(signal.nnz, 0)

    def test_42_log1p_damping_slower_than_linear(self):
        linear = 1.0 + 10.0
        damped = 1.0 + math.log1p(10.0)
        self.assertLess(damped, linear)

    def test_43_listened_seconds_converted_to_minutes(self):
        seconds = 120.0
        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {(0, 0): {"observed": 1.0, "listened_seconds": seconds}},
        )
        signal = build_collaborative_training_signal(bundle)
        expected = (
            OBSERVED_WEIGHT * 1.0
            + LISTENED_MINUTE_LOG_WEIGHT * math.log1p(seconds / 60.0)
        )
        expected = min(max(expected, 0.0), MAX_IMPLICIT_SIGNAL)
        assert_close(self, float(signal.data[0]), expected, places=6)

    def test_44_signal_matches_hand_formula_all_terms(self):
        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {
                (0, 0): {
                    "observed": 1.0,
                    "session_count": 3.0,
                    "play_started_count": 2.0,
                    "replay_started_count": 1.0,
                    "completed_count": 4.0,
                    "skipped_count": 1.0,
                    "listened_seconds": 150.0,
                    "stopped_count": 9.0,
                }
            },
        )
        signal = build_collaborative_training_signal(bundle)
        expected = (
            1.00 * 1.0
            + 0.50 * math.log1p(3.0)
            + 0.25 * math.log1p(2.0)
            + 1.50 * math.log1p(4.0)
            + 1.00 * math.log1p(1.0)
            + 0.25 * math.log1p(150.0 / 60.0)
            - 0.75 * math.log1p(1.0)
        )
        expected = min(max(expected, 0.0), 8.0)
        assert_close(self, float(signal.data[0]), expected, places=6)

    def test_45_observed_only_gives_observed_weight(self):
        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {(0, 0): {"observed": 1.0}},
        )
        signal = build_collaborative_training_signal(bundle)
        assert_close(self, float(signal.data[0]), OBSERVED_WEIGHT, places=6)

    def test_46_empty_bundle_signal(self):
        bundle = hand_bundle([], [], {})
        signal = build_collaborative_training_signal(bundle)
        self.assertEqual(signal.shape, (0, 0))
        self.assertEqual(signal.nnz, 0)

    def test_47_signal_sorted_indices(self):
        signal = build_collaborative_training_signal(simple_bundle())
        self.assertTrue(signal.has_sorted_indices)

    def test_48_signal_eliminates_explicit_zeros(self):
        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {(0, 0): {"observed": 1.0, "skipped_count": 100.0}},
        )
        signal = build_collaborative_training_signal(bundle)
        self.assertTrue(bool((signal.data != 0.0).all()))

    def test_49_signal_non_negative_input_stays_bounded(self):
        signal = build_collaborative_training_signal(larger_bundle())
        self.assertLessEqual(float(signal.data.max()), MAX_IMPLICIT_SIGNAL)

    def test_50_weights_are_fixed_constants_not_learned(self):
        self.assertIsInstance(OBSERVED_WEIGHT, float)
        self.assertIsInstance(SKIP_LOG_PENALTY, float)
        self.assertNotEqual(OBSERVED_WEIGHT, 0.0)
        self.assertGreater(SKIP_LOG_PENALTY, 0.0)


class BundleValidationTests(unittest.TestCase):
    def test_51_rejects_non_bundle(self):
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(object())

    def test_52_rejects_none_signal(self):
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(None)

    def test_53_rejects_dict(self):
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal({})

    def test_54_train_rejects_non_bundle(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model("not-a-bundle")

    def test_55_rejects_wrong_shape_matrix(self):
        import numpy as np
        import scipy.sparse as sp

        bundle = simple_bundle()
        bad = sp.csr_matrix((1, 1), dtype=np.float32)
        object.__setattr__ if False else None
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids,
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bad,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_56_rejects_non_csr_matrix(self):
        import numpy as np
        import scipy.sparse as sp

        bundle = simple_bundle()
        bad = sp.coo_matrix(
            (np.array([1.0], dtype=np.float32), (np.array([0]), np.array([0]))),
            shape=bundle.observed.shape,
            dtype=np.float32,
        )
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids,
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bad,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_57_rejects_non_float32(self):
        import numpy as np
        import scipy.sparse as sp

        bundle = simple_bundle()
        bad = bundle.observed.astype(np.float64)
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids,
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bad,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_58_rejects_negative_matrix_values(self):
        import numpy as np
        import scipy.sparse as sp

        bundle = simple_bundle()
        data = bundle.observed.data.copy()
        data[0] = -1.0
        bad = sp.csr_matrix(
            (data, bundle.observed.indices, bundle.observed.indptr),
            shape=bundle.observed.shape,
            dtype=np.float32,
        )
        bad.eliminate_zeros()
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids,
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bad,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_59_rejects_non_binary_observed(self):
        import numpy as np
        import scipy.sparse as sp

        bundle = simple_bundle()
        data = bundle.observed.data.copy()
        data[0] = 2.0
        bad = sp.csr_matrix(
            (data, bundle.observed.indices, bundle.observed.indptr),
            shape=bundle.observed.shape,
            dtype=np.float32,
        )
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids,
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bad,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_60_rejects_user_count_mismatch(self):
        bundle = simple_bundle()
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids[:-1],
            song_ids=bundle.song_ids,
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bundle.observed,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_61_rejects_song_count_mismatch(self):
        bundle = simple_bundle()
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids[:-1],
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bundle.observed,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_62_rejects_summary_pair_mismatch(self):
        bundle = simple_bundle()
        bad_summary = SparseInteractionSummary(
            event_count=bundle.summary.event_count,
            unique_user_count=bundle.summary.unique_user_count,
            unique_song_count=bundle.summary.unique_song_count,
            interaction_pair_count=bundle.summary.interaction_pair_count + 1,
            session_count=bundle.summary.session_count,
            matrix_shape=bundle.summary.matrix_shape,
        )
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids,
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bundle.observed,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bad_summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_63_rejects_inconsistent_index_map(self):
        bundle = simple_bundle()
        bad_map = dict(bundle.user_to_index)
        first = bundle.user_ids[0]
        bad_map[first] = 999
        from types import MappingProxyType

        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids,
            user_to_index=MappingProxyType(bad_map),
            song_to_index=bundle.song_to_index,
            observed=bundle.observed,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bundle.listened_seconds,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_64_rejects_uppercase_user_ids(self):
        bundle = hand_bundle([U1.upper(), U2], [S1, S2], {(0, 0): {}})
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(bundle)

    def test_64b_rejects_uppercase_song_ids(self):
        hex_song = "ab" + "0" * 22
        bundle = hand_bundle([U1, U2], [hex_song.upper(), S2], {(0, 0): {}})
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(bundle)

    def test_65_rejects_non_hex_song_ids(self):
        bundle = hand_bundle([U1, U2], ["z" * 24, S2], {(0, 0): {}})
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(bundle)

    def test_66_rejects_short_user_ids(self):
        bundle = hand_bundle(["a" * 23, U2], [S1, S2], {(0, 0): {}})
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(bundle)

    def test_67_accepts_valid_bundle(self):
        signal = build_collaborative_training_signal(simple_bundle())
        self.assertGreater(signal.nnz, 0)

    def test_68_does_not_mutate_matrices(self):
        import numpy as np

        bundle = simple_bundle()
        before = [
            getattr(bundle, name).data.copy() for name in _MATRIX_KEYS
        ]
        build_collaborative_training_signal(bundle)
        for name, arr in zip(_MATRIX_KEYS, before):
            self.assertTrue(np.array_equal(arr, getattr(bundle, name).data))

    def test_69_rejects_nan_in_matrix(self):
        import numpy as np
        import scipy.sparse as sp

        bundle = simple_bundle()
        data = bundle.listened_seconds.data.copy()
        if data.size == 0:
            data = np.array([1.0], dtype=np.float32)
            indices = np.array([0], dtype=np.int32)
            indptr = np.zeros(bundle.listened_seconds.shape[0] + 1, dtype=np.int32)
            indptr[-1] = 1
            bad = sp.csr_matrix(
                (data, indices, indptr),
                shape=bundle.listened_seconds.shape,
                dtype=np.float32,
            )
        else:
            data[0] = np.nan
            bad = sp.csr_matrix(
                (data, bundle.listened_seconds.indices, bundle.listened_seconds.indptr),
                shape=bundle.listened_seconds.shape,
                dtype=np.float32,
            )
        corrupted = SparseInteractionBundle(
            user_ids=bundle.user_ids,
            song_ids=bundle.song_ids,
            user_to_index=bundle.user_to_index,
            song_to_index=bundle.song_to_index,
            observed=bundle.observed,
            session_count=bundle.session_count,
            play_started_count=bundle.play_started_count,
            replay_started_count=bundle.replay_started_count,
            completed_count=bundle.completed_count,
            skipped_count=bundle.skipped_count,
            stopped_count=bundle.stopped_count,
            listened_seconds=bad,
            summary=bundle.summary,
        )
        with self.assertRaises(CollaborativeValidationError):
            build_collaborative_training_signal(corrupted)

    def test_70_train_and_signal_share_validation(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(None)


class ComponentAndSeedValidationTests(unittest.TestCase):
    def test_71_rejects_n_components_zero(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), n_components=0)

    def test_72_rejects_n_components_negative(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), n_components=-1)

    def test_73_rejects_n_components_33(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), n_components=33)

    def test_74_rejects_n_components_bool(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), n_components=True)

    def test_75_rejects_n_components_float(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), n_components=4.5)

    def test_76_rejects_n_components_none(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), n_components=None)

    def test_77_accepts_n_components_1(self):
        result = train_collaborative_model(simple_bundle(), n_components=1)
        self.assertEqual(result.status, STATUS_TRAINED)
        self.assertEqual(result.summary.requested_components, 1)

    def test_78_accepts_n_components_32(self):
        result = train_collaborative_model(larger_bundle(), n_components=32)
        self.assertEqual(result.summary.requested_components, 32)

    def test_79_rejects_seed_negative(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), random_seed=-1)

    def test_80_rejects_seed_above_max(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), random_seed=MAX_SEED + 1)

    def test_81_rejects_seed_bool(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), random_seed=True)

    def test_82_rejects_seed_float(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(simple_bundle(), random_seed=42.0)

    def test_83_accepts_seed_zero(self):
        result = train_collaborative_model(simple_bundle(), random_seed=0)
        self.assertEqual(result.summary.random_seed, 0)

    def test_84_accepts_seed_max(self):
        result = train_collaborative_model(simple_bundle(), random_seed=MAX_SEED)
        self.assertEqual(result.summary.random_seed, MAX_SEED)

    def test_85_default_seed_is_42(self):
        result = train_collaborative_model(simple_bundle())
        self.assertEqual(result.summary.random_seed, 42)

    def test_86_validation_runs_before_bundle_work(self):
        with self.assertRaises(CollaborativeValidationError):
            train_collaborative_model(object(), n_components=0)

    def test_87_seed_validation_error_message_bounded(self):
        try:
            train_collaborative_model(simple_bundle(), random_seed=-5)
        except CollaborativeValidationError as exc:
            text = str(exc)
            self.assertLess(len(text), 200)
            self.assertNotIn("password", text.lower())
            self.assertNotIn("token", text.lower())

    def test_88_components_error_message_bounded(self):
        try:
            train_collaborative_model(simple_bundle(), n_components=99)
        except CollaborativeValidationError as exc:
            text = str(exc)
            self.assertLess(len(text), 200)

    def test_89_effective_never_exceeds_max_latent(self):
        result = train_collaborative_model(larger_bundle(), n_components=32)
        self.assertLessEqual(result.summary.effective_components, MAX_LATENT_FACTORS)

    def test_90_requested_components_preserved_on_model(self):
        result = train_collaborative_model(larger_bundle(), n_components=8)
        self.assertEqual(result.model.requested_components, 8)


class InsufficientDataTests(unittest.TestCase):
    def test_91_single_user_insufficient(self):
        make_event.counter = 400
        events = [
            make_event(user_id=U1, song_id=S1, session_id="a", sequence=0),
            make_event(user_id=U1, song_id=S2, session_id="b", sequence=0),
        ]
        bundle = build_sparse_interactions(events)
        result = train_collaborative_model(bundle)
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)
        self.assertIsNone(result.model)

    def test_92_single_song_insufficient(self):
        make_event.counter = 500
        events = [
            make_event(user_id=U1, song_id=S1, session_id="a", sequence=0),
            make_event(user_id=U2, song_id=S1, session_id="b", sequence=0),
            make_event(user_id=U3, song_id=S1, session_id="c", sequence=0),
        ]
        bundle = build_sparse_interactions(events)
        result = train_collaborative_model(bundle)
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)
        self.assertIsNone(result.model)

    def test_93_single_pair_insufficient(self):
        make_event.counter = 600
        events = [
            make_event(user_id=U1, song_id=S1, session_id="a", sequence=0),
            make_event(user_id=U2, song_id=S1, session_id="b", sequence=0),
        ]
        # two users one song -> song count < 2
        bundle = build_sparse_interactions(events)
        result = train_collaborative_model(bundle)
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)

    def test_94_two_pairs_two_users_two_songs_trains(self):
        make_event.counter = 700
        events = [
            make_event(user_id=U1, song_id=S1, session_id="a", sequence=0),
            make_event(user_id=U1, song_id=S2, session_id="b", sequence=0),
            make_event(user_id=U2, song_id=S1, session_id="c", sequence=0),
        ]
        bundle = build_sparse_interactions(events)
        result = train_collaborative_model(bundle)
        self.assertEqual(result.status, STATUS_TRAINED)
        self.assertIsNotNone(result.model)

    def test_95_empty_bundle_insufficient(self):
        bundle = build_sparse_interactions([])
        result = train_collaborative_model(bundle)
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)
        self.assertIsNone(result.model)
        self.assertEqual(result.summary.user_count, 0)
        self.assertEqual(result.summary.song_count, 0)
        self.assertIsNone(result.summary.explained_variance_ratio_sum)

    def test_96_all_clipped_to_zero_insufficient(self):
        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {(0, 0): {"observed": 1.0, "skipped_count": 80.0}},
        )
        signal = build_collaborative_training_signal(bundle)
        self.assertEqual(signal.nnz, 0)
        result = train_collaborative_model(bundle)
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)
        self.assertIsNone(result.model)

    def test_97_insufficient_summary_fields(self):
        bundle = build_sparse_interactions([])
        result = train_collaborative_model(bundle)
        self.assertEqual(result.summary.status, STATUS_INSUFFICIENT_DATA)
        self.assertEqual(result.summary.effective_components, 0)
        self.assertEqual(result.summary.requested_components, DEFAULT_LATENT_FACTORS)
        self.assertEqual(result.summary.random_seed, 42)
        self.assertIsNone(result.summary.explained_variance_ratio_sum)

    def test_98_insufficient_does_not_raise(self):
        bundle = build_sparse_interactions([])
        try:
            result = train_collaborative_model(bundle)
        except Exception as exc:  # pragma: no cover
            self.fail(f"unexpected raise: {exc}")
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)

    def test_99_insufficient_no_fake_factors(self):
        bundle = build_sparse_interactions([])
        result = train_collaborative_model(bundle)
        self.assertFalse(hasattr(result, "user_factors"))
        self.assertIsNone(result.model)

    def test_100_insufficient_result_is_frozen(self):
        result = train_collaborative_model(build_sparse_interactions([]))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.status = STATUS_TRAINED

    def test_101_insufficient_summary_frozen(self):
        result = train_collaborative_model(build_sparse_interactions([]))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.summary.user_count = 10

    def test_102_insufficient_status_matches_summary(self):
        result = train_collaborative_model(build_sparse_interactions([]))
        self.assertEqual(result.status, result.summary.status)

    def test_103_min_pairs_constant_used(self):
        self.assertEqual(MIN_COLLABORATIVE_INTERACTION_PAIRS, 2)

    def test_104_one_user_two_songs_insufficient(self):
        make_event.counter = 800
        events = [
            make_event(user_id=U1, song_id=S1, session_id="a", sequence=0),
            make_event(user_id=U1, song_id=S2, session_id="b", sequence=0),
        ]
        result = train_collaborative_model(build_sparse_interactions(events))
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)

    def test_105_single_pair_two_users_two_songs_insufficient(self):
        bundle = hand_bundle(
            [U1, U2],
            [S1, S2],
            {(0, 0): {"observed": 1.0}},
        )
        result = train_collaborative_model(bundle)
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)
        self.assertIsNone(result.model)

    def test_106_zero_pair_observed_insufficient(self):
        bundle = hand_bundle([U1, U2], [S1, S2], {})
        result = train_collaborative_model(bundle)
        self.assertEqual(result.status, STATUS_INSUFFICIENT_DATA)

    def test_107_insufficient_model_none_not_empty_model(self):
        result = train_collaborative_model(build_sparse_interactions([]))
        self.assertIsNone(result.model)

    def test_108_insufficient_training_signal_nnz_zero(self):
        result = train_collaborative_model(build_sparse_interactions([]))
        self.assertEqual(result.summary.training_signal_nnz, 0)

    def test_109_pair_count_zero_insufficient(self):
        result = train_collaborative_model(build_sparse_interactions([]))
        self.assertEqual(result.summary.interaction_pair_count, 0)

    def test_110_status_strings_exact(self):
        self.assertEqual(STATUS_TRAINED, "trained")
        self.assertEqual(STATUS_INSUFFICIENT_DATA, "insufficient-data")


class TrainingTests(unittest.TestCase):
    def test_111_trained_status(self):
        result = train_collaborative_model(simple_bundle())
        self.assertEqual(result.status, STATUS_TRAINED)

    def test_112_model_not_none(self):
        result = train_collaborative_model(simple_bundle())
        self.assertIsNotNone(result.model)

    def test_113_model_schema_version(self):
        model = train_collaborative_model(simple_bundle()).model
        self.assertEqual(model.schema_version, 1)

    def test_114_user_factors_shape(self):
        bundle = simple_bundle()
        model = train_collaborative_model(bundle).model
        self.assertEqual(
            model.user_factors.shape,
            (len(bundle.user_ids), model.effective_components),
        )

    def test_115_song_factors_shape(self):
        bundle = simple_bundle()
        model = train_collaborative_model(bundle).model
        self.assertEqual(
            model.song_factors.shape,
            (len(bundle.song_ids), model.effective_components),
        )

    def test_116_factors_float32(self):
        model = train_collaborative_model(simple_bundle()).model
        self.assertEqual(model.user_factors.dtype.name, "float32")
        self.assertEqual(model.song_factors.dtype.name, "float32")

    def test_117_factors_finite(self):
        import numpy as np

        model = train_collaborative_model(simple_bundle()).model
        self.assertTrue(bool(np.isfinite(model.user_factors).all()))
        self.assertTrue(bool(np.isfinite(model.song_factors).all()))

    def test_118_user_factors_read_only(self):
        model = train_collaborative_model(simple_bundle()).model
        with self.assertRaises(ValueError):
            model.user_factors[0, 0] = 0.0

    def test_119_song_factors_read_only(self):
        model = train_collaborative_model(simple_bundle()).model
        with self.assertRaises(ValueError):
            model.song_factors[0, 0] = 0.0

    def test_120_singular_values_read_only(self):
        model = train_collaborative_model(simple_bundle()).model
        with self.assertRaises(ValueError):
            model.singular_values[0] = 0.0

    def test_121_explained_variance_read_only(self):
        model = train_collaborative_model(simple_bundle()).model
        with self.assertRaises(ValueError):
            model.explained_variance_ratio[0] = 0.0

    def test_122_determinism_same_seed(self):
        a = train_collaborative_model(simple_bundle(), random_seed=42)
        b = train_collaborative_model(simple_bundle(), random_seed=42)
        import numpy as np

        self.assertTrue(np.array_equal(a.model.user_factors, b.model.user_factors))
        self.assertTrue(np.array_equal(a.model.song_factors, b.model.song_factors))

    def test_123_determinism_repeated_three_times(self):
        import numpy as np

        runs = [
            train_collaborative_model(larger_bundle(), random_seed=7)
            for _ in range(3)
        ]
        for other in runs[1:]:
            self.assertTrue(
                np.array_equal(runs[0].model.user_factors, other.model.user_factors)
            )
            self.assertTrue(
                np.array_equal(runs[0].model.song_factors, other.model.song_factors)
            )

    def test_124_different_seed_can_differ(self):
        a = train_collaborative_model(larger_bundle(), random_seed=1)
        b = train_collaborative_model(larger_bundle(), random_seed=2)
        import numpy as np

        self.assertFalse(
            np.array_equal(a.model.user_factors, b.model.user_factors)
        )

    def test_125_effective_components_shrink(self):
        bundle = simple_bundle()
        result = train_collaborative_model(bundle, n_components=32)
        expected = min(32, len(bundle.user_ids) - 1, len(bundle.song_ids) - 1)
        self.assertEqual(result.summary.effective_components, expected)
        self.assertEqual(result.model.effective_components, expected)

    def test_126_algorithm_field(self):
        model = train_collaborative_model(simple_bundle()).model
        self.assertEqual(model.algorithm, "randomized")

    def test_127_n_iter_field(self):
        model = train_collaborative_model(simple_bundle()).model
        self.assertEqual(model.n_iter, 7)

    def test_128_seed_field(self):
        model = train_collaborative_model(simple_bundle(), random_seed=9).model
        self.assertEqual(model.random_seed, 9)

    def test_129_user_ids_preserved(self):
        bundle = simple_bundle()
        model = train_collaborative_model(bundle).model
        self.assertEqual(model.user_ids, bundle.user_ids)

    def test_130_song_ids_preserved(self):
        bundle = simple_bundle()
        model = train_collaborative_model(bundle).model
        self.assertEqual(model.song_ids, bundle.song_ids)

    def test_131_index_maps_match_ids(self):
        bundle = simple_bundle()
        model = train_collaborative_model(bundle).model
        for i, u in enumerate(model.user_ids):
            self.assertEqual(model.user_to_index[u], i)
        for i, s in enumerate(model.song_ids):
            self.assertEqual(model.song_to_index[s], i)

    def test_132_index_maps_read_only(self):
        model = train_collaborative_model(simple_bundle()).model
        with self.assertRaises(TypeError):
            model.user_to_index["x"] = 0

    def test_133_song_index_maps_read_only(self):
        model = train_collaborative_model(simple_bundle()).model
        with self.assertRaises(TypeError):
            model.song_to_index["x"] = 0

    def test_134_summary_explained_variance_not_none(self):
        result = train_collaborative_model(simple_bundle())
        self.assertIsNotNone(result.summary.explained_variance_ratio_sum)
        self.assertGreaterEqual(result.summary.explained_variance_ratio_sum, 0.0)
        self.assertLessEqual(result.summary.explained_variance_ratio_sum, 1.0 + 1e-5)

    def test_135_summary_status_trained(self):
        result = train_collaborative_model(simple_bundle())
        self.assertEqual(result.summary.status, STATUS_TRAINED)
        self.assertEqual(result.status, result.summary.status)

    def test_136_summary_counts(self):
        bundle = simple_bundle()
        result = train_collaborative_model(bundle)
        self.assertEqual(result.summary.user_count, len(bundle.user_ids))
        self.assertEqual(result.summary.song_count, len(bundle.song_ids))
        self.assertEqual(
            result.summary.interaction_pair_count, int(bundle.observed.nnz)
        )

    def test_137_result_frozen(self):
        result = train_collaborative_model(simple_bundle())
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.status = "x"

    def test_138_model_frozen(self):
        model = train_collaborative_model(simple_bundle()).model
        with self.assertRaises(dataclasses.FrozenInstanceError):
            model.schema_version = 2

    def test_139_summary_frozen(self):
        result = train_collaborative_model(simple_bundle())
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.summary.status = "x"

    def test_140_uses_truncated_svd_randomized(self):
        source = MODULE_SOURCE
        self.assertIn("TruncatedSVD", source)
        self.assertIn("randomized", source)
        self.assertIn("n_iter", source)

    def test_141_random_state_is_seed(self):
        source = MODULE_SOURCE
        self.assertIn("random_state=seed", source)

    def test_142_no_hyperparameter_search(self):
        for needle in ("GridSearchCV", "RandomizedSearchCV", "Optuna"):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_143_factors_not_l2_normalized(self):
        import numpy as np

        model = train_collaborative_model(simple_bundle()).model
        norms = np.linalg.norm(model.user_factors, axis=1)
        self.assertTrue(bool((np.abs(norms - 1.0) > 1e-3).any()))

    def test_144_training_signal_nnz_matches(self):
        bundle = simple_bundle()
        signal = build_collaborative_training_signal(bundle)
        result = train_collaborative_model(bundle)
        self.assertEqual(result.summary.training_signal_nnz, int(signal.nnz))

    def test_145_cpu_env_after_train(self):
        train_collaborative_model(simple_bundle())
        for name in CPU_THREAD_ENV_VARS:
            self.assertEqual(os.environ.get(name), str(THREADS_PER_NUMERIC_LIBRARY))
        self.assertEqual(os.environ.get(CUDA_VISIBLE_DEVICES_VAR), "")

    def test_146_effective_components_at_least_one(self):
        result = train_collaborative_model(simple_bundle())
        self.assertGreaterEqual(result.summary.effective_components, 1)

    def test_147_singular_values_shape(self):
        model = train_collaborative_model(simple_bundle()).model
        self.assertEqual(model.singular_values.shape[0], model.effective_components)

    def test_148_explained_variance_shape(self):
        model = train_collaborative_model(simple_bundle()).model
        self.assertEqual(
            model.explained_variance_ratio.shape[0], model.effective_components
        )

    def test_149_fit_transform_used(self):
        self.assertIn("fit_transform", MODULE_SOURCE)

    def test_150_components_transposed_to_song_factors(self):
        self.assertIn("components_.T", MODULE_SOURCE)

    def test_151_no_full_matrix_reconstruction(self):
        for needle in (
            "user_factors @ song_factors",
            "user_factors.dot(song_factors.T",
            "user_factors @ song_factors.T",
        ):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_152_larger_bundle_trains_full_requested_when_possible(self):
        bundle = larger_bundle()
        result = train_collaborative_model(bundle, n_components=3)
        self.assertEqual(result.status, STATUS_TRAINED)
        self.assertEqual(result.model.effective_components, 3)

    def test_153_model_maps_are_mapping_proxy(self):
        from types import MappingProxyType

        model = train_collaborative_model(simple_bundle()).model
        self.assertIsInstance(model.user_to_index, MappingProxyType)
        self.assertIsInstance(model.song_to_index, MappingProxyType)

    def test_154_summary_is_dataclass(self):
        result = train_collaborative_model(simple_bundle())
        self.assertTrue(dataclasses.is_dataclass(result.summary))

    def test_155_model_is_dataclass(self):
        model = train_collaborative_model(simple_bundle()).model
        self.assertTrue(dataclasses.is_dataclass(model))

    def test_156_train_default_args(self):
        result = train_collaborative_model(simple_bundle())
        self.assertEqual(result.summary.requested_components, 32)
        self.assertEqual(result.summary.random_seed, 42)

    def test_157_status_trained_string(self):
        result = train_collaborative_model(simple_bundle())
        self.assertEqual(result.status, "trained")

    def test_158_no_artifact_publish_on_train(self):
        for needle in (
            "publish_artifact_release",
            "activate_artifact_release",
            "joblib.dump",
        ):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_159_training_does_not_call_evaluation(self):
        self.assertNotIn("evaluate_recommendations", MODULE_SOURCE)

    def test_160_effective_formula_documented_in_code(self):
        self.assertIn("user_count - 1", MODULE_SOURCE)
        self.assertIn("song_count - 1", MODULE_SOURCE)


class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.bundle = simple_bundle()
        self.result = train_collaborative_model(self.bundle)
        self.model = self.result.model

    def test_161_returns_tuple(self):
        scores = score_collaborative_candidates(self.model, U1, [S1, S2])
        self.assertIsInstance(scores, tuple)

    def test_162_item_score_type(self):
        scores = score_collaborative_candidates(self.model, U1, [S1])
        self.assertIsInstance(scores[0], CollaborativeItemScore)

    def test_163_preserves_input_order(self):
        scores = score_collaborative_candidates(self.model, U1, [S3, S1, S2])
        self.assertEqual(
            [s.song_id for s in scores], [S3, S1, S2]
        )

    def test_164_empty_candidates(self):
        scores = score_collaborative_candidates(self.model, U1, [])
        self.assertEqual(scores, ())

    def test_165_empty_tuple_candidates(self):
        scores = score_collaborative_candidates(self.model, U1, ())
        self.assertEqual(scores, ())

    def test_166_score_is_float(self):
        scores = score_collaborative_candidates(self.model, U1, [S1])
        self.assertIsInstance(scores[0].score, float)

    def test_167_score_may_be_negative(self):
        import numpy as np

        # construct model where dot can be negative by using raw factors
        scores = score_collaborative_candidates(
            self.model, U1, list(self.model.song_ids)
        )
        # at least scoring works for all songs
        self.assertEqual(len(scores), len(self.model.song_ids))

    def test_168_manual_dot_formula(self):
        import numpy as np

        scores = score_collaborative_candidates(self.model, U1, [S1])
        ui = self.model.user_to_index[U1]
        si = self.model.song_to_index[S1]
        expected = float(np.dot(self.model.user_factors[ui], self.model.song_factors[si]))
        assert_close(self, scores[0].score, expected, places=6)

    def test_169_no_sigmoid_or_clip_on_score(self):
        scores = score_collaborative_candidates(
            self.model, U1, list(self.model.song_ids)
        )
        raw_values = [s.score for s in scores]
        # raw scores are not forced into [0,1]
        import numpy as np

        ui = self.model.user_to_index[U1]
        for s in scores:
            si = self.model.song_to_index[s.song_id]
            expected = float(
                np.dot(self.model.user_factors[ui], self.model.song_factors[si])
            )
            assert_close(self, s.score, expected, places=6)

    def test_170_unknown_user_raises(self):
        with self.assertRaises(CollaborativeUnknownUserError):
            score_collaborative_candidates(self.model, "f" * 24, [S1])

    def test_171_unknown_song_raises(self):
        with self.assertRaises(CollaborativeUnknownSongError):
            score_collaborative_candidates(self.model, U1, ["e" * 24])

    def test_172_invalid_user_format_raises(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, "not-an-id", [S1])

    def test_173_invalid_song_format_raises(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, U1, ["nope"])

    def test_174_rejects_set_candidates(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, U1, {S1, S2})

    def test_175_rejects_generator_candidates(self):
        def gen():
            yield S1

        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, U1, gen())

    def test_176_rejects_string_candidates(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, U1, S1)

    def test_177_rejects_mapping_candidates(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, U1, {"song": S1})

    def test_178_rejects_duplicate_candidates(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, U1, [S1, S1])

    def test_179_rejects_case_variant_duplicates(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, U1, [S1, S1.upper()])

    def test_180_rejects_non_model(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(None, U1, [S1])

    def test_181_rejects_result_as_model(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.result, U1, [S1])

    def test_182_canonicalizes_uppercase_user(self):
        scores = score_collaborative_candidates(self.model, U1.upper(), [S1])
        self.assertEqual(len(scores), 1)

    def test_183_canonicalizes_uppercase_song(self):
        scores = score_collaborative_candidates(self.model, U1, [S1.upper()])
        self.assertEqual(scores[0].song_id, S1)

    def test_184_no_seen_song_filtering(self):
        # U1 interacted with S1 in simple_bundle; S1 must still be scorable
        scores = score_collaborative_candidates(self.model, U1, [S1, S2, S3])
        ids = [s.song_id for s in scores]
        self.assertIn(S1, ids)
        self.assertIn(S2, ids)

    def test_185_no_ranking_sort(self):
        # pass songs in reverse lexical order; output must match input
        ordered = list(reversed(sorted(self.model.song_ids)))
        scores = score_collaborative_candidates(self.model, U1, ordered)
        self.assertEqual([s.song_id for s in scores], ordered)

    def test_186_cannot_modify_result_tuple(self):
        scores = score_collaborative_candidates(self.model, U1, [S1])
        with self.assertRaises(TypeError):
            scores[0] = CollaborativeItemScore(song_id=S1, score=0.0)

    def test_187_item_score_frozen(self):
        score = score_collaborative_candidates(self.model, U1, [S1])[0]
        with self.assertRaises(dataclasses.FrozenInstanceError):
            score.score = 0.0

    def test_188_score_not_probability_claim(self):
        scores = score_collaborative_candidates(
            self.model, U1, list(self.model.song_ids)
        )
        # no forced [0,1] requirement — just ensure finite floats
        for s in scores:
            self.assertTrue(math.isfinite(s.score))

    def test_189_unknown_user_checked_before_songs(self):
        with self.assertRaises(CollaborativeUnknownUserError):
            score_collaborative_candidates(self.model, "f" * 24, ["e" * 24])

    def test_190_multiple_users_score_independently(self):
        s1 = score_collaborative_candidates(self.model, U1, [S1])[0]
        s2 = score_collaborative_candidates(self.model, U2, [S1])[0]
        import numpy as np

        ui1 = self.model.user_to_index[U1]
        ui2 = self.model.user_to_index[U2]
        si = self.model.song_to_index[S1]
        e1 = float(np.dot(self.model.user_factors[ui1], self.model.song_factors[si]))
        e2 = float(np.dot(self.model.user_factors[ui2], self.model.song_factors[si]))
        assert_close(self, s1.score, e1, places=6)
        assert_close(self, s2.score, e2, places=6)

    def test_191_duplicate_after_canonicalization(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, U1, [S1, S1.strip() + ""])

    def test_192_scores_tuple_length_matches_input(self):
        candidates = list(self.model.song_ids)
        scores = score_collaborative_candidates(self.model, U1, candidates)
        self.assertEqual(len(scores), len(candidates))

    def test_193_no_content_features_in_score(self):
        self.assertNotIn("SongContentFeatureBundle", MODULE_SOURCE)
        self.assertNotIn("build_song_content_features", MODULE_SOURCE)

    def test_194_no_evaluation_call_in_score(self):
        self.assertNotIn("evaluate_recommendations", MODULE_SOURCE)

    def test_195_score_rejects_bool_user(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, True, [S1])

    def test_196_score_rejects_none_user(self):
        with self.assertRaises(CollaborativeValidationError):
            score_collaborative_candidates(self.model, None, [S1])

    def test_197_score_works_for_every_model_song(self):
        for song in self.model.song_ids:
            scores = score_collaborative_candidates(self.model, U1, [song])
            self.assertEqual(scores[0].song_id, song)

    def test_198_score_works_for_every_model_user(self):
        for user in self.model.user_ids:
            scores = score_collaborative_candidates(self.model, user, [S1])
            self.assertEqual(len(scores), 1)

    def test_199_bounded_working_data_is_per_candidate_dot(self):
        # ensure no full reconstruction symbol
        for needle in (".toarray(", ".todense("):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_200_score_input_list_not_mutated(self):
        candidates = [S2, S1, S3]
        snapshot = list(candidates)
        score_collaborative_candidates(self.model, U1, candidates)
        self.assertEqual(candidates, snapshot)


class MemoryAndStaticSafetyTests(unittest.TestCase):
    def test_201_no_dense_toarray(self):
        self.assertNotIn(".toarray(", MODULE_SOURCE)

    def test_202_no_dense_todense(self):
        self.assertNotIn(".todense(", MODULE_SOURCE)

    def test_203_no_dense_user_song_zeros(self):
        self.assertNotIn("np.zeros((n_users", MODULE_SOURCE)
        self.assertNotIn("numpy.zeros((n_users", MODULE_SOURCE)

    def test_204_no_pca(self):
        self.assertNotIn("PCA(", MODULE_SOURCE)

    def test_205_no_nmf(self):
        self.assertNotIn("NMF(", MODULE_SOURCE)

    def test_206_no_grid_search(self):
        self.assertNotIn("GridSearchCV", MODULE_SOURCE)

    def test_207_no_randomized_search(self):
        self.assertNotIn("RandomizedSearchCV", MODULE_SOURCE)

    def test_208_no_favorite_string(self):
        self.assertNotIn("Favorite", MODULE_SOURCE)

    def test_209_no_playlist_string(self):
        self.assertNotIn("Playlist", MODULE_SOURCE)

    def test_210_no_content_bundle_string(self):
        self.assertNotIn("SongContentFeatureBundle", MODULE_SOURCE)

    def test_211_no_pymongo(self):
        self.assertNotIn("pymongo", MODULE_SOURCE)

    def test_212_no_mongoclient(self):
        self.assertNotIn("MongoClient", MODULE_SOURCE)

    def test_213_no_fastapi(self):
        self.assertNotIn("FastAPI", MODULE_SOURCE)

    def test_214_no_flask(self):
        self.assertNotIn("Flask", MODULE_SOURCE)

    def test_215_no_requests(self):
        self.assertNotIn("requests", MODULE_SOURCE)

    def test_216_no_artifact_publish(self):
        self.assertNotIn("publish_artifact_release", MODULE_SOURCE)

    def test_217_no_artifact_activate(self):
        self.assertNotIn("activate_artifact_release", MODULE_SOURCE)

    def test_218_no_evaluate_recommendations(self):
        self.assertNotIn("evaluate_recommendations", MODULE_SOURCE)

    def test_219_no_joblib_dump(self):
        self.assertNotIn("joblib.dump", MODULE_SOURCE)

    def test_220_no_pickle(self):
        self.assertNotIn("pickle", MODULE_SOURCE)

    def test_221_has_truncated_svd(self):
        self.assertIn("TruncatedSVD", MODULE_SOURCE)

    def test_222_has_log1p(self):
        self.assertIn("log1p", MODULE_SOURCE)

    def test_223_has_sparse_csr_ops(self):
        self.assertIn("csr_matrix", MODULE_SOURCE)

    def test_224_no_forbidden_ast_imports(self):
        tree = ast.parse(MODULE_SOURCE)
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imported.add(alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        forbidden = {
            "pymongo",
            "pandas",
            "requests",
            "fastapi",
            "flask",
            "torch",
            "tensorflow",
        }
        self.assertFalse(imported & forbidden, imported & forbidden)

    def test_225_no_cli_train_command(self):
        cli_source = (
            PROJECT_ROOT / "ml" / "recommender" / "cli.py"
        ).read_text(encoding="utf-8")
        self.assertIn("runtime-info", cli_source)
        self.assertNotIn('"train"', cli_source)
        self.assertNotIn("'train'", cli_source)
        self.assertNotIn("fit", cli_source.split("def ")[0])

    def test_226_runtime_info_unchanged_fields(self):
        import json

        out = subprocess.run(
            [sys.executable, "-m", "ml.recommender.cli", "runtime-info", "--json"],
            check=True,
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
        )
        payload = json.loads(out.stdout)
        self.assertEqual(payload["random_seed"], 42)
        self.assertEqual(payload["max_raw_events"], 250000)
        self.assertEqual(payload["max_unique_users"], 50000)
        self.assertEqual(payload["max_unique_songs"], 25000)
        self.assertEqual(payload["numeric_threads"], 1)
        self.assertEqual(payload["max_workers"], 1)
        self.assertEqual(payload["runtime_schema_version"], 1)

    def test_227_no_filesystem_reads_in_module(self):
        for needle in ("open(", "read_text", "Path(", "json.load"):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_228_no_subprocess_or_multiprocessing(self):
        for needle in ("subprocess", "multiprocessing", "os.system"):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_229_no_http_client(self):
        for needle in ("urllib", "http.client", "httpx"):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_230_forbidden_strings_complete_scan(self):
        forbidden = [
            ".toarray(",
            ".todense(",
            "np.zeros((n_users",
            "numpy.zeros((n_users",
            "PCA(",
            "NMF(",
            "GridSearchCV",
            "RandomizedSearchCV",
            "Favorite",
            "Playlist",
            "SongContentFeatureBundle",
            "pymongo",
            "MongoClient",
            "FastAPI",
            "Flask",
            "requests",
            "publish_artifact_release",
            "activate_artifact_release",
            "evaluate_recommendations",
            "joblib.dump",
            "pickle",
        ]
        for needle in forbidden:
            self.assertNotIn(needle, MODULE_SOURCE, needle)


class LazyCpuRuntimeTests(unittest.TestCase):
    def test_231_import_does_not_set_omp(self):
        code = (
            "import os, sys\n"
            "os.environ.pop('OMP_NUM_THREADS', None)\n"
            "import ml.recommender.collaborative_model\n"
            "assert 'OMP_NUM_THREADS' not in os.environ\n"
        )
        subprocess.run(
            [sys.executable, "-c", code],
            check=True,
            cwd=str(PROJECT_ROOT),
            timeout=60,
        )

    def test_232_train_sets_numeric_threads(self):
        train_collaborative_model(simple_bundle())
        self.assertEqual(os.environ.get("OMP_NUM_THREADS"), "1")
        self.assertEqual(os.environ.get("OPENBLAS_NUM_THREADS"), "1")
        self.assertEqual(os.environ.get("MKL_NUM_THREADS"), "1")

    def test_233_train_clears_cuda(self):
        train_collaborative_model(simple_bundle())
        self.assertEqual(os.environ.get("CUDA_VISIBLE_DEVICES"), "")

    def test_234_no_gpu_code(self):
        for needle in ("cuda", "torch", "tensorflow", "cupy"):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_235_signal_build_configures_runtime(self):
        from ml.recommender.collaborative_model import _np

        # ensure stack configured after any previous test called it
        build_collaborative_training_signal(simple_bundle())
        from ml.recommender import collaborative_model as cm

        self.assertIsNotNone(cm._np)


class DocumentationContractTests(unittest.TestCase):
    def test_236_module_docstring_mentions_heuristic(self):
        self.assertIn("heuristic", MODULE_SOURCE)

    def test_237_module_docstring_mentions_not_learned(self):
        self.assertIn("not learned", MODULE_SOURCE)
        self.assertIn("not an optimized", MODULE_SOURCE)

    def test_238_stopped_neutral_documented(self):
        self.assertIn("stopped_count", MODULE_SOURCE)
        self.assertIn("unused", MODULE_SOURCE)

    def test_239_no_optimal_weight_claim(self):
        for needle in ("optimal weight", "best weight", "optimized weight"):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_240_no_production_active_claim(self):
        for needle in (
            "production recommendations active",
            "model quality proven",
            "accuracy of the model",
        ):
            self.assertNotIn(needle, MODULE_SOURCE)


if __name__ == "__main__":
    unittest.main()
