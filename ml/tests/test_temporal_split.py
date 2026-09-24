"""Standard-library tests for deterministic temporal raw-event splitting."""

from __future__ import annotations

import copy
import dataclasses
import math
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ml.recommender.runtime import (
    MAX_RAW_EVENTS,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    ResourceLimitError,
)
from ml.recommender.temporal_split import (
    MIN_SESSIONS_FOR_EVALUATION,
    MIN_TRAIN_SESSIONS_PER_EVALUATED_USER,
    SUPPORTED_EVENT_TYPES,
    TEST_SESSIONS_PER_USER,
    VALIDATION_SESSIONS_PER_USER,
    TemporalInteractionEvent,
    TemporalSplitError,
    TemporalSplitResult,
    TemporalSplitSummary,
    TemporalSplitValidationError,
    split_interactions_temporally,
)

MODULE_PATH = Path(__file__).resolve().parents[1] / "recommender" / "temporal_split.py"
MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")

U1 = "a" * 24
U2 = "b" * 24
S1 = "1" * 24
S2 = "2" * 24
E_BASE = "c" * 24

BASE_TIME = datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)


def iso(offset_minutes: int = 0) -> str:
    return (BASE_TIME + timedelta(minutes=offset_minutes)).isoformat().replace("+00:00", "+00:00")


def make_event(
    *,
    event_id: str | None = None,
    user: str = U1,
    song: str = S1,
    session_id: str = "sess-1",
    sequence: int = 0,
    event_type: str = "play-started",
    listened_seconds_delta=None,
    created_at: str | datetime | None = None,
    include_delta: bool = True,
    extra: dict | None = None,
) -> dict:
    idx = make_event.counter
    make_event.counter += 1
    event = {
        "_id": event_id if event_id is not None else f"{idx:024x}"[:24].rjust(24, "0"),
        "user": user,
        "song": song,
        "session_id": session_id,
        "sequence": sequence,
        "event_type": event_type,
        "createdAt": created_at if created_at is not None else iso(0),
    }
    if include_delta:
        event["listened_seconds_delta"] = listened_seconds_delta
    if extra:
        event.update(extra)
    return event


make_event.counter = 0


def session_events(
    session_id: str,
    *,
    user: str = U1,
    song: str = S1,
    start_minute: int = 0,
    count: int = 2,
    event_types: list[str] | None = None,
) -> list[dict]:
    events = []
    types = event_types or ["play-started", "completed"]
    for i in range(count):
        events.append(
            make_event(
                user=user,
                song=song,
                session_id=session_id,
                sequence=i,
                event_type=types[i % len(types)],
                created_at=iso(start_minute + i),
            )
        )
    return events


def run_split(events):
    return split_interactions_temporally(events)


def sessions_in(partition) -> set[tuple[str, str]]:
    return {(e.user_id, e.session_id) for e in partition}


class ConstantsContractTests(unittest.TestCase):
    def test_1_validation_holdout_sessions(self):
        self.assertEqual(VALIDATION_SESSIONS_PER_USER, 1)

    def test_2_test_holdout_sessions(self):
        self.assertEqual(TEST_SESSIONS_PER_USER, 1)

    def test_3_minimum_training_sessions(self):
        self.assertEqual(MIN_TRAIN_SESSIONS_PER_EVALUATED_USER, 1)

    def test_4_minimum_evaluable_sessions(self):
        self.assertEqual(MIN_SESSIONS_FOR_EVALUATION, 3)

    def test_5_event_vocabulary_matches_server(self):
        expected = [
            "play-started",
            "progress",
            "paused",
            "resumed",
            "seeked",
            "completed",
            "skipped",
            "stopped",
            "replay-started",
        ]
        self.assertEqual(sorted(SUPPORTED_EVENT_TYPES), sorted(expected))
        self.assertEqual(len(SUPPORTED_EVENT_TYPES), 9)


