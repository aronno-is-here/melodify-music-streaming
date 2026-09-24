"""Deterministic per-user chronological train/validation/test raw-event split.

Session-level, leakage-resistant splitting for Melodify ListeningEvent-like
records. One (user_id, session_id) group always belongs to exactly one
partition. Server ``createdAt`` is the sole chronological authority;
``client_occurred_at`` is ignored for partition decisions.

This module does not build matrices, train models, access MongoDB, expose
HTTP, or use randomness/current time. It operates only on provided in-memory
records under 23/43 runtime hard caps (no silent truncation).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence

from .runtime import (
    MAX_RAW_EVENTS,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    RecommenderRuntimeError,
    ResourceLimitError,
)

VALIDATION_SESSIONS_PER_USER = 1
TEST_SESSIONS_PER_USER = 1
MIN_TRAIN_SESSIONS_PER_EVALUATED_USER = 1
MIN_SESSIONS_FOR_EVALUATION = 3

MAX_SEQUENCE = 1_000_000
MAX_SESSION_ID_LENGTH = 128
MAX_LISTENED_DELTA_SECONDS = 120.0

SUPPORTED_EVENT_TYPES = frozenset(
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
)


class TemporalSplitError(RecommenderRuntimeError):
    """Base temporal-split failure."""


class TemporalSplitValidationError(TemporalSplitError):
    """Input record failed deterministic validation."""


@dataclass(frozen=True)
class TemporalInteractionEvent:
    """Normalized immutable ListeningEvent-like record for offline splitting."""

    event_id: str
    user_id: str
    song_id: str
    session_id: str
    sequence: int
    event_type: str
    listened_seconds_delta: float | None
    created_at: datetime


@dataclass(frozen=True)
class TemporalSplitSummary:
    """Factual counts describing one temporal split result."""

    input_event_count: int
    train_event_count: int
    validation_event_count: int
    test_event_count: int
    unique_user_count: int
    unique_song_count: int
    session_count: int
    evaluable_user_count: int
    train_only_user_count: int
    overlap_train_only_user_count: int
    train_session_count: int
    validation_session_count: int
    test_session_count: int


@dataclass(frozen=True)
class TemporalSplitResult:
    """Immutable train/validation/test partitions plus factual summary."""

    train: tuple[TemporalInteractionEvent, ...]
    validation: tuple[TemporalInteractionEvent, ...]
    test: tuple[TemporalInteractionEvent, ...]
    summary: TemporalSplitSummary


_HEX_CHARS = frozenset("0123456789abcdef")


def _canonical_object_id(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise TemporalSplitValidationError(f"{field} must be a 24-hex string")
    lowered = value.strip().lower()
    if len(lowered) != 24 or any(ch not in _HEX_CHARS for ch in lowered):
        raise TemporalSplitValidationError(f"invalid {field}")
    return lowered


def _require_session_id(value: object) -> str:
    if not isinstance(value, str):
        raise TemporalSplitValidationError("session_id must be a non-empty string")
    trimmed = value.strip()
    if not trimmed:
        raise TemporalSplitValidationError("session_id must be a non-empty string")
    if len(trimmed) > MAX_SESSION_ID_LENGTH:
        raise TemporalSplitValidationError("session_id exceeds maximum length 128")
    return trimmed


def _require_sequence(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TemporalSplitValidationError("sequence must be an integer")
    if value < 0 or value > MAX_SEQUENCE:
        raise TemporalSplitValidationError(
            f"sequence must be between 0 and {MAX_SEQUENCE}"
        )
    return value


def _require_event_type(value: object) -> str:
    if not isinstance(value, str) or value not in SUPPORTED_EVENT_TYPES:
        raise TemporalSplitValidationError("unsupported event_type")
    return value


def _parse_created_at(value: object) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise TemporalSplitValidationError("createdAt must include timezone")
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise TemporalSplitValidationError("createdAt must include timezone")
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as exc:
            raise TemporalSplitValidationError("createdAt must be a valid ISO-8601 timestamp") from exc
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise TemporalSplitValidationError("createdAt must include timezone")
        return parsed.astimezone(timezone.utc)
    raise TemporalSplitValidationError("createdAt must be a timezone-aware datetime or ISO-8601 string")


def _parse_listened_delta(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TemporalSplitValidationError("listened_seconds_delta must be a finite number or null")
    numeric = float(value)
    if not math.isfinite(numeric):
        raise TemporalSplitValidationError("listened_seconds_delta must be a finite number or null")
    if numeric < 0.0 or numeric > MAX_LISTENED_DELTA_SECONDS:
        raise TemporalSplitValidationError(
            f"listened_seconds_delta must be between 0 and {int(MAX_LISTENED_DELTA_SECONDS)}"
        )
    return numeric


def _normalize_event(raw: Mapping[str, Any]) -> TemporalInteractionEvent:
    if not isinstance(raw, Mapping):
        raise TemporalSplitValidationError("each event must be a mapping")
    if "_id" not in raw:
        raise TemporalSplitValidationError("event is missing _id")
    if "user" not in raw:
        raise TemporalSplitValidationError("event is missing user")
    if "song" not in raw:
        raise TemporalSplitValidationError("event is missing song")
    if "session_id" not in raw:
        raise TemporalSplitValidationError("event is missing session_id")
    if "sequence" not in raw:
        raise TemporalSplitValidationError("event is missing sequence")
    if "event_type" not in raw:
        raise TemporalSplitValidationError("event is missing event_type")
    if "createdAt" not in raw:
        raise TemporalSplitValidationError("event is missing createdAt")

    return TemporalInteractionEvent(
        event_id=_canonical_object_id(raw["_id"], "event id"),
        user_id=_canonical_object_id(raw["user"], "user id"),
        song_id=_canonical_object_id(raw["song"], "song id"),
        session_id=_require_session_id(raw["session_id"]),
        sequence=_require_sequence(raw["sequence"]),
        event_type=_require_event_type(raw["event_type"]),
        listened_seconds_delta=_parse_listened_delta(raw.get("listened_seconds_delta")),
        created_at=_parse_created_at(raw["createdAt"]),
    )


def _coerce_sequence_input(events: object) -> Sequence[Any]:
    if isinstance(events, (str, bytes, bytearray, memoryview)):
        raise TemporalSplitValidationError("events must be a list or tuple of mappings")
    if isinstance(events, Mapping):
        raise TemporalSplitValidationError("events must be a list or tuple of mappings")
    if isinstance(events, Sequence):
        return events
    if hasattr(events, "__len__"):
        # Check hard cap before materializing when length is known.
        try:
            length = len(events)  # type: ignore[arg-type]
        except TypeError as exc:
            raise TemporalSplitValidationError("events must be a list or tuple of mappings") from exc
        if length > MAX_RAW_EVENTS:
            raise ResourceLimitError(f"raw_event_count exceeds limit {MAX_RAW_EVENTS}")
    if isinstance(events, Iterable):
        materialized = list(events)
        if len(materialized) > MAX_RAW_EVENTS:
            raise ResourceLimitError(f"raw_event_count exceeds limit {MAX_RAW_EVENTS}")
        return materialized
    raise TemporalSplitValidationError("events must be a list or tuple of mappings")


def _partition_sort_key(event: TemporalInteractionEvent) -> tuple:
    return (
        event.created_at,
        event.user_id,
        event.session_id,
        event.sequence,
        event.event_id,
    )


def _session_sort_key(session: tuple) -> tuple:
    start_at, end_at, session_id = session
    return (start_at, end_at, session_id)


def split_interactions_temporally(
    events: Sequence[Mapping[str, Any]] | Iterable[Mapping[str, Any]],
) -> TemporalSplitResult:
    """Split raw ListeningEvent-like records into train/validation/test.

    Per-user chronological session holdout: with at least
    ``MIN_SESSIONS_FOR_EVALUATION`` non-overlapping sessions, earliest
    sessions go to train, the second-latest session to validation, and the
    latest session to test. Users with fewer sessions or overlapping session
    timelines remain train-only. No randomness, no current time, no file/DB
    access, no silent truncation.
    """
    sequence_input = _coerce_sequence_input(events)

    normalized: list[TemporalInteractionEvent] = []
    seen_event_ids: set[str] = set()
    for index, raw in enumerate(sequence_input):
        if not isinstance(raw, Mapping):
            raise TemporalSplitValidationError(f"event {index} must be a mapping")
        try:
            event = _normalize_event(raw)
        except TemporalSplitValidationError as exc:
            raise TemporalSplitValidationError(f"event {index} has invalid input: {exc}") from exc
        if event.event_id in seen_event_ids:
            raise TemporalSplitValidationError("duplicate event id")
        seen_event_ids.add(event.event_id)
        normalized.append(event)

    unique_users = {event.user_id for event in normalized}
    unique_songs = {event.song_id for event in normalized}
    if len(unique_users) > MAX_UNIQUE_USERS:
        raise ResourceLimitError(f"unique_user_count exceeds limit {MAX_UNIQUE_USERS}")
    if len(unique_songs) > MAX_UNIQUE_SONGS:
        raise ResourceLimitError(f"unique_song_count exceeds limit {MAX_UNIQUE_SONGS}")

    sessions_by_user: dict[str, dict[str, list[TemporalInteractionEvent]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for event in normalized:
        sessions_by_user[event.user_id][event.session_id].append(event)

    partition_events: dict[str, list[TemporalInteractionEvent]] = {
        "train": [],
        "validation": [],
        "test": [],
    }
    partition_sessions: dict[str, list[tuple[str, str]]] = {
        "train": [],
        "validation": [],
        "test": [],
    }
    evaluable_user_count = 0
    train_only_user_count = 0
    overlap_train_only_user_count = 0

    for user_id in sorted(sessions_by_user):
        session_map = sessions_by_user[user_id]
        session_records: list[tuple[datetime, datetime, str]] = []
        for session_id, session_events in session_map.items():
            songs = {event.song_id for event in session_events}
            if len(songs) != 1:
                raise TemporalSplitValidationError("session contains multiple song ids")
            sequences = [event.sequence for event in session_events]
            if len(sequences) != len(set(sequences)):
                raise TemporalSplitValidationError("duplicate sequence in session")
            session_events_sorted = sorted(
                session_events,
                key=lambda e: (e.created_at, e.sequence, e.event_id),
            )
            session_map[session_id] = session_events_sorted
            start_at = min(event.created_at for event in session_events_sorted)
            end_at = max(event.created_at for event in session_events_sorted)
            session_records.append((start_at, end_at, session_id))

        session_records.sort(key=_session_sort_key)

        overlapping = any(
            session_records[i][1] > session_records[i + 1][0]
            for i in range(len(session_records) - 1)
        )
        if overlapping:
            overlap_train_only_user_count += 1
            train_only_user_count += 1
            for start_at, end_at, session_id in session_records:
                for event in session_map[session_id]:
                    partition_events["train"].append(event)
                partition_sessions["train"].append((user_id, session_id))
            continue

        if len(session_records) < MIN_SESSIONS_FOR_EVALUATION:
            train_only_user_count += 1
            for start_at, end_at, session_id in session_records:
                for event in session_map[session_id]:
                    partition_events["train"].append(event)
                partition_sessions["train"].append((user_id, session_id))
            continue

        evaluable_user_count += 1
        train_session_count = (
            len(session_records)
            - VALIDATION_SESSIONS_PER_USER
            - TEST_SESSIONS_PER_USER
        )
        for index, (start_at, end_at, session_id) in enumerate(session_records):
            if index < train_session_count:
                name = "train"
            elif index == train_session_count:
                name = "validation"
            else:
                name = "test"
            for event in session_map[session_id]:
                partition_events[name].append(event)
            partition_sessions[name].append((user_id, session_id))

    train = tuple(sorted(partition_events["train"], key=_partition_sort_key))
    validation = tuple(sorted(partition_events["validation"], key=_partition_sort_key))
    test = tuple(sorted(partition_events["test"], key=_partition_sort_key))

    summary = TemporalSplitSummary(
        input_event_count=len(normalized),
        train_event_count=len(train),
        validation_event_count=len(validation),
        test_event_count=len(test),
        unique_user_count=len(unique_users),
        unique_song_count=len(unique_songs),
        session_count=sum(len(user_sessions) for user_sessions in sessions_by_user.values()),
        evaluable_user_count=evaluable_user_count,
        train_only_user_count=train_only_user_count,
        overlap_train_only_user_count=overlap_train_only_user_count,
        train_session_count=len(partition_sessions["train"]),
        validation_session_count=len(partition_sessions["validation"]),
        test_session_count=len(partition_sessions["test"]),
    )
    return TemporalSplitResult(
        train=train,
        validation=validation,
        test=test,
        summary=summary,
    )
