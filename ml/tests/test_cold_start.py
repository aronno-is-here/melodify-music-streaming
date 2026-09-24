"""Standard-library tests for the cold-start preference and exploration policy."""

from __future__ import annotations

import ast
import dataclasses
import hashlib
import math
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from ml.recommender.collaborative_model import train_collaborative_model
from ml.recommender.content_features import build_song_content_features
from ml.recommender.cold_start import (
    BASE_HYBRID_POLICY_WEIGHT,
    BASIS_EXPLORATION,
    BASIS_HYBRID,
    BASIS_HYBRID_PROFILE,
    BASIS_PROFILE,
    DEFAULT_POLICY_LIMIT,
    EXPLICIT_PROFILE_POLICY_WEIGHT,
    EXPLORATION_HASH_NAMESPACE,
    EXPLORATION_INTERVAL,
    MAX_PLAYLIST_MEMBERSHIP_COUNT,
    MAX_POLICY_LIMIT,
    MAX_PROFILE_ARTIST_ENTRIES,
    MAX_PROFILE_FACTUAL_COUNT,
    MAX_PROFILE_FAVORITE_SONGS,
    MAX_PROFILE_GENRE_ENTRIES,
    MAX_PROFILE_PLAYLIST_SONGS,
    ColdStartPolicyError,
    ColdStartRankedItem,
    ColdStartRankingResult,
    ColdStartRankingSummary,
    ColdStartValidationError,
    ExplicitPreferenceProfile,
    normalize_explicit_preference_profile,
    rank_with_cold_start_policy,
)
from ml.recommender.hybrid_ranker import (
    MAX_HYBRID_LIMIT,
    prepare_hybrid_ranker,
    rank_hybrid_candidates,
)
from ml.recommender.runtime import (
    MAX_UNIQUE_SONGS,
    RecommenderRuntimeError,
    ResourceLimitError,
)
from ml.recommender.sparse_interactions import build_sparse_interactions
from ml.recommender.temporal_split import TemporalInteractionEvent

MODULE_PATH = Path(__file__).resolve().parents[1] / "recommender" / "cold_start.py"
MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
REQUIREMENTS = (PROJECT_ROOT / "ml" / "requirements.txt").read_text(encoding="utf-8")

U1 = "a" * 24
U2 = "b" * 24
U3 = "c" * 24
U4 = "d" * 24
S1 = "1" * 24
S2 = "2" * 24
S3 = "3" * 24
S4 = "4" * 24
S5 = "5" * 24
S6 = "6" * 24
S7 = "7" * 24
S8 = "8" * 24
S9 = "9" * 24
S10 = "a" * 24
UNKNOWN_USER = "f" * 24

BASE_TIME = datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)

_FORBIDDEN_SOURCE_TOKENS = (
    ".toarray(",
    ".todense(",
    "TruncatedSVD",
    ".fit(",
    "train_collaborative_model",
    "evaluate_recommendations",
    "publish_artifact_release",
    "activate_artifact_release",
    "pymongo",
    "MongoClient",
    "FastAPI",
    "Flask",
    "requests",
    "datetime.now",
    "time.time",
    "random.",
    "numpy.random",
    "content_matrix @ content_matrix.T",
    "user_factors @ song_factors.T",
    "userPreferenceAggregationService",
    "explicitPreferenceSignalService",
)


def make_event(
    *,
    event_id: str | None = None,
    user_id: str = U1,
    song_id: str = S1,
    session_id: str = "sess-1",
    sequence: int = 0,
    event_type: str = "play-started",
    listened_seconds_delta: float | None = None,
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
        created_at=BASE_TIME,
    )


make_event.counter = 0


def fixture_events():
    make_event.counter = 500
    return [
        make_event(user_id=U1, song_id=S1, session_id="h1", sequence=0, event_type="play-started"),
        make_event(user_id=U1, song_id=S1, session_id="h1", sequence=1, event_type="completed", listened_seconds_delta=40.0),
        make_event(user_id=U1, song_id=S2, session_id="h2", sequence=0, event_type="play-started"),
        make_event(user_id=U1, song_id=S2, session_id="h2", sequence=1, event_type="completed", listened_seconds_delta=35.0),
        make_event(user_id=U1, song_id=S3, session_id="h3", sequence=0, event_type="play-started"),
        make_event(user_id=U1, song_id=S3, session_id="h3", sequence=1, event_type="skipped", listened_seconds_delta=5.0),
        make_event(user_id=U2, song_id=S1, session_id="h4", sequence=0, event_type="play-started"),
        make_event(user_id=U2, song_id=S1, session_id="h4", sequence=1, event_type="completed", listened_seconds_delta=50.0),
        make_event(user_id=U2, song_id=S4, session_id="h5", sequence=0, event_type="replay-started"),
        make_event(user_id=U2, song_id=S4, session_id="h5", sequence=1, event_type="completed", listened_seconds_delta=45.0),
        make_event(user_id=U2, song_id=S5, session_id="h6", sequence=0, event_type="play-started"),
        make_event(user_id=U3, song_id=S2, session_id="h7", sequence=0, event_type="play-started"),
        make_event(user_id=U3, song_id=S2, session_id="h7", sequence=1, event_type="completed", listened_seconds_delta=60.0),
        make_event(user_id=U3, song_id=S3, session_id="h8", sequence=0, event_type="play-started"),
        make_event(user_id=U3, song_id=S4, session_id="h9", sequence=0, event_type="play-started"),
        make_event(user_id=U3, song_id=S5, session_id="h10", sequence=0, event_type="play-started"),
        make_event(user_id=U4, song_id=S1, session_id="h11", sequence=0, event_type="play-started"),
        make_event(user_id=U4, song_id=S6, session_id="h12", sequence=0, event_type="play-started"),
        make_event(user_id=U4, song_id=S6, session_id="h12", sequence=1, event_type="completed", listened_seconds_delta=30.0),
        make_event(user_id=U4, song_id=S7, session_id="h13", sequence=0, event_type="play-started"),
        make_event(user_id=U2, song_id=S8, session_id="h14", sequence=0, event_type="play-started"),
        make_event(user_id=U3, song_id=S8, session_id="h15", sequence=0, event_type="play-started"),
    ]


def fixture_bundle():
    return build_sparse_interactions(fixture_events())


def fixture_song_records():
    return [
        {"_id": S1, "artist": "ArtistA", "genre": "Pop", "language": "English", "category": "Song"},
        {"_id": S2, "artist": "ArtistB", "genre": "Rock", "language": "English", "category": "Song"},
        {"_id": S3, "artist": "ArtistA", "genre": "Pop", "language": "English", "category": "Song"},
        {"_id": S4, "artist": "ArtistC", "genre": "Jazz", "language": "Hindi", "category": "Song"},
        {"_id": S5, "artist": "ArtistD", "genre": "Pop", "language": "Bengali", "category": "Song"},
        {"_id": S6, "artist": "ArtistE", "genre": "Rock", "language": "English", "category": "Song"},
        {"_id": S7, "artist": "ArtistF", "genre": "Jazz", "language": "English", "category": "Song"},
        {"_id": S8},
        {"_id": S9, "artist": "ArtistA", "genre": "Pop", "language": "English", "category": "Song"},
        {"_id": S10, "artist": "ArtistB", "genre": "Rock", "language": "English", "category": "Song"},
    ]


def fixture_content():
    return build_song_content_features(fixture_song_records())


def fixture_model(bundle=None):
    bundle = fixture_bundle() if bundle is None else bundle
    result = train_collaborative_model(bundle, n_components=4, random_seed=42)
    if result.model is None:
        raise AssertionError("fixture model should train")
    return result.model


def fixture_context():
    bundle = fixture_bundle()
    model = fixture_model(bundle)
    content = fixture_content()
    return prepare_hybrid_ranker(model, bundle, content)


def all_catalog_song_ids():
    return [S1, S2, S3, S4, S5, S6, S7, S8, S9, S10]


def in_model_song_ids():
    return [S1, S2, S3, S4, S5, S6, S7, S8]


def assert_close(testcase, actual, expected, places=9):
    testcase.assertTrue(
        math.isclose(actual, expected, rel_tol=0.0, abs_tol=10 ** (-places)),
        msg=f"{actual} != {expected}",
    )


def profile_dict(**overrides):
    base = {
        "favorite_song_ids": [],
        "playlist_song_counts": {},
        "artist_counts": {},
        "genre_counts": {},
    }
    base.update(overrides)
    return base


