"""Deterministic cold-start preference and exploration policy for Melodify.

Policy layer above the 30/43 hybrid ranker: accepts known users, unknown
(cold-start) users, collaborative-unseen Songs, and a bounded plain-data
explicit preference profile (Favorite Song IDs, playlist membership counts,
direct artist/genre aggregates). Combines hybrid exploitation with sparse
profile cosine using a fixed initial 80/20 baseline — not learned, not
optimized, and not a quality claim — and interleaves deterministic SHA-256
exploration at an auditable every-fifth-rank cadence.

This module does not import JavaScript/Node services, query MongoDB,
duplicate 17/18 database loads, retrain models, persist recommendations,
write recommendation files or artifacts, run evaluation, expose HTTP, or
modify front-end/back-end code. Importing this module does not configure the process
environment or load NumPy/SciPy; the policy path is pure Python over
caller-supplied sparse structures.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from .content_features import (
    MAX_CONTENT_VALUE_LENGTH,
    ContentFeatureValidationError,
    normalize_content_value,
)
from .hybrid_ranker import (
    MAX_HYBRID_LIMIT,
    HybridRankerContext,
    rank_hybrid_candidates,
)
from .runtime import (
    MAX_UNIQUE_SONGS,
    RecommenderRuntimeError,
    ResourceLimitError,
)

BASE_HYBRID_POLICY_WEIGHT = 0.80
EXPLICIT_PROFILE_POLICY_WEIGHT = 0.20
DEFAULT_POLICY_LIMIT = 20
MAX_POLICY_LIMIT = 100
EXPLORATION_INTERVAL = 5
EXPLORATION_HASH_NAMESPACE = "melodify-exploration-v1"

MAX_PROFILE_FAVORITE_SONGS = 1000
MAX_PROFILE_PLAYLIST_SONGS = 5000
MAX_PROFILE_ARTIST_ENTRIES = 5000
MAX_PROFILE_GENRE_ENTRIES = 5000
MAX_PLAYLIST_MEMBERSHIP_COUNT = 250
MAX_PROFILE_FACTUAL_COUNT = 1_000_000

PROFILE_KEY_FAVORITES = "favorite_song_ids"
PROFILE_KEY_PLAYLIST = "playlist_song_counts"
PROFILE_KEY_ARTIST = "artist_counts"
PROFILE_KEY_GENRE = "genre_counts"
_PROFILE_ALLOWED_KEYS = frozenset(
    {
        PROFILE_KEY_FAVORITES,
        PROFILE_KEY_PLAYLIST,
        PROFILE_KEY_ARTIST,
        PROFILE_KEY_GENRE,
    }
)

BASIS_HYBRID = "hybrid"
BASIS_HYBRID_PROFILE = "hybrid-profile"
BASIS_PROFILE = "profile"
BASIS_EXPLORATION = "exploration"

_HEX_CHARS = frozenset("0123456789abcdef")


class ColdStartPolicyError(RecommenderRuntimeError):
    """Base cold-start policy failure."""


class ColdStartValidationError(ColdStartPolicyError):
    """Input failed deterministic validation."""


@dataclass(frozen=True)
class ExplicitPreferenceProfile:
    """Immutable normalized explicit preference evidence for one user."""

    favorite_song_ids: tuple[str, ...]
    playlist_song_counts: Mapping[str, int]
    artist_counts: Mapping[str, int]
    genre_counts: Mapping[str, int]


@dataclass(frozen=True)
class ColdStartRankedItem:
    """One deterministically ranked candidate Song under the policy."""

    rank: int
    song_id: str
    basis: str
    policy_score: float | None
    hybrid_score: float | None
    profile_score: float | None
    collaborative_known: bool


@dataclass(frozen=True)
class ColdStartRankingSummary:
    """Factual counts and fixed flags for one cold-start ranking call."""

    input_candidate_count: int
    profile_source_excluded_count: int
    seen_excluded_count: int
    eligible_candidate_count: int
    collaborative_known_candidate_count: int
    cold_start_song_candidate_count: int
    profile_feature_count: int
    exploitation_selected_count: int
    exploration_selected_count: int
    returned_count: int
    requested_limit: int
    collaborative_known_user: bool
    profile_available: bool


@dataclass(frozen=True)
class ColdStartRankingResult:
    """Immutable ranked items plus factual summary."""

    items: tuple[ColdStartRankedItem, ...]
    summary: ColdStartRankingSummary


@dataclass(frozen=True)
class _ScoredCandidate:
    song_id: str
    hybrid_score: float | None
    profile_score: float | None
    policy_score: float | None
    exploit_basis: str | None
    collaborative_known: bool
    exploration_key: bytes


def _empty_profile() -> ExplicitPreferenceProfile:
    return ExplicitPreferenceProfile(
        favorite_song_ids=(),
        playlist_song_counts=MappingProxyType({}),
        artist_counts=MappingProxyType({}),
        genre_counts=MappingProxyType({}),
    )


def _canonical_song_id(value: object) -> str:
    if isinstance(value, bool) or not isinstance(value, str):
        raise ColdStartValidationError("invalid profile favorite song id")
    text = value.strip().lower()
    if len(text) != 24 or any(ch not in _HEX_CHARS for ch in text):
        raise ColdStartValidationError("invalid profile favorite song id")
    return text


def _factual_count(value: object, upper: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ColdStartValidationError("invalid profile factual count")
    if value < 1 or value > upper:
        raise ColdStartValidationError("invalid profile factual count")
    return value


def _require_mapping(value: object) -> Mapping:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise ColdStartValidationError("invalid explicit preference profile")
    return value


def _normalized_family_counts(
    raw: object, family: str, max_entries: int
) -> dict[str, int]:
    mapping = _require_mapping(raw)
    if len(mapping) > max_entries:
        raise ResourceLimitError(
            f"preference_{family}_entries exceeds limit {max_entries}"
        )
    normalized: dict[str, int] = {}
    for raw_key, raw_value in mapping.items():
        if not isinstance(raw_key, str):
            raise ColdStartValidationError("invalid explicit preference profile")
        try:
            text = normalize_content_value(raw_key)
        except ContentFeatureValidationError as exc:
            raise ColdStartValidationError(
                "invalid explicit preference profile"
            ) from exc
        if not text or len(text) > MAX_CONTENT_VALUE_LENGTH:
            raise ColdStartValidationError("invalid explicit preference profile")
        if text in normalized:
            raise ColdStartValidationError(
                f"duplicate {family} preference key"
            )
        normalized[text] = _factual_count(raw_value, MAX_PROFILE_FACTUAL_COUNT)
    return normalized


def normalize_explicit_preference_profile(
    profile: object,
) -> ExplicitPreferenceProfile:
    """Validate and freeze one bounded plain-data preference profile.

    ``None`` becomes a valid empty profile. Otherwise only the four allowed
    keys are accepted; unknown keys reject. Favorite Song IDs must be a
    list or tuple of unique canonical 24-hex strings within the favorite
    cap. Playlist Song counts and direct artist/genre aggregates must be
    mappings of positive factual counts within their caps (``bool``
    rejected). Text keys are normalized with 26/43
    ``normalize_content_value``; keys that collapse to the same normalized
    value reject (no silent merge). Count-cap overflow raises
    ``ResourceLimitError``; shape/type failures raise
    ``ColdStartValidationError`` with bounded messages. Output fields are
    immutable (tuple + ``MappingProxyType``). No silent truncation.
    """
    if profile is None:
        return _empty_profile()
    if isinstance(profile, ExplicitPreferenceProfile):
        return profile
    if not isinstance(profile, Mapping):
        raise ColdStartValidationError("invalid explicit preference profile")

    for key in profile:
        if key not in _PROFILE_ALLOWED_KEYS:
            raise ColdStartValidationError("invalid explicit preference profile")

    raw_favorites = profile.get(PROFILE_KEY_FAVORITES)
    if raw_favorites is None:
        raw_favorites = ()
    if isinstance(raw_favorites, (set, frozenset)) or not isinstance(
        raw_favorites, (list, tuple)
    ):
        raise ColdStartValidationError("invalid explicit preference profile")
    if len(raw_favorites) > MAX_PROFILE_FAVORITE_SONGS:
        raise ResourceLimitError(
            f"preference_favorite_songs exceeds limit {MAX_PROFILE_FAVORITE_SONGS}"
        )
    favorite_song_ids: list[str] = []
    seen_favorites: set[str] = set()
    for raw_song in raw_favorites:
        song_id = _canonical_song_id(raw_song)
        if song_id in seen_favorites:
            raise ColdStartValidationError("duplicate favorite song")
        seen_favorites.add(song_id)
        favorite_song_ids.append(song_id)

    raw_playlist = _require_mapping(profile.get(PROFILE_KEY_PLAYLIST))
    if len(raw_playlist) > MAX_PROFILE_PLAYLIST_SONGS:
        raise ResourceLimitError(
            f"preference_playlist_songs exceeds limit {MAX_PROFILE_PLAYLIST_SONGS}"
        )
    playlist_song_counts: dict[str, int] = {}
    for raw_key, raw_value in raw_playlist.items():
        song_id = _canonical_song_id(raw_key)
        if song_id in playlist_song_counts:
            raise ColdStartValidationError("duplicate playlist preference song")
        playlist_song_counts[song_id] = _factual_count(
            raw_value, MAX_PLAYLIST_MEMBERSHIP_COUNT
        )

    artist_counts = _normalized_family_counts(
        profile.get(PROFILE_KEY_ARTIST),
        "artist",
        MAX_PROFILE_ARTIST_ENTRIES,
    )
    genre_counts = _normalized_family_counts(
        profile.get(PROFILE_KEY_GENRE),
        "genre",
        MAX_PROFILE_GENRE_ENTRIES,
    )

    return ExplicitPreferenceProfile(
        favorite_song_ids=tuple(favorite_song_ids),
        playlist_song_counts=MappingProxyType(dict(playlist_song_counts)),
        artist_counts=MappingProxyType(dict(artist_counts)),
        genre_counts=MappingProxyType(dict(genre_counts)),
    )


def _validate_limit(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ColdStartValidationError("limit must be an integer")
    if value < 1 or value > MAX_POLICY_LIMIT:
        raise ColdStartValidationError(
            f"limit must be between 1 and {MAX_POLICY_LIMIT}"
        )
    return value


def _canonical_user_id(value: object) -> str:
    if isinstance(value, bool) or not isinstance(value, str):
        raise ColdStartValidationError("invalid policy user id")
    text = value.strip().lower()
    if len(text) != 24 or any(ch not in _HEX_CHARS for ch in text):
        raise ColdStartValidationError("invalid policy user id")
    return text


def _canonical_candidates(candidate_song_ids: object) -> list[str]:
    if isinstance(candidate_song_ids, bool) or not isinstance(
        candidate_song_ids, (list, tuple)
    ):
        raise ColdStartValidationError(
            "candidate_song_ids must be a list or tuple"
        )
    if len(candidate_song_ids) > MAX_UNIQUE_SONGS:
        raise ResourceLimitError(
            f"hybrid_candidate_count exceeds limit {MAX_UNIQUE_SONGS}"
        )
    canonical: list[str] = []
    seen: set[str] = set()
    for raw_song in candidate_song_ids:
        if isinstance(raw_song, bool) or not isinstance(raw_song, str):
            raise ColdStartValidationError("invalid policy song id")
        text = raw_song.strip().lower()
        if len(text) != 24 or any(ch not in _HEX_CHARS for ch in text):
            raise ColdStartValidationError("invalid policy song id")
        if text in seen:
            raise ColdStartValidationError("duplicate policy candidate song")
        seen.add(text)
        canonical.append(text)
    return canonical


def _exploration_key(user_id: str, song_id: str) -> bytes:
    payload = f"{EXPLORATION_HASH_NAMESPACE}|{user_id}|{song_id}".encode("utf-8")
    return hashlib.sha256(payload).digest()


def _seen_song_indexes(context: HybridRankerContext, user_index: int) -> set[int]:
    observed = context.interaction_bundle.observed
    start = int(observed.indptr[user_index])
    end = int(observed.indptr[user_index + 1])
    indexes: set[int] = set()
    for k in range(start, end):
        if float(observed.data[k]) > 0.0:
            indexes.add(int(observed.indices[k]))
    return indexes


def _build_profile_vector(
    context: HybridRankerContext, profile: ExplicitPreferenceProfile
) -> tuple[dict[int, float], float]:
    content = context.content_features
    matrix = content.matrix
    feature_names = content.feature_names
    feature_to_index = content.feature_to_index
    song_to_index = content.song_to_index

    units_by_song: dict[str, int] = {}
    for song_id in profile.favorite_song_ids:
        units_by_song[song_id] = units_by_song.get(song_id, 0) + 1
    for song_id, count in profile.playlist_song_counts.items():
        units_by_song[song_id] = units_by_song.get(song_id, 0) + count

    artist_from_songs = len(profile.artist_counts) == 0
    genre_from_songs = len(profile.genre_counts) == 0

    profile_vec: dict[int, float] = {}
    for song_id in sorted(units_by_song):
        units = units_by_song[song_id]
        row = song_to_index.get(song_id)
        if row is None:
            continue
        start = int(matrix.indptr[row])
        end = int(matrix.indptr[row + 1])
        for j in range(start, end):
            feature_index = int(matrix.indices[j])
            feature_name = feature_names[feature_index]
            family = feature_name.split("::", 1)[0]
            if family == "artist" and not artist_from_songs:
                continue
            if family == "genre" and not genre_from_songs:
                continue
            value = float(matrix.data[j])
            profile_vec[feature_index] = profile_vec.get(
                feature_index, 0.0
            ) + (units * value)

    for text, count in sorted(profile.artist_counts.items()):
        feature_index = feature_to_index.get(f"artist::{text}")
        if feature_index is None:
            continue
        profile_vec[feature_index] = profile_vec.get(feature_index, 0.0) + float(
            count
        )
    for text, count in sorted(profile.genre_counts.items()):
        feature_index = feature_to_index.get(f"genre::{text}")
        if feature_index is None:
            continue
        profile_vec[feature_index] = profile_vec.get(feature_index, 0.0) + float(
            count
        )

    profile_norm = math.sqrt(sum(value * value for value in profile_vec.values()))
    if not math.isfinite(profile_norm):
        raise ColdStartValidationError("profile norm must be finite")
    return profile_vec, profile_norm


def _profile_cosine(
    context: HybridRankerContext,
    profile_vec: Mapping[int, float],
    profile_norm: float,
    song_id: str,
) -> float | None:
    if profile_norm <= 0.0:
        return None
    content = context.content_features
    row = content.song_to_index[song_id]
    row_norm = float(context.content_row_norms[row])
    if row_norm <= 0.0:
        return None
    matrix = content.matrix
    start = int(matrix.indptr[row])
    end = int(matrix.indptr[row + 1])
    dot = 0.0
    for j in range(start, end):
        feature_index = int(matrix.indices[j])
        profile_value = profile_vec.get(feature_index)
        if profile_value is None:
            continue
        dot += profile_value * float(matrix.data[j])
    cosine = dot / (profile_norm * row_norm)
    if cosine < 0.0:
        cosine = 0.0
    elif cosine > 1.0:
        cosine = 1.0
    if not math.isfinite(cosine):
        raise ColdStartValidationError("profile score must be finite")
    return float(cosine)


def _policy_components(
    hybrid_score: float | None, profile_score: float | None
) -> tuple[float | None, str | None]:
    if hybrid_score is not None and profile_score is not None:
        policy = (
            BASE_HYBRID_POLICY_WEIGHT * hybrid_score
            + EXPLICIT_PROFILE_POLICY_WEIGHT * profile_score
        )
        if not math.isfinite(policy):
            raise ColdStartValidationError("policy score must be finite")
        if policy < 0.0:
            policy = 0.0
        elif policy > 1.0:
            policy = 1.0
        return float(policy), BASIS_HYBRID_PROFILE
    if hybrid_score is not None:
        return float(hybrid_score), BASIS_HYBRID
    if profile_score is not None:
        return float(profile_score), BASIS_PROFILE
    return None, None


def _exploit_sort_key(candidate: _ScoredCandidate):
    policy = candidate.policy_score
    if policy is None:
        policy_key = float("inf")
    else:
        policy_key = -float(policy)
    hybrid = candidate.hybrid_score
    hybrid_key = float("inf") if hybrid is None else -float(hybrid)
    profile = candidate.profile_score
    profile_key = float("inf") if profile is None else -float(profile)
    return (policy_key, hybrid_key, profile_key, candidate.song_id)


def _interleave(
    exploitation_pool: list[_ScoredCandidate],
    exploration_pool: list[_ScoredCandidate],
    limit: int,
    eligible_count: int,
) -> list[tuple[_ScoredCandidate, str]]:
    selected: list[tuple[_ScoredCandidate, str]] = []
    used: set[str] = set()
    exploit_index = 0
    explore_index = 0
    exploit_len = len(exploitation_pool)
    explore_len = len(exploration_pool)

    def next_exploitation() -> _ScoredCandidate | None:
        nonlocal exploit_index
        while exploit_index < exploit_len:
            candidate = exploitation_pool[exploit_index]
            exploit_index += 1
            if candidate.song_id not in used:
                return candidate
        return None

    def next_exploration() -> _ScoredCandidate | None:
        nonlocal explore_index
        while explore_index < explore_len:
            candidate = exploration_pool[explore_index]
            explore_index += 1
            if candidate.song_id not in used:
                return candidate
        return None

    target = min(limit, eligible_count)
    for position in range(1, target + 1):
        if len(selected) >= target:
            break
        want_explore = position % EXPLORATION_INTERVAL == 0
        candidate: _ScoredCandidate | None
        basis: str
        if want_explore:
            candidate = next_exploration()
            if candidate is not None:
                basis = BASIS_EXPLORATION
            else:
                candidate = next_exploitation()
                if candidate is None:
                    break
                basis = candidate.exploit_basis or BASIS_EXPLORATION
        else:
            candidate = next_exploitation()
            if candidate is not None:
                basis = candidate.exploit_basis or BASIS_EXPLORATION
            else:
                candidate = next_exploration()
                if candidate is None:
                    break
                basis = BASIS_EXPLORATION
        used.add(candidate.song_id)
        selected.append((candidate, basis))
    return selected


def rank_with_cold_start_policy(
    hybrid_context: object,
    user_id: object,
    candidate_song_ids: object,
    *,
    explicit_profile: object = None,
    limit: int = DEFAULT_POLICY_LIMIT,
) -> ColdStartRankingResult:
    """Rank candidates for known or cold-start users under the policy layer.

    Validates the prepared 30/43 hybrid context, a canonical 24-hex user
    (unknown users are valid — they are not an error), a list or tuple of
    unique canonical candidate Song IDs that all exist in the 26/43 content
    bundle, and an optional explicit preference profile (``None``,
    ``ExplicitPreferenceProfile``, or a plain mapping normalized by
    :func:`normalize_explicit_preference_profile`). Filter order is content
    membership → explicit profile source Songs → known-user ``observed``
    seen Songs → collaborative-known vs cold-start Song split.

    Known users call ``rank_hybrid_candidates`` exactly once over the
    remaining collaborative-known IDs with ``limit=MAX_HYBRID_LIMIT``;
    unknown users make zero hybrid calls and never receive fabricated
    collaborative scores. Profile evidence uses Favorite Song +1 unit and
    playlist membership count units over 26/43 features; non-empty direct
    artist/genre aggregates replace (never add to) source-Song artist/genre
    family contributions. Exploitation applies the fixed 80/20 hybrid/profile
    baseline when both scores exist, full hybrid when only hybrid exists,
    full profile when only profile exists, and leaves candidates with
    neither score exploration-eligible only. Exploration ordering is
    SHA-256 over namespace, canonical user, and Song ID (no wall clock, no
    built-in ``hash``, no randomness) with every-fifth-rank cadence and
    deterministic backfill. Ranks are contiguous 1..N. Empty eligible sets
    yield a valid empty result. No training, evaluation, artifacts, DB,
    HTTP, dense matrices, external ranking signals, or silent truncation.
    """
    if not isinstance(hybrid_context, HybridRankerContext):
        raise ColdStartValidationError(
            "hybrid_context must be a HybridRankerContext"
        )
    if getattr(hybrid_context, "training_signal", None) is None:
        raise ColdStartValidationError("hybrid context is incomplete")
    if getattr(hybrid_context, "content_row_norms", None) is None:
        raise ColdStartValidationError("hybrid context is incomplete")

    resolved_limit = _validate_limit(limit)
    canonical_user = _canonical_user_id(user_id)
    profile = normalize_explicit_preference_profile(explicit_profile)
    canonical_candidates = _canonical_candidates(candidate_song_ids)

    content = hybrid_context.content_features
    model = hybrid_context.collaborative_model
    for song_id in canonical_candidates:
        if song_id not in content.song_to_index:
            raise ColdStartValidationError(
                "candidate song is outside content catalog"
            )

    known_user = canonical_user in model.user_to_index
    profile_source_ids = set(profile.favorite_song_ids) | set(
        profile.playlist_song_counts
    )

    input_candidate_count = len(canonical_candidates)
    profile_source_excluded_count = 0
    after_source: list[str] = []
    for song_id in canonical_candidates:
        if song_id in profile_source_ids:
            profile_source_excluded_count += 1
        else:
            after_source.append(song_id)

    seen_excluded_count = 0
    eligible: list[str] = []
    if known_user:
        user_index = model.user_to_index[canonical_user]
        seen_indexes = _seen_song_indexes(hybrid_context, user_index)
        for song_id in after_source:
            song_index = model.song_to_index.get(song_id)
            if song_index is not None and song_index in seen_indexes:
                seen_excluded_count += 1
            else:
                eligible.append(song_id)
    else:
        eligible = list(after_source)

    collaborative_known_eligible = [
        song_id for song_id in eligible if song_id in model.song_to_index
    ]
    cold_start_eligible = [
        song_id for song_id in eligible if song_id not in model.song_to_index
    ]
    collaborative_known_candidate_count = len(collaborative_known_eligible)
    cold_start_song_candidate_count = len(cold_start_eligible)
    eligible_candidate_count = len(eligible)

    profile_vec, profile_norm = _build_profile_vector(hybrid_context, profile)
    profile_feature_count = len(profile_vec)
    profile_available = profile_feature_count > 0

    hybrid_by_song: dict[str, float] = {}
    if known_user:
        hybrid_result = rank_hybrid_candidates(
            hybrid_context,
            canonical_user,
            collaborative_known_eligible,
            limit=MAX_HYBRID_LIMIT,
        )
        for hybrid_item in hybrid_result.items:
            hybrid_by_song[hybrid_item.song_id] = float(hybrid_item.hybrid_score)

    scored: list[_ScoredCandidate] = []
    for song_id in eligible:
        hybrid_score = hybrid_by_song.get(song_id)
        profile_score = _profile_cosine(
            hybrid_context, profile_vec, profile_norm, song_id
        )
        policy_score, exploit_basis = _policy_components(
            hybrid_score, profile_score
        )
        scored.append(
            _ScoredCandidate(
                song_id=song_id,
                hybrid_score=hybrid_score,
                profile_score=profile_score,
                policy_score=policy_score,
                exploit_basis=exploit_basis,
                collaborative_known=song_id in model.song_to_index,
                exploration_key=_exploration_key(canonical_user, song_id),
            )
        )

    exploitation_pool = [
        candidate for candidate in scored if candidate.policy_score is not None
    ]
    exploitation_pool.sort(key=_exploit_sort_key)
    exploration_pool = list(scored)
    exploration_pool.sort(key=lambda candidate: (candidate.exploration_key, candidate.song_id))

    selected = _interleave(
        exploitation_pool,
        exploration_pool,
        resolved_limit,
        eligible_candidate_count,
    )

    items: list[ColdStartRankedItem] = []
    exploitation_selected_count = 0
    exploration_selected_count = 0
    for rank, (candidate, basis) in enumerate(selected, start=1):
        if basis == BASIS_EXPLORATION:
            exploration_selected_count += 1
            policy_score = None
        else:
            exploitation_selected_count += 1
            policy_score = candidate.policy_score
        items.append(
            ColdStartRankedItem(
                rank=rank,
                song_id=candidate.song_id,
                basis=basis,
                policy_score=policy_score,
                hybrid_score=candidate.hybrid_score,
                profile_score=candidate.profile_score,
                collaborative_known=candidate.collaborative_known,
            )
        )

    summary = ColdStartRankingSummary(
        input_candidate_count=input_candidate_count,
        profile_source_excluded_count=profile_source_excluded_count,
        seen_excluded_count=seen_excluded_count,
        eligible_candidate_count=eligible_candidate_count,
        collaborative_known_candidate_count=collaborative_known_candidate_count,
        cold_start_song_candidate_count=cold_start_song_candidate_count,
        profile_feature_count=profile_feature_count,
        exploitation_selected_count=exploitation_selected_count,
        exploration_selected_count=exploration_selected_count,
        returned_count=len(items),
        requested_limit=resolved_limit,
        collaborative_known_user=known_user,
        profile_available=profile_available,
    )
    return ColdStartRankingResult(items=tuple(items), summary=summary)
