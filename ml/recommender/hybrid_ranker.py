"""Deterministic known-user hybrid ranker for Melodify.

Combines 29/43 raw collaborative latent-factor scores with 26/43 sparse
content cosine similarity for one known user over an explicit candidate
Song list. Weights are a fixed initial baseline (0.70 collaborative /
0.30 content) — not learned, not optimized, and not a quality claim.
Collaborative scores are min-max normalized inside the candidate set only
(a ranking convenience, not a probability or calibrated preference). When
content similarity is unavailable the hybrid score equals the normalized
collaborative score alone (no metadata penalty). Already-observed Songs
are excluded before scoring. Ordering is fully deterministic and ends at
ascending Song ID.

This module does not implement cold-start fallback, exploration, or
explicit-evidence integration (future checkpoint), does not train or
refit models, does not read MongoDB, does not expose HTTP, does not write
artifacts, and does not allocate dense user×song or Song×Song matrices.
Importing this module does not import NumPy or SciPy; they load lazily
after ``configure_cpu_runtime()``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .collaborative_model import (
    CollaborativeLatentModel,
    build_collaborative_training_signal,
    score_collaborative_candidates,
)
from .content_features import SongContentFeatureBundle
from .runtime import (
    MAX_UNIQUE_SONGS,
    RecommenderRuntimeError,
    ResourceLimitError,
    configure_cpu_runtime,
)
from .sparse_interactions import SparseInteractionBundle

COLLABORATIVE_WEIGHT = 0.70
CONTENT_WEIGHT = 0.30
DEFAULT_HYBRID_LIMIT = 20
MAX_HYBRID_LIMIT = 100
MAX_HYBRID_CANDIDATES = MAX_UNIQUE_SONGS
COLLABORATIVE_EQUAL_SCORE_VALUE = 0.50

_HEX_CHARS = frozenset("0123456789abcdef")

_np = None


class HybridRankingError(RecommenderRuntimeError):
    """Base hybrid-ranking failure."""


class HybridValidationError(HybridRankingError):
    """Input failed deterministic validation."""


class HybridColdStartUserError(HybridRankingError):
    """Known-user ranking cannot proceed without a cold-start policy."""


class HybridColdStartSongError(HybridRankingError):
    """Candidate Song is absent from the collaborative model index."""


@dataclass(frozen=True)
class HybridRankedItem:
    """One deterministically ranked candidate Song."""

    rank: int
    song_id: str
    hybrid_score: float
    collaborative_raw_score: float
    collaborative_normalized_score: float
    content_score: float | None
    content_available: bool


@dataclass(frozen=True)
class HybridRankingSummary:
    """Factual counts and fixed weights for one hybrid ranking call."""

    input_candidate_count: int
    seen_filtered_count: int
    eligible_candidate_count: int
    returned_count: int
    requested_limit: int
    content_profile_feature_count: int
    content_available_candidate_count: int
    collaborative_weight: float
    content_weight: float


@dataclass(frozen=True)
class HybridRankingResult:
    """Immutable ranked items plus factual summary."""

    items: tuple[HybridRankedItem, ...]
    summary: HybridRankingSummary


@dataclass(frozen=True)
class HybridRankerContext:
    """Immutable prepared inputs for repeated known-user hybrid ranking."""

    collaborative_model: object
    interaction_bundle: object
    content_features: object
    training_signal: object
    content_row_norms: object


def _load_numeric_stack():
    """Configure CPU thread bounds first, then import NumPy once."""
    global _np
    if _np is None:
        configure_cpu_runtime()
        import numpy as numpy_module

        _np = numpy_module
    return _np


def _canonical_id(value: object, kind: str) -> str:
    if isinstance(value, bool) or not isinstance(value, str):
        raise HybridValidationError(f"invalid hybrid {kind} id")
    text = value.strip().lower()
    if len(text) != 24 or any(ch not in _HEX_CHARS for ch in text):
        raise HybridValidationError(f"invalid hybrid {kind} id")
    return text


def _validate_limit(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise HybridValidationError("limit must be an integer")
    if value < 1 or value > MAX_HYBRID_LIMIT:
        raise HybridValidationError(
            f"limit must be between 1 and {MAX_HYBRID_LIMIT}"
        )
    return value


def _content_row_norms(np, content_matrix) -> object:
    squared = content_matrix.multiply(content_matrix)
    row_sums = np.asarray(squared.sum(axis=1)).ravel()
    norms = np.sqrt(row_sums).astype(np.float32, copy=False)
    if not bool(np.isfinite(norms).all()):
        raise HybridValidationError("content row norms must be finite")
    norms = np.array(norms, dtype=np.float32, copy=True)
    norms.setflags(write=False)
    return norms


def prepare_hybrid_ranker(
    collaborative_model: object,
    interaction_bundle: object,
    content_features: object,
) -> HybridRankerContext:
    """Validate alignment, build the training signal once, precompute norms.

    Requires a ``CollaborativeLatentModel`` whose user/song ID indexes and
    maps exactly match a ``SparseInteractionBundle``, and a
    ``SongContentFeatureBundle`` that contains every model Song (extra
    content Songs are allowed). Builds the 29/43 training signal exactly
    once (the fixed formula is not duplicated here) and stores it
    read-only. Precomputes one finite read-only ``float32`` L2 norm per
    content row. Inputs are never mutated. Does not rank, score, train,
    publish artifacts, or query external services.
    """
    if not isinstance(collaborative_model, CollaborativeLatentModel):
        raise HybridValidationError(
            "collaborative_model must be a CollaborativeLatentModel"
        )
    if not isinstance(interaction_bundle, SparseInteractionBundle):
        raise HybridValidationError(
            "interaction_bundle must be a SparseInteractionBundle"
        )
    if not isinstance(content_features, SongContentFeatureBundle):
        raise HybridValidationError(
            "content_features must be a SongContentFeatureBundle"
        )

    model = collaborative_model
    bundle = interaction_bundle
    content = content_features

    if model.user_ids != bundle.user_ids:
        raise HybridValidationError("hybrid model alignment mismatch")
    if model.song_ids != bundle.song_ids:
        raise HybridValidationError("hybrid model alignment mismatch")
    if dict(model.user_to_index) != dict(bundle.user_to_index):
        raise HybridValidationError("hybrid model alignment mismatch")
    if dict(model.song_to_index) != dict(bundle.song_to_index):
        raise HybridValidationError("hybrid model alignment mismatch")

    content_song_to_index = content.song_to_index
    if not hasattr(content_song_to_index, "get"):
        raise HybridValidationError(
            "content_features song index must be a mapping"
        )
    for song_id in model.song_ids:
        if song_id not in content_song_to_index:
            raise HybridValidationError("hybrid model alignment mismatch")

    signal = build_collaborative_training_signal(bundle)
    signal.data.setflags(write=False)
    signal.indices.setflags(write=False)
    signal.indptr.setflags(write=False)

    np = _load_numeric_stack()
    norms = _content_row_norms(np, content.matrix)

    return HybridRankerContext(
        collaborative_model=model,
        interaction_bundle=bundle,
        content_features=content,
        training_signal=signal,
        content_row_norms=norms,
    )


def _build_content_profile(context: HybridRankerContext, user_index: int):
    signal = context.training_signal
    content = context.content_features
    bundle = context.interaction_bundle
    content_matrix = content.matrix
    content_song_to_index = content.song_to_index

    profile: dict[int, float] = {}
    start = int(signal.indptr[user_index])
    end = int(signal.indptr[user_index + 1])
    for k in range(start, end):
        weight = float(signal.data[k])
        if weight <= 0.0:
            continue
        song_id = bundle.song_ids[int(signal.indices[k])]
        content_row = content_song_to_index[song_id]
        c_start = int(content_matrix.indptr[content_row])
        c_end = int(content_matrix.indptr[content_row + 1])
        for j in range(c_start, c_end):
            feature_index = int(content_matrix.indices[j])
            value = float(content_matrix.data[j])
            profile[feature_index] = profile.get(feature_index, 0.0) + (
                weight * value
            )

    profile_norm = math.sqrt(sum(value * value for value in profile.values()))
    if not math.isfinite(profile_norm):
        raise HybridValidationError("content profile norm must be finite")
    return profile, profile_norm


def _content_cosine_for_song(
    context: HybridRankerContext,
    profile: dict[int, float],
    profile_norm: float,
    song_id: str,
) -> float | None:
    if profile_norm <= 0.0:
        return None
    content = context.content_features
    content_row = content.song_to_index[song_id]
    row_norm = float(context.content_row_norms[content_row])
    if row_norm <= 0.0:
        return None

    content_matrix = content.matrix
    start = int(content_matrix.indptr[content_row])
    end = int(content_matrix.indptr[content_row + 1])
    dot = 0.0
    for j in range(start, end):
        feature_index = int(content_matrix.indices[j])
        profile_value = profile.get(feature_index)
        if profile_value is None:
            continue
        dot += profile_value * float(content_matrix.data[j])

    cosine = dot / (profile_norm * row_norm)
    if cosine < 0.0:
        cosine = 0.0
    elif cosine > 1.0:
        cosine = 1.0
    if not math.isfinite(cosine):
        raise HybridValidationError("content score must be finite")
    return float(cosine)


def _min_max_normalize(raw_scores: list[float]) -> list[float]:
    if not raw_scores:
        return []
    raw_min = min(raw_scores)
    raw_max = max(raw_scores)
    if raw_max > raw_min:
        span = raw_max - raw_min
        normalized = []
        for raw in raw_scores:
            value = (raw - raw_min) / span
            if value < 0.0:
                value = 0.0
            elif value > 1.0:
                value = 1.0
            normalized.append(float(value))
        return normalized
    return [COLLABORATIVE_EQUAL_SCORE_VALUE] * len(raw_scores)


def rank_hybrid_candidates(
    context: HybridRankerContext,
    user_id: object,
    candidate_song_ids: object,
    *,
    limit: int = DEFAULT_HYBRID_LIMIT,
) -> HybridRankingResult:
    """Rank explicit candidates for one known user with the hybrid formula.

    Validates the prepared context, a canonical known user, and a list or
    tuple of unique canonical candidate Song IDs (≤ ``MAX_HYBRID_CANDIDATES``).
    Filters already-observed Songs before the single collaborative scoring
    call, min-max normalizes raw scores within the unseen candidate set
    (equal scores map to ``COLLABORATIVE_EQUAL_SCORE_VALUE``), builds a
    sparse content profile from positive 29/43 training-signal entries over
    26/43 features, and scores content by sparse cosine. Hybrid score is
    ``0.70·collab_norm + 0.30·content`` when content is available, else
    ``collab_norm`` alone. Sorts by hybrid DESC, collaborative normalized
    DESC, collaborative raw DESC, content DESC (missing content last), then
    Song ID ASC; applies ``limit`` and assigns contiguous 1-based ranks.
    Unknown users raise ``HybridColdStartUserError``; unknown candidate
    Songs raise ``HybridColdStartSongError``. Empty candidates or an
    all-seen candidate list yield a valid empty result with no collaborative
    scoring call. No cold-start fallback, exploration, random tie-break, or
    caller-supplied weights.
    """
    if not isinstance(context, HybridRankerContext):
        raise HybridValidationError("context must be a HybridRankerContext")
    if not hasattr(context, "training_signal") or context.training_signal is None:
        raise HybridValidationError("hybrid context is incomplete")
    if not hasattr(context, "content_row_norms") or context.content_row_norms is None:
        raise HybridValidationError("hybrid context is incomplete")

    resolved_limit = _validate_limit(limit)

    canonical_user = _canonical_id(user_id, "user")
    model = context.collaborative_model
    bundle = context.interaction_bundle
    if canonical_user not in model.user_to_index:
        raise HybridColdStartUserError(
            "cold-start user requires hybrid fallback handling"
        )
    if canonical_user not in bundle.user_to_index:
        raise HybridColdStartUserError(
            "cold-start user requires hybrid fallback handling"
        )

    if isinstance(candidate_song_ids, bool) or not isinstance(
        candidate_song_ids, (list, tuple)
    ):
        raise HybridValidationError(
            "candidate_song_ids must be a list or tuple"
        )
    if len(candidate_song_ids) > MAX_HYBRID_CANDIDATES:
        raise ResourceLimitError(
            f"hybrid_candidate_count exceeds limit {MAX_HYBRID_CANDIDATES}"
        )

    canonical_candidates: list[str] = []
    seen_input: set[str] = set()
    for raw_song in candidate_song_ids:
        song_id = _canonical_id(raw_song, "song")
        if song_id in seen_input:
            raise HybridValidationError("duplicate hybrid candidate song")
        seen_input.add(song_id)
        canonical_candidates.append(song_id)

    input_candidate_count = len(canonical_candidates)

    profile, profile_norm = _build_content_profile(
        context, model.user_to_index[canonical_user]
    )
    profile_feature_count = len(profile)

    if input_candidate_count == 0:
        summary = HybridRankingSummary(
            input_candidate_count=0,
            seen_filtered_count=0,
            eligible_candidate_count=0,
            returned_count=0,
            requested_limit=resolved_limit,
            content_profile_feature_count=profile_feature_count,
            content_available_candidate_count=0,
            collaborative_weight=COLLABORATIVE_WEIGHT,
            content_weight=CONTENT_WEIGHT,
        )
        return HybridRankingResult(items=(), summary=summary)

    observed = bundle.observed
    user_index = bundle.user_to_index[canonical_user]
    row_start = int(observed.indptr[user_index])
    row_end = int(observed.indptr[user_index + 1])
    seen_song_indexes: set[int] = set()
    for k in range(row_start, row_end):
        if float(observed.data[k]) > 0.0:
            seen_song_indexes.add(int(observed.indices[k]))

    unseen_song_ids: list[str] = []
    seen_filtered_count = 0
    for song_id in canonical_candidates:
        song_index = model.song_to_index.get(song_id)
        if song_index is None:
            raise HybridColdStartSongError(
                "cold-start song requires hybrid fallback handling"
            )
        if song_id not in context.content_features.song_to_index:
            raise HybridValidationError("hybrid model alignment mismatch")
        if song_index in seen_song_indexes:
            seen_filtered_count += 1
            continue
        unseen_song_ids.append(song_id)

    eligible_candidate_count = len(unseen_song_ids)

    if eligible_candidate_count == 0:
        summary = HybridRankingSummary(
            input_candidate_count=input_candidate_count,
            seen_filtered_count=seen_filtered_count,
            eligible_candidate_count=0,
            returned_count=0,
            requested_limit=resolved_limit,
            content_profile_feature_count=profile_feature_count,
            content_available_candidate_count=0,
            collaborative_weight=COLLABORATIVE_WEIGHT,
            content_weight=CONTENT_WEIGHT,
        )
        return HybridRankingResult(items=(), summary=summary)

    collaborative_scores = score_collaborative_candidates(
        model, canonical_user, unseen_song_ids
    )
    if len(collaborative_scores) != eligible_candidate_count:
        raise HybridValidationError(
            "collaborative scorer returned an unexpected score count"
        )

    raw_by_song: dict[str, float] = {}
    raw_order: list[str] = []
    for entry in collaborative_scores:
        raw_by_song[entry.song_id] = float(entry.score)
        raw_order.append(entry.song_id)

    normalized_list = _min_max_normalize(
        [raw_by_song[song_id] for song_id in raw_order]
    )
    normalized_by_song: dict[str, float] = {}
    for song_id, normalized in zip(raw_order, normalized_list):
        normalized_by_song[song_id] = normalized

    content_available_count = 0
    scored_rows: list[dict] = []
    for song_id in unseen_song_ids:
        content_score = _content_cosine_for_song(
            context, profile, profile_norm, song_id
        )
        if content_score is not None:
            content_available_count += 1
            hybrid_score = (
                COLLABORATIVE_WEIGHT * normalized_by_song[song_id]
                + CONTENT_WEIGHT * content_score
            )
            content_available = True
        else:
            hybrid_score = normalized_by_song[song_id]
            content_available = False
        if not math.isfinite(hybrid_score):
            raise HybridValidationError("hybrid score must be finite")
        if hybrid_score < 0.0:
            hybrid_score = 0.0
        elif hybrid_score > 1.0:
            hybrid_score = 1.0
        scored_rows.append(
            {
                "song_id": song_id,
                "hybrid_score": float(hybrid_score),
                "collaborative_raw_score": raw_by_song[song_id],
                "collaborative_normalized_score": normalized_by_song[song_id],
                "content_score": content_score,
                "content_available": content_available,
            }
        )

    def _sort_key(row: dict):
        content_score = row["content_score"]
        content_key = (
            float("inf") if content_score is None else -float(content_score)
        )
        return (
            -row["hybrid_score"],
            -row["collaborative_normalized_score"],
            -row["collaborative_raw_score"],
            content_key,
            row["song_id"],
        )

    scored_rows.sort(key=_sort_key)
    applied = scored_rows[:resolved_limit]

    items: list[HybridRankedItem] = []
    for rank, row in enumerate(applied, start=1):
        items.append(
            HybridRankedItem(
                rank=rank,
                song_id=row["song_id"],
                hybrid_score=row["hybrid_score"],
                collaborative_raw_score=row["collaborative_raw_score"],
                collaborative_normalized_score=row[
                    "collaborative_normalized_score"
                ],
                content_score=row["content_score"],
                content_available=row["content_available"],
            )
        )

    summary = HybridRankingSummary(
        input_candidate_count=input_candidate_count,
        seen_filtered_count=seen_filtered_count,
        eligible_candidate_count=eligible_candidate_count,
        returned_count=len(items),
        requested_limit=resolved_limit,
        content_profile_feature_count=profile_feature_count,
        content_available_candidate_count=content_available_count,
        collaborative_weight=COLLABORATIVE_WEIGHT,
        content_weight=CONTENT_WEIGHT,
    )
    return HybridRankingResult(items=tuple(items), summary=summary)