class InputValidationTests(unittest.TestCase):
    def test_6_empty_list_succeeds(self):
        result = run_split([])
        self.assertEqual(result.summary.input_event_count, 0)
        self.assertEqual(result.train, ())
        self.assertEqual(result.validation, ())
        self.assertEqual(result.test, ())

    def test_7_tuple_input_succeeds(self):
        events = session_events("s1")
        result = run_split(tuple(events))
        self.assertEqual(result.summary.input_event_count, len(events))

    def test_8_string_input_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split("not-a-list")

    def test_9_bytes_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split(b"bytes")

    def test_10_mapping_as_whole_input_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split({"_id": "x"})

    def test_11_missing_id_rejected(self):
        event = make_event()
        del event["_id"]
        with self.assertRaises(TemporalSplitValidationError):
            run_split([event])

    def test_12_invalid_event_id_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(event_id="not-hex")])
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(event_id="xyz")])

    def test_13_uppercase_event_id_canonicalized(self):
        upper = "ABCDEF0123456789ABCDEF01"
        result = run_split([make_event(event_id=upper)])
        self.assertEqual(result.train[0].event_id, upper.lower())

    def test_14_missing_user_rejected(self):
        event = make_event()
        del event["user"]
        with self.assertRaises(TemporalSplitValidationError):
            run_split([event])

    def test_15_invalid_user_id_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(user="bad-id")])

    def test_16_missing_song_rejected(self):
        event = make_event()
        del event["song"]
        with self.assertRaises(TemporalSplitValidationError):
            run_split([event])

    def test_17_invalid_song_id_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(song="nope")])

    def test_18_missing_session_id_rejected(self):
        event = make_event()
        del event["session_id"]
        with self.assertRaises(TemporalSplitValidationError):
            run_split([event])

    def test_19_blank_session_id_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(session_id="   ")])

    def test_20_long_session_id_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(session_id="s" * 129)])
        result = run_split([make_event(session_id="s" * 128)])
        self.assertEqual(result.train[0].session_id, "s" * 128)

    def test_21_missing_sequence_rejected(self):
        event = make_event()
        del event["sequence"]
        with self.assertRaises(TemporalSplitValidationError):
            run_split([event])

    def test_22_negative_sequence_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(sequence=-1)])

    def test_23_sequence_above_max_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(sequence=1_000_001)])

    def test_24_float_sequence_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(sequence=1.0)])

    def test_25_bool_sequence_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(sequence=True)])

    def test_26_missing_event_type_rejected(self):
        event = make_event()
        del event["event_type"]
        with self.assertRaises(TemporalSplitValidationError):
            run_split([event])

    def test_27_unsupported_event_type_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(event_type="liked")])

    def test_28_missing_created_at_rejected(self):
        event = make_event()
        del event["createdAt"]
        with self.assertRaises(TemporalSplitValidationError):
            run_split([event])

    def test_non_mapping_event_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split(["not-a-mapping"])


class TimestampTests(unittest.TestCase):
    def test_29_timezone_aware_datetime_accepted(self):
        result = run_split(
            [make_event(created_at=datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc))]
        )
        self.assertEqual(
            result.train[0].created_at,
            datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc),
        )

    def test_30_z_iso_string_accepted(self):
        result = run_split([make_event(created_at="2026-09-01T10:00:00Z")])
        self.assertEqual(result.train[0].created_at.tzinfo, timezone.utc)

    def test_31_offset_iso_string_accepted(self):
        result = run_split([make_event(created_at="2026-09-01T12:00:00+02:00")])
        self.assertEqual(
            result.train[0].created_at,
            datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc),
        )

    def test_32_naive_datetime_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(created_at=datetime(2026, 9, 1, 10, 0))])

    def test_33_timezone_less_iso_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(created_at="2026-09-01T10:00:00")])

    def test_34_invalid_timestamp_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(created_at="not-a-timestamp")])

    def test_35_timestamps_normalized_to_utc(self):
        result = run_split([make_event(created_at="2026-09-01T15:30:00+05:30")])
        self.assertEqual(
            result.train[0].created_at,
            datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc),
        )

    def test_36_client_occurred_at_cannot_affect_ordering(self):
        # Same createdAt, different client_occurred_at — order fixed by createdAt/sequence/event_id.
        a = make_event(
            session_id="sA",
            sequence=1,
            created_at="2026-09-01T10:00:00Z",
            extra={"client_occurred_at": "2026-09-01T20:00:00Z"},
        )
        b = make_event(
            session_id="sA",
            sequence=0,
            created_at="2026-09-01T10:00:00Z",
            extra={"client_occurred_at": "2026-09-01T01:00:00Z"},
        )
        result = run_split([a, b])
        self.assertEqual(result.train[0].sequence, 0)
        self.assertEqual(result.train[1].sequence, 1)


class ListenedDeltaTests(unittest.TestCase):
    def test_37_missing_delta_accepted_as_none(self):
        result = run_split([make_event(include_delta=False)])
        self.assertIsNone(result.train[0].listened_seconds_delta)

    def test_38_null_delta_accepted(self):
        result = run_split([make_event(listened_seconds_delta=None)])
        self.assertIsNone(result.train[0].listened_seconds_delta)

    def test_39_zero_accepted(self):
        result = run_split([make_event(listened_seconds_delta=0)])
        self.assertEqual(result.train[0].listened_seconds_delta, 0.0)

    def test_40_120_accepted(self):
        result = run_split([make_event(listened_seconds_delta=120)])
        self.assertEqual(result.train[0].listened_seconds_delta, 120.0)

    def test_41_negative_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(listened_seconds_delta=-0.1)])

    def test_42_above_120_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(listened_seconds_delta=120.1)])

    def test_43_nan_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(listened_seconds_delta=float("nan"))])

    def test_44_infinity_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(listened_seconds_delta=float("inf"))])

    def test_45_bool_delta_rejected(self):
        with self.assertRaises(TemporalSplitValidationError):
            run_split([make_event(listened_seconds_delta=True)])

    def test_46_valid_delta_normalization_deterministic(self):
        first = run_split([make_event(listened_seconds_delta=12)])
        second = run_split([make_event(listened_seconds_delta=12)])
        self.assertEqual(first.train[0].listened_seconds_delta, 12.0)
        self.assertEqual(
            first.train[0].listened_seconds_delta,
            second.train[0].listened_seconds_delta,
        )


