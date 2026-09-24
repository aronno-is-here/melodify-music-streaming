"""Bounded CPU-only offline training runtime for Melodify recommender tooling.

This module is infrastructure only: hard safety limits, a deterministic
process-local CPU thread bootstrap, pure bound-validation helpers, and a
standard-library seed helper. It does not train models, read MongoDB, expose
HTTP, or import third-party numerical libraries.

These constants are execution/data-shape safety limits for the initial
8 GB RAM CPU development workflow. They are NOT dataset statistics,
production traffic limits, API limits, recommendation-quality parameters,
or ML hyperparameters.
"""

from __future__ import annotations

import os
import random
from dataclasses import dataclass
from typing import Mapping

RUNTIME_SCHEMA_VERSION = 1
RUNTIME_NAME = "melodify-offline-recommender"

DEFAULT_RANDOM_SEED = 42
MAX_RAW_EVENTS = 250_000
MAX_UNIQUE_USERS = 50_000
MAX_UNIQUE_SONGS = 25_000
MAX_WORKERS = 1
THREADS_PER_NUMERIC_LIBRARY = 1

MAX_SEED = 2**32 - 1

CPU_THREAD_ENV_VARS = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
)
CUDA_VISIBLE_DEVICES_VAR = "CUDA_VISIBLE_DEVICES"


class RecommenderRuntimeError(Exception):
    """Base package-specific runtime failure."""


class ResourceLimitError(RecommenderRuntimeError):
    """A hard safety limit was exceeded."""


class RuntimeConfigError(RecommenderRuntimeError):
    """Runtime configuration or seed input was invalid."""


@dataclass(frozen=True)
class RuntimeLimits:
    """Immutable hard safety ceilings for the offline CPU runtime."""

    random_seed: int
    max_raw_events: int
    max_unique_users: int
    max_unique_songs: int
    max_workers: int
    numeric_threads: int


_DEFAULT_LIMITS = RuntimeLimits(
    random_seed=DEFAULT_RANDOM_SEED,
    max_raw_events=MAX_RAW_EVENTS,
    max_unique_users=MAX_UNIQUE_USERS,
    max_unique_songs=MAX_UNIQUE_SONGS,
    max_workers=MAX_WORKERS,
    numeric_threads=THREADS_PER_NUMERIC_LIBRARY,
)


def get_runtime_limits() -> RuntimeLimits:
    """Return the canonical frozen hard-limit configuration."""
    return _DEFAULT_LIMITS


def configure_cpu_runtime() -> Mapping[str, str]:
    """Bind common numerical-library thread counts for this process only.

    Mutates only ``os.environ`` for the current Python process. Does not write
    permanent Windows/system environment variables, does not modify the
    registry, and does not invoke shell SETX. Idempotent: calling twice yields
    the same resulting configuration. This is a numerical-library thread
    bound, not an OS-level CPU quota or memory quota.
    """
    for name in CPU_THREAD_ENV_VARS:
        os.environ[name] = str(THREADS_PER_NUMERIC_LIBRARY)
    os.environ[CUDA_VISIBLE_DEVICES_VAR] = ""
    return {
        **{name: os.environ[name] for name in CPU_THREAD_ENV_VARS},
        CUDA_VISIBLE_DEVICES_VAR: os.environ[CUDA_VISIBLE_DEVICES_VAR],
    }


def _is_strict_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_non_negative_count(field_name: str, value: object, limit: int) -> int:
    """Validate one non-negative integer count against a hard cap.

    Accepts only ``int`` (``bool`` is rejected). Value must be ``>= 0`` and
    ``<= limit``. Raises :class:`ResourceLimitError` or
    :class:`RuntimeConfigError` with deterministic, bounded messages.
    """
    if not _is_strict_int(value):
        raise RuntimeConfigError(f"{field_name} must be a non-negative integer")
    if value < 0:
        raise ResourceLimitError(f"{field_name} must be a non-negative integer")
    if value > limit:
        raise ResourceLimitError(f"{field_name} exceeds limit {limit}")
    return value


def ensure_within_limit(field_name: str, value: object, limit: int) -> int:
    """Ensure ``value`` is an integer within ``[0, limit]`` (inclusive)."""
    return validate_non_negative_count(field_name, value, limit)


def validate_dataset_shape(
    raw_event_count: object,
    unique_user_count: object,
    unique_song_count: object,
    *,
    limits: RuntimeLimits | None = None,
) -> tuple[int, int, int]:
    """Validate a combined dataset shape against hard safety ceilings.

    Does not mutate the input values. Checks raw events, unique users, then
    unique songs in a fixed order so failures are deterministic.
    """
    cfg = limits if limits is not None else get_runtime_limits()
    events = validate_non_negative_count(
        "raw_event_count", raw_event_count, cfg.max_raw_events
    )
    users = validate_non_negative_count(
        "unique_user_count", unique_user_count, cfg.max_unique_users
    )
    songs = validate_non_negative_count(
        "unique_song_count", unique_song_count, cfg.max_unique_songs
    )
    return events, users, songs


def seed_standard_library(seed: int = DEFAULT_RANDOM_SEED) -> int:
    """Seed the standard-library ``random`` module only.

    Validates ``0 <= seed <= 2**32 - 1`` and rejects ``bool``. Does not claim
    to seed NumPy or any other library; later numerical checkpoints must seed
    their own libraries explicitly.
    """
    if not _is_strict_int(seed):
        raise RuntimeConfigError("seed must be an integer")
    if seed < 0 or seed > MAX_SEED:
        raise RuntimeConfigError(f"seed must be between 0 and {MAX_SEED}")
    random.seed(seed)
    return seed
