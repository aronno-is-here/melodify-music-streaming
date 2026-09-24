"""Deterministic pure ranking-evaluation metrics for Melodify recommenders.

Measures caller-supplied ranked recommendations against held-out relevant
Song IDs and an evaluation catalog. Supports Precision@5/10, Recall@5/10,
NDCG@5/10, MAP@10, Hit Rate@10, Catalog Coverage, and intra-list Diversity
over 26/43 sparse content features. Macro-averages user relevance metrics
over users with at least one relevant Song.

This module does not train models, generate recommendations, implement
SVD or ranking, query MongoDB, write artifacts, expose HTTP, mutate
inputs, or infer relevance from playback event types. Ground truth is
caller-provided only. Diversity uses sparse row access only — no dense
Song×Song matrix.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

from .content_features import SongContentFeatureBundle
from .runtime import (
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    RecommenderRuntimeError,
    ResourceLimitError,
    configure_cpu_runtime,
)

PRECISION_RECALL_KS = (5, 10)
NDCG_KS = (5, 10)
MAP_K = 10
HIT_RATE_K = 10
COVERAGE_K = 10
DIVERSITY_K = 10
MAX_RECOMMENDATIONS_PER_USER = 100

_HEX_CHARS = frozenset("0123456789abcdef")

_np = None
_sp = None


class EvaluationError(RecommenderRuntimeError):
    """Base evaluation failure."""


class EvaluationValidationError(EvaluationError):
    """Evaluation input failed deterministic validation."""


@dataclass(frozen=True)
class RecommenderEvaluationSummary:
    """Factual counts describing one evaluation run."""

    evaluated_user_count: int
    recommendation_user_count: int
    relevance_user_count: int
    catalog_size: int
    unique_recommended_at_10: int
    diversity_evaluable_user_count: int
    diversity_pair_count: int


@dataclass(frozen=True)
class RecommenderEvaluationResult:
    """Immutable metric outputs plus factual summary."""

    precision_at_5: float
    precision_at_10: float
    recall_at_5: float
    recall_at_10: float
    ndcg_at_5: float
    ndcg_at_10: float
    map_at_10: float
    hit_rate_at_10: float
    catalog_coverage: float
    diversity: float
    summary: RecommenderEvaluationSummary


def _load_numeric_stack():
    global _np, _sp
    if _np is None or _sp is None:
        configure_cpu_runtime()
        import numpy as numpy_module
        import scipy.sparse as scipy_sparse_module

        _np = numpy_module
        _sp = scipy_sparse_module
    return _np, _sp


def _canonical_id(value: object, kind: str) -> str:
    if isinstance(value, bool) or not isinstance(value, str):
        raise EvaluationValidationError(f"invalid evaluation {kind} id")
    text = value.strip().lower()
    if len(text) != 24 or any(ch not in _HEX_CHARS for ch in text):
        raise EvaluationValidationError(f"invalid evaluation {kind} id")
    return text


def _canonical_user_id(value: object) -> str:
    return _canonical_id(value, "user")


def _canonical_song_id(value: object) -> str:
    return _canonical_id(value, "song")


def _require_mapping(value: object, field: str) -> Mapping:
    if not isinstance(value, Mapping):
        raise EvaluationValidationError(f"{field} must be a mapping")
    return value


def _parse_recommendations(recommendations_by_user: object) -> dict[str, tuple[str, ...]]:
    mapping = _require_mapping(recommendations_by_user, "recommendations_by_user")
    parsed: dict[str, tuple[str, ...]] = {}
    for raw_user, raw_list in mapping.items():
        user_id = _canonical_user_id(raw_user)
        if user_id in parsed:
            raise EvaluationValidationError("duplicate evaluation user id")
        if not isinstance(raw_list, (list, tuple)):
            raise EvaluationValidationError(
                "recommendations must be a list or tuple"
            )
        if len(raw_list) > MAX_RECOMMENDATIONS_PER_USER:
            raise ResourceLimitError(
                f"recommendations exceed limit {MAX_RECOMMENDATIONS_PER_USER}"
            )
        ranked: list[str] = []
        seen: set[str] = set()
        for raw_song in raw_list:
            song_id = _canonical_song_id(raw_song)
            if song_id in seen:
                raise EvaluationValidationError("duplicate recommendation song")
            seen.add(song_id)
            ranked.append(song_id)
        parsed[user_id] = tuple(ranked)
    return parsed


def _parse_relevance(relevant_by_user: object) -> dict[str, frozenset[str]]:
    mapping = _require_mapping(relevant_by_user, "relevant_by_user")
    parsed: dict[str, frozenset[str]] = {}
    for raw_user, raw_relevant in mapping.items():
        user_id = _canonical_user_id(raw_user)
        if user_id in parsed:
            raise EvaluationValidationError("duplicate evaluation user id")
        if not isinstance(raw_relevant, (list, tuple, set, frozenset)):
            raise EvaluationValidationError(
                "relevance must be a list, tuple, set, or frozenset"
            )
        songs: list[str] = []
        for raw_song in raw_relevant:
            songs.append(_canonical_song_id(raw_song))
        if isinstance(raw_relevant, (list, tuple)) and len(songs) != len(set(songs)):
            raise EvaluationValidationError("duplicate relevance song")
        parsed[user_id] = frozenset(songs)
    return parsed


def _parse_catalog(catalog_song_ids: object) -> frozenset[str]:
    if not isinstance(catalog_song_ids, (list, tuple, set, frozenset)):
        raise EvaluationValidationError(
            "catalog_song_ids must be a list, tuple, set, or frozenset"
        )
    songs: list[str] = []
    for raw_song in catalog_song_ids:
        songs.append(_canonical_song_id(raw_song))
    if isinstance(catalog_song_ids, (list, tuple)) and len(songs) != len(set(songs)):
        raise EvaluationValidationError("duplicate catalog song")
    if len(songs) > MAX_UNIQUE_SONGS:
        raise ResourceLimitError(f"unique_song_count exceeds limit {MAX_UNIQUE_SONGS}")
    return frozenset(songs)


def _validate_user_bound(
    recommendations: Mapping[str, tuple[str, ...]],
    relevance: Mapping[str, frozenset[str]],
) -> None:
    user_ids = set(recommendations) | set(relevance)
    if len(user_ids) > MAX_UNIQUE_USERS:
        raise ResourceLimitError(
            f"unique_user_count exceeds limit {MAX_UNIQUE_USERS}"
        )


def _evaluable_users(relevance: Mapping[str, frozenset[str]]) -> list[str]:
    return sorted(user for user, songs in relevance.items() if songs)


def _validate_catalog_membership(
    catalog: frozenset[str],
    relevance: Mapping[str, frozenset[str]],
    recommendations: Mapping[str, tuple[str, ...]],
    evaluable: Sequence[str],
) -> None:
    for user in evaluable:
        for song in relevance[user]:
            if song not in catalog:
                raise EvaluationValidationError(
                    "relevant song is outside evaluation catalog"
                )
        for song in recommendations.get(user, ()):
            if song not in catalog:
                raise EvaluationValidationError(
                    "recommended song is outside evaluation catalog"
                )


def _validate_content_bundle(
    content_features: object, catalog: frozenset[str]
) -> SongContentFeatureBundle:
    if not isinstance(content_features, SongContentFeatureBundle):
        raise EvaluationValidationError("invalid content feature bundle")
    matrix = content_features.matrix
    if matrix is None or getattr(matrix, "shape", None) is None:
        raise EvaluationValidationError("content feature catalog is misaligned")
    if matrix.shape[0] != len(content_features.song_ids):
        raise EvaluationValidationError("content feature catalog is misaligned")
    song_to_index = content_features.song_to_index
    if len(song_to_index) != len(content_features.song_ids):
        raise EvaluationValidationError("content feature catalog is misaligned")
    for song_id in content_features.song_ids:
        if song_id not in song_to_index:
            raise EvaluationValidationError("content feature catalog is misaligned")
        if song_to_index[song_id] is None:
            raise EvaluationValidationError("content feature catalog is misaligned")
    for song_id in catalog:
        if song_id not in song_to_index:
            raise EvaluationValidationError("content feature catalog is misaligned")
    return content_features


def precision_at_k(recommended: Sequence[str], relevant: frozenset[str], k: int) -> float:
    """Precision@K with denominator always K (missing ranks count as misses)."""
    if k <= 0:
        raise EvaluationValidationError("precision cutoff must be positive")
    hits = sum(1 for song in recommended[:k] if song in relevant)
    return hits / k


def recall_at_k(recommended: Sequence[str], relevant: frozenset[str], k: int) -> float:
    """Recall@K over the non-empty held-out relevant set."""
    if k <= 0:
        raise EvaluationValidationError("recall cutoff must be positive")
    if not relevant:
        raise EvaluationValidationError("recall requires a non-empty relevant set")
    hits = sum(1 for song in recommended[:k] if song in relevant)
    return hits / len(relevant)


def ndcg_at_k(recommended: Sequence[str], relevant: frozenset[str], k: int) -> float:
    """Binary-relevance NDCG@K with log2 rank discounting."""
    if k <= 0:
        raise EvaluationValidationError("ndcg cutoff must be positive")
    if not relevant:
        raise EvaluationValidationError("ndcg requires a non-empty relevant set")
    dcg = 0.0
    for rank, song in enumerate(recommended[:k], start=1):
        if song in relevant:
            dcg += 1.0 / math.log2(rank + 1)
    ideal_count = min(k, len(relevant))
    idcg = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_count + 1))
    if idcg <= 0.0:
        return 0.0
    return dcg / idcg


def average_precision_at_k(
    recommended: Sequence[str], relevant: frozenset[str], k: int
) -> float:
    """AP@K with denominator min(|relevant|, K)."""
    if k <= 0:
        raise EvaluationValidationError("average precision cutoff must be positive")
    if not relevant:
        raise EvaluationValidationError(
            "average precision requires a non-empty relevant set"
        )
    hits = 0
    precision_sum = 0.0
    for rank, song in enumerate(recommended[:k], start=1):
        if song in relevant:
            hits += 1
            precision_sum += hits / rank
    denominator = min(len(relevant), k)
    if denominator <= 0:
        return 0.0
    return precision_sum / denominator


def hit_at_k(recommended: Sequence[str], relevant: frozenset[str], k: int) -> float:
    """Hit@K: 1.0 when at least one relevant Song appears in top K, else 0.0."""
    if k <= 0:
        raise EvaluationValidationError("hit cutoff must be positive")
    for song in recommended[:k]:
        if song in relevant:
            return 1.0
    return 0.0


def catalog_coverage_at_k(
    recommendations: Mapping[str, Sequence[str]],
    evaluable_users: Sequence[str],
    catalog: frozenset[str],
    k: int,
) -> float:
    """Unique top-K recommended Songs across evaluable users / catalog size."""
    if k <= 0:
        raise EvaluationValidationError("coverage cutoff must be positive")
    if not catalog:
        return 0.0
    unique: set[str] = set()
    for user in evaluable_users:
        for song in recommendations.get(user, ())[:k]:
            unique.add(song)
    return len(unique) / len(catalog)


def _row_norm(matrix, index: int) -> float:
    row = matrix.getrow(index)
    return math.sqrt(float(row.multiply(row).sum()))


def _row_dot(matrix, index_a: int, index_b: int) -> float:
    row_a = matrix.getrow(index_a)
    row_b = matrix.getrow(index_b)
    return float(row_a.multiply(row_b).sum())


def intra_list_diversity_at_k(
    recommended: Sequence[str],
    content_features: SongContentFeatureBundle,
    k: int,
    norm_cache: dict[str, float | None],
) -> tuple[float | None, int]:
    """Mean pairwise cosine dissimilarity over scorable top-K pairs.

    Returns ``(user_diversity_or_None, scorable_pair_count)``. Zero-feature
    pairs are excluded from the denominator.
    """
    if k <= 0:
        raise EvaluationValidationError("diversity cutoff must be positive")
    songs = list(recommended[:k])
    if len(songs) < 2:
        return None, 0
    matrix = content_features.matrix
    song_to_index = content_features.song_to_index
    norms: list[float | None] = []
    for song in songs:
        if song not in norm_cache:
            if song not in song_to_index:
                norm_cache[song] = None
            else:
                norm = _row_norm(matrix, song_to_index[song])
                norm_cache[song] = norm if norm > 0.0 else None
        norms.append(norm_cache[song])
    dissimilarity_sum = 0.0
    pair_count = 0
    for i in range(len(songs)):
        for j in range(i + 1, len(songs)):
            norm_a = norms[i]
            norm_b = norms[j]
            if norm_a is None or norm_b is None:
                continue
            cosine = _row_dot(matrix, song_to_index[songs[i]], song_to_index[songs[j]])
            cosine = cosine / (norm_a * norm_b)
            if cosine < 0.0:
                cosine = 0.0
            elif cosine > 1.0:
                cosine = 1.0
            dissimilarity_sum += 1.0 - cosine
            pair_count += 1
    if pair_count == 0:
        return None, 0
    return dissimilarity_sum / pair_count, pair_count


def _mean(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def evaluate_recommendations(
    recommendations_by_user: object,
    relevant_by_user: object,
    catalog_song_ids: object,
    content_features: object,
) -> RecommenderEvaluationResult:
    """Compute fixed-cutoff ranking metrics over caller-supplied inputs.

    Recommendations must already be ranked by the caller. Relevance is
    caller-provided held-out ground truth. All user-averaged metrics are
    macro-averages over evaluable users (non-empty relevance). Missing
    recommendations for an evaluable user count as an empty ranked list.
    """
    recommendations = _parse_recommendations(recommendations_by_user)
    relevance = _parse_relevance(relevant_by_user)
    catalog = _parse_catalog(catalog_song_ids)
    _validate_user_bound(recommendations, relevance)
    evaluable = _evaluable_users(relevance)
    if not catalog and evaluable:
        raise EvaluationValidationError(
            "relevance exists against empty evaluation catalog"
        )
    _validate_catalog_membership(catalog, relevance, recommendations, evaluable)
    bundle = _validate_content_bundle(content_features, catalog)

    if not evaluable:
        empty_summary = RecommenderEvaluationSummary(
            evaluated_user_count=0,
            recommendation_user_count=len(recommendations),
            relevance_user_count=len(relevance),
            catalog_size=len(catalog),
            unique_recommended_at_10=0,
            diversity_evaluable_user_count=0,
            diversity_pair_count=0,
        )
        return RecommenderEvaluationResult(
            precision_at_5=0.0,
            precision_at_10=0.0,
            recall_at_5=0.0,
            recall_at_10=0.0,
            ndcg_at_5=0.0,
            ndcg_at_10=0.0,
            map_at_10=0.0,
            hit_rate_at_10=0.0,
            catalog_coverage=0.0,
            diversity=0.0,
            summary=empty_summary,
        )

    precision_5_values: list[float] = []
    precision_10_values: list[float] = []
    recall_5_values: list[float] = []
    recall_10_values: list[float] = []
    ndcg_5_values: list[float] = []
    ndcg_10_values: list[float] = []
    ap_10_values: list[float] = []
    hit_10_values: list[float] = []
    diversity_values: list[float] = []
    unique_top10: set[str] = set()
    diversity_pair_count = 0

    norm_cache: dict[str, float | None] = {}
    for user in evaluable:
        ranked = recommendations.get(user, ())
        relevant = relevance[user]
        precision_5_values.append(precision_at_k(ranked, relevant, 5))
        precision_10_values.append(precision_at_k(ranked, relevant, 10))
        recall_5_values.append(recall_at_k(ranked, relevant, 5))
        recall_10_values.append(recall_at_k(ranked, relevant, 10))
        ndcg_5_values.append(ndcg_at_k(ranked, relevant, 5))
        ndcg_10_values.append(ndcg_at_k(ranked, relevant, 10))
        ap_10_values.append(average_precision_at_k(ranked, relevant, MAP_K))
        hit_10_values.append(hit_at_k(ranked, relevant, HIT_RATE_K))
        for song in ranked[:COVERAGE_K]:
            unique_top10.add(song)
        user_diversity, pair_count = intra_list_diversity_at_k(
            ranked, bundle, DIVERSITY_K, norm_cache
        )
        if user_diversity is not None:
            diversity_values.append(user_diversity)
            diversity_pair_count += pair_count

    coverage = (
        len(unique_top10) / len(catalog) if catalog else 0.0
    )
    diversity = _mean(diversity_values)

    summary = RecommenderEvaluationSummary(
        evaluated_user_count=len(evaluable),
        recommendation_user_count=len(recommendations),
        relevance_user_count=len(relevance),
        catalog_size=len(catalog),
        unique_recommended_at_10=len(unique_top10),
        diversity_evaluable_user_count=len(diversity_values),
        diversity_pair_count=diversity_pair_count,
    )
    return RecommenderEvaluationResult(
        precision_at_5=_mean(precision_5_values),
        precision_at_10=_mean(precision_10_values),
        recall_at_5=_mean(recall_5_values),
        recall_at_10=_mean(recall_10_values),
        ndcg_at_5=_mean(ndcg_5_values),
        ndcg_at_10=_mean(ndcg_10_values),
        map_at_10=_mean(ap_10_values),
        hit_rate_at_10=_mean(hit_10_values),
        catalog_coverage=coverage,
        diversity=diversity,
        summary=summary,
    )