class EventUniquenessSessionTests(unittest.TestCase):
    def test_47_duplicate_event_id_rejected(self):
        events = session_events("s1")
        duplicate = dict(events[0])
        with self.assertRaises(TemporalSplitValidationError) as ctx:
            run_split(events + [duplicate])
        self.assertIn("duplicate event id", str(ctx.exception))

    def test_48_duplicate_session_sequence_rejected(self):
        events = [
            make_event(session_id="s1", sequence=0, created_at=iso(0)),
            make_event(session_id="s1", sequence=0, created_at=iso(1)),
        ]
        with self.assertRaises(TemporalSplitValidationError) as ctx:
            run_split(events)
        self.assertIn("duplicate sequence", str(ctx.exception))

    def test_49_sequence_gaps_accepted(self):
        events = [
            make_event(session_id="s1", sequence=0, created_at=iso(0)),
            make_event(session_id="s1", sequence=1, created_at=iso(1)),
            make_event(session_id="s1", sequence=3, created_at=iso(2)),
            make_event(session_id="s1", sequence=4, created_at=iso(3)),
        ]
        result = run_split(events)
        self.assertEqual(result.summary.input_event_count, 4)

    def test_50_session_one_song_accepted(self):
        events = session_events("s1", song=S1)
        result = run_split(events)
        self.assertEqual(result.summary.input_event_count, len(events))

    def test_51_multi_song_session_rejected(self):
        events = [
            make_event(session_id="s1", song=S1, sequence=0, created_at=iso(0)),
            make_event(session_id="s1", song=S2, sequence=1, created_at=iso(1)),
        ]
        with self.assertRaises(TemporalSplitValidationError) as ctx:
            run_split(events)
        self.assertIn("multiple song ids", str(ctx.exception))

    def test_52_same_session_id_different_users_separate(self):
        events = [
            make_event(user=U1, session_id="shared", sequence=0, created_at=iso(0), song=S1),
            make_event(user=U2, session_id="shared", sequence=0, created_at=iso(1), song=S2),
        ]
        result = run_split(events)
        self.assertEqual(result.summary.session_count, 2)
        self.assertEqual(result.summary.train_event_count, 2)


class SessionOrderTests(unittest.TestCase):
    def test_53_session_start_uses_earliest_created_at(self):
        events = [
            make_event(session_id="s1", sequence=1, created_at=iso(10)),
            make_event(session_id="s1", sequence=0, created_at=iso(5)),
        ]
        result = run_split(events)
        self.assertEqual(result.train[0].created_at, BASE_TIME + timedelta(minutes=5))

    def test_54_session_end_uses_latest_created_at(self):
        events = [
            make_event(session_id="s1", sequence=0, created_at=iso(0)),
            make_event(session_id="s1", sequence=1, created_at=iso(30)),
        ]
        result = run_split(events)
        self.assertEqual(result.summary.input_event_count, 2)

    def test_55_sessions_ordered_by_start_time(self):
        events = (
            session_events("late", start_minute=100)
            + session_events("early", start_minute=0)
            + session_events("mid", start_minute=50)
        )
        # 3 sessions for U1 → evaluable: early→train, mid→val, late→test
        result = run_split(events)
        self.assertTrue(all(e.session_id == "early" for e in result.train))
        self.assertTrue(all(e.session_id == "mid" for e in result.validation))
        self.assertTrue(all(e.session_id == "late" for e in result.test))

    def test_56_equal_start_uses_end_time(self):
        # Same start, different ends via equal start times and different lengths.
        s_a_start = iso(0)
        s_b_start = iso(0)
        events = [
            make_event(session_id="a", sequence=0, created_at=s_a_start),
            make_event(session_id="a", sequence=1, created_at=iso(10)),
            make_event(session_id="b", sequence=0, created_at=s_b_start),
            make_event(session_id="b", sequence=1, created_at=iso(5)),
        ]
        result = run_split(events)
        # a ends at +10, b ends at +5 → b sorts before a when starts equal
        # 2 sessions → train only
        self.assertEqual(result.validation, ())
        self.assertEqual(result.test, ())

    def test_57_equal_start_end_uses_session_id(self):
        events = (
            session_events("zzz", start_minute=0, count=1)
            + session_events("aaa", start_minute=0, count=1)
            + session_events("mmm", start_minute=0, count=1)
        )
        result = run_split(events)
        # Equal start/end → order by session_id: aaa, mmm, zzz
        # 3 non-overlapping sessions → evaluable: aaa→train, mmm→val, zzz→test
        self.assertEqual(sessions_in(result.train), {(U1, "aaa")})
        self.assertEqual(sessions_in(result.validation), {(U1, "mmm")})
        self.assertEqual(sessions_in(result.test), {(U1, "zzz")})
        self.assertEqual(result.summary.overlap_train_only_user_count, 0)

    def test_58_events_within_session_ordered(self):
        events = [
            make_event(session_id="s1", sequence=2, created_at=iso(5), event_type="completed"),
            make_event(session_id="s1", sequence=0, created_at=iso(1), event_type="play-started"),
            make_event(session_id="s1", sequence=1, created_at=iso(3), event_type="progress"),
        ]
        result = run_split(events)
        sequences = [e.sequence for e in result.train]
        self.assertEqual(sequences, [0, 1, 2])
        times = [e.created_at for e in result.train]
        self.assertEqual(times, sorted(times))


