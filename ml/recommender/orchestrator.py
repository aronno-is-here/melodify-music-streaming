"""Bounded offline retraining orchestrator for Melodify (checkpoint 43/43).

Composes checkpoints 23–31 into one deterministic retrain pass: temporal
split, sparse interactions, content features, collaborative training,
hybrid context, cold-start policy ranking, evaluation against held-out
test relevance, and immutable artifact publication via checkpoint 27.

Standard library only at import time; NumPy/SciPy/sklearn load lazily
after ``configure_cpu_runtime()`` through the composed modules. No
database drivers, HTTP servers, shell execution, executable object
loads, or network access. Caller supplies a fully bounded plain-data
payload; this module never reads files except through the
checkpoint-27 artifact store under a caller-supplied root.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from types import MappingProxyType
from typing import Any, Mapping, Sequence

from .artifacts import (
    ArtifactConflictError,
    ArtifactError,
    encode_json_artifact,
    encode_numeric_npz,
    publish_artifact_release,
    verify_artifact_release,
)
from .cold_start import (
    EXPLORATION_INTERVAL,
    rank_with_cold_start_policy,
)
from .collaborative_model import (
    STATUS_TRAINED,
    SVD_ALGORITHM,
    DEFAULT_LATENT_FACTORS,
    train_collaborative_model,
)
from .content_features import build_song_content_features
from .evaluation import evaluate_recommendations
from .hybrid_ranker import (
    COLLABORATIVE_WEIGHT,
    CONTENT_WEIGHT,
    prepare_hybrid_ranker,
)
from .cold_start import (
    BASE_HYBRID_POLICY_WEIGHT,
    EXPLICIT_PROFILE_POLICY_WEIGHT,
)
from .runtime import (
    DEFAULT_RANDOM_SEED,
    MAX_RAW_EVENTS,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    RecommenderRuntimeError,
    ResourceLimitError,
    configure_cpu_runtime,
)
from .sparse_interactions import build_sparse_interactions
from .temporal_split import split_interactions_temporally

RETRAIN_INPUT_SCHEMA_VERSION = 1
RETRAIN_OUTPUT_SCHEMA_VERSION = 1
PIPELINE_STAGE = "policy"
ARTIFACT_KIND = "recommendation-model"

DEFAULT_SNAPSHOT_LIMIT = 20
MAX_SNAPSHOT_LIMIT = 100

_HEX = frozenset("0123456789abcdef")
_IDENTIFIER_LEN = 64


class OrchestratorError(RecommenderRuntimeError):
    """Base retraining orchestration failure."""


class OrchestratorValidationError(OrchestratorError):
    """Retrain payload failed deterministic validation."""


class OrchestratorInsufficientDataError(OrchestratorError):
    """Training input cannot fit a collaborative model."""


class OrchestratorArtifactConflictError(OrchestratorError):
    """Requested artifact version already exists with different content."""


class OrchestratorOutputError(OrchestratorError):
    """Orchestrator failed to produce a valid output document."""


@dataclass(frozen=True)
class RetrainFilterSummary:
    """Factual event-filter conservation counts."""

    input_event_count: int
    usable_event_count: int
    dropped_event_count: int


def _is_plain_object(value: object) -> bool:
    return isinstance(value, dict)


def _require_object(value: object, field: str) -> dict:
    if not _is_plain_object(value):
        raise OrchestratorValidationError(f"{field} must be an object")
    return value


def _require_list(value: object, field: str) -> list:
    if not isinstance(value, list):
        raise OrchestratorValidationError(f"{field} must be a list")
    return value


def _canonical_object_id(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise OrchestratorValidationError(f"{field} must be a 24-hex string")
    text = value.strip().lower()
    if len(text) != 24 or any(ch not in _HEX for ch in text):
        raise OrchestratorValidationError(f"invalid {field}")
    return text


def _validate_identifier(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise OrchestratorValidationError(f"invalid {field}")
    text = value.strip()
    if len(text) < 1 or len(text) > _IDENTIFIER_LEN:
        raise OrchestratorValidationError(f"invalid {field}")
    if text in (".", ".."):
        raise OrchestratorValidationError(f"invalid {field}")
    if text != value:
        raise OrchestratorValidationError(f"invalid {field}")
    if not (text[0].islower() or text[0].isdigit()):
        raise OrchestratorValidationError(f"invalid {field}")
    for ch in text:
        if not (ch.islower() or ch.isdigit() or ch in "._-"):
            raise OrchestratorValidationError(f"invalid {field}")
    return text


def _validate_run_at(value: object) -> str:
    if not isinstance(value, str):
        raise OrchestratorValidationError("invalid run_at")
    text = value.strip()
    if not text:
        raise OrchestratorValidationError("invalid run_at")
    parse_text = text
    if parse_text.endswith(("Z", "z")):
        parse_text = parse_text[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(parse_text)
    except ValueError:
        raise OrchestratorValidationError("invalid run_at") from None
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise OrchestratorValidationError("run_at must include a timezone")
    utc = moment.astimezone(timezone.utc)
    iso_text = utc.isoformat()
    if iso_text.endswith("+00:00"):
        return iso_text[:-6] + "Z"
    return iso_text


def _validate_snapshot_limit(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise OrchestratorValidationError("invalid snapshot_limit")
    if value < 1 or value > MAX_SNAPSHOT_LIMIT:
        raise OrchestratorValidationError("invalid snapshot_limit")
    return value


def _validate_random_seed(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise OrchestratorValidationError("invalid random_seed")
    if value < 0 or value > 4294967295:
        raise OrchestratorValidationError("invalid random_seed")
    return value


def _validate_artifact_root(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OrchestratorValidationError("invalid artifact_root")
    if value != value.strip():
        raise OrchestratorValidationError("invalid artifact_root")
    return value


def _validate_songs(value: object) -> list[dict]:
    songs = _require_list(value, "songs")
    if not songs:
        raise OrchestratorValidationError("songs must be non-empty")
    if len(songs) > MAX_UNIQUE_SONGS:
        raise ResourceLimitError(
            f"song_count exceeds limit {MAX_UNIQUE_SONGS}"
        )
    cleaned: list[dict] = []
    seen: set[str] = set()
    for index, raw in enumerate(songs):
        song = _require_object(raw, f"songs[{index}]")
        song_id = _canonical_object_id(song.get("_id"), f"songs[{index}]._id")
        if song_id in seen:
            raise OrchestratorValidationError("duplicate song id")
        seen.add(song_id)
        entry = {"_id": song_id}
        for key in ("artist", "genre", "language", "category"):
            raw_value = song.get(key)
            if raw_value is None:
                entry[key] = None
            elif isinstance(raw_value, str):
                entry[key] = raw_value
            else:
                raise OrchestratorValidationError(
                    f"songs[{index}].{key} must be a string or null"
                )
        cleaned.append(entry)
    cleaned.sort(key=lambda item: item["_id"])
    return cleaned


def _validate_users(value: object) -> list[str]:
    users = _require_list(value, "users")
    if len(users) > MAX_UNIQUE_USERS:
        raise ResourceLimitError(
            f"user_count exceeds limit {MAX_UNIQUE_USERS}"
        )
    cleaned: list[str] = []
    seen: set[str] = set()
    for index, raw in enumerate(users):
        user_id = _canonical_object_id(raw, f"users[{index}]")
        if user_id in seen:
            raise OrchestratorValidationError("duplicate user id")
        seen.add(user_id)
        cleaned.append(user_id)
    cleaned.sort()
    return cleaned


def _validate_events(value: object) -> list[dict]:
    events = _require_list(value, "events")
    if len(events) > MAX_RAW_EVENTS:
        raise ResourceLimitError(
            f"event_count exceeds limit {MAX_RAW_EVENTS}"
        )
    cleaned: list[dict] = []
    for index, raw in enumerate(events):
        event = _require_object(raw, f"events[{index}]")
        entry = {
            "_id": _canonical_object_id(event.get("_id"), f"events[{index}]._id"),
            "user": _canonical_object_id(event.get("user"), f"events[{index}].user"),
            "song": _canonical_object_id(event.get("song"), f"events[{index}].song"),
            "session_id": event.get("session_id"),
            "sequence": event.get("sequence"),
            "event_type": event.get("event_type"),
            "createdAt": event.get("createdAt"),
        }
        if "listened_seconds_delta" in event:
            entry["listened_seconds_delta"] = event["listened_seconds_delta"]
        cleaned.append(entry)
    return cleaned


def _validate_profiles(value: object, user_ids: Sequence[str]) -> dict[str, dict | None]:
    if value is None:
        return {user_id: None for user_id in user_ids}
    profiles = _require_object(value, "profiles")
    allowed = {
        "favorite_song_ids",
        "playlist_song_counts",
        "artist_counts",
        "genre_counts",
    }
    cleaned: dict[str, dict | None] = {}
    for user_id in user_ids:
        if user_id not in profiles:
            cleaned[user_id] = None
            continue
        raw = profiles[user_id]
        if raw is None:
            cleaned[user_id] = None
            continue
        profile = _require_object(raw, f"profiles[{user_id}]")
        for key in profile:
            if key not in allowed:
                raise OrchestratorValidationError(
                    "invalid explicit preference profile"
                )
        cleaned[user_id] = dict(profile)
    for key in profiles:
        if key not in set(user_ids):
            raise OrchestratorValidationError("profile for unknown user")
    return cleaned


def parse_retrain_input(payload: object) -> dict:
    """Validate and normalize one bounded retrain input document."""
    root = _require_object(payload, "payload")
    allowed = {
        "schema_version",
        "run_id",
        "run_at",
        "snapshot_limit",
        "random_seed",
        "artifact_root",
        "songs",
        "users",
        "events",
        "profiles",
    }
    for key in root:
        if key not in allowed:
            raise OrchestratorValidationError("unknown retrain input key")
    if root.get("schema_version") != RETRAIN_INPUT_SCHEMA_VERSION:
        raise OrchestratorValidationError("unsupported retrain input schema version")
    for required in (
        "run_id",
        "run_at",
        "snapshot_limit",
        "random_seed",
        "artifact_root",
        "songs",
        "users",
        "events",
    ):
        if required not in root:
            raise OrchestratorValidationError(f"missing {required}")

    run_id = _validate_identifier(root["run_id"], "run_id")
    run_at = _validate_run_at(root["run_at"])
    snapshot_limit = _validate_snapshot_limit(root["snapshot_limit"])
    random_seed = _validate_random_seed(root["random_seed"])
    artifact_root = _validate_artifact_root(root["artifact_root"])
    songs = _validate_songs(root["songs"])
    users = _validate_users(root["users"])
    events = _validate_events(root["events"])
    profiles = _validate_profiles(root.get("profiles"), users)

    return {
        "schema_version": RETRAIN_INPUT_SCHEMA_VERSION,
        "run_id": run_id,
        "run_at": run_at,
        "snapshot_limit": snapshot_limit,
        "random_seed": random_seed,
        "artifact_root": artifact_root,
        "songs": songs,
        "users": users,
        "events": events,
        "profiles": profiles,
    }


def _filter_events(
    events: Sequence[Mapping[str, Any]],
    user_ids: set[str],
    song_ids: set[str],
) -> tuple[list[dict], RetrainFilterSummary]:
    input_count = len(events)
    usable: list[dict] = []
    dropped = 0
    for event in events:
        if event["user"] in user_ids and event["song"] in song_ids:
            usable.append(dict(event))
        else:
            dropped += 1
    if len(usable) + dropped != input_count:
        raise OrchestratorOutputError("event filter conservation violated")
    summary = RetrainFilterSummary(
        input_event_count=input_count,
        usable_event_count=len(usable),
        dropped_event_count=dropped,
    )
    return usable, summary


def _session_count(events: Sequence[Mapping[str, Any]]) -> int:
    return len({(event["user"], event["session_id"]) for event in events})


def _unique_count(events: Sequence[Mapping[str, Any]], key: str) -> int:
    return len({event[key] for event in events})


def _ranking_to_snapshot_items(result) -> list[dict]:
    items: list[dict] = []
    for item in result.items:
        items.append(
            {
                "rank": item.rank,
                "song_id": item.song_id,
                "basis": item.basis,
                "policy_score": item.policy_score,
                "hybrid_score": item.hybrid_score,
                "profile_score": item.profile_score,
                "collaborative_known": item.collaborative_known,
            }
        )
    return items


def _ranking_to_summary(result) -> dict:
    summary = result.summary
    return {
        "input_candidate_count": summary.input_candidate_count,
        "profile_source_excluded_count": summary.profile_source_excluded_count,
        "seen_excluded_count": summary.seen_excluded_count,
        "eligible_candidate_count": summary.eligible_candidate_count,
        "collaborative_known_candidate_count": summary.collaborative_known_candidate_count,
        "cold_start_song_candidate_count": summary.cold_start_song_candidate_count,
        "profile_feature_count": summary.profile_feature_count,
        "exploitation_selected_count": summary.exploitation_selected_count,
        "exploration_selected_count": summary.exploration_selected_count,
        "returned_count": summary.returned_count,
        "requested_limit": summary.requested_limit,
        "collaborative_known_user": summary.collaborative_known_user,
        "profile_available": summary.profile_available,
    }


def _metrics_dict(result) -> dict[str, float]:
    return {
        "precision_at_5": float(result.precision_at_5),
        "precision_at_10": float(result.precision_at_10),
        "recall_at_5": float(result.recall_at_5),
        "recall_at_10": float(result.recall_at_10),
        "ndcg_at_5": float(result.ndcg_at_5),
        "ndcg_at_10": float(result.ndcg_at_10),
        "map_at_10": float(result.map_at_10),
        "hit_rate_at_10": float(result.hit_rate_at_10),
        "catalog_coverage": float(result.catalog_coverage),
        "diversity": float(result.diversity),
    }


def _summary_dict(result) -> dict[str, int]:
    summary = result.summary
    return {
        "evaluated_user_count": int(summary.evaluated_user_count),
        "recommendation_user_count": int(summary.recommendation_user_count),
        "relevance_user_count": int(summary.relevance_user_count),
        "catalog_size": int(summary.catalog_size),
        "unique_recommended_at_10": int(summary.unique_recommended_at_10),
        "diversity_evaluable_user_count": int(
            summary.diversity_evaluable_user_count
        ),
        "diversity_pair_count": int(summary.diversity_pair_count),
    }


def _publish_artifact(
    artifact_root: str,
    run_id: str,
    run_at: str,
    model,
    training_summary,
    dataset: Mapping[str, int],
    configuration: Mapping[str, Any],
) -> dict[str, Any]:
    metadata = {
        "schema_version": 1,
        "artifact_kind": ARTIFACT_KIND,
        "run_id": run_id,
        "pipeline_stage": PIPELINE_STAGE,
        "created_at": run_at,
        "random_seed": int(configuration["random_seed"]),
        "algorithm": str(configuration["algorithm"]),
        "requested_components": int(configuration["requested_components"]),
        "effective_components": int(configuration["effective_components"]),
        "user_count": int(training_summary.user_count),
        "song_count": int(training_summary.song_count),
        "raw_event_count": int(dataset["raw_event_count"]),
    }
    artifacts = {
        "metadata.json": encode_json_artifact(metadata),
        "model.npz": encode_numeric_npz(
            {
                "user_factors": model.user_factors,
                "song_factors": model.song_factors,
                "singular_values": model.singular_values,
                "explained_variance_ratio": model.explained_variance_ratio,
            }
        ),
    }
    try:
        publish_artifact_release(
            artifact_root,
            version=run_id,
            artifact_kind=ARTIFACT_KIND,
            created_at=run_at,
            artifacts=artifacts,
            metadata=metadata,
        )
        return {"created": True, "artifact_version": run_id}
    except ArtifactConflictError:
        try:
            verify_artifact_release(artifact_root, run_id)
        except ArtifactError:
            raise OrchestratorArtifactConflictError(
                "artifact version already exists"
            ) from None
        return {"created": False, "artifact_version": run_id}
    except ArtifactError:
        raise OrchestratorArtifactConflictError(
            "failed to publish artifact release"
        ) from None


def run_retraining(payload: object) -> dict:
    """Execute one bounded retrain pass and return the output document.

    Validates the caller payload, filters events, composes checkpoints
    23–31, evaluates policy output against held-out test relevance,
    publishes (or reuses) one immutable artifact release, and returns a
    single JSON-ready document. Never queries a database or network.
    """
    configure_cpu_runtime()
    parsed = parse_retrain_input(payload)

    song_ids = {song["_id"] for song in parsed["songs"]}
    user_ids = set(parsed["users"])
    usable_events, filter_summary = _filter_events(
        parsed["events"], user_ids, song_ids
    )

    if filter_summary.usable_event_count == 0:
        raise OrchestratorInsufficientDataError("insufficient training data")
    if filter_summary.usable_event_count > MAX_RAW_EVENTS:
        raise ResourceLimitError(
            f"usable_event_count exceeds limit {MAX_RAW_EVENTS}"
        )

    split = split_interactions_temporally(usable_events)
    content = build_song_content_features(parsed["songs"])
    catalog = list(content.song_ids)

    if not split.train:
        raise OrchestratorInsufficientDataError("insufficient training data")

    interactions = build_sparse_interactions(split.train)
    training = train_collaborative_model(
        interactions,
        n_components=DEFAULT_LATENT_FACTORS,
        random_seed=parsed["random_seed"],
    )
    if training.status != STATUS_TRAINED or training.model is None:
        raise OrchestratorInsufficientDataError("insufficient training data")

    model = training.model
    context = prepare_hybrid_ranker(model, interactions, content)

    candidates = list(catalog)
    recommendations: dict[str, tuple[str, ...]] = {}
    snapshots: list[dict] = []

    for user_id in parsed["users"]:
        profile = parsed["profiles"].get(user_id)
        result = rank_with_cold_start_policy(
            context,
            user_id,
            candidates,
            explicit_profile=profile,
            limit=parsed["snapshot_limit"],
        )
        recommendations[user_id] = tuple(item.song_id for item in result.items)
        snapshots.append(
            {
                "user_id": user_id,
                "snapshot_version": parsed["run_id"],
                "artifact_version": parsed["run_id"],
                "generated_at": parsed["run_at"],
                "items": _ranking_to_snapshot_items(result),
                "summary": _ranking_to_summary(result),
            }
        )

    relevant: dict[str, set[str]] = {}
    for event in split.test:
        relevant.setdefault(event.user_id, set()).add(event.song_id)

    evaluation = evaluate_recommendations(recommendations, relevant, catalog, content)

    dataset = {
        "raw_event_count": filter_summary.usable_event_count,
        "train_event_count": int(split.summary.train_event_count),
        "validation_event_count": int(split.summary.validation_event_count),
        "test_event_count": int(split.summary.test_event_count),
        "unique_user_count": int(split.summary.unique_user_count),
        "unique_song_count": int(split.summary.unique_song_count),
        "session_count": int(split.summary.session_count),
        "interaction_pair_count": int(interactions.summary.interaction_pair_count),
        "content_feature_count": int(content.summary.feature_count),
    }
    if (
        dataset["raw_event_count"]
        != dataset["train_event_count"]
        + dataset["validation_event_count"]
        + dataset["test_event_count"]
    ):
        raise OrchestratorOutputError("dataset conservation violated")

    configuration = {
        "random_seed": parsed["random_seed"],
        "algorithm": SVD_ALGORITHM,
        "requested_components": int(training.summary.requested_components),
        "effective_components": int(training.summary.effective_components),
        "collaborative_weight": COLLABORATIVE_WEIGHT,
        "content_weight": CONTENT_WEIGHT,
        "base_hybrid_policy_weight": BASE_HYBRID_POLICY_WEIGHT,
        "explicit_profile_policy_weight": EXPLICIT_PROFILE_POLICY_WEIGHT,
        "exploration_interval": EXPLORATION_INTERVAL,
    }

    artifact = _publish_artifact(
        parsed["artifact_root"],
        parsed["run_id"],
        parsed["run_at"],
        model,
        training.summary,
        dataset,
        configuration,
    )

    evaluation_payload = {
        "schema_version": 1,
        "run_id": parsed["run_id"],
        "pipeline_stage": PIPELINE_STAGE,
        "artifact_version": parsed["run_id"],
        "evaluated_at": parsed["run_at"],
        "metrics": _metrics_dict(evaluation),
        "summary": _summary_dict(evaluation),
        "dataset": dataset,
        "configuration": configuration,
    }

    output = {
        "schema_version": RETRAIN_OUTPUT_SCHEMA_VERSION,
        "run_id": parsed["run_id"],
        "run_at": parsed["run_at"],
        "artifact_version": parsed["run_id"],
        "pipeline_stage": PIPELINE_STAGE,
        "filtering": {
            "input_event_count": filter_summary.input_event_count,
            "usable_event_count": filter_summary.usable_event_count,
            "dropped_event_count": filter_summary.dropped_event_count,
            "event_window_truncated": False,
        },
        "evaluation": evaluation_payload,
        "snapshots": snapshots,
        "artifact": artifact,
    }
    if len({snapshot["user_id"] for snapshot in snapshots}) != len(snapshots):
        raise OrchestratorOutputError("duplicate snapshot user")
    if [snapshot["user_id"] for snapshot in snapshots] != list(parsed["users"]):
        raise OrchestratorOutputError("snapshot user mismatch")
    return output


__all__ = [
    "ARTIFACT_KIND",
    "DEFAULT_SNAPSHOT_LIMIT",
    "MAX_SNAPSHOT_LIMIT",
    "PIPELINE_STAGE",
    "RETRAIN_INPUT_SCHEMA_VERSION",
    "RETRAIN_OUTPUT_SCHEMA_VERSION",
    "OrchestratorArtifactConflictError",
    "OrchestratorError",
    "OrchestratorInsufficientDataError",
    "OrchestratorOutputError",
    "OrchestratorValidationError",
    "RetrainFilterSummary",
    "parse_retrain_input",
    "run_retraining",
]