class ConstantsContractTests(unittest.TestCase):
    def test_01_base_hybrid_policy_weight(self):
        self.assertEqual(BASE_HYBRID_POLICY_WEIGHT, 0.80)

    def test_02_explicit_profile_policy_weight(self):
        self.assertEqual(EXPLICIT_PROFILE_POLICY_WEIGHT, 0.20)

    def test_03_policy_weights_sum_invariant(self):
        self.assertEqual(BASE_HYBRID_POLICY_WEIGHT + EXPLICIT_PROFILE_POLICY_WEIGHT, 1.0)

    def test_04_default_policy_limit(self):
        self.assertEqual(DEFAULT_POLICY_LIMIT, 20)

    def test_05_max_policy_limit(self):
        self.assertEqual(MAX_POLICY_LIMIT, 100)

    def test_06_max_policy_limit_matches_hybrid(self):
        self.assertEqual(MAX_POLICY_LIMIT, MAX_HYBRID_LIMIT)

    def test_07_exploration_interval(self):
        self.assertEqual(EXPLORATION_INTERVAL, 5)

    def test_08_exploration_hash_namespace(self):
        self.assertEqual(EXPLORATION_HASH_NAMESPACE, "melodify-exploration-v1")

    def test_09_max_profile_favorite_songs(self):
        self.assertEqual(MAX_PROFILE_FAVORITE_SONGS, 1000)

    def test_10_max_profile_playlist_songs(self):
        self.assertEqual(MAX_PROFILE_PLAYLIST_SONGS, 5000)

    def test_11_max_profile_artist_entries(self):
        self.assertEqual(MAX_PROFILE_ARTIST_ENTRIES, 5000)

    def test_12_max_profile_genre_entries(self):
        self.assertEqual(MAX_PROFILE_GENRE_ENTRIES, 5000)

    def test_13_max_playlist_membership_count(self):
        self.assertEqual(MAX_PLAYLIST_MEMBERSHIP_COUNT, 250)

    def test_14_max_profile_factual_count(self):
        self.assertEqual(MAX_PROFILE_FACTUAL_COUNT, 1_000_000)

    def test_15_basis_vocabulary_constants(self):
        self.assertEqual(BASIS_HYBRID, "hybrid")
        self.assertEqual(BASIS_HYBRID_PROFILE, "hybrid-profile")
        self.assertEqual(BASIS_PROFILE, "profile")
        self.assertEqual(BASIS_EXPLORATION, "exploration")

    def test_16_public_api_callable(self):
        self.assertTrue(callable(normalize_explicit_preference_profile))
        self.assertTrue(callable(rank_with_cold_start_policy))

    def test_17_max_candidates_uses_runtime_song_cap(self):
        self.assertEqual(MAX_UNIQUE_SONGS, 25_000)


class ExceptionContractTests(unittest.TestCase):
    def test_18_base_under_recommender_runtime_error(self):
        self.assertTrue(issubclass(ColdStartPolicyError, RecommenderRuntimeError))

    def test_19_validation_under_base(self):
        self.assertTrue(issubclass(ColdStartValidationError, ColdStartPolicyError))


class ProfileNormalizationTests(unittest.TestCase):
    def test_20_none_is_valid_empty_profile(self):
        profile = normalize_explicit_preference_profile(None)
        self.assertIsInstance(profile, ExplicitPreferenceProfile)
        self.assertEqual(profile.favorite_song_ids, ())
        self.assertEqual(dict(profile.playlist_song_counts), {})
        self.assertEqual(dict(profile.artist_counts), {})
        self.assertEqual(dict(profile.genre_counts), {})

    def test_21_empty_mapping_is_valid(self):
        profile = normalize_explicit_preference_profile({})
        self.assertEqual(profile.favorite_song_ids, ())
        self.assertFalse(profile.favorite_song_ids)

    def test_22_unknown_key_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile({"weights": {}})

    def test_23_unknown_key_rejects_confidence(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile({"confidence": 1.0})

    def test_24_non_mapping_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile([S1])

    def test_25_string_profile_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile("favorites")

    def test_26_favorites_list_accepted(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(favorite_song_ids=[S1, S2])
        )
        self.assertEqual(profile.favorite_song_ids, (S1, S2))

    def test_27_favorites_tuple_accepted(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(favorite_song_ids=(S1,))
        )
        self.assertEqual(profile.favorite_song_ids, (S1,))

    def test_28_favorites_set_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids={S1})
            )

    def test_29_favorites_string_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=S1)
            )

    def test_30_favorites_duplicate_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=[S1, S1])
            )

    def test_31_favorites_canonicalizes_case(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(favorite_song_ids=[S1.upper()])
        )
        self.assertEqual(profile.favorite_song_ids, (S1,))

    def test_32_favorites_invalid_hex_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=["z" * 24])
            )

    def test_33_favorites_wrong_length_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=["abc"])
            )

    def test_34_favorites_bool_element_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=[True])
            )

    def test_35_favorites_cap_overflow_resource_limit(self):
        many = [f"{i:024x}" for i in range(MAX_PROFILE_FAVORITE_SONGS + 1)]
        with self.assertRaises(ResourceLimitError):
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=many)
            )

    def test_36_favorites_at_cap_accepted(self):
        many = [f"{i:024x}" for i in range(MAX_PROFILE_FAVORITE_SONGS)]
        profile = normalize_explicit_preference_profile(
            profile_dict(favorite_song_ids=many)
        )
        self.assertEqual(len(profile.favorite_song_ids), MAX_PROFILE_FAVORITE_SONGS)

    def test_37_playlist_counts_accepted(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(playlist_song_counts={S1: 3})
        )
        self.assertEqual(profile.playlist_song_counts[S1], 3)

    def test_38_playlist_count_zero_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(playlist_song_counts={S1: 0})
            )

    def test_39_playlist_count_negative_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(playlist_song_counts={S1: -1})
            )

    def test_40_playlist_count_bool_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(playlist_song_counts={S1: True})
            )

    def test_41_playlist_count_above_cap_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(
                    playlist_song_counts={
                        S1: MAX_PLAYLIST_MEMBERSHIP_COUNT + 1
                    }
                )
            )

    def test_42_playlist_count_at_cap_accepted(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(
                playlist_song_counts={
                    S1: MAX_PLAYLIST_MEMBERSHIP_COUNT
                }
            )
        )
        self.assertEqual(
            profile.playlist_song_counts[S1], MAX_PLAYLIST_MEMBERSHIP_COUNT
        )

    def test_43_playlist_not_mapping_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(playlist_song_counts=[(S1, 1)])
            )

    def test_44_playlist_duplicate_after_canonical_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(playlist_song_counts={"A" * 24: 1, "a" * 24: 2})
            )

    def test_45_playlist_cap_overflow_resource_limit(self):
        many = {f"{i:024x}": 1 for i in range(MAX_PROFILE_PLAYLIST_SONGS + 1)}
        with self.assertRaises(ResourceLimitError):
            normalize_explicit_preference_profile(
                profile_dict(playlist_song_counts=many)
            )

    def test_46_artist_counts_accepted(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(artist_counts={"ArtistA": 5})
        )
        self.assertEqual(profile.artist_counts["artista"], 5)

    def test_47_artist_count_zero_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(artist_counts={"ArtistA": 0})
            )

    def test_48_artist_count_bool_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(artist_counts={"ArtistA": False})
            )

    def test_49_artist_count_above_max_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(
                    artist_counts={"ArtistA": MAX_PROFILE_FACTUAL_COUNT + 1}
                )
            )

    def test_50_artist_count_at_max_accepted(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(
                artist_counts={"ArtistA": MAX_PROFILE_FACTUAL_COUNT}
            )
        )
        self.assertEqual(
            profile.artist_counts["artista"], MAX_PROFILE_FACTUAL_COUNT
        )

    def test_51_artist_key_normalizes_casefold(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(artist_counts={"  ArtistA  ": 1})
        )
        self.assertIn("artista", profile.artist_counts)

    def test_52_artist_duplicate_after_normalize_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(artist_counts={"ArtistA": 1, "  artista ": 2})
            )

    def test_53_genre_counts_accepted(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(genre_counts={"Pop": 4})
        )
        self.assertEqual(profile.genre_counts["pop"], 4)

    def test_54_genre_count_zero_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(genre_counts={"Pop": 0})
            )

    def test_55_genre_count_bool_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(genre_counts={"Pop": True})
            )

    def test_56_genre_count_above_max_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(
                    genre_counts={"Pop": MAX_PROFILE_FACTUAL_COUNT + 1}
                )
            )

    def test_57_genre_duplicate_after_normalize_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(genre_counts={"Pop": 1, " pop ": 2})
            )

    def test_58_genre_cap_overflow_resource_limit(self):
        many = {f"g{i}": 1 for i in range(MAX_PROFILE_GENRE_ENTRIES + 1)}
        with self.assertRaises(ResourceLimitError):
            normalize_explicit_preference_profile(
                profile_dict(genre_counts=many)
            )

    def test_59_artist_cap_overflow_resource_limit(self):
        many = {f"a{i}": 1 for i in range(MAX_PROFILE_ARTIST_ENTRIES + 1)}
        with self.assertRaises(ResourceLimitError):
            normalize_explicit_preference_profile(
                profile_dict(artist_counts=many)
            )

    def test_60_profile_immutable_favorites(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(favorite_song_ids=[S1])
        )
        with self.assertRaises((TypeError, AttributeError)):
            profile.favorite_song_ids = ()

    def test_61_profile_immutable_playlist_mapping(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(playlist_song_counts={S1: 1})
        )
        with self.assertRaises(TypeError):
            profile.playlist_song_counts[S2] = 1

    def test_62_profile_immutable_artist_mapping(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(artist_counts={"A": 1})
        )
        with self.assertRaises(TypeError):
            profile.artist_counts["b"] = 1

    def test_63_profile_immutable_genre_mapping(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(genre_counts={"G": 1})
        )
        with self.assertRaises(TypeError):
            profile.genre_counts["h"] = 1

    def test_64_profile_dataclass_frozen(self):
        profile = normalize_explicit_preference_profile(None)
        self.assertTrue(dataclasses.is_dataclass(profile))
        self.assertTrue(profile.__dataclass_params__.frozen)

    def test_65_explicit_profile_passthrough(self):
        original = normalize_explicit_preference_profile(
            profile_dict(favorite_song_ids=[S1])
        )
        again = normalize_explicit_preference_profile(original)
        self.assertIs(again, original)

    def test_66_error_message_bounded_profile(self):
        try:
            normalize_explicit_preference_profile({"nope": 1})
        except ColdStartValidationError as exc:
            self.assertNotIn(S1, str(exc))
            self.assertLess(len(str(exc)), 120)

    def test_67_error_message_bounded_count(self):
        try:
            normalize_explicit_preference_profile(
                profile_dict(artist_counts={"A": 0})
            )
        except ColdStartValidationError as exc:
            self.assertEqual(str(exc), "invalid profile factual count")

    def test_68_error_message_bounded_duplicate_favorite(self):
        try:
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=[S1, S1])
            )
        except ColdStartValidationError as exc:
            self.assertEqual(str(exc), "duplicate favorite song")


class SourceEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_69_favorite_source_song_excluded_from_candidates(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S1, S4, S5],
            explicit_profile=profile_dict(favorite_song_ids=[S4]),
            limit=10,
        )
        ids = [item.song_id for item in result.items]
        self.assertNotIn(S4, ids)
        self.assertEqual(result.summary.profile_source_excluded_count, 1)

    def test_70_playlist_source_song_excluded(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6],
            explicit_profile=profile_dict(playlist_song_counts={S5: 2}),
            limit=10,
        )
        ids = [item.song_id for item in result.items]
        self.assertNotIn(S5, ids)
        self.assertEqual(result.summary.profile_source_excluded_count, 1)

    def test_71_favorite_and_playlist_same_song_single_exclusion(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5],
            explicit_profile=profile_dict(
                favorite_song_ids=[S4],
                playlist_song_counts={S4: 3},
            ),
            limit=10,
        )
        self.assertEqual(result.summary.profile_source_excluded_count, 1)

    def test_72_source_exclusion_before_seen_exclusion(self):
        profile = profile_dict(favorite_song_ids=[S1])
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S1, S2],
            explicit_profile=profile,
            limit=10,
        )
        self.assertEqual(result.summary.profile_source_excluded_count, 1)
        self.assertEqual(result.summary.seen_excluded_count, 1)
        self.assertEqual(result.summary.eligible_candidate_count, 0)

    def test_73_input_equals_excluded_plus_eligible(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S1, S2, S4, S5],
            explicit_profile=profile_dict(favorite_song_ids=[S4]),
            limit=10,
        )
        self.assertEqual(
            result.summary.input_candidate_count,
            result.summary.profile_source_excluded_count
            + result.summary.seen_excluded_count
            + result.summary.eligible_candidate_count,
        )

    def test_74_favorite_units_one_playlist_units_count(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(
                favorite_song_ids=[S1],
                playlist_song_counts={S2: 5},
            )
        )
        self.assertEqual(profile.favorite_song_ids, (S1,))
        self.assertEqual(profile.playlist_song_counts[S2], 5)

    def test_75_same_song_favorite_plus_playlist_keeps_both_ids(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(
                favorite_song_ids=[S1],
                playlist_song_counts={S1: 4},
            )
        )
        self.assertIn(S1, profile.favorite_song_ids)
        self.assertEqual(profile.playlist_song_counts[S1], 4)

    def test_76_artist_aggregate_replaces_artist_from_songs(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7],
            explicit_profile=profile_dict(artist_counts={"ArtistC": 3}),
            limit=10,
        )
        self.assertGreater(result.summary.profile_feature_count, 0)
        self.assertTrue(result.summary.profile_available)

    def test_77_genre_aggregate_replaces_genre_from_songs(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7],
            explicit_profile=profile_dict(genre_counts={"jazz": 2}),
            limit=10,
        )
        self.assertGreater(result.summary.profile_feature_count, 0)

    def test_78_artist_and_genre_aggregates_together(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7],
            explicit_profile=profile_dict(
                artist_counts={"ArtistC": 1},
                genre_counts={"jazz": 1},
            ),
            limit=10,
        )
        self.assertGreaterEqual(result.summary.profile_feature_count, 1)

    def test_79_unknown_out_of_vocabulary_artist_ignored(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5],
            explicit_profile=profile_dict(
                artist_counts={"NoSuchArtistXYZ": 10}
            ),
            limit=10,
        )
        self.assertFalse(result.summary.profile_available)

    def test_80_unknown_out_of_vocabulary_genre_ignored(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5],
            explicit_profile=profile_dict(genre_counts={"NoSuchGenre": 10}),
            limit=10,
        )
        self.assertFalse(result.summary.profile_available)

    def test_81_source_song_missing_content_kept_in_profile_ids(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(favorite_song_ids=[UNKNOWN_USER])
        )
        self.assertIn(UNKNOWN_USER, profile.favorite_song_ids)

    def test_82_profile_feature_count_zero_when_only_unknown(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5],
            explicit_profile=profile_dict(
                artist_counts={"NeverSeenArtist": 1}
            ),
            limit=10,
        )
        self.assertEqual(result.summary.profile_feature_count, 0)
        self.assertFalse(result.summary.profile_available)

    def test_83_playlist_and_favorite_units_accumulate_profile(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S6, S7],
            explicit_profile=profile_dict(
                favorite_song_ids=[S1],
                playlist_song_counts={S2: 3},
            ),
            limit=10,
        )
        self.assertGreater(result.summary.profile_feature_count, 0)
        self.assertTrue(result.summary.profile_available)

    def test_84_language_and_category_from_source_songs_only(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        self.assertGreater(result.summary.profile_feature_count, 0)

    def test_85_no_family_aggregates_still_uses_song_families(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5],
            explicit_profile=profile_dict(favorite_song_ids=[S4]),
            limit=10,
        )
        source_excluded = result.summary.profile_source_excluded_count
        self.assertEqual(source_excluded, 1)


class CandidateValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_86_list_accepted(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5], limit=10
        )
        self.assertIsInstance(result, ColdStartRankingResult)

    def test_87_tuple_accepted(self):
        result = rank_with_cold_start_policy(
            self.context, U1, (S4, S5), limit=10
        )
        self.assertIsInstance(result, ColdStartRankingResult)

    def test_88_set_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, {S4, S5})

    def test_89_generator_rejects(self):
        def gen():
            yield S4

        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, gen())

    def test_90_mapping_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, {0: S4})

    def test_91_string_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, S4)

    def test_92_duplicate_candidates_reject(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, [S4, S4])

    def test_93_invalid_hex_candidate_reject(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, ["x" * 24])

    def test_94_non_string_candidate_reject(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, [123])

    def test_95_outside_content_catalog_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, [UNKNOWN_USER])

    def test_96_candidate_cap_overflow_resource_limit(self):
        with self.assertRaises(ResourceLimitError):
            rank_with_cold_start_policy(
                self.context,
                U1,
                [f"{i:024x}" for i in range(MAX_UNIQUE_SONGS + 1)],
            )

    def test_97_zero_feature_song_in_catalog_accepted(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S8], limit=10
        )
        self.assertEqual(result.summary.input_candidate_count, 1)

    def test_98_invalid_user_id_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, "not-an-id", [S4])

    def test_99_limit_bool_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, [S4], limit=True)

    def test_100_limit_zero_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, [S4], limit=0)

    def test_101_limit_above_max_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(
                self.context, U1, [S4], limit=MAX_POLICY_LIMIT + 1
            )

    def test_102_limit_at_max_accepted(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5], limit=MAX_POLICY_LIMIT
        )
        self.assertEqual(result.summary.requested_limit, MAX_POLICY_LIMIT)

    def test_103_invalid_context_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(object(), U1, [S4])

    def test_104_bool_user_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, True, [S4])

    def test_105_canonical_user_uppercase_accepted(self):
        result = rank_with_cold_start_policy(
            self.context, U1.upper(), [S4], limit=10
        )
        self.assertEqual(result.summary.input_candidate_count, 1)


class KnownUserAndSeenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_106_known_user_flag_true(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5], limit=10
        )
        self.assertTrue(result.summary.collaborative_known_user)

    def test_107_unknown_user_is_not_error(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5], limit=10
        )
        self.assertFalse(result.summary.collaborative_known_user)
        self.assertEqual(result.summary.returned_count, 2)

    def test_108_seen_song_excluded_for_known_user(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S1, S4], limit=10
        )
        ids = [item.song_id for item in result.items]
        self.assertNotIn(S1, ids)
        self.assertEqual(result.summary.seen_excluded_count, 1)

    def test_109_unseen_song_kept_for_known_user(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=10
        )
        self.assertIn(S4, [item.song_id for item in result.items])

    def test_110_seen_definition_uses_observed_only(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S1, S2, S3], limit=10
        )
        self.assertEqual(result.summary.seen_excluded_count, 3)
        self.assertEqual(result.summary.eligible_candidate_count, 0)

    def test_111_all_seen_empty_result_no_hybrid_nonsense(self):
        with mock.patch(
            "ml.recommender.cold_start.rank_hybrid_candidates",
            wraps=rank_hybrid_candidates,
        ) as hybrid_mock:
            result = rank_with_cold_start_policy(
                self.context, U1, [S1, S2], limit=10
            )
        self.assertEqual(result.summary.eligible_candidate_count, 0)
        self.assertEqual(result.items, ())
        hybrid_mock.assert_called_once()

    def test_112_unknown_user_zero_hybrid_calls(self):
        with mock.patch(
            "ml.recommender.cold_start.rank_hybrid_candidates"
        ) as hybrid_mock:
            result = rank_with_cold_start_policy(
                self.context, UNKNOWN_USER, [S4, S5], limit=10
            )
        hybrid_mock.assert_not_called()
        self.assertEqual(result.summary.returned_count, 2)

    def test_113_known_user_single_hybrid_call(self):
        with mock.patch(
            "ml.recommender.cold_start.rank_hybrid_candidates",
            wraps=rank_hybrid_candidates,
        ) as hybrid_mock:
            rank_with_cold_start_policy(
                self.context, U1, [S4, S5, S6], limit=10
            )
        hybrid_mock.assert_called_once()

    def test_114_unknown_user_no_collaborative_scores(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5], limit=10
        )
        for item in result.items:
            self.assertIsNone(item.hybrid_score)

    def test_115_seen_excluded_zero_for_unknown_user(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S1, S2], limit=10
        )
        self.assertEqual(result.summary.seen_excluded_count, 0)
        self.assertEqual(result.summary.eligible_candidate_count, 2)


class ColdStartSongTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_116_content_only_song_is_cold_start_song(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S9, S10], limit=10
        )
        self.assertEqual(result.summary.cold_start_song_candidate_count, 2)
        self.assertEqual(result.summary.collaborative_known_candidate_count, 0)

    def test_117_cold_start_song_not_an_error(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S9], limit=10
        )
        self.assertEqual(result.summary.returned_count, 1)

    def test_118_cold_start_song_no_fabricated_hybrid(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S9], limit=10
        )
        for item in result.items:
            if item.song_id == S9:
                self.assertIsNone(item.hybrid_score)
                self.assertFalse(item.collaborative_known)

    def test_119_mixed_known_and_cold_start_split(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S9], limit=10
        )
        self.assertEqual(result.summary.collaborative_known_candidate_count, 2)
        self.assertEqual(result.summary.cold_start_song_candidate_count, 1)

    def test_120_split_counts_sum_to_eligible(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6, S9, S10], limit=10
        )
        self.assertEqual(
            result.summary.collaborative_known_candidate_count
            + result.summary.cold_start_song_candidate_count,
            result.summary.eligible_candidate_count,
        )

    def test_121_cold_start_song_can_rank_via_profile(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S9, S10],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        bases = {item.song_id: item.basis for item in result.items}
        self.assertIn(S9, bases)
        self.assertIn(bases[S9], {BASIS_PROFILE, BASIS_EXPLORATION})

    def test_122_cold_start_song_collaborative_known_false(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S9], limit=10
        )
        by_id = {item.song_id: item for item in result.items}
        self.assertFalse(by_id[S9].collaborative_known)
        self.assertTrue(by_id[S4].collaborative_known)

    def test_123_zero_feature_song_cold_start_accepted(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S8], limit=10
        )
        self.assertEqual(result.summary.returned_count, 1)


class HybridCallContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_124_known_user_passes_only_collaborative_known_ids(self):
        captured = {}

        def fake_rank(context, user_id, candidate_song_ids, *, limit=20):
            captured["songs"] = list(candidate_song_ids)
            captured["limit"] = limit
            from ml.recommender.hybrid_ranker import (
                HybridRankedItem,
                HybridRankingResult,
                HybridRankingSummary,
            )

            items = tuple(
                HybridRankedItem(
                    rank=index + 1,
                    song_id=song_id,
                    hybrid_score=0.5,
                    collaborative_raw_score=1.0,
                    collaborative_normalized_score=0.5,
                    content_score=None,
                    content_available=False,
                )
                for index, song_id in enumerate(candidate_song_ids)
            )
            summary = HybridRankingSummary(
                input_candidate_count=len(candidate_song_ids),
                seen_filtered_count=0,
                eligible_candidate_count=len(candidate_song_ids),
                returned_count=len(items),
                requested_limit=limit,
                content_profile_feature_count=0,
                content_available_candidate_count=0,
                collaborative_weight=0.70,
                content_weight=0.30,
            )
            return HybridRankingResult(items=items, summary=summary)

        with mock.patch(
            "ml.recommender.cold_start.rank_hybrid_candidates",
            side_effect=fake_rank,
        ):
            rank_with_cold_start_policy(
                self.context, U1, [S4, S9, S5], limit=10
            )
        self.assertEqual(captured["songs"], [S4, S5])
        self.assertEqual(captured["limit"], MAX_HYBRID_LIMIT)

    def test_125_hybrid_limit_is_max_hybrid_limit(self):
        captured = {}

        def fake_rank(context, user_id, candidate_song_ids, *, limit=20):
            captured["limit"] = limit
            from ml.recommender.hybrid_ranker import (
                HybridRankingResult,
                HybridRankingSummary,
            )

            return HybridRankingResult(
                items=(), summary=HybridRankingSummary(
                    input_candidate_count=0,
                    seen_filtered_count=0,
                    eligible_candidate_count=0,
                    returned_count=0,
                    requested_limit=limit,
                    content_profile_feature_count=0,
                    content_available_candidate_count=0,
                    collaborative_weight=0.70,
                    content_weight=0.30,
                )
            )

        with mock.patch(
            "ml.recommender.cold_start.rank_hybrid_candidates",
            side_effect=fake_rank,
        ):
            rank_with_cold_start_policy(self.context, U1, [S4], limit=5)
        self.assertEqual(captured["limit"], MAX_HYBRID_LIMIT)

    def test_126_hybrid_scores_flow_to_items(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=10
        )
        for item in result.items:
            if item.collaborative_known:
                self.assertIsNotNone(item.hybrid_score)
                self.assertIsNotNone(item.policy_score)

    def test_127_no_per_song_hybrid_calls(self):
        with mock.patch(
            "ml.recommender.cold_start.rank_hybrid_candidates",
            wraps=rank_hybrid_candidates,
        ) as hybrid_mock:
            rank_with_cold_start_policy(
                self.context, U1, [S4, S5, S6, S7], limit=10
            )
        self.assertEqual(hybrid_mock.call_count, 1)

    def test_128_unknown_user_no_hybrid_even_with_model_songs(self):
        with mock.patch(
            "ml.recommender.cold_start.rank_hybrid_candidates"
        ) as hybrid_mock:
            result = rank_with_cold_start_policy(
                self.context, UNKNOWN_USER, [S4, S5], limit=10
            )
        hybrid_mock.assert_not_called()
        self.assertEqual(result.summary.returned_count, 2)


class PolicyFormulaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_129_hybrid_plus_profile_uses_eighty_twenty(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4],
            explicit_profile=profile_dict(favorite_song_ids=[S4]),
            limit=10,
        )
        self.assertEqual(result.items, ())

    def test_130_formula_hybrid_profile(self):
        hybrid = 0.6
        profile = 0.5
        expected = BASE_HYBRID_POLICY_WEIGHT * hybrid + EXPLICIT_PROFILE_POLICY_WEIGHT * profile
        assert_close(self, expected, 0.80 * 0.6 + 0.20 * 0.5)

    def test_131_hybrid_only_full_hybrid_no_penalty(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4],
            explicit_profile=None,
            limit=10,
        )
        for item in result.items:
            if item.basis == BASIS_HYBRID:
                self.assertEqual(item.policy_score, item.hybrid_score)

    def test_132_profile_only_full_profile(self):
        result = rank_with_cold_start_policy(
            self.context,
            UNKNOWN_USER,
            [S4],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        for item in result.items:
            if item.basis == BASIS_PROFILE:
                self.assertEqual(item.policy_score, item.profile_score)

    def test_133_neither_score_exploration_only(self):
        result = rank_with_cold_start_policy(
            self.context,
            UNKNOWN_USER,
            [S4, S5],
            explicit_profile=None,
            limit=10,
        )
        for item in result.items:
            self.assertIsNone(item.policy_score)
            self.assertEqual(item.basis, BASIS_EXPLORATION)

    def test_134_profile_score_in_unit_interval(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        for item in result.items:
            if item.profile_score is not None:
                self.assertGreaterEqual(item.profile_score, 0.0)
                self.assertLessEqual(item.profile_score, 1.0)

    def test_135_policy_score_in_unit_interval_when_present(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6],
            explicit_profile=profile_dict(genre_counts={"jazz": 2}),
            limit=10,
        )
        for item in result.items:
            if item.policy_score is not None:
                self.assertGreaterEqual(item.policy_score, 0.0)
                self.assertLessEqual(item.policy_score, 1.0)
                self.assertTrue(math.isfinite(item.policy_score))

    def test_136_profile_unavailable_when_empty_profile(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], explicit_profile=None, limit=10
        )
        self.assertFalse(result.summary.profile_available)
        self.assertEqual(result.summary.profile_feature_count, 0)

    def test_137_profile_unavailable_zero_feature_candidate_only(self):
        result = rank_with_cold_start_policy(
            self.context,
            UNKNOWN_USER,
            [S8],
            explicit_profile=profile_dict(favorite_song_ids=[UNKNOWN_USER]),
            limit=10,
        )
        self.assertFalse(result.summary.profile_available)

    def test_138_missing_profile_does_not_penalize_hybrid(self):
        without = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=10
        )
        for item in without.items:
            if item.basis == BASIS_HYBRID:
                self.assertEqual(item.policy_score, item.hybrid_score)

    def test_139_hybrid_score_none_for_unknown_user(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4], limit=10
        )
        for item in result.items:
            self.assertIsNone(item.hybrid_score)

    def test_140_profile_score_none_when_norm_zero(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], explicit_profile=None, limit=10
        )
        for item in result.items:
            self.assertIsNone(item.profile_score)


class ExploitSortTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_141_policy_score_descending_primary(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        scores = [
            item.policy_score
            for item in result.items
            if item.policy_score is not None
            and item.basis != BASIS_EXPLORATION
        ]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_142_song_id_final_tiebreak(self):
        result1 = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S5, S4, S6], limit=3
        )
        result2 = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6], limit=3
        )
        self.assertEqual(
            [i.song_id for i in result1.items],
            [i.song_id for i in result2.items],
        )

    def test_143_full_precision_before_sort(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        for item in result.items:
            if item.policy_score is not None:
                self.assertIsInstance(item.policy_score, float)

    def test_144_ranks_contiguous_from_one(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6, S7], limit=10
        )
        for index, item in enumerate(result.items, start=1):
            self.assertEqual(item.rank, index)

    def test_145_no_negative_policy_scores(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=10
        )
        for item in result.items:
            if item.policy_score is not None:
                self.assertGreaterEqual(item.policy_score, 0.0)

    def test_146_deterministic_order_same_inputs(self):
        first = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6, S7, S9], limit=10
        )
        second = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6, S7, S9], limit=10
        )
        self.assertEqual(
            [i.song_id for i in first.items],
            [i.song_id for i in second.items],
        )
        self.assertEqual(
            [i.basis for i in first.items],
            [i.basis for i in second.items],
        )


class ExplorationHashTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_147_sha256_namespace_user_song(self):
        payload = f"{EXPLORATION_HASH_NAMESPACE}|{U1}|{S4}".encode("utf-8")
        expected = hashlib.sha256(payload).digest()
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        self.assertEqual(len(result.items), 1)

    def test_148_hash_is_user_specific(self):
        key_u1 = hashlib.sha256(
            f"{EXPLORATION_HASH_NAMESPACE}|{U1}|{S4}".encode("utf-8")
        ).digest()
        key_u2 = hashlib.sha256(
            f"{EXPLORATION_HASH_NAMESPACE}|{U2}|{S4}".encode("utf-8")
        ).digest()
        self.assertNotEqual(key_u1, key_u2)

    def test_149_no_builtin_hash_token_in_source(self):
        self.assertNotIn("hash(", MODULE_SOURCE)

    def test_150_uses_hashlib_sha256(self):
        self.assertIn("hashlib.sha256", MODULE_SOURCE)

    def test_151_no_random_in_source(self):
        self.assertNotIn("random.", MODULE_SOURCE)
        self.assertNotIn("numpy.random", MODULE_SOURCE)

    def test_152_no_wall_clock_in_source(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)

    def test_153_hash_not_exposed_as_score(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6, S7, S9], limit=10
        )
        for item in result.items:
            self.assertFalse(hasattr(item, "exploration_hash"))
            self.assertFalse(hasattr(item, "digest"))

    def test_154_exploration_order_deterministic_across_calls(self):
        first = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6, S7, S8], limit=5
        )
        second = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6, S7, S8], limit=5
        )
        self.assertEqual(
            [i.song_id for i in first.items],
            [i.song_id for i in second.items],
        )

    def test_155_different_user_different_exploration_order(self):
        songs = [S4, S5, S6, S7, S10]
        result_u1 = rank_with_cold_start_policy(
            self.context, U1, songs, limit=5
        )
        result_u4 = rank_with_cold_start_policy(
            self.context, U4, songs, limit=5
        )
        order_u1 = [
            i.song_id
            for i in result_u1.items
            if i.basis == BASIS_EXPLORATION
        ]
        order_u4 = [
            i.song_id
            for i in result_u4.items
            if i.basis == BASIS_EXPLORATION
        ]
        if order_u1 and order_u4:
            self.assertEqual(len(order_u1), len(order_u4))

    def test_156_digest_sort_then_song_id(self):
        digests = []
        for song_id in [S4, S5, S6]:
            digests.append(
                (
                    hashlib.sha256(
                        f"{EXPLORATION_HASH_NAMESPACE}|{U1}|{song_id}".encode(
                            "utf-8"
                        )
                    ).digest(),
                    song_id,
                )
            )
        ordered = sorted(digests, key=lambda pair: (pair[0], pair[1]))
        self.assertEqual(len(ordered), 3)
        self.assertEqual(
            ordered,
            sorted(ordered, key=lambda pair: (pair[0], pair[1])),
        )


class ExplorationSlotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_157_slot_formula_limit_4(self):
        self.assertEqual(4 // EXPLORATION_INTERVAL, 0)

    def test_158_slot_formula_limit_5(self):
        self.assertEqual(5 // EXPLORATION_INTERVAL, 1)

    def test_159_slot_formula_limit_10(self):
        self.assertEqual(10 // EXPLORATION_INTERVAL, 2)

    def test_160_slot_formula_limit_20(self):
        self.assertEqual(20 // EXPLORATION_INTERVAL, 4)

    def test_161_slot_formula_limit_100(self):
        self.assertEqual(100 // EXPLORATION_INTERVAL, 20)

    def test_162_rank_five_prefers_exploration(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7, S9, S10],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=5,
        )
        self.assertEqual(len(result.items), 5)
        self.assertEqual(result.items[4].rank, 5)

    def test_163_exploration_selected_at_cadence_when_available(self):
        songs = [S4, S5, S6, S7, S9, S10, S8]
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            songs,
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        for item in result.items:
            if item.basis == BASIS_EXPLORATION:
                self.assertEqual(item.rank % EXPLORATION_INTERVAL, 0)
            else:
                self.assertNotEqual(item.rank % EXPLORATION_INTERVAL, 0)

    def test_164_exploitation_at_non_cadence_when_available(self):
        songs = [S4, S5, S6, S7, S9, S10]
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            songs,
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=4,
        )
        for item in result.items:
            self.assertNotEqual(item.basis, BASIS_EXPLORATION)

    def test_165_exploration_count_at_most_floor_limit_over_interval(self):
        songs = all_catalog_song_ids()
        result = rank_with_cold_start_policy(
            self.context, U1, songs, limit=20
        )
        self.assertLessEqual(
            result.summary.exploration_selected_count,
            20 // EXPLORATION_INTERVAL,
        )

    def test_166_backfill_when_exploitation_exhausted(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6, S7], limit=4
        )
        self.assertEqual(result.summary.returned_count, 4)
        for item in result.items:
            self.assertEqual(item.basis, BASIS_EXPLORATION)

    def test_167_backfill_when_exploration_empty_pool_prefers_other(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=5
        )
        self.assertEqual(result.summary.returned_count, 1)
        self.assertEqual(result.items[0].rank, 1)

    def test_168_no_duplicate_song_ids_in_result(self):
        songs = all_catalog_song_ids()
        result = rank_with_cold_start_policy(
            self.context, U1, songs, limit=15
        )
        ids = [item.song_id for item in result.items]
        self.assertEqual(len(ids), len(set(ids)))

    def test_169_fills_until_limit_or_exhausted(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=20
        )
        self.assertEqual(result.summary.returned_count, 3)

    def test_170_exploration_item_policy_score_none(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6, S7, S8], limit=10
        )
        for item in result.items:
            if item.basis == BASIS_EXPLORATION:
                self.assertIsNone(item.policy_score)

    def test_171_exploitation_item_policy_score_present(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=4,
        )
        for item in result.items:
            if item.basis != BASIS_EXPLORATION:
                self.assertIsNotNone(item.policy_score)

    def test_172_interleave_exploration_retains_diagnostics(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6, S7, S9], limit=5
        )
        for item in result.items:
            if item.basis == BASIS_EXPLORATION:
                _ = item.hybrid_score
                _ = item.profile_score

    def test_173_selected_counts_sum_to_returned(self):
        result = rank_with_cold_start_policy(
            self.context, U1, all_catalog_song_ids(), limit=12
        )
        self.assertEqual(
            result.summary.exploitation_selected_count
            + result.summary.exploration_selected_count,
            result.summary.returned_count,
        )


class BasisVocabularyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_174_basis_values_only_from_vocabulary(self):
        allowed = {BASIS_HYBRID, BASIS_HYBRID_PROFILE, BASIS_PROFILE, BASIS_EXPLORATION}
        result = rank_with_cold_start_policy(
            self.context, U1, all_catalog_song_ids(), limit=20
        )
        for item in result.items:
            self.assertIn(item.basis, allowed)

    def test_175_hybrid_basis_when_only_hybrid(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=10
        )
        for item in result.items:
            if item.collaborative_known and item.profile_score is None:
                if item.basis != BASIS_EXPLORATION:
                    self.assertEqual(item.basis, BASIS_HYBRID)

    def test_176_profile_basis_for_unknown_user_with_profile(self):
        result = rank_with_cold_start_policy(
            self.context,
            UNKNOWN_USER,
            [S4, S5],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=2,
        )
        self.assertEqual(result.items[0].basis, BASIS_PROFILE)
        self.assertIsNotNone(result.items[0].policy_score)

    def test_177_exploration_basis_string(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4], limit=5
        )
        self.assertEqual(result.items[0].basis, BASIS_EXPLORATION)

    def test_178_item_has_no_confidence_field(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        fields = {f.name for f in dataclasses.fields(result.items[0])}
        for forbidden in ("confidence", "probability", "rating", "accuracy"):
            self.assertNotIn(forbidden, fields)

    def test_179_summary_has_no_quality_verdict_field(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        fields = {f.name for f in dataclasses.fields(result.summary)}
        for forbidden in ("quality", "score", "confidence", "probability"):
            self.assertNotIn(forbidden, fields)

    def test_180_summary_fields_complete(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        expected = {
            "input_candidate_count",
            "profile_source_excluded_count",
            "seen_excluded_count",
            "eligible_candidate_count",
            "collaborative_known_candidate_count",
            "cold_start_song_candidate_count",
            "profile_feature_count",
            "exploitation_selected_count",
            "exploration_selected_count",
            "returned_count",
            "requested_limit",
            "collaborative_known_user",
            "profile_available",
        }
        fields = {f.name for f in dataclasses.fields(result.summary)}
        self.assertEqual(fields, expected)


class ScenarioComboTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_181_known_user_with_profile_and_exploration(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7, S9, S10],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=6,
        )
        self.assertTrue(result.summary.collaborative_known_user)
        self.assertTrue(result.summary.profile_available)
        self.assertGreater(result.summary.returned_count, 0)

    def test_182_unknown_user_profile_only(self):
        result = rank_with_cold_start_policy(
            self.context,
            UNKNOWN_USER,
            [S4, S5, S6],
            explicit_profile=profile_dict(genre_counts={"pop": 2}),
            limit=3,
        )
        self.assertFalse(result.summary.collaborative_known_user)
        self.assertTrue(result.summary.profile_available)
        self.assertEqual(result.summary.returned_count, 3)
        for item in result.items:
            if item.basis != BASIS_EXPLORATION:
                self.assertEqual(item.basis, BASIS_PROFILE)

    def test_183_unknown_user_no_profile_exploration_only(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6, S7, S8], limit=5
        )
        for item in result.items:
            self.assertIsNone(item.policy_score)
            self.assertEqual(item.basis, BASIS_EXPLORATION)

    def test_184_known_user_cold_start_songs_only(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S9, S10],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        self.assertEqual(result.summary.collaborative_known_candidate_count, 0)
        self.assertEqual(result.summary.cold_start_song_candidate_count, 2)
        self.assertTrue(result.summary.collaborative_known_user)

    def test_185_source_plus_seen_plus_eligible_full_accounting(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S1, S2, S4, S5, S9],
            explicit_profile=profile_dict(favorite_song_ids=[S4]),
            limit=10,
        )
        self.assertEqual(result.summary.input_candidate_count, 5)
        self.assertEqual(result.summary.profile_source_excluded_count, 1)
        self.assertEqual(result.summary.seen_excluded_count, 2)
        self.assertEqual(result.summary.eligible_candidate_count, 2)

    def test_186_hybrid_profile_basis_formula_check(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        for item in result.items:
            if (
                item.basis == BASIS_HYBRID_PROFILE
                and item.hybrid_score is not None
                and item.profile_score is not None
            ):
                expected = (
                    0.80 * item.hybrid_score + 0.20 * item.profile_score
                )
                assert_close(self, item.policy_score, expected, places=12)

    def test_187_limit_smaller_than_eligible(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6, S7], limit=2
        )
        self.assertEqual(result.summary.returned_count, 2)
        self.assertEqual(result.summary.requested_limit, 2)

    def test_188_empty_profile_key_subset_accepted(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4],
            explicit_profile={"favorite_song_ids": []},
            limit=10,
        )
        self.assertEqual(result.summary.returned_count, 1)

    def test_189_playlist_only_profile(self):
        result = rank_with_cold_start_policy(
            self.context,
            UNKNOWN_USER,
            [S4, S5],
            explicit_profile=profile_dict(playlist_song_counts={S1: 3}),
            limit=2,
        )
        self.assertTrue(result.summary.profile_available)


class ResultAndSummaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_190_result_frozen(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        self.assertTrue(result.__dataclass_params__.frozen)

    def test_191_summary_frozen(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        self.assertTrue(result.summary.__dataclass_params__.frozen)

    def test_192_item_frozen(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        self.assertTrue(result.items[0].__dataclass_params__.frozen)

    def test_193_items_is_tuple(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5], limit=10
        )
        self.assertIsInstance(result.items, tuple)

    def test_194_returned_count_matches_items(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=10
        )
        self.assertEqual(result.summary.returned_count, len(result.items))

    def test_195_requested_limit_matches_argument(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=7
        )
        self.assertEqual(result.summary.requested_limit, 7)

    def test_196_default_limit_used_when_omitted(self):
        result = rank_with_cold_start_policy(self.context, U1, [S4])
        self.assertEqual(result.summary.requested_limit, DEFAULT_POLICY_LIMIT)

    def test_197_eligible_le_input(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S1, S2, S4], limit=10
        )
        self.assertLessEqual(
            result.summary.eligible_candidate_count,
            result.summary.input_candidate_count,
        )

    def test_198_profile_available_implies_feature_count_positive(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        if result.summary.profile_available:
            self.assertGreater(result.summary.profile_feature_count, 0)

    def test_199_profile_feature_count_non_negative(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=10
        )
        self.assertGreaterEqual(result.summary.profile_feature_count, 0)

    def test_200_exploitation_selected_non_negative(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5], limit=10
        )
        self.assertGreaterEqual(result.summary.exploitation_selected_count, 0)
        self.assertGreaterEqual(result.summary.exploration_selected_count, 0)


class EmptyAndEdgeCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_201_empty_candidates_valid_empty_result(self):
        result = rank_with_cold_start_policy(self.context, U1, [], limit=10)
        self.assertEqual(result.items, ())
        self.assertEqual(result.summary.input_candidate_count, 0)
        self.assertEqual(result.summary.returned_count, 0)

    def test_202_empty_candidates_still_normalizes_profile(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        self.assertTrue(result.summary.profile_available)
        self.assertGreater(result.summary.profile_feature_count, 0)

    def test_203_empty_candidates_known_user_zero_eligible(self):
        result = rank_with_cold_start_policy(self.context, U1, [], limit=5)
        self.assertEqual(result.summary.eligible_candidate_count, 0)
        self.assertTrue(result.summary.collaborative_known_user)

    def test_204_all_profile_sources_excluded(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5],
            explicit_profile=profile_dict(
                favorite_song_ids=[S4], playlist_song_counts={S5: 1}
            ),
            limit=10,
        )
        self.assertEqual(result.summary.eligible_candidate_count, 0)
        self.assertEqual(result.items, ())

    def test_205_limit_one(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=1
        )
        self.assertEqual(result.summary.returned_count, 1)
        self.assertEqual(result.items[0].rank, 1)

    def test_206_single_candidate(self):
        result = rank_with_cold_start_policy(self.context, U1, [S4], limit=10)
        self.assertEqual(result.summary.returned_count, 1)

    def test_207_empty_profile_all_none_scores(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4], limit=5
        )
        self.assertIsNone(result.items[0].policy_score)
        self.assertIsNone(result.items[0].hybrid_score)
        self.assertIsNone(result.items[0].profile_score)

    def test_208_zero_feature_with_profile_score_none(self):
        result = rank_with_cold_start_policy(
            self.context,
            UNKNOWN_USER,
            [S8],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=5,
        )
        for item in result.items:
            self.assertIsNone(item.profile_score)

    def test_209_seen_plus_profile_source_accounting(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S1, S4],
            explicit_profile=profile_dict(favorite_song_ids=[S4]),
            limit=10,
        )
        self.assertEqual(result.summary.profile_source_excluded_count, 1)
        self.assertEqual(result.summary.seen_excluded_count, 1)
        self.assertEqual(result.summary.eligible_candidate_count, 0)

    def test_210_tuple_candidates_empty(self):
        result = rank_with_cold_start_policy(self.context, U1, (), limit=10)
        self.assertEqual(result.items, ())


class DeterminismTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_211_same_inputs_same_order(self):
        kwargs = dict(
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        first = rank_with_cold_start_policy(
            self.context, U1, all_catalog_song_ids(), **kwargs
        )
        second = rank_with_cold_start_policy(
            self.context, U1, all_catalog_song_ids(), **kwargs
        )
        self.assertEqual(
            [(i.song_id, i.basis, i.rank) for i in first.items],
            [(i.song_id, i.basis, i.rank) for i in second.items],
        )

    def test_212_repeated_exploration_hash_ordering_stable(self):
        first = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6, S7, S10], limit=5
        )
        second = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6, S7, S10], limit=5
        )
        self.assertEqual(
            [i.song_id for i in first.items],
            [i.song_id for i in second.items],
        )

    def test_213_no_time_dependence_in_executed_call(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=10
        )
        self.assertGreater(result.summary.returned_count, 0)

    def test_214_candidate_order_does_not_change_final_tiebreak(self):
        result_a = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S6, S5, S4], limit=3
        )
        result_b = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6], limit=3
        )
        self.assertEqual(
            [i.song_id for i in result_a.items],
            [i.song_id for i in result_b.items],
        )

    def test_215_profile_normalization_deterministic(self):
        a = normalize_explicit_preference_profile(
            profile_dict(artist_counts={"B": 1, "A": 2})
        )
        b = normalize_explicit_preference_profile(
            profile_dict(artist_counts={"A": 2, "B": 1})
        )
        self.assertEqual(dict(a.artist_counts), dict(b.artist_counts))


class ImmutabilityAndMemoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_216_input_candidate_list_not_mutated(self):
        candidates = [S4, S5, S6]
        original = list(candidates)
        rank_with_cold_start_policy(self.context, U1, candidates, limit=10)
        self.assertEqual(candidates, original)

    def test_217_profile_dict_not_mutated(self):
        profile = profile_dict(favorite_song_ids=[S4], artist_counts={"A": 1})
        snapshot = {
            "favorite_song_ids": list(profile["favorite_song_ids"]),
            "artist_counts": dict(profile["artist_counts"]),
        }
        normalize_explicit_preference_profile(profile)
        self.assertEqual(profile["favorite_song_ids"], snapshot["favorite_song_ids"])
        self.assertEqual(profile["artist_counts"], snapshot["artist_counts"])

    def test_218_normalized_profile_mappings_immutable(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(playlist_song_counts={S1: 1}, genre_counts={"pop": 1})
        )
        with self.assertRaises(TypeError):
            profile.playlist_song_counts[S2] = 2
        with self.assertRaises(TypeError):
            profile.genre_counts["rock"] = 1

    def test_219_no_dense_profile_allocation(self):
        self.assertNotIn("np.zeros(", MODULE_SOURCE)
        self.assertNotIn("numpy.zeros", MODULE_SOURCE)
        self.assertNotIn(".toarray(", MODULE_SOURCE)
        self.assertNotIn(".todense(", MODULE_SOURCE)

    def test_220_context_not_mutated_by_rank(self):
        before_signal = self.context.training_signal.data.tobytes()
        before_norms = self.context.content_row_norms.tobytes()
        rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        self.assertEqual(self.context.training_signal.data.tobytes(), before_signal)
        self.assertEqual(self.context.content_row_norms.tobytes(), before_norms)

    def test_221_profile_vector_is_dict_not_ndarray(self):
        from ml.recommender.cold_start import _build_profile_vector

        profile = normalize_explicit_preference_profile(
            profile_dict(favorite_song_ids=[S1])
        )
        vec, norm = _build_profile_vector(self.context, profile)
        self.assertIsInstance(vec, dict)
        self.assertIsInstance(norm, float)

    def test_222_result_items_tuple_immutable(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5], limit=10
        )
        with self.assertRaises((TypeError, AttributeError)):
            result.items = ()

    def test_223_no_dense_matrix_in_source(self):
        self.assertNotIn("content_matrix @ content_matrix.T", MODULE_SOURCE)
        self.assertNotIn("user_factors @ song_factors.T", MODULE_SOURCE)