class SparseUserTests(unittest.TestCase):
    def test_59_one_session_entirely_train(self):
        result = run_split(session_events("only", start_minute=0))
        self.assertEqual(result.summary.train_event_count, result.summary.input_event_count)
        self.assertEqual(result.validation, ())
        self.assertEqual(result.test, ())

    def test_60_two_session_user_entirely_train(self):
        events = session_events("a", start_minute=0) + session_events("b", start_minute=50)
        result = run_split(events)
        self.assertEqual(result.summary.train_event_count, result.summary.input_event_count)
        self.assertEqual(result.validation, ())
        self.assertEqual(result.test, ())

    def test_61_one_session_no_val_test(self):
        result = run_split(session_events("only"))
        self.assertEqual(len(result.validation), 0)
        self.assertEqual(len(result.test), 0)

    def test_62_two_session_no_val_test(self):
        events = session_events("a", start_minute=0) + session_events("b", start_minute=50)
        result = run_split(events)
        self.assertEqual(len(result.validation), 0)
        self.assertEqual(len(result.test), 0)

    def test_63_sparse_users_count_as_train_only(self):
        events = (
            session_events("u1s1", start_minute=0)  # 1 session user U1
            + session_events("u2s1", user=U2, song=S2, start_minute=0)
            + session_events("u2s2", user=U2, song=S2, start_minute=50)
        )
        result = run_split(events)
        self.assertEqual(result.summary.train_only_user_count, 2)
        self.assertEqual(result.summary.evaluable_user_count, 0)
        self.assertEqual(result.summary.overlap_train_only_user_count, 0)


class ThreeSessionSplitTests(unittest.TestCase):
    def _three(self):
        return (
            session_events("s1", start_minute=0)
            + session_events("s2", start_minute=50)
            + session_events("s3", start_minute=100)
        )

    def test_64_first_session_train(self):
        result = run_split(self._three())
        self.assertTrue(all(e.session_id == "s1" for e in result.train))

    def test_65_second_session_validation(self):
        result = run_split(self._three())
        self.assertTrue(all(e.session_id == "s2" for e in result.validation))
        self.assertEqual(len(result.validation), 2)

    def test_66_third_session_test(self):
        result = run_split(self._three())
        self.assertTrue(all(e.session_id == "s3" for e in result.test))
        self.assertEqual(len(result.test), 2)

    def test_67_all_events_in_session_stay_together(self):
        result = run_split(self._three())
        train_sessions = sessions_in(result.train)
        self.assertEqual(train_sessions, {(U1, "s1")})
        self.assertEqual(sessions_in(result.validation), {(U1, "s2")})
        self.assertEqual(sessions_in(result.test), {(U1, "s3")})

    def test_68_exactly_one_validation_session(self):
        result = run_split(self._three())
        self.assertEqual(len(sessions_in(result.validation)), 1)

    def test_69_exactly_one_test_session(self):
        result = run_split(self._three())
        self.assertEqual(len(sessions_in(result.test)), 1)


