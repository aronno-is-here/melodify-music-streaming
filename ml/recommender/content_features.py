"""Deterministic sparse Song content-feature encoder for Melodify.

Converts bounded Song catalog metadata records into one Song × Content
Feature CSR float32 matrix under 23/43 hard safety caps. Only four factual
categorical families are encoded: artist, genre, language, category. Feature
values are binary; row and column order are lexicographic. NumPy and SciPy
load lazily **after** ``configure_cpu_runtime()`` so importing this module
alone does not mutate the process environment.

This module does not rank, score, embed, fit models, read MongoDB, expose
HTTP, write artifacts, allocate dense Song×feature or Song×song matrices,
or fold user-interaction signals.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from .runtime import (
    MAX_UNIQUE_SONGS,
    RecommenderRuntimeError,
    ResourceLimitError,
    configure_cpu_runtime,
)

CONTENT_FEATURE_FAMILIES = (
    "artist",
    "genre",
    "language",
    "category",
)

MAX_CONTENT_VALUE_LENGTH = 512
MAX_CONTENT_FEATURES = MAX_UNIQUE_SONGS * len(CONTENT_FEATURE_FAMILIES)

_HEX_CHARS = frozenset("0123456789abcdef")

_np = None
_sp = None


class ContentFeatureError(RecommenderRuntimeError):
    """Base content-feature failure."""


class ContentFeatureValidationError(ContentFeatureError):
    """Song record failed deterministic validation."""


@dataclass(frozen=True)
class SongContentFeatureSummary:
    """Factual counts describing one Song content-feature build."""

    song_count: int
    feature_count: int
    nonzero_count: int
    zero_feature_song_count: int
    artist_feature_count: int
    genre_feature_count: int
    language_feature_count: int
    category_feature_count: int
    matrix_shape: tuple[int, int]


@dataclass(frozen=True)
class SongContentFeatureBundle:
    """Immutable sorted indexes, one CSR matrix, and factual summary."""

    song_ids: tuple[str, ...]
    feature_names: tuple[str, ...]
    song_to_index: Mapping[str, int]
    feature_to_index: Mapping[str, int]
    matrix: object
    summary: SongContentFeatureSummary


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


def normalize_content_value(value: str) -> str:
    """Apply NFKC, trim, whitespace collapse, then casefold.

    Deterministic pure text normalization only: no transliteration,
    stemming, accent removal, punctuation stripping, or tokenization.
    """
    if not isinstance(value, str):
        raise ContentFeatureValidationError("content value must be a string")
    text = unicodedata.normalize("NFKC", value)
    text = text.strip()
    text = " ".join(text.split())
    text = text.casefold()
    text = text.strip()
    return text


def _require_normalized_length(text: str, field: str) -> str:
    if len(text) > MAX_CONTENT_VALUE_LENGTH:
        raise ContentFeatureValidationError(
            f"{field} exceeds maximum length {MAX_CONTENT_VALUE_LENGTH}"
        )
    return text


def _canonical_song_id(value: object) -> str:
    if isinstance(value, bool) or not isinstance(value, str):
        raise ContentFeatureValidationError("_id must be a 24-hex string")
    if not value.strip():
        raise ContentFeatureValidationError("_id must be a non-empty string")
    lowered = value.strip().lower()
    if len(lowered) != 24 or any(ch not in _HEX_CHARS for ch in lowered):
        raise ContentFeatureValidationError("invalid _id")
    return lowered


def _raw_content_text(song: Mapping, key: str) -> str | None:
    if key not in song:
        return None
    value = song[key]
    if value is None:
        return None
    if not isinstance(value, str):
        raise ContentFeatureValidationError(f"{key} must be a string or null")
    return value


def _normalized_or_fallback(
    song: Mapping, normalized_key: str, fallback_key: str
) -> str | None:
    normalized_raw = _raw_content_text(song, normalized_key)
    if normalized_raw is not None:
        normalized = _require_normalized_length(
            normalize_content_value(normalized_raw), normalized_key
        )
        if normalized:
            return normalized
    fallback_raw = _raw_content_text(song, fallback_key)
    if fallback_raw is not None:
        fallback = _require_normalized_length(
            normalize_content_value(fallback_raw), fallback_key
        )
        if fallback:
            return fallback
    return None


def _single_content_value(song: Mapping, key: str) -> str | None:
    raw = _raw_content_text(song, key)
    if raw is None:
        return None
    normalized = _require_normalized_length(normalize_content_value(raw), key)
    if not normalized:
        return None
    return normalized


def _song_feature_names(song: Mapping) -> tuple[str, ...]:
    features: list[str] = []
    artist = _normalized_or_fallback(song, "normalized_artist", "artist")
    if artist is not None:
        features.append(f"artist::{artist}")
    genre = _normalized_or_fallback(song, "normalized_genre", "genre")
    if genre is not None:
        features.append(f"genre::{genre}")
    language = _single_content_value(song, "language")
    if language is not None:
        features.append(f"language::{language}")
    category = _single_content_value(song, "category")
    if category is not None:
        features.append(f"category::{category}")
    return tuple(features)


def _coerce_songs(songs: object) -> list:
    if not isinstance(songs, (list, tuple)):
        raise ContentFeatureValidationError(
            "songs must be a list or tuple of Song mappings"
        )
    if len(songs) > MAX_UNIQUE_SONGS:
        raise ResourceLimitError(
            f"unique_song_count exceeds limit {MAX_UNIQUE_SONGS}"
        )
    return list(songs)


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


def build_song_content_features(songs) -> SongContentFeatureBundle:
    """Build one Song × Content Feature CSR float32 matrix from Song records.

    Accepts only a list or tuple of mapping-like Song records. Encodes
    binary namespaced categorical features for the four supported families.
    Zero-feature Songs remain as zero rows. No weighting, ranking,
    similarity, dense allocation, DB/HTTP access, or silent truncation.
    """
    sequence_input = _coerce_songs(songs)

    seen_song_ids: set[str] = set()
    features_by_song_id: dict[str, tuple[str, ...]] = {}

    for index, raw in enumerate(sequence_input):
        if not isinstance(raw, Mapping):
            raise ContentFeatureValidationError(
                f"song {index} must be a mapping"
            )
        try:
            song_id = _canonical_song_id(raw["_id"]) if "_id" in raw else None
            if song_id is None:
                raise ContentFeatureValidationError("missing _id")
            feature_names = _song_feature_names(raw)
        except ContentFeatureValidationError as exc:
            raise ContentFeatureValidationError(
                f"song {index} has invalid input: {exc}"
            ) from exc
        if song_id in seen_song_ids:
            raise ContentFeatureValidationError("duplicate song id")
        seen_song_ids.add(song_id)
        features_by_song_id[song_id] = feature_names

    song_ids = tuple(sorted(features_by_song_id))
    feature_name_set: set[str] = set()
    for feature_names in features_by_song_id.values():
        feature_name_set.update(feature_names)
    if len(feature_name_set) > MAX_CONTENT_FEATURES:
        raise ResourceLimitError(
            f"content_feature_count exceeds limit {MAX_CONTENT_FEATURES}"
        )
    feature_names = tuple(sorted(feature_name_set))

    song_to_index = MappingProxyType(
        {song_id: index for index, song_id in enumerate(song_ids)}
    )
    feature_to_index = MappingProxyType(
        {name: index for index, name in enumerate(feature_names)}
    )
    shape = (len(song_ids), len(feature_names))

    coords: set[tuple[int, int]] = set()
    zero_feature_song_count = 0
    for song_id in song_ids:
        row = song_to_index[song_id]
        row_features = features_by_song_id[song_id]
        if not row_features:
            zero_feature_song_count += 1
            continue
        for name in row_features:
            coords.add((row, feature_to_index[name]))

    np, sp = _load_numeric_stack()

    rows: list[int] = []
    cols: list[int] = []
    for row, col in sorted(coords):
        rows.append(row)
        cols.append(col)
    matrix = _build_csr(
        np, sp, rows, cols, [1.0] * len(rows), shape
    )

    artist_feature_count = sum(
        1 for name in feature_names if name.startswith("artist::")
    )
    genre_feature_count = sum(
        1 for name in feature_names if name.startswith("genre::")
    )
    language_feature_count = sum(
        1 for name in feature_names if name.startswith("language::")
    )
    category_feature_count = sum(
        1 for name in feature_names if name.startswith("category::")
    )

    summary = SongContentFeatureSummary(
        song_count=len(song_ids),
        feature_count=len(feature_names),
        nonzero_count=int(matrix.nnz),
        zero_feature_song_count=zero_feature_song_count,
        artist_feature_count=artist_feature_count,
        genre_feature_count=genre_feature_count,
        language_feature_count=language_feature_count,
        category_feature_count=category_feature_count,
        matrix_shape=shape,
    )

    return SongContentFeatureBundle(
        song_ids=song_ids,
        feature_names=feature_names,
        song_to_index=song_to_index,
        feature_to_index=feature_to_index,
        matrix=matrix,
        summary=summary,
    )
