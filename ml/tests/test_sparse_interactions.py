"""Standard-library tests for bounded sparse interaction matrix building."""

from __future__ import annotations

import ast
import copy
import dataclasses
import inspect
import os
import subprocess
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ml.recommender.runtime import (
    CPU_THREAD_ENV_VARS,
    CUDA_VISIBLE_DEVICES_VAR,
    MAX_RAW_EVENTS,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    ResourceLimitError,
    THREADS_PER_NUMERIC_LIBRARY,
)
from ml.recommender.sparse_interactions import (
    MATRIX_NAMES,
    SparseInteractionBundle,
    SparseInteractionError,
    SparseInteractionSummary,
    SparseInteractionValidationError,
    build_sparse_interactions,
)
from ml.recommender.temporal_split import (
    MAX_LISTENED_DELTA_SECONDS,
    MAX_SEQUENCE,
    MAX_SESSION_ID_LENGTH,
    SUPPORTED_EVENT_TYPES,
    TemporalInteractionEvent,
)

MODULE_PATH = Path(__file__).resolve().parents[1] / "recommender" / "sparse_interactions.py"
MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
PROJECT_ROOT = Path(__file__).resolve().parents[2]

U1 = "a" * 24
U2 = "b" * 24
U3 = "c" * 24
S1 = "1" * 24
S2 = "2" * 24
S3 = "3" * 24

BASE_TIME = datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)


def make_event(
    *,
    event_id: str | None = None,
    user_id: str = U1,
    song_id: str = S1,
    session_id: str = "sess-1",
    sequence: int = 0,
    event_type: str = "play-started",
    listened_seconds_delta: float | None = None,
    created_at: datetime | None = None,
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
        created_at=created_at if created_at is not None else BASE_TIME,
    )


make_event.counter = 0


def run_build(events) -> SparseInteractionBundle:
    return build_sparse_interactions(events)