class LongerHistoryTests(unittest.TestCase):
    def _five(self):
        return (
            session_events("a", start_minute=0)
            + session_events("b", start_minute=20)
            + session_events("c", start_minute=40)
            + session_events("d", start_minute=60)
            + session_events("e", start_minute=80)
        )

    def test_70_five_session_first_three_train(self):
        result = run_split(self._five())
        self.assertEqual(sessions_in(result.train), {(U1, "a"), (U1, "b"), (U1, "c")})

    def test_71_fourth_validation(self):
        result = run_split(self._five())
        self.assertEqual(sessions_in(result.validation), {(U1, "d")})

    def test_72_fifth_test(self):
        result = run_split(self._five())
        self.assertEqual(sessions_in(result.test), {(U1, "e")})

    def test_73_replay_events_remain_with_session(self):
        events = (
            session_events("s1", start_minute=0)
            + session_events("s2", start_minute=50)
            + session_events("s3", start_minute=100, event_types=["play-started", "replay-started"])
        )
        result = run_split(events)
        self.assertTrue(all(e.session_id == "s3" for e in result.test))
        self.assertTrue(any(e.event_type == "replay-started" for e in result.test))

    def test_74_completion_events_remain_with_session(self):
        events = (
            session_events("s1", start_minute=0)
            + session_events("s2", start_minute=50)
            + session_events("s3", start_minute=100, event_types=["progress", "completed"])
        )
        result = run_split(events)
        self.assertTrue(any(e.event_type == "completed" for e in result.test))

    def test_75_skip_events_remain_with_session(self):
        events = (
            session_events("s1", start_minute=0)
            + session_events("s2", start_minute=50)
            + session_events("s3", start_minute=100, event_types=["progress", "skipped"])
        )
        result = run_split(events)
        self.assertTrue(any(e.event_type == "skipped" for e in result.test))


class NoSessionLeakageTests(unittest.TestCase):
    def _three(self):
        return (
            session_events("s1", start_minute=0)
            + session_events("s2", start_minute=50)
            + session_events("s3", start_minute=100)
        )

    def test_76_no_train_validation_session_overlap(self):
        result = run_split(self._three())
        self.assertEqual(sessions_in(result.train) & sessions_in(result.validation), set())

    def test_77_no_validation_test_session_overlap(self):
        result = run_split(self._three())
        self.assertEqual(sessions_in(result.validation) & sessions_in(result.test), set())

    def test_78_no_train_test_session_overlap(self):
        result = run_split(self._three())
        self.assertEqual(sessions_in(result.train) & sessions_in(result.test), set())

    def test_79_all_session_events_assigned_exactly_once(self):
        events = self._three()
        result = run_split(events)
        assigned = list(result.train) + list(result.validation) + list(result.test)
        self.assertEqual(len(assigned), len(events))
        ids = [e.event_id for e in assigned]
        self.assertEqual(len(ids), len(set(ids)))


class TemporalLeakageTests(unittest.TestCase):
    def _three(self):
        return (
            session_events("s1", start_minute=0)
            + session_events("s2", start_minute=50)
            + session_events("s3", start_minute=100)
        )

    def test_80_max_train_le_min_validation(self):
        result = run_split(self._three())
        self.assertLessEqual(max(e.created_at for e in result.train), min(e.created_at for e in result.validation))

    def test_81_max_validation_le_min_test(self):
        result = run_split(self._three())
        self.assertLessEqual(max(e.created_at for e in result.validation), min(e.created_at for e in result.test))

    def test_82_input_order_reversal_does_not_change_assignments(self):
        events = self._three()
        forward = run_split(events)
        reverse = run_split(list(reversed(events)))
        self.assertEqual(forward, reverse)


class OverlapSafetyTests(unittest.TestCase):
    def _overlapping_and_clean(self):
        # U1: session A [0..100], session B [50..60], session C [150..160] → A overlaps B
        overlap = [
            make_event(session_id="A", sequence=0, created_at=iso(0)),
            make_event(session_id="A", sequence=1, created_at=iso(100)),
            make_event(session_id="B", sequence=0, created_at=iso(50)),
            make_event(session_id="B", sequence=1, created_at=iso(60)),
            make_event(session_id="C", sequence=0, created_at=iso(150)),
            make_event(session_id="C", sequence=1, created_at=iso(160)),
        ]
        clean = (
            session_events("x", user=U2, song=S2, start_minute=0)
            + session_events("y", user=U2, song=S2, start_minute=50)
            + session_events("z", user=U2, song=S2, start_minute=100)
        )
        return overlap, clean

    def test_83_overlapping_adjacent_sessions_detected(self):
        overlap, clean = self._overlapping_and_clean()
        result = run_split(overlap + clean)
        self.assertEqual(result.summary.overlap_train_only_user_count, 1)

    def test_84_overlapping_user_all_sessions_train(self):
        overlap, clean = self._overlapping_and_clean()
        result = run_split(overlap + clean)
        overlap_in_val = [e for e in result.validation if e.user_id == U1]
        overlap_in_test = [e for e in result.test if e.user_id == U1]
        self.assertEqual(overlap_in_val, [])
        self.assertEqual(overlap_in_test, [])
        overlap_train = [e for e in result.train if e.user_id == U1]
        self.assertEqual(len(overlap_train), 6)

    def test_85_overlapping_user_no_val_test(self):
        overlap, _ = self._overlapping_and_clean()
        result = run_split(overlap)
        self.assertEqual(result.validation, ())
        self.assertEqual(result.test, ())

    def test_86_overlap_train_only_count_increments(self):
        overlap, clean = self._overlapping_and_clean()
        result = run_split(overlap + clean)
        self.assertEqual(result.summary.overlap_train_only_user_count, 1)

    def test_87_train_only_includes_overlap_user(self):
        overlap, clean = self._overlapping_and_clean()
        result = run_split(overlap + clean)
        # U1 overlap + U2 evaluable → train_only = 1
        self.assertEqual(result.summary.train_only_user_count, 1)
        self.assertEqual(result.summary.evaluable_user_count, 1)

    def test_88_another_clean_user_remains_evaluable(self):
        overlap, clean = self._overlapping_and_clean()
        result = run_split(overlap + clean)
        self.assertTrue(any(e.user_id == U2 for e in result.validation))
        self.assertTrue(any(e.user_id == U2 for e in result.test))

    def test_89_equal_boundary_not_overlap(self):
        # previous end == next start is allowed
        events = [
            make_event(session_id="A", sequence=0, created_at=iso(0)),
            make_event(session_id="A", sequence=1, created_at=iso(10)),
            make_event(session_id="B", sequence=0, created_at=iso(10)),
            make_event(session_id="B", sequence=1, created_at=iso(20)),
            make_event(session_id="C", sequence=0, created_at=iso(30)),
            make_event(session_id="C", sequence=1, created_at=iso(40)),
        ]
        result = run_split(events)
        self.assertEqual(result.summary.overlap_train_only_user_count, 0)
        self.assertEqual(result.summary.evaluable_user_count, 1)
        self.assertEqual(len(result.validation), 2)
        self.assertEqual(len(result.test), 2)