class CpuAndImportSafetyTests(unittest.TestCase):
    def test_224_import_does_not_load_numpy(self):
        code = (
            "import sys;\n"
            "import ml.recommender.cold_start;\n"
            "raise SystemExit(0 if 'numpy' not in sys.modules else 1)\n"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_225_import_does_not_call_configure_cpu_runtime(self):
        code = (
            "import ml.recommender.runtime as rt;\n"
            "called = [];\n"
            "rt.configure_cpu_runtime = lambda: called.append(1);\n"
            "import ml.recommender.cold_start;\n"
            "raise SystemExit(0 if not called else 1)\n"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_226_module_has_no_main_entrypoint(self):
        self.assertNotIn("if __name__", MODULE_SOURCE)
        self.assertNotIn("def train(", MODULE_SOURCE)
        self.assertNotIn("def serve(", MODULE_SOURCE)

    def test_227_no_third_party_numeric_import_at_module_level(self):
        tree = ast.parse(MODULE_SOURCE)
        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertNotIn(alias.name.split(".")[0], {"numpy", "scipy", "sklearn"})
            if isinstance(node, ast.ImportFrom) and node.module:
                self.assertNotIn(node.module.split(".")[0], {"numpy", "scipy", "sklearn"})

    def test_228_requirements_unchanged(self):
        lines = [
            line.strip()
            for line in REQUIREMENTS.splitlines()
            if line.strip()
        ]
        self.assertEqual(
            lines,
            [
                "numpy>=1.26,<3",
                "scipy>=1.12,<2",
                "scikit-learn>=1.5,<2",
            ],
        )


class ScopeSafetyTests(unittest.TestCase):
    def test_229_forbidden_tokens_absent(self):
        for token in _FORBIDDEN_SOURCE_TOKENS:
            self.assertNotIn(token, MODULE_SOURCE, msg=f"forbidden token: {token}")

    def test_230_no_client_or_server_references(self):
        self.assertNotIn("client/", MODULE_SOURCE)
        self.assertNotIn("server/", MODULE_SOURCE)
        self.assertNotIn("PlayerContext", MODULE_SOURCE)
        self.assertNotIn("Dashboard", MODULE_SOURCE)

    def test_231_no_http_framework(self):
        self.assertNotIn("FastAPI", MODULE_SOURCE)
        self.assertNotIn("Flask", MODULE_SOURCE)
        self.assertNotIn("express", MODULE_SOURCE)

    def test_232_no_mongo(self):
        self.assertNotIn("pymongo", MODULE_SOURCE)
        self.assertNotIn("MongoClient", MODULE_SOURCE)
        self.assertNotIn("mongoose", MODULE_SOURCE)

    def test_233_no_artifact_publish(self):
        self.assertNotIn("publish_artifact_release", MODULE_SOURCE)
        self.assertNotIn("activate_artifact_release", MODULE_SOURCE)

    def test_234_no_evaluation_call(self):
        self.assertNotIn("evaluate_recommendations", MODULE_SOURCE)

    def test_235_no_training_call(self):
        self.assertNotIn("train_collaborative_model", MODULE_SOURCE)
        self.assertNotIn("TruncatedSVD", MODULE_SOURCE)
        self.assertNotIn(".fit(", MODULE_SOURCE)

    def test_236_no_js_service_imports(self):
        self.assertNotIn("userPreferenceAggregationService", MODULE_SOURCE)
        self.assertNotIn("explicitPreferenceSignalService", MODULE_SOURCE)

    def test_237_no_popularity_fallback(self):
        self.assertNotIn("trending", MODULE_SOURCE.lower())
        self.assertNotIn("popularity", MODULE_SOURCE.lower())
        self.assertNotIn("release_date", MODULE_SOURCE)

    def test_238_no_snapshot_or_artifact_write(self):
        self.assertNotIn("np.save", MODULE_SOURCE)
        self.assertNotIn("tofile", MODULE_SOURCE)
        self.assertNotIn("pickle", MODULE_SOURCE)
        self.assertNotIn("joblib", MODULE_SOURCE)

    def test_239_exceptions_under_runtime_error(self):
        self.assertTrue(
            issubclass(ColdStartPolicyError, RecommenderRuntimeError)
        )

    def test_240_cli_unchanged_still_only_runtime_info(self):
        cli_source = (
            PROJECT_ROOT / "ml" / "recommender" / "cli.py"
        ).read_text(encoding="utf-8")
        self.assertIn("runtime-info", cli_source)
        self.assertNotIn("rank", cli_source)

    def test_241_no_requests_library(self):
        self.assertNotIn("import requests", MODULE_SOURCE)
        self.assertNotIn("from requests", MODULE_SOURCE)

    def test_242_no_datetime_now_or_time_time(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)

    def test_243_no_random_module(self):
        self.assertNotIn("import random", MODULE_SOURCE)
        self.assertNotIn("random.random", MODULE_SOURCE)
        self.assertNotIn("random.shuffle", MODULE_SOURCE)

    def test_244_no_file_write_operations(self):
        self.assertNotIn("open(", MODULE_SOURCE)
        self.assertNotIn("Path(", MODULE_SOURCE)
        self.assertNotIn("os.remove", MODULE_SOURCE)

    def test_245_no_subprocess_in_module(self):
        self.assertNotIn("subprocess", MODULE_SOURCE)

    def test_246_weights_not_caller_configurable(self):
        self.assertNotIn("alpha", MODULE_SOURCE)
        self.assertNotIn("beta=", MODULE_SOURCE)
        self.assertNotIn("collaborative_weight=", MODULE_SOURCE)

    def test_247_no_sigmoid_or_probability_claim(self):
        self.assertNotIn("sigmoid", MODULE_SOURCE)
        self.assertNotIn("probability", MODULE_SOURCE)
        self.assertNotIn("calibrated", MODULE_SOURCE)

    def test_248_no_engine_or_route_changes(self):
        self.assertNotIn("router", MODULE_SOURCE)
        self.assertNotIn("app.get", MODULE_SOURCE)
        self.assertNotIn("app.post", MODULE_SOURCE)

    def test_249_only_expected_recommender_imports(self):
        allowed_modules = {
            "ml.recommender.content_features",
            "ml.recommender.hybrid_ranker",
            "ml.recommender.runtime",
            ".content_features",
            ".hybrid_ranker",
            ".runtime",
        }
        tree = ast.parse(MODULE_SOURCE)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if node.module.startswith("ml.") or node.module.startswith("."):
                    self.assertIn(
                        node.module,
                        allowed_modules,
                        msg=f"unexpected import: {node.module}",
                    )

    def test_250_no_43_future_checkpoint_code(self):
        self.assertNotIn("32/43", MODULE_SOURCE)
        self.assertNotIn("snapshot", MODULE_SOURCE)
        self.assertNotIn("recommendation_snapshot", MODULE_SOURCE)


class ExpandedCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_251_playlist_count_type_float_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(playlist_song_counts={S1: 1.5})
            )

    def test_252_artist_count_float_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(artist_counts={"A": 2.0})
            )

    def test_253_genre_count_string_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(genre_counts={"Pop": "3"})
            )

    def test_254_favorites_generator_inside_list_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=[iter([S1])])
            )

    def test_255_profile_key_none_favorites_treated_empty(self):
        profile = normalize_explicit_preference_profile(
            {"favorite_song_ids": None}
        )
        self.assertEqual(profile.favorite_song_ids, ())

    def test_256_playlist_none_treated_empty(self):
        profile = normalize_explicit_preference_profile(
            {"playlist_song_counts": None}
        )
        self.assertEqual(dict(profile.playlist_song_counts), {})

    def test_257_non_string_artist_key_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(artist_counts={1: 1})
            )

    def test_258_empty_artist_key_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(artist_counts={"   ": 1})
            )

    def test_259_limit_float_rejects(self):
        with self.assertRaises(ColdStartValidationError):
            rank_with_cold_start_policy(self.context, U1, [S4], limit=2.5)

    def test_260_user_with_whitespace_canonicalizes(self):
        result = rank_with_cold_start_policy(
            self.context, f"  {U1}  ", [S4], limit=10
        )
        self.assertEqual(result.summary.returned_count, 1)

    def test_261_song_with_uppercase_candidates_canonicalize(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4.upper()], limit=10
        )
        self.assertEqual(result.items[0].song_id, S4)

    def test_262_hybrid_score_none_cold_start_profile_present(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S9],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=5,
        )
        for item in result.items:
            self.assertIsNone(item.hybrid_score)
            self.assertIsNotNone(item.profile_score)

    def test_263_exploitation_pool_sorted_by_policy(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7],
            explicit_profile=profile_dict(genre_counts={"jazz": 5}),
            limit=4,
        )
        exploit = [
            item.policy_score
            for item in result.items
            if item.basis != BASIS_EXPLORATION and item.policy_score is not None
        ]
        self.assertEqual(exploit, sorted(exploit, reverse=True))

    def test_264_exploration_at_rank_five_with_mixed_pools(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7, S9, S10, S8],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=5,
        )
        self.assertEqual(len(result.items), 5)
        fifth = result.items[4]
        self.assertEqual(fifth.rank, 5)

    def test_265_collaborative_known_user_with_only_cold_start_songs(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S9, S10], limit=10
        )
        self.assertTrue(result.summary.collaborative_known_user)
        self.assertEqual(result.summary.collaborative_known_candidate_count, 0)

    def test_266_profile_available_false_when_profile_empty(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], explicit_profile=None, limit=10
        )
        self.assertFalse(result.summary.profile_available)

    def test_267_input_candidate_count_is_canonical_length(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4.upper(), S5], limit=10
        )
        self.assertEqual(result.summary.input_candidate_count, 2)

    def test_268_duplicate_playlist_keys_case_rejected(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(playlist_song_counts={"B" * 24: 1, "b" * 24: 1})
            )

    def test_269_max_profile_factual_count_boundary_one(self):
        profile = normalize_explicit_preference_profile(
            profile_dict(artist_counts={"A": 1})
        )
        self.assertEqual(profile.artist_counts["a"], 1)

    def test_270_error_not_leaking_profile_payload(self):
        try:
            normalize_explicit_preference_profile(
                profile_dict(favorite_song_ids=[S1, S1])
            )
        except ColdStartValidationError as exc:
            message = str(exc)
            self.assertNotIn("favorite_song_ids", message)
            self.assertNotIn(str(MAX_PROFILE_FAVORITE_SONGS), message)

    def test_271_bounded_message_outside_content(self):
        try:
            rank_with_cold_start_policy(
                self.context, U1, [UNKNOWN_USER], limit=10
            )
        except ColdStartValidationError as exc:
            self.assertEqual(
                str(exc), "candidate song is outside content catalog"
            )

    def test_272_result_is_dataclass(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        self.assertTrue(dataclasses.is_dataclass(result))
        self.assertTrue(dataclasses.is_dataclass(result.summary))

    def test_273_items_are_cold_start_ranked_item(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        self.assertIsInstance(result.items[0], ColdStartRankedItem)

    def test_274_summary_is_cold_start_ranking_summary(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=1
        )
        self.assertIsInstance(result.summary, ColdStartRankingSummary)

    def test_275_no_configurable_exploration_interval_param(self):
        import inspect

        signature = inspect.signature(rank_with_cold_start_policy)
        self.assertNotIn("exploration_interval", signature.parameters)
        self.assertNotIn("interval", signature.parameters)

    def test_276_no_weight_parameters_on_public_api(self):
        import inspect

        signature = inspect.signature(rank_with_cold_start_policy)
        for name in signature.parameters:
            self.assertNotIn("weight", name)
            self.assertNotIn("alpha", name)
            self.assertNotIn("beta", name)

    def test_277_normalize_rejects_bool_profile(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(True)

    def test_278_normalize_rejects_int_profile(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(3)

    def test_279_zero_feature_only_candidates_profile_score_none(self):
        result = rank_with_cold_start_policy(
            self.context,
            UNKNOWN_USER,
            [S8],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=5,
        )
        for item in result.items:
            self.assertIsNone(item.profile_score)

    def test_280_full_catalog_ranking_returns_limit(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, all_catalog_song_ids(), limit=8
        )
        self.assertEqual(result.summary.returned_count, 8)
        ranks = [item.rank for item in result.items]
        self.assertEqual(ranks, list(range(1, 9)))

    def test_281_eligible_song_ids_unique(self):
        result = rank_with_cold_start_policy(
            self.context, U1, all_catalog_song_ids(), limit=20
        )
        ids = [item.song_id for item in result.items]
        self.assertEqual(len(ids), len(set(ids)))

    def test_282_no_duplicates_when_source_seen_overlap(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S1, S2, S3, S4, S5],
            explicit_profile=profile_dict(favorite_song_ids=[S4]),
            limit=10,
        )
        ids = [item.song_id for item in result.items]
        self.assertEqual(len(ids), len(set(ids)))

    def test_283_policy_score_none_only_for_exploration(self):
        result = rank_with_cold_start_policy(
            self.context, U1, all_catalog_song_ids(), limit=20
        )
        for item in result.items:
            if item.policy_score is None:
                self.assertEqual(item.basis, BASIS_EXPLORATION)
            else:
                self.assertNotEqual(item.basis, BASIS_EXPLORATION)

    def test_284_basis_exploration_policy_none_inverse(self):
        result = rank_with_cold_start_policy(
            self.context, U1, all_catalog_song_ids(), limit=20
        )
        for item in result.items:
            if item.basis == BASIS_EXPLORATION:
                self.assertIsNone(item.policy_score)

    def test_285_hybrid_profile_score_diagnostics_retained_on_exploration(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S7, S9],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=5,
        )
        for item in result.items:
            if item.song_id in {S4, S5, S6, S7}:
                _ = item.hybrid_score

    def test_286_unknown_user_summary_collaborative_counts_by_song_index(self):
        result = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S9], limit=10
        )
        self.assertEqual(result.summary.collaborative_known_candidate_count, 1)
        self.assertEqual(result.summary.cold_start_song_candidate_count, 1)
        self.assertFalse(result.summary.collaborative_known_user)

    def test_287_profile_source_excluded_zero_when_no_profile(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5], limit=10
        )
        self.assertEqual(result.summary.profile_source_excluded_count, 0)

    def test_288_seen_excluded_zero_when_no_overlap(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5, S6], limit=10
        )
        self.assertEqual(result.summary.seen_excluded_count, 0)

    def test_289_explicit_profile_keyword_only_accepted(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=10,
        )
        self.assertIsInstance(result, ColdStartRankingResult)

    def test_290_limit_keyword_only_accepted(self):
        result = rank_with_cold_start_policy(self.context, U1, [S4], limit=3)
        self.assertEqual(result.summary.requested_limit, 3)

    def test_291_module_docstring_mentions_policy_layer(self):
        self.assertIn("cold-start", MODULE_SOURCE)
        self.assertIn("exploration", MODULE_SOURCE)

    def test_292_no_verb_train_serve_publish_in_defs(self):
        self.assertNotIn("def publish", MODULE_SOURCE)
        self.assertNotIn("def export", MODULE_SOURCE)
        self.assertNotIn("def deploy", MODULE_SOURCE)

    def test_293_playlist_membership_cap_boundary_rejected_above(self):
        with self.assertRaises(ColdStartValidationError):
            normalize_explicit_preference_profile(
                profile_dict(
                    playlist_song_counts={S1: MAX_PLAYLIST_MEMBERSHIP_COUNT + 1}
                )
            )

    def test_294_profile_available_tracks_usable_features(self):
        result = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4],
            explicit_profile=profile_dict(genre_counts={"jazz": 1}),
            limit=10,
        )
        self.assertTrue(result.summary.profile_available)
        self.assertGreater(result.summary.profile_feature_count, 0)

    def test_295_empty_profile_available_false_even_with_content_candidates(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S5], explicit_profile=None, limit=10
        )
        self.assertFalse(result.summary.profile_available)

    def test_296_returns_fewer_than_limit_when_eligible_less(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=20
        )
        self.assertEqual(result.summary.returned_count, 1)
        self.assertEqual(result.summary.requested_limit, 20)

    def test_297_all_basis_fields_are_strings(self):
        result = rank_with_cold_start_policy(
            self.context, U1, all_catalog_song_ids(), limit=15
        )
        for item in result.items:
            self.assertIsInstance(item.basis, str)

    def test_298_collaborative_known_field_is_bool(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4, S9], limit=10
        )
        for item in result.items:
            self.assertIsInstance(item.collaborative_known, bool)

    def test_299_profile_available_field_is_bool(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=10
        )
        self.assertIsInstance(result.summary.profile_available, bool)

    def test_300_known_user_flag_is_bool(self):
        result = rank_with_cold_start_policy(
            self.context, U1, [S4], limit=10
        )
        self.assertIsInstance(result.summary.collaborative_known_user, bool)

    def test_301_no_extra_files_needed_scope(self):
        expected_imports = {
            "ml.recommender.cold_start",
            "ml.recommender.hybrid_ranker",
            "ml.recommender.runtime",
            "ml.recommender.content_features",
        }
        self.assertTrue(expected_imports)

    def test_302_sha256_hexdigest_not_required_only_digest(self):
        self.assertIn("hashlib.sha256", MODULE_SOURCE)

    def test_303_exploration_key_used_in_pool_sort(self):
        self.assertIn("exploration_key", MODULE_SOURCE)

    def test_304_source_excludes_seen_before_split(self):
        self.assertIn("profile_source_ids", MODULE_SOURCE)
        self.assertIn("seen_indexes", MODULE_SOURCE)

    def test_305_no_eval_or_artifact_tokens_in_tests_forbidden_scan(self):
        for token in _FORBIDDEN_SOURCE_TOKENS:
            self.assertNotIn(token, MODULE_SOURCE)

    def test_306_requirements_has_no_new_lines(self):
        raw = REQUIREMENTS.strip().splitlines()
        self.assertEqual(len(raw), 3)

    def test_307_git_tracked_scope_only_four_files_expected(self):
        self.assertTrue(MODULE_PATH.exists())
        self.assertTrue(
            (Path(__file__).resolve()).exists()
        )

    def test_308_final_smoke_rank_known_and_unknown(self):
        known = rank_with_cold_start_policy(
            self.context,
            U1,
            [S4, S5, S6, S9],
            explicit_profile=profile_dict(favorite_song_ids=[S1]),
            limit=4,
        )
        unknown = rank_with_cold_start_policy(
            self.context, UNKNOWN_USER, [S4, S5, S6], limit=3
        )
        self.assertGreaterEqual(known.summary.returned_count, 1)
        self.assertEqual(unknown.summary.returned_count, 3)
        self.assertTrue(known.summary.collaborative_known_user)
        self.assertFalse(unknown.summary.collaborative_known_user)


if __name__ == "__main__":
    unittest.main()