class InputTypeTests(unittest.TestCase):
    def test_accepts_list(self):
        bundle = run_build([make_event()])
        self.assertEqual(bundle.summary.event_count, 1)

    def test_accepts_tuple(self):
        bundle = run_build((make_event(),))
        self.assertEqual(bundle.summary.event_count, 1)

    def test_accepts_empty_list(self):
        bundle = run_build([])
        self.assertEqual(bundle.summary.event_count, 0)
        self.assertEqual(bundle.user_ids, ())
        self.assertEqual(bundle.song_ids, ())
        self.assertEqual(bundle.summary.matrix_shape, (0, 0))

    def test_accepts_empty_tuple(self):
        bundle = run_build(())
        self.assertEqual(bundle.summary.matrix_shape, (0, 0))
        for name in MATRIX_NAMES:
            matrix = getattr(bundle, name)
            self.assertEqual(matrix.shape, (0, 0))
            self.assertEqual(matrix.nnz, 0)
            self.assertEqual(matrix.dtype.name, "float32")

    def test_rejects_string(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions("not events")

    def test_rejects_bytes(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(b"not events")

    def test_rejects_mapping(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions({"event": 1})

    def test_rejects_none(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(None)

    def test_rejects_generator(self):
        def gen():
            yield make_event()

        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(gen())

    def test_rejects_raw_dict_event(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([{"event_id": "x"}])

    def test_rejects_arbitrary_object(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([object()])

    def test_rejects_int_items(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([1, 2, 3])


class EmptyBundleTests(unittest.TestCase):
    def test_empty_matrices_are_canonical_csr_float32(self):
        bundle = run_build([])
        for name in MATRIX_NAMES:
            matrix = getattr(bundle, name)
            self.assertEqual(matrix.format, "csr")
            self.assertEqual(matrix.dtype.name, "float32")
            self.assertEqual(matrix.nnz, 0)
            self.assertTrue(matrix.has_sorted_indices)

    def test_empty_summary_is_zeroed(self):
        bundle = run_build([])
        summary = bundle.summary
        self.assertEqual(summary.event_count, 0)
        self.assertEqual(summary.unique_user_count, 0)
        self.assertEqual(summary.unique_song_count, 0)
        self.assertEqual(summary.interaction_pair_count, 0)
        self.assertEqual(summary.session_count, 0)
        self.assertEqual(summary.matrix_shape, (0, 0))

    def test_empty_maps_are_empty(self):
        bundle = run_build([])
        self.assertEqual(len(bundle.user_to_index), 0)
        self.assertEqual(len(bundle.song_to_index), 0)


class ValidationTests(unittest.TestCase):
    def test_rejects_non_canonical_user_id(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([make_event(user_id="A" * 24)])

    def test_rejects_uppercase_song_id(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([make_event(song_id="B" * 24)])

    def test_rejects_short_id(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([make_event(user_id="abc")])

    def test_rejects_non_hex_id(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [make_event(user_id="z" * 24)]
            )

    def test_rejects_empty_session_id(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([make_event(session_id="   ")])

    def test_rejects_overlong_session_id(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [make_event(session_id="s" * (MAX_SESSION_ID_LENGTH + 1))]
            )

    def test_rejects_bool_sequence(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([make_event(sequence=True)])

    def test_rejects_negative_sequence(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([make_event(sequence=-1)])

    def test_rejects_over_max_sequence(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [make_event(sequence=MAX_SEQUENCE + 1)]
            )

    def test_rejects_unknown_event_type(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [make_event(event_type="liked-something")]
            )

    def test_rejects_non_finite_delta(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [make_event(listened_seconds_delta=float("nan"))]
            )

    def test_rejects_infinite_delta(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [make_event(listened_seconds_delta=float("inf"))]
            )

    def test_rejects_delta_over_max(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [
                    make_event(
                        listened_seconds_delta=MAX_LISTENED_DELTA_SECONDS + 1
                    )
                ]
            )

    def test_rejects_bool_delta(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions([make_event(listened_seconds_delta=True)])

    def test_rejects_naive_created_at(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [make_event(created_at=datetime(2026, 9, 1, 10, 0, 0))]
            )

    def test_rejects_string_created_at(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [
                    TemporalInteractionEvent(
                        event_id="a" * 24,
                        user_id=U1,
                        song_id=S1,
                        session_id="s",
                        sequence=0,
                        event_type="progress",
                        listened_seconds_delta=None,
                        created_at="2026-09-01T10:00:00+00:00",  # type: ignore[arg-type]
                    )
                ]
            )

    def test_accepts_none_delta(self):
        bundle = run_build([make_event(listened_seconds_delta=None)])
        self.assertEqual(bundle.summary.event_count, 1)

    def test_rejects_duplicate_event_id(self):
        shared = "d" * 24
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [
                    make_event(event_id=shared, sequence=0),
                    make_event(event_id=shared, sequence=1),
                ]
            )

    def test_rejects_duplicate_sequence_in_session(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [
                    make_event(session_id="s", sequence=0),
                    make_event(session_id="s", sequence=0),
                ]
            )

    def test_allows_sequence_gaps(self):
        bundle = run_build(
            [
                make_event(session_id="s", sequence=0),
                make_event(session_id="s", sequence=5),
            ]
        )
        self.assertEqual(bundle.summary.event_count, 2)

    def test_rejects_multi_song_session(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions(
                [
                    make_event(song_id=S1, session_id="s", sequence=0),
                    make_event(song_id=S2, session_id="s", sequence=1),
                ]
            )

    def test_same_session_id_different_users_ok(self):
        bundle = run_build(
            [
                make_event(user_id=U1, song_id=S1, session_id="shared"),
                make_event(user_id=U2, song_id=S2, session_id="shared"),
            ]
        )
        self.assertEqual(bundle.summary.session_count, 2)

    def test_validation_error_is_sparse_interaction_error(self):
        self.assertTrue(
            issubclass(SparseInteractionValidationError, SparseInteractionError)
        )
        self.assertTrue(issubclass(SparseInteractionError, Exception))

    def test_validation_error_message_is_bounded(self):
        try:
            build_sparse_interactions([make_event(user_id="bad")])
        except SparseInteractionValidationError as exc:
            message = str(exc)
            self.assertNotIn("Traceback", message)
            self.assertNotIn("mongodb", message.lower())
            self.assertNotIn("password", message.lower())
            self.assertLess(len(message), 200)

    def test_error_index_included_for_invalid_item(self):
        with self.assertRaises(SparseInteractionValidationError) as ctx:
            build_sparse_interactions([make_event(), object()])
        self.assertIn("event 1", str(ctx.exception))


class RuntimeCapTests(unittest.TestCase):
    def test_caps_derive_from_runtime(self):
        from ml.recommender import sparse_interactions as si

        self.assertEqual(si.MAX_RAW_EVENTS, MAX_RAW_EVENTS)
        self.assertEqual(si.MAX_UNIQUE_USERS, MAX_UNIQUE_USERS)
        self.assertEqual(si.MAX_UNIQUE_SONGS, MAX_UNIQUE_SONGS)

    def test_raw_event_cap_overflow_raises(self):
        events = [make_event() for _ in range(0)]
        events = _FakeLongList(MAX_RAW_EVENTS + 1)
        with self.assertRaises(ResourceLimitError):
            build_sparse_interactions(events)

    def test_unique_user_cap_enforced(self):
        from unittest import mock

        with mock.patch.object(
            __import__(
                "ml.recommender.sparse_interactions", fromlist=["x"]
            ),
            "MAX_UNIQUE_USERS",
            1,
        ):
            with mock.patch.object(
                __import__(
                    "ml.recommender.sparse_interactions", fromlist=["x"]
                ),
                "validate_dataset_shape",
                _limit_users(1),
            ):
                events = [
                    make_event(user_id=U1, session_id="a", sequence=0),
                    make_event(user_id=U2, session_id="b", sequence=0),
                ]
                with self.assertRaises(ResourceLimitError):
                    build_sparse_interactions(events)

    def test_unique_song_cap_enforced(self):
        from unittest import mock

        with mock.patch.object(
            __import__(
                "ml.recommender.sparse_interactions", fromlist=["x"]
            ),
            "validate_dataset_shape",
            _limit_songs(1),
        ):
            events = [
                make_event(song_id=S1, session_id="a", sequence=0),
                make_event(song_id=S2, session_id="b", sequence=1),
            ]
            with self.assertRaises(ResourceLimitError):
                build_sparse_interactions(events)

    def test_no_silent_truncation(self):
        from unittest import mock

        with mock.patch.object(
            __import__(
                "ml.recommender.sparse_interactions", fromlist=["x"]
            ),
            "validate_dataset_shape",
            _limit_users(1),
        ):
            events = [
                make_event(user_id=U1, session_id="a", sequence=0),
                make_event(user_id=U2, session_id="b", sequence=0),
            ]
            with self.assertRaises(ResourceLimitError):
                build_sparse_interactions(events)


def _limit_users(limit: int):
    def wrapped(events_count, users, songs, **kwargs):
        if users > limit:
            raise ResourceLimitError(
                f"unique_user_count exceeds limit {limit}"
            )
        return events_count, users, songs

    return wrapped


def _limit_songs(limit: int):
    def wrapped(events_count, users, songs, **kwargs):
        if songs > limit:
            raise ResourceLimitError(
                f"unique_song_count exceeds limit {limit}"
            )
        return events_count, users, songs

    return wrapped


class _FakeLongList(list):
    def __init__(self, length: int):
        super().__init__()
        self._length = length

    def __len__(self) -> int:
        return self._length

    def __iter__(self):
        raise AssertionError("should not iterate when over cap")


class IndexDeterminismTests(unittest.TestCase):
    def test_user_ids_sorted_lexicographically(self):
        bundle = run_build(
            [
                make_event(user_id=U2, session_id="a", sequence=0),
                make_event(user_id=U1, session_id="b", sequence=0),
            ]
        )
        self.assertEqual(bundle.user_ids, tuple(sorted((U1, U2))))
        self.assertEqual(bundle.user_ids[0], U1)
        self.assertEqual(bundle.user_ids[1], U2)

    def test_song_ids_sorted_lexicographically(self):
        bundle = run_build(
            [
                make_event(song_id=S3, session_id="a", sequence=0),
                make_event(song_id=S1, session_id="b", sequence=0),
                make_event(song_id=S2, session_id="c", sequence=0),
            ]
        )
        self.assertEqual(bundle.song_ids, (S1, S2, S3))

    def test_index_maps_match_sorted_order(self):
        bundle = run_build(
            [
                make_event(user_id=U2, song_id=S2, session_id="a", sequence=0),
                make_event(user_id=U1, song_id=S1, session_id="b", sequence=0),
            ]
        )
        self.assertEqual(bundle.user_to_index[U1], 0)
        self.assertEqual(bundle.user_to_index[U2], 1)
        self.assertEqual(bundle.song_to_index[S1], 0)
        self.assertEqual(bundle.song_to_index[S2], 1)

    def test_user_to_index_is_mapping_proxy(self):
        bundle = run_build([make_event()])
        self.assertIsInstance(bundle.user_to_index, type(bundle.user_to_index))
        from types import MappingProxyType

        self.assertIsInstance(bundle.user_to_index, MappingProxyType)
        self.assertIsInstance(bundle.song_to_index, MappingProxyType)

    def test_index_maps_are_read_only(self):
        bundle = run_build([make_event()])
        with self.assertRaises(TypeError):
            bundle.user_to_index["x"] = 0  # type: ignore[index]
        with self.assertRaises(TypeError):
            bundle.song_to_index["y"] = 0  # type: ignore[index]

    def test_input_order_does_not_change_matrices(self):
        events_a = [
            make_event(event_id="1" * 24, user_id=U1, song_id=S1, session_id="s1", sequence=0, event_type="play-started", listened_seconds_delta=10.0, created_at=BASE_TIME),
            make_event(event_id="2" * 24, user_id=U1, song_id=S1, session_id="s1", sequence=1, event_type="completed", listened_seconds_delta=5.0, created_at=BASE_TIME + timedelta(seconds=1)),
            make_event(event_id="3" * 24, user_id=U2, song_id=S2, session_id="s2", sequence=0, event_type="play-started", listened_seconds_delta=None, created_at=BASE_TIME),
        ]
        events_b = list(reversed(events_a))
        bundle_a = build_sparse_interactions(events_a)
        bundle_b = build_sparse_interactions(events_b)
        for name in MATRIX_NAMES:
            matrix_a = getattr(bundle_a, name)
            matrix_b = getattr(bundle_b, name)
            self.assertTrue((matrix_a != matrix_b).nnz == 0, msg=name)

    def test_same_input_same_maps(self):
        events = [make_event(event_id="a" * 24, user_id=U1, song_id=S1, session_id="s", sequence=0)]
        bundle_a = build_sparse_interactions(events)
        bundle_b = build_sparse_interactions(events)
        self.assertEqual(bundle_a.user_ids, bundle_b.user_ids)
        self.assertEqual(bundle_a.song_ids, bundle_b.song_ids)
        self.assertEqual(
            dict(bundle_a.user_to_index), dict(bundle_b.user_to_index)
        )
        self.assertEqual(bundle_a.summary, bundle_b.summary)


class MatrixShapeAndFormTests(unittest.TestCase):
    def setUp(self):
        self.bundle = run_build(
            [
                make_event(
                    user_id=U1,
                    song_id=S1,
                    session_id="s1",
                    sequence=0,
                    event_type="play-started",
                    listened_seconds_delta=12.0,
                ),
                make_event(
                    user_id=U1,
                    song_id=S1,
                    session_id="s1",
                    sequence=1,
                    event_type="progress",
                    listened_seconds_delta=15.0,
                ),
                make_event(
                    user_id=U2,
                    song_id=S2,
                    session_id="s2",
                    sequence=0,
                    event_type="completed",
                    listened_seconds_delta=30.0,
                ),
            ]
        )

    def test_shape_is_users_by_songs(self):
        self.assertEqual(self.bundle.summary.matrix_shape, (2, 2))
        for name in MATRIX_NAMES:
            matrix = getattr(self.bundle, name)
            self.assertEqual(matrix.shape, (2, 2), msg=name)

    def test_all_matrices_csr_float32(self):
        for name in MATRIX_NAMES:
            matrix = getattr(self.bundle, name)
            self.assertEqual(matrix.format, "csr", msg=name)
            self.assertEqual(matrix.dtype.name, "float32", msg=name)

    def test_all_matrices_sorted_indices(self):
        for name in MATRIX_NAMES:
            matrix = getattr(self.bundle, name)
            self.assertTrue(matrix.has_sorted_indices, msg=name)

    def test_all_matrices_have_canonical_format(self):
        for name in MATRIX_NAMES:
            matrix = getattr(self.bundle, name)
            self.assertEqual(matrix.format, "csr", msg=name)
            self.assertEqual(matrix.nnz, matrix.tocsr().nnz, msg=name)

    def test_no_explicit_zeros_in_canonical_form(self):
        for name in MATRIX_NAMES:
            matrix = getattr(self.bundle, name)
            if matrix.nnz:
                self.assertTrue((matrix.data != 0).all(), msg=name)


class ObservedMatrixTests(unittest.TestCase):
    def test_binary_presence_not_event_count(self):
        bundle = run_build(
            [
                make_event(session_id="s1", sequence=0),
                make_event(session_id="s1", sequence=1),
                make_event(session_id="s1", sequence=2),
            ]
        )
        matrix = bundle.observed
        self.assertEqual(matrix.nnz, 1)
        self.assertEqual(matrix[0, 0], 1.0)

    def test_multiple_pairs(self):
        bundle = run_build(
            [
                make_event(user_id=U1, song_id=S1, session_id="a", sequence=0),
                make_event(user_id=U1, song_id=S2, session_id="b", sequence=0),
                make_event(user_id=U2, song_id=S1, session_id="c", sequence=0),
            ]
        )
        self.assertEqual(bundle.observed.nnz, 3)
        self.assertEqual(bundle.summary.interaction_pair_count, 3)

    def test_all_event_types_create_observed(self):
        for event_type in sorted(SUPPORTED_EVENT_TYPES):
            bundle = run_build(
                [
                    make_event(
                        session_id=f"s-{event_type}",
                        sequence=0,
                        event_type=event_type,
                    )
                ]
            )
            self.assertEqual(bundle.observed.nnz, 1, msg=event_type)
            self.assertEqual(bundle.observed[0, 0], 1.0, msg=event_type)


class SessionCountMatrixTests(unittest.TestCase):
    def test_distinct_sessions_not_events(self):
        bundle = run_build(
            [
                make_event(session_id="s1", sequence=0, event_type="play-started"),
                make_event(session_id="s1", sequence=1, event_type="progress"),
                make_event(session_id="s1", sequence=2, event_type="completed"),
                make_event(session_id="s2", sequence=0, event_type="play-started"),
            ]
        )
        self.assertEqual(bundle.session_count[0, 0], 2.0)

    def test_summary_session_count_matches_matrix_total(self):
        bundle = run_build(
            [
                make_event(user_id=U1, session_id="s1", sequence=0),
                make_event(user_id=U1, session_id="s2", sequence=0),
                make_event(user_id=U2, session_id="s1", sequence=0),
            ]
        )
        total = float(bundle.session_count.sum())
        self.assertEqual(bundle.summary.session_count, 3)
        self.assertEqual(total, 3.0)

    def test_sessions_split_across_songs(self):
        bundle = run_build(
            [
                make_event(song_id=S1, session_id="a", sequence=0),
                make_event(song_id=S2, session_id="b", sequence=0),
            ]
        )
        self.assertEqual(bundle.session_count[0, 0], 1.0)
        self.assertEqual(bundle.session_count[0, 1], 1.0)


class CountMatrixTests(unittest.TestCase):
    def test_play_started_count(self):
        bundle = run_build(
            [
                make_event(session_id="s", sequence=0, event_type="play-started"),
                make_event(session_id="s", sequence=1, event_type="progress"),
                make_event(session_id="s", sequence=2, event_type="completed"),
            ]
        )
        self.assertEqual(bundle.play_started_count[0, 0], 1.0)
        self.assertEqual(bundle.completed_count[0, 0], 1.0)
        self.assertEqual(bundle.skipped_count.nnz, 0)
        self.assertEqual(bundle.stopped_count.nnz, 0)
        self.assertEqual(bundle.replay_started_count.nnz, 0)

    def test_replay_started_count(self):
        bundle = run_build(
            [
                make_event(session_id="s", sequence=0, event_type="play-started"),
                make_event(session_id="s", sequence=1, event_type="completed"),
                make_event(session_id="s", sequence=2, event_type="replay-started"),
                make_event(session_id="s", sequence=3, event_type="replay-started"),
            ]
        )
        self.assertEqual(bundle.replay_started_count[0, 0], 2.0)
        self.assertEqual(bundle.play_started_count[0, 0], 1.0)

    def test_completed_count(self):
        bundle = run_build(
            [
                make_event(session_id="s", sequence=0, event_type="completed"),
                make_event(session_id="s", sequence=1, event_type="completed"),
            ]
        )
        self.assertEqual(bundle.completed_count[0, 0], 2.0)

    def test_skipped_count_is_positive_count(self):
        bundle = run_build(
            [
                make_event(session_id="s", sequence=0, event_type="skipped"),
                make_event(session_id="s", sequence=1, event_type="skipped"),
            ]
        )
        self.assertEqual(bundle.skipped_count[0, 0], 2.0)
        self.assertGreater(bundle.skipped_count[0, 0], 0.0)

    def test_stopped_count(self):
        bundle = run_build(
            [
                make_event(session_id="s", sequence=0, event_type="stopped"),
                make_event(session_id="s", sequence=1, event_type="stopped"),
                make_event(session_id="s", sequence=2, event_type="stopped"),
            ]
        )
        self.assertEqual(bundle.stopped_count[0, 0], 3.0)

    def test_unrelated_types_do_not_leak_into_count_matrices(self):
        bundle = run_build(
            [
                make_event(session_id="s", sequence=0, event_type="progress"),
                make_event(session_id="s", sequence=1, event_type="paused"),
                make_event(session_id="s", sequence=2, event_type="resumed"),
                make_event(session_id="s", sequence=3, event_type="seeked"),
            ]
        )
        self.assertEqual(bundle.play_started_count.nnz, 0)
        self.assertEqual(bundle.replay_started_count.nnz, 0)
        self.assertEqual(bundle.completed_count.nnz, 0)
        self.assertEqual(bundle.skipped_count.nnz, 0)
        self.assertEqual(bundle.stopped_count.nnz, 0)
        self.assertEqual(bundle.observed.nnz, 1)
        self.assertEqual(bundle.session_count[0, 0], 1.0)

    def test_support_event_types_do_not_create_own_count_matrices(self):
        for event_type in ("progress", "paused", "resumed", "seeked"):
            bundle = run_build(
                [
                    make_event(
                        session_id=f"s-{event_type}",
                        sequence=0,
                        event_type=event_type,
                    )
                ]
            )
            for field in (
                "play_started_count",
                "replay_started_count",
                "completed_count",
                "skipped_count",
                "stopped_count",
            ):
                self.assertEqual(
                    getattr(bundle, field).nnz, 0, msg=f"{event_type}/{field}"
                )

    def test_count_matrix_values_accumulate_across_sessions(self):
        bundle = run_build(
            [
                make_event(session_id="s1", sequence=0, event_type="completed"),
                make_event(session_id="s2", sequence=0, event_type="completed"),
                make_event(session_id="s3", sequence=0, event_type="completed"),
            ]
        )
        self.assertEqual(bundle.completed_count[0, 0], 3.0)


class ListenedSecondsMatrixTests(unittest.TestCase):
    def test_sums_stored_deltas(self):
        bundle = run_build(
            [
                make_event(
                    session_id="s", sequence=0, listened_seconds_delta=10.5
                ),
                make_event(
                    session_id="s", sequence=1, listened_seconds_delta=4.25
                ),
            ]
        )
        self.assertAlmostEqual(
            float(bundle.listened_seconds[0, 0]), 14.75, places=5
        )

    def test_none_delta_contributes_zero(self):
        bundle = run_build(
            [
                make_event(
                    session_id="s", sequence=0, listened_seconds_delta=None
                ),
                make_event(
                    session_id="s", sequence=1, listened_seconds_delta=7.0
                ),
            ]
        )
        self.assertAlmostEqual(
            float(bundle.listened_seconds[0, 0]), 7.0, places=5
        )

    def test_zero_delta_is_not_negative(self):
        bundle = run_build(
            [
                make_event(
                    session_id="s", sequence=0, listened_seconds_delta=0.0
                )
            ]
        )
        if bundle.listened_seconds.nnz:
            self.assertGreaterEqual(
                float(bundle.listened_seconds[0, 0]), 0.0
            )
        self.assertEqual(bundle.observed.nnz, 1)

    def test_all_event_types_contribute_stored_delta(self):
        for event_type in sorted(SUPPORTED_EVENT_TYPES):
            bundle = run_build(
                [
                    make_event(
                        session_id=f"s-{event_type}",
                        sequence=0,
                        event_type=event_type,
                        listened_seconds_delta=3.0,
                    )
                ]
            )
            self.assertAlmostEqual(
                float(bundle.listened_seconds[0, 0]), 3.0, places=5
            )

    def test_does_not_infer_from_position_or_duration(self):
        bundle = run_build(
            [
                make_event(
                    session_id="s",
                    sequence=0,
                    event_type="play-started",
                    listened_seconds_delta=None,
                )
            ]
        )
        self.assertEqual(bundle.listened_seconds.nnz, 0)


class SummaryTests(unittest.TestCase):
    def test_summary_fields(self):
        bundle = run_build(
            [
                make_event(user_id=U1, song_id=S1, session_id="a", sequence=0),
                make_event(user_id=U1, song_id=S1, session_id="b", sequence=0),
                make_event(user_id=U2, song_id=S2, session_id="c", sequence=0),
            ]
        )
        summary = bundle.summary
        self.assertIsInstance(summary, SparseInteractionSummary)
        self.assertEqual(summary.event_count, 3)
        self.assertEqual(summary.unique_user_count, 2)
        self.assertEqual(summary.unique_song_count, 2)
        self.assertEqual(summary.interaction_pair_count, 2)
        self.assertEqual(summary.session_count, 3)
        self.assertEqual(summary.matrix_shape, (2, 2))

    def test_summary_is_frozen(self):
        bundle = run_build([make_event()])
        with self.assertRaises(dataclasses.FrozenInstanceError):
            bundle.summary.event_count = 99  # type: ignore[misc]

    def test_bundle_is_frozen(self):
        bundle = run_build([make_event()])
        with self.assertRaises(dataclasses.FrozenInstanceError):
            bundle.user_ids = ()  # type: ignore[misc]


class ThreadInitTests(unittest.TestCase):
    def test_importing_module_alone_does_not_mutate_env(self):
        keys = list(CPU_THREAD_ENV_VARS) + [CUDA_VISIBLE_DEVICES_VAR]
        code = (
            "import os\n"
            f"keys = {keys!r}\n"
            "before = {k: os.environ.get(k) for k in keys}\n"
            "import ml.recommender.sparse_interactions\n"
            "after = {k: os.environ.get(k) for k in keys}\n"
            "print(before == after)\n"
            "print(after)\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        lines = result.stdout.strip().splitlines()
        self.assertEqual(lines[0], "True", msg=result.stdout)

    def test_build_configures_thread_env(self):
        run_build([make_event()])
        for name in CPU_THREAD_ENV_VARS:
            self.assertEqual(
                os.environ.get(name), str(THREADS_PER_NUMERIC_LIBRARY), msg=name
            )
        self.assertEqual(os.environ.get(CUDA_VISIBLE_DEVICES_VAR), "")

    def test_build_on_empty_input_still_configures(self):
        run_build([])
        for name in CPU_THREAD_ENV_VARS:
            self.assertEqual(os.environ.get(name), "1", msg=name)

    def test_configure_is_idempotent(self):
        run_build([make_event()])
        first = {name: os.environ.get(name) for name in CPU_THREAD_ENV_VARS}
        run_build([make_event()])
        second = {name: os.environ.get(name) for name in CPU_THREAD_ENV_VARS}
        self.assertEqual(first, second)

    def test_lazy_loader_configures_before_numpy_import(self):
        from ml.recommender import sparse_interactions as si

        source = inspect.getsource(si._load_numeric_stack)
        configure_pos = source.find("configure_cpu_runtime")
        numpy_pos = source.find("import numpy")
        self.assertGreater(configure_pos, -1)
        self.assertGreater(numpy_pos, configure_pos)

    def test_no_eager_numeric_import_at_module_level(self):
        tree = ast.parse(MODULE_SOURCE)
        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertNotIn("numpy", alias.name)
                    self.assertNotIn("scipy", alias.name)
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                self.assertNotIn("numpy", module)
                self.assertNotIn("scipy", module)


class StaticSafetyTests(unittest.TestCase):
    def test_no_pymongo(self):
        self.assertNotIn("pymongo", MODULE_SOURCE)

    def test_no_bson(self):
        self.assertNotIn("import bson", MODULE_SOURCE)
        self.assertNotIn("from bson", MODULE_SOURCE)

    def test_no_pandas(self):
        self.assertNotIn("pandas", MODULE_SOURCE)

    def test_no_sklearn(self):
        self.assertNotIn("sklearn", MODULE_SOURCE)

    def test_no_torch(self):
        self.assertNotIn("torch", MODULE_SOURCE)

    def test_no_joblib(self):
        self.assertNotIn("joblib", MODULE_SOURCE)

    def test_no_http_framework(self):
        for name in ("fastapi", "flask", "django", "uvicorn"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_filesystem_dataset_read(self):
        for name in ("open(", "Path(", "read_text", "read_csv", "json.load"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_artifact_write(self):
        for name in (
            "write_text",
            "json.dump",
            "np.save",
            "to_csv",
            "joblib",
            ".npz",
            ".npy",
            ".pkl",
            "pickle",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_dense_conversions(self):
        for name in (".toarray(", ".todense(", "np.zeros", "numpy.zeros"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_dense_interaction_allocation_pattern(self):
        for name in (
            "np.zeros((n_users",
            "np.zeros((users",
            "dense_matrix",
            "full_matrix",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_weight_constants(self):
        for name in (
            "PLAY_WEIGHT",
            "COMPLETE_WEIGHT",
            "SKIP_PENALTY",
            "REPLAY_WEIGHT",
            "PREFERENCE_WEIGHT",
            "SCORE_WEIGHT",
            "INTERACTION_WEIGHT",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_train_model_function(self):
        self.assertNotIn("def train", MODULE_SOURCE)
        self.assertNotIn("def fit", MODULE_SOURCE)
        self.assertNotIn("TruncatedSVD", MODULE_SOURCE)

    def test_no_recommendation_scoring(self):
        for name in (
            "recommend_score",
            "prediction_score",
            "affinity",
            "cosine_similarity",
            "implicit",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_randomness(self):
        for name in ("random.", "import random", "np.random", "seed("):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_current_time_dependency(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)

    def test_no_favorite_playlist_integration(self):
        for name in ("Favorite", "Playlist", "explicitPreference"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_retraining_split_logic(self):
        self.assertNotIn("split_interactions_temporally", MODULE_SOURCE)

    def test_does_not_redefine_runtime_caps_as_conflicting_literals(self):
        self.assertNotIn("MAX_RAW_EVENTS = 250_000", MODULE_SOURCE)
        self.assertNotIn("MAX_UNIQUE_USERS = 50_000", MODULE_SOURCE)
        self.assertNotIn("MAX_UNIQUE_SONGS = 25_000", MODULE_SOURCE)
        self.assertNotIn("MAX_RAW_EVENTS = 250000", MODULE_SOURCE)


class ExceptionHierarchyTests(unittest.TestCase):
    def test_hierarchy(self):
        from ml.recommender.runtime import RecommenderRuntimeError

        self.assertTrue(issubclass(SparseInteractionError, RecommenderRuntimeError))
        self.assertTrue(
            issubclass(SparseInteractionValidationError, SparseInteractionError)
        )

    def test_rejects_bad_container_with_validation_error(self):
        with self.assertRaises(SparseInteractionValidationError):
            build_sparse_interactions("bad")


class VocabularyTests(unittest.TestCase):
    def test_reuses_temporal_split_vocabulary(self):
        self.assertEqual(
            SUPPORTED_EVENT_TYPES,
            frozenset(
                {
                    "play-started",
                    "progress",
                    "paused",
                    "resumed",
                    "seeked",
                    "completed",
                    "skipped",
                    "stopped",
                    "replay-started",
                }
            ),
        )

    def test_matrix_names_constant_is_eight_entries(self):
        self.assertEqual(len(MATRIX_NAMES), 8)
        self.assertEqual(
            set(MATRIX_NAMES),
            {
                "observed",
                "session_count",
                "play_started_count",
                "replay_started_count",
                "completed_count",
                "skipped_count",
                "stopped_count",
                "listened_seconds",
            },
        )


class CopySafetyTests(unittest.TestCase):
    def test_bundle_not_affected_by_input_mutation(self):
        event = make_event(session_id="s", sequence=0, listened_seconds_delta=1.0)
        events = [event]
        bundle = build_sparse_interactions(events)
        events.clear()
        self.assertEqual(bundle.summary.event_count, 1)
        self.assertEqual(bundle.observed.nnz, 1)

    def test_frozen_event_cannot_be_mutated(self):
        event = make_event()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            event.event_id = "x" * 24  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