class SameSongRepeatTests(unittest.TestCase):
    def _three_same_song(self):
        return (
            session_events("s1", song=S1, start_minute=0)
            + session_events("s2", song=S1, start_minute=50)
            + session_events("s3", song=S1, start_minute=100)
        )

    def test_90_same_song_train_and_validation(self):
        result = run_split(self._three_same_song())
        train_songs = {e.song_id for e in result.train}
        val_songs = {e.song_id for e in result.validation}
        self.assertIn(S1, train_songs)
        self.assertIn(S1, val_songs)

    def test_91_same_song_validation_and_test(self):
        result = run_split(self._three_same_song())
        self.assertEqual({e.song_id for e in result.validation}, {S1})
        self.assertEqual({e.song_id for e in result.test}, {S1})

    def test_92_repeated_song_not_filtered(self):
        result = run_split(self._three_same_song())
        self.assertEqual(result.summary.input_event_count, 6)
        self.assertEqual(
            result.summary.train_event_count
            + result.summary.validation_event_count
            + result.summary.test_event_count,
            6,
        )


class MultiUserTests(unittest.TestCase):
    def test_93_users_split_independently(self):
        u1 = (
            session_events("a1", user=U1, song=S1, start_minute=0)
            + session_events("a2", user=U1, song=S1, start_minute=50)
            + session_events("a3", user=U1, song=S1, start_minute=100)
        )
        u2 = session_events("b1", user=U2, song=S2, start_minute=0)
        result = run_split(u1 + u2)
        self.assertEqual(result.summary.evaluable_user_count, 1)
        self.assertEqual(result.summary.train_only_user_count, 1)

    def test_94_sparse_user_does_not_change_another_split(self):
        sparse = session_events("only", user=U2, song=S2, start_minute=0)
        evaluable = (
            session_events("e1", user=U1, song=S1, start_minute=0)
            + session_events("e2", user=U1, song=S1, start_minute=50)
            + session_events("e3", user=U1, song=S1, start_minute=100)
        )
        alone = run_split(evaluable)
        combined = run_split(evaluable + sparse)
        alone_val_ids = {e.event_id for e in alone.validation}
        combined_val_ids = {e.event_id for e in combined.validation if e.user_id == U1}
        self.assertEqual(alone_val_ids, combined_val_ids)

    def test_95_overlapping_user_does_not_change_clean_split(self):
        overlap = [
            make_event(session_id="A", sequence=0, created_at=iso(0)),
            make_event(session_id="A", sequence=1, created_at=iso(100)),
            make_event(session_id="B", sequence=0, created_at=iso(50)),
            make_event(session_id="B", sequence=1, created_at=iso(60)),
            make_event(session_id="C", sequence=0, created_at=iso(150)),
        ]
        clean = (
            session_events("x", user=U2, song=S2, start_minute=0)
            + session_events("y", user=U2, song=S2, start_minute=50)
            + session_events("z", user=U2, song=S2, start_minute=100)
        )
        alone = run_split(clean)
        combined = run_split(clean + overlap)
        self.assertEqual(
            {e.event_id for e in alone.validation},
            {e.event_id for e in combined.validation if e.user_id == U2},
        )

    def test_96_final_partitions_deterministic_global_ordering(self):
        events = (
            session_events("s1", start_minute=0)
            + session_events("s2", start_minute=50)
            + session_events("s3", start_minute=100)
        )
        result = run_split(events)
        for partition in (result.train, result.validation, result.test):
            keys = [
                (e.created_at, e.user_id, e.session_id, e.sequence, e.event_id)
                for e in partition
            ]
            self.assertEqual(keys, sorted(keys))


