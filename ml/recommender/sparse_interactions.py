"""Bounded sparse user-by-song factual interaction matrices for Melodify.

Converts validated ``TemporalInteractionEvent`` records (24/43) into eight
deterministic CSR float32 matrices under 23/43 hard safety caps. Row/column
order is lexicographic by ID. NumPy and SciPy are loaded lazily **after**
``configure_cpu_runtime()`` so importing this module alone does not mutate
the process environment.

This module does not assign training weights/preferences, train models,
access MongoDB, expose HTTP, write artifacts, or allocate dense user-by-song
matrices. It does not re-split time; partitions arrive already decided by
24/43.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Mapping

from .runtime import (
    MAX_RAW_EVENTS,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    RecommenderRuntimeError,
    ResourceLimitError,
    configure_cpu_runtime,
    validate_dataset_shape,
)
from .temporal_split import (
    MAX_LISTENED_DELTA_SECONDS,
    MAX_SEQUENCE,
    MAX_SESSION_ID_LENGTH,
    SUPPORTED_EVENT_TYPES,
    TemporalInteractionEvent,
)

MATRIX_NAMES = (
    "observed",
    "session_count",
    "play_started_count",
    "replay_started_count",
    "completed_count",
    "skipped_count",
    "stopped_count",
    "listened_seconds",
)

_EVENT_TYPE_COUNT_FIELDS: Mapping[str, str] = MappingProxyType(
    {
        "play-started": "play_started_count",
        "replay-started": "replay_started_count",
        "completed": "completed_count",
        "skipped": "skipped_count",
        "stopped": "stopped_count",
    }
)

_COUNT_FIELDS = (
    "play_started_count",
    "replay_started_count",
    "completed_count",
    "skipped_count",
    "stopped_count",
)

_HEX_CHARS = frozenset("0123456789abcdef")

_np = None
_sp = None


class SparseInteractionError(RecommenderRuntimeError):
    """Base sparse-interaction failure."""


class SparseInteractionValidationError(SparseInteractionError):
    """Input event failed deterministic validation."""


@dataclass(frozen=True)
class SparseInteractionSummary:
    """Factual counts describing one sparse interaction build."""

    event_count: int
    unique_user_count: int
    unique_song_count: int
    interaction_pair_count: int
    session_count: int
    matrix_shape: tuple[int, int]


@dataclass(frozen=True)
class SparseInteractionBundle:
    """Immutable sorted ID indexes, eight CSR matrices, and factual summary."""

    user_ids: tuple[str, ...]
    song_ids: tuple[str, ...]
    user_to_index: Mapping[str, int]
    song_to_index: Mapping[str, int]
    observed: object
    session_count: object
    play_started_count: object
    replay_started_count: object
    completed_count: object
    skipped_count: object
    stopped_count: object
    listened_seconds: object
    summary: SparseInteractionSummary


def _load_numeric_stack():
    """Configure CPU thread bounds first, then import NumPy/SciPy once."""
    global _np, _sp
    if _np is None or _sp is None:
        configure_cpu_runtime()
        import numpy as numpy_module
        import scipy.sparse as scipy_sparse_module

        _np = numpy_module
        _sp = scipy_sparse_module
    return _np, _sp


def _require_canonical_id(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise SparseInteractionValidationError(f"{field} must be a 24-hex string")
    if len(value) != 24 or value.lower() != value:
        raise SparseInteractionValidationError(f"invalid {field}")
    if any(ch not in _HEX_CHARS for ch in value):
        raise SparseInteractionValidationError(f"invalid {field}")
    return value


def _require_session_id(value: object) -> str:
    if not isinstance(value, str):
        raise SparseInteractionValidationError("session_id must be a non-empty string")
    if not value.strip():
        raise SparseInteractionValidationError("session_id must be a non-empty string")
    if len(value) > MAX_SESSION_ID_LENGTH:
        raise SparseInteractionValidationError("session_id exceeds maximum length 128")
    return value


def _require_sequence(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SparseInteractionValidationError("sequence must be an integer")
    if value < 0 or value > MAX_SEQUENCE:
        raise SparseInteractionValidationError(
            f"sequence must be between 0 and {MAX_SEQUENCE}"
        )
    return value


def _require_event_type(value: object) -> str:
    if not isinstance(value, str) or value not in SUPPORTED_EVENT_TYPES:
        raise SparseInteractionValidationError("unsupported event_type")
    return value


def _require_listened_delta(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SparseInteractionValidationError(
            "listened_seconds_delta must be a finite number or null"
        )
    numeric = float(value)
    if not math.isfinite(numeric):
        raise SparseInteractionValidationError(
            "listened_seconds_delta must be a finite number or null"
        )
    if numeric < 0.0 or numeric > MAX_LISTENED_DELTA_SECONDS:
        raise SparseInteractionValidationError(
            f"listened_seconds_delta must be between 0 and {int(MAX_LISTENED_DELTA_SECONDS)}"
        )
    return numeric


def _require_created_at(value: object) -> datetime:
    if not isinstance(value, datetime):
        raise SparseInteractionValidationError(
            "created_at must be a timezone-aware datetime"
        )
    if value.tzinfo is None or value.utcoffset() is None:
        raise SparseInteractionValidationError("created_at must include timezone")
    return value


def _validate_event(event: object, index: int) -> TemporalInteractionEvent:
    if not isinstance(event, TemporalInteractionEvent):
        raise SparseInteractionValidationError(
            f"event {index} must be a TemporalInteractionEvent"
        )
    try:
        _require_canonical_id(event.event_id, "event id")
        _require_canonical_id(event.user_id, "user id")
        _require_canonical_id(event.song_id, "song id")
        _require_session_id(event.session_id)
        _require_sequence(event.sequence)
        _require_event_type(event.event_type)
        _require_listened_delta(event.listened_seconds_delta)
        _require_created_at(event.created_at)
    except SparseInteractionValidationError as exc:
        raise SparseInteractionValidationError(
            f"event {index} has invalid input: {exc}"
        ) from exc
    return event


def _coerce_events(events: object) -> list:
    if not isinstance(events, (list, tuple)):
        raise SparseInteractionValidationError(
            "events must be a list or tuple of TemporalInteractionEvent"
        )
    if len(events) > MAX_RAW_EVENTS:
        raise ResourceLimitError(f"raw_event_count exceeds limit {MAX_RAW_EVENTS}")
    return list(events)


def _build_csr(np, sp, rows, cols, data, shape: tuple[int, int]):
    if not rows:
        matrix = sp.csr_matrix(shape, dtype=np.float32)
    else:
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
    matrix.sum_duplicates()
    matrix.eliminate_zeros()
    matrix.sort_indices()
    return matrix


def build_sparse_interactions(events) -> SparseInteractionBundle:
    """Build eight factual CSR float32 user-by-song matrices from events.

    Accepts only a list or tuple of ``TemporalInteractionEvent`` objects.
    IDs are indexed in sorted order; matrices are canonical CSR
    (``float32``, duplicate-summed, explicit zeros removed, indices sorted).
    No weighted/preference scores, no dense allocation, no randomness, no
    re-splitting, no silent truncation of 23/43 caps.
    """
    sequence_input = _coerce_events(events)

    validated: list[TemporalInteractionEvent] = []
    seen_event_ids: set[str] = set()
    seen_sequence_keys: set[tuple[str, str, int]] = set()
    session_song: dict[tuple[str, str], str] = {}
    unique_users: set[str] = set()
    unique_songs: set[str] = set()
    unique_sessions: set[tuple[str, str]] = set()

    for index, raw in enumerate(sequence_input):
        event = _validate_event(raw, index)
        if event.event_id in seen_event_ids:
            raise SparseInteractionValidationError("duplicate event id")
        seen_event_ids.add(event.event_id)

        sequence_key = (event.user_id, event.session_id, event.sequence)
        if sequence_key in seen_sequence_keys:
            raise SparseInteractionValidationError("duplicate sequence in session")
        seen_sequence_keys.add(sequence_key)

        session_key = (event.user_id, event.session_id)
        prior_song = session_song.get(session_key)
        if prior_song is None:
            session_song[session_key] = event.song_id
        elif prior_song != event.song_id:
            raise SparseInteractionValidationError(
                "session contains multiple song ids"
            )

        unique_sessions.add(session_key)
        unique_users.add(event.user_id)
        unique_songs.add(event.song_id)
        validated.append(event)

    validate_dataset_shape(
        len(validated), len(unique_users), len(unique_songs)
    )

    user_ids = tuple(sorted(unique_users))
    song_ids = tuple(sorted(unique_songs))
    user_to_index = MappingProxyType(
        {user_id: index for index, user_id in enumerate(user_ids)}
    )
    song_to_index = MappingProxyType(
        {song_id: index for index, song_id in enumerate(song_ids)}
    )
    shape = (len(user_ids), len(song_ids))

    observed_pairs: set[tuple[int, int]] = set()
    sessions_by_pair: dict[tuple[int, int], set[str]] = defaultdict(set)
    count_pairs: dict[str, dict[tuple[int, int], float]] = {
        field: defaultdict(float) for field in _COUNT_FIELDS
    }
    listened_pairs: dict[tuple[int, int], float] = defaultdict(float)

    for event in validated:
        row = user_to_index[event.user_id]
        col = song_to_index[event.song_id]
        pair = (row, col)
        observed_pairs.add(pair)
        sessions_by_pair[pair].add(event.session_id)
        count_field = _EVENT_TYPE_COUNT_FIELDS.get(event.event_type)
        if count_field is not None:
            count_pairs[count_field][pair] += 1.0
        if event.listened_seconds_delta is not None:
            listened_pairs[pair] += float(event.listened_seconds_delta)

    np, sp = _load_numeric_stack()

    observed_rows: list[int] = []
    observed_cols: list[int] = []
    for row, col in sorted(observed_pairs):
        observed_rows.append(row)
        observed_cols.append(col)
    observed = _build_csr(
        np,
        sp,
        observed_rows,
        observed_cols,
        [1.0] * len(observed_rows),
        shape,
    )

    session_rows: list[int] = []
    session_cols: list[int] = []
    session_data: list[float] = []
    for (row, col), session_ids in sorted(sessions_by_pair.items()):
        session_rows.append(row)
        session_cols.append(col)
        session_data.append(float(len(session_ids)))
    session_count = _build_csr(
        np, sp, session_rows, session_cols, session_data, shape
    )

    count_matrices = {}
    for field in _COUNT_FIELDS:
        pairs = count_pairs[field]
        rows: list[int] = []
        cols: list[int] = []
        data: list[float] = []
        for (row, col), value in sorted(pairs.items()):
            rows.append(row)
            cols.append(col)
            data.append(value)
        count_matrices[field] = _build_csr(
            np, sp, rows, cols, data, shape
        )

    listened_rows: list[int] = []
    listened_cols: list[int] = []
    listened_data: list[float] = []
    for (row, col), value in sorted(listened_pairs.items()):
        listened_rows.append(row)
        listened_cols.append(col)
        listened_data.append(value)
    listened_seconds = _build_csr(
        np, sp, listened_rows, listened_cols, listened_data, shape
    )

    summary = SparseInteractionSummary(
        event_count=len(validated),
        unique_user_count=len(user_ids),
        unique_song_count=len(song_ids),
        interaction_pair_count=int(observed.nnz),
        session_count=len(unique_sessions),
        matrix_shape=shape,
    )

    return SparseInteractionBundle(
        user_ids=user_ids,
        song_ids=song_ids,
        user_to_index=user_to_index,
        song_to_index=song_to_index,
        observed=observed,
        session_count=session_count,
        play_started_count=count_matrices["play_started_count"],
        replay_started_count=count_matrices["replay_started_count"],
        completed_count=count_matrices["completed_count"],
        skipped_count=count_matrices["skipped_count"],
        stopped_count=count_matrices["stopped_count"],
        listened_seconds=listened_seconds,
        summary=summary,
    )