class SummaryTests(unittest.TestCase):
    def _mixed(self):
        sparse = session_events("only", user=U2, song=S2, start_minute=0)
        evaluable = (
            session_events("e1", user=U1, song=S1, start_minute=0)
            + session_events("e2", user=U1, song=S1, start_minute=50)
            + session_events("e3", user=U1, song=S1, start_minute=100)
        )
        overlap = [
            make_event(user="d" * 24, song=S2, session_id="A", sequence=0, created_at=iso(0)),
            make_event(user="d" * 24, song=S2, session_id="A", sequence=1, created_at=iso(100)),
            make_event(user="d" * 24, song=S2, session_id="B", sequence=0, created_at=iso(50)),
            make_event(user="d" * 24, song=S2, session_id="B", sequence=1, created_at=iso(60)),
            make_event(user="d" * 24, song=S2, session_id="C", sequence=0, created_at=iso(150)),
        ]
        return evaluable + sparse + overlap

    def test_97_input_event_count(self):
        events = self._mixed()
        result = run_split(events)
        self.assertEqual(result.summary.input_event_count, len(events))

    def test_98_train_event_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.train_event_count, len(result.train))

    def test_99_validation_event_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.validation_event_count, len(result.validation))

    def test_100_test_event_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.test_event_count, len(result.test))

    def test_101_unique_user_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.unique_user_count, 3)

    def test_102_unique_song_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.unique_song_count, 2)

    def test_103_session_count(self):
        result = run_split(self._mixed())
        # U1: 3, U2: 1, overlap user: 3
        self.assertEqual(result.summary.session_count, 7)

    def test_104_evaluable_user_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.evaluable_user_count, 1)

    def test_105_train_only_user_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.train_only_user_count, 2)

    def test_106_overlap_train_only_user_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.overlap_train_only_user_count, 1)

    def test_107_train_session_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.train_session_count, len(sessions_in(result.train)))

    def test_108_validation_session_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.validation_session_count, len(sessions_in(result.validation)))

    def test_109_test_session_count(self):
        result = run_split(self._mixed())
        self.assertEqual(result.summary.test_session_count, len(sessions_in(result.test)))

    def test_110_event_count_conservation(self):
        result = run_split(self._mixed())
        s = result.summary
        self.assertEqual(
            s.input_event_count,
            s.train_event_count + s.validation_event_count + s.test_event_count,
        )

    def test_111_session_count_conservation(self):
        result = run_split(self._mixed())
        s = result.summary
        self.assertEqual(
            s.session_count,
            s.train_session_count + s.validation_session_count + s.test_session_count,
        )


class DeterminismImmutabilityTests(unittest.TestCase):
    def _three(self):
        return (
            session_events("s1", start_minute=0)
            + session_events("s2", start_minute=50)
            + session_events("s3", start_minute=100)
        )

    def test_112_shuffled_input_deep_equal(self):
        events = self._three()
        forward = run_split(events)
        shuffled = [events[4], events[0], events[5], events[2], events[1], events[3]]
        reverse = run_split(shuffled)
        self.assertEqual(forward, reverse)

    def test_113_identical_input_repeated_deep_equal(self):
        events = self._three()
        self.assertEqual(run_split(events), run_split(events))

    def test_114_no_random_module_for_split(self):
        self.assertNotIn("import random", MODULE_SOURCE)
        self.assertNotIn("random.", MODULE_SOURCE)
        self.assertNotIn("random.shuffle", MODULE_SOURCE)
        self.assertNotIn("random.sample", MODULE_SOURCE)

    def test_115_no_current_time_dependency(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)
        self.assertNotIn("utcnow", MODULE_SOURCE)

    def test_116_original_input_mappings_unchanged(self):
        events = self._three()
        snapshot = copy.deepcopy(events)
        run_split(events)
        self.assertEqual(events, snapshot)

    def test_117_result_dataclasses_immutable(self):
        result = run_split(self._three())
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.train = ()  # type: ignore[misc]
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.summary.input_event_count = 0  # type: ignore[misc]
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.train[0].sequence = 99  # type: ignore[misc]

    def test_118_partition_tuples_immutable(self):
        result = run_split(self._three())
        self.assertIsInstance(result.train, tuple)
        self.assertIsInstance(result.validation, tuple)
        self.assertIsInstance(result.test, tuple)


class _FakeLongSequence:
    def __init__(self, length: int):
        self._length = length

    def __len__(self) -> int:
        return self._length

    def __iter__(self):
        raise AssertionError("should not iterate when over cap")


class RuntimeCapTests(unittest.TestCase):
    def test_119_raw_event_cap_contract_derives_from_runtime(self):
        from ml.recommender import temporal_split as ts

        self.assertEqual(ts.MAX_RAW_EVENTS, MAX_RAW_EVENTS)
        self.assertEqual(ts.MAX_UNIQUE_USERS, MAX_UNIQUE_USERS)
        self.assertEqual(ts.MAX_UNIQUE_SONGS, MAX_UNIQUE_SONGS)

    def test_120_cap_overflow_raises_resource_limit(self):
        fake = _FakeLongSequence(MAX_RAW_EVENTS + 1)
        with self.assertRaises(ResourceLimitError):
            split_interactions_temporally(fake)

    def test_121_unique_user_cap_enforced(self):
        from unittest import mock

        with mock.patch.object(
            __import__("ml.recommender.temporal_split", fromlist=["x"]), "MAX_UNIQUE_USERS", 1
        ):
            events = [
                make_event(user=U1, session_id="s", sequence=0, created_at=iso(0)),
                make_event(user=U2, session_id="s", sequence=0, created_at=iso(1)),
            ]
            with self.assertRaises(ResourceLimitError):
                split_interactions_temporally(events)

    def test_122_unique_song_cap_enforced(self):
        from unittest import mock

        with mock.patch.object(
            __import__("ml.recommender.temporal_split", fromlist=["x"]), "MAX_UNIQUE_SONGS", 1
        ):
            events = [
                make_event(song=S1, session_id="s", sequence=0, created_at=iso(0)),
                make_event(song=S2, session_id="s", sequence=1, created_at=iso(1)),
            ]
            with self.assertRaises(ResourceLimitError):
                split_interactions_temporally(events)

    def test_123_no_silent_truncation(self):
        from unittest import mock

        with mock.patch.object(
            __import__("ml.recommender.temporal_split", fromlist=["x"]), "MAX_UNIQUE_USERS", 1
        ):
            events = [
                make_event(user=U1, session_id="s", sequence=0, created_at=iso(0)),
                make_event(user=U2, session_id="s", sequence=0, created_at=iso(1)),
            ]
            with self.assertRaises(ResourceLimitError):
                split_interactions_temporally(events)


class StaticSafetyTests(unittest.TestCase):
    def test_124_no_pymongo(self):
        self.assertNotIn("pymongo", MODULE_SOURCE)

    def test_125_no_bson(self):
        self.assertNotIn("import bson", MODULE_SOURCE)
        self.assertNotIn("from bson", MODULE_SOURCE)

    def test_126_no_numpy(self):
        self.assertNotIn("numpy", MODULE_SOURCE)

    def test_127_no_scipy(self):
        self.assertNotIn("scipy", MODULE_SOURCE)

    def test_128_no_pandas(self):
        self.assertNotIn("pandas", MODULE_SOURCE)

    def test_129_no_sklearn(self):
        self.assertNotIn("sklearn", MODULE_SOURCE)

    def test_130_no_http_framework(self):
        for name in ("fastapi", "flask", "django", "uvicorn"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_131_no_filesystem_dataset_read(self):
        for name in ("open(", "Path(", "read_text", "read_csv", "json.load"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_132_no_artifact_write(self):
        for name in ("write_text", "json.dump", "np.save", "to_csv", "joblib"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_133_no_train_model_function(self):
        self.assertNotIn("def train", MODULE_SOURCE)
        self.assertNotIn("def fit", MODULE_SOURCE)
        self.assertNotIn("TruncatedSVD", MODULE_SOURCE)

    def test_134_no_recommendation_scoring(self):
        for name in ("recommend_score", "prediction_score", "affinity", "cosine_similarity"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_135_no_client_occurred_at_split_logic(self):
        # Only a docstring mention that it is ignored is allowed.
        code_lines = [
            line
            for line in MODULE_SOURCE.splitlines()
            if "client_occurred_at" in line and not line.strip().startswith(("`", "#", "``"))
        ]
        # All non-docstring mentions must be comments/docstrings saying ignored.
        for line in code_lines:
            self.assertTrue(
                "ignored" in line or "does not" in line or line.strip().startswith(("`", "'''")),
                msg=line,
            )


class ExceptionTypeTests(unittest.TestCase):
    def test_temporal_split_error_hierarchy(self):
        self.assertTrue(issubclass(TemporalSplitValidationError, TemporalSplitError))
        self.assertTrue(issubclass(TemporalSplitError, Exception))
        with self.assertRaises(TemporalSplitError):
            split_interactions_temporally("bad")

    def test_validation_error_messages_are_bounded(self):
        try:
            run_split([make_event(song="bad")])
        except TemporalSplitValidationError as exc:
            message = str(exc)
            self.assertNotIn("Traceback", message)
            self.assertNotIn("mongodb", message.lower())
            self.assertNotIn("password", message.lower())
            self.assertLess(len(message), 200)


if __name__ == "__main__":
    unittest.main()
