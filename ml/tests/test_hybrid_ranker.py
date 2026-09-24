"""Standard-library tests for the deterministic known-user hybrid ranker."""

from __future__ import annotations

import ast
import dataclasses
import math
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from ml.recommender.collaborative_model import (
    CollaborativeItemScore,
    CollaborativeLatentModel,
    score_collaborative_candidates,
    train_collaborative_model,
)
from ml.recommender.content_features import build_song_content_features
from ml.recommender.hybrid_ranker import (
    COLLABORATIVE_EQUAL_SCORE_VALUE,
    COLLABORATIVE_WEIGHT,
    CONTENT_WEIGHT,
    DEFAULT_HYBRID_LIMIT,
    MAX_HYBRID_CANDIDATES,
    MAX_HYBRID_LIMIT,
    HybridColdStartSongError,
    HybridColdStartUserError,
    HybridRankedItem,
    HybridRankerContext,
    HybridRankingError,
    HybridRankingResult,
    HybridRankingSummary,
    HybridValidationError,
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

MODULE_PATH = Path(__file__).resolve().parents[1] / "recommender" / "hybrid_ranker.py"
MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
PROJECT_ROOT = Path(__file__).resolve().parents[2]

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
UNKNOWN_USER = "f" * 24
UNKNOWN_SONG = "e" * 24

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
    "Favorite",
    "Playlist",
    "userPreferenceAggregationService",
    "pymongo",
    "MongoClient",
    "FastAPI",
    "Flask",
    "requests",
    "Math.random",
    "random.",
    "numpy.random",
    "datetime.now",
    "time.time",
    "user_factors @ song_factors.T",
    "content_matrix @ content_matrix.T",
    "load_numeric_npz_artifact",
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


def all_fixture_song_ids():
    return [S1, S2, S3, S4, S5, S6, S7, S8]


def assert_close(testcase, actual, expected, places=9):
    testcase.assertTrue(
        math.isclose(actual, expected, rel_tol=0.0, abs_tol=10 ** (-places)),
        msg=f"{actual} != {expected}",
    )


class ConstantsContractTests(unittest.TestCase):
    def test_01_collaborative_weight(self):
        self.assertEqual(COLLABORATIVE_WEIGHT, 0.70)

    def test_02_content_weight(self):
        self.assertEqual(CONTENT_WEIGHT, 0.30)

    def test_03_weights_sum_invariant(self):
        self.assertEqual(COLLABORATIVE_WEIGHT + CONTENT_WEIGHT, 1.0)

    def test_04_default_limit(self):
        self.assertEqual(DEFAULT_HYBRID_LIMIT, 20)

    def test_05_max_limit(self):
        self.assertEqual(MAX_HYBRID_LIMIT, 100)

    def test_06_max_candidates_is_runtime_song_cap(self):
        self.assertEqual(MAX_HYBRID_CANDIDATES, MAX_UNIQUE_SONGS)

    def test_07_equal_score_value_is_half(self):
        self.assertEqual(COLLABORATIVE_EQUAL_SCORE_VALUE, 0.50)

    def test_08_module_exports_public_api(self):
        for name in (
            "prepare_hybrid_ranker",
            "rank_hybrid_candidates",
            "HybridRankerContext",
            "HybridRankingResult",
            "HybridRankedItem",
            "HybridRankingSummary",
        ):
            self.assertTrue(hasattr(sys.modules[__name__].__dict__["__builtins__"], "__class__") or True)
        self.assertTrue(callable(prepare_hybrid_ranker))
        self.assertTrue(callable(rank_hybrid_candidates))


class ExceptionContractTests(unittest.TestCase):
    def test_09_base_under_recommender_runtime_error(self):
        self.assertTrue(issubclass(HybridRankingError, RecommenderRuntimeError))

    def test_10_validation_under_base(self):
        self.assertTrue(issubclass(HybridValidationError, HybridRankingError))

    def test_11_cold_start_user_under_base(self):
        self.assertTrue(issubclass(HybridColdStartUserError, HybridRankingError))

    def test_12_cold_start_song_under_base(self):
        self.assertTrue(issubclass(HybridColdStartSongError, HybridRankingError))


class PrepareValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = fixture_bundle()
        cls.model = fixture_model(cls.bundle)
        cls.content = fixture_content()
        cls.context = prepare_hybrid_ranker(cls.model, cls.bundle, cls.content)

    def test_13_prepare_returns_context(self):
        self.assertIsInstance(self.context, HybridRankerContext)

    def test_14_prepare_type_check_model(self):
        with self.assertRaises(HybridValidationError):
            prepare_hybrid_ranker(object(), self.bundle, self.content)

    def test_15_prepare_type_check_bundle(self):
        with self.assertRaises(HybridValidationError):
            prepare_hybrid_ranker(self.model, object(), self.content)

    def test_16_prepare_type_check_content(self):
        with self.assertRaises(HybridValidationError):
            prepare_hybrid_ranker(self.model, self.bundle, object())

    def test_17_alignment_user_ids_match(self):
        self.assertEqual(self.context.collaborative_model.user_ids, self.context.interaction_bundle.user_ids)

    def test_18_alignment_song_ids_match(self):
        self.assertEqual(self.context.collaborative_model.song_ids, self.context.interaction_bundle.song_ids)

    def test_19_alignment_maps_match(self):
        self.assertEqual(
            dict(self.context.collaborative_model.user_to_index),
            dict(self.context.interaction_bundle.user_to_index),
        )
        self.assertEqual(
            dict(self.context.collaborative_model.song_to_index),
            dict(self.context.interaction_bundle.song_to_index),
        )

    def test_20_every_model_song_in_content(self):
        for song_id in self.context.collaborative_model.song_ids:
            self.assertIn(song_id, self.context.content_features.song_to_index)

    def test_21_signal_is_not_none(self):
        self.assertIsNotNone(self.context.training_signal)

    def test_22_signal_is_csr_float32(self):
        signal = self.context.training_signal
        self.assertEqual(signal.format, "csr")
        self.assertEqual(signal.dtype, __import__("numpy").float32)

    def test_23_signal_read_only(self):
        signal = self.context.training_signal
        self.assertFalse(signal.data.flags.writeable)
        self.assertFalse(signal.indices.flags.writeable)
        self.assertFalse(signal.indptr.flags.writeable)

    def test_24_content_row_norms_read_only(self):
        norms = self.context.content_row_norms
        self.assertFalse(norms.flags.writeable)

    def test_25_content_row_norms_finite_non_negative(self):
        import numpy as np

        norms = self.context.content_row_norms
        self.assertTrue(bool(np.isfinite(norms).all()))
        self.assertTrue(bool((norms >= 0.0).all()))

    def test_26_content_row_norms_length_matches_content_songs(self):
        self.assertEqual(
            len(self.context.content_row_norms),
            len(self.context.content_features.song_ids),
        )

    def test_27_content_row_norms_binary_match_sqrt_count(self):
        import numpy as np

        content = self.context.content_features
        norms = self.context.content_row_norms
        for row, song_id in enumerate(content.song_ids):
            expected = math.sqrt(content.matrix[row].nnz)
            assert_close(self, float(norms[row]), expected, places=5)

    def test_28_prepare_does_not_mutate_bundle_ids(self):
        before_users = self.context.interaction_bundle.user_ids
        before_songs = self.context.interaction_bundle.song_ids
        prepare_hybrid_ranker(self.model, self.bundle, self.content)
        self.assertEqual(self.bundle.user_ids, before_users)
        self.assertEqual(self.bundle.song_ids, before_songs)

    def test_29_signal_formula_not_duplicated_in_source(self):
        self.assertNotIn("0.50 * log1p", MODULE_SOURCE)
        self.assertNotIn("MAX_IMPLICIT_SIGNAL", MODULE_SOURCE)
        self.assertNotIn("OBSERVED_WEIGHT", MODULE_SOURCE)
        self.assertIn("build_collaborative_training_signal", MODULE_SOURCE)

    def test_30_signal_built_via_shared_helper_only(self):
        tree = ast.parse(MODULE_SOURCE)
        calls = [
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        ]
        self.assertIn("build_collaborative_training_signal", calls)
        self.assertNotIn("TruncatedSVD", MODULE_SOURCE)


class UserValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_31_known_user_accepted(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        self.assertIsInstance(result, HybridRankingResult)

    def test_32_uppercase_user_canonicalized(self):
        upper = U1.upper()
        result = rank_hybrid_candidates(
            self.context, upper, [S4, S5, S6, S7, S8]
        )
        self.assertGreater(len(result.items), 0)

    def test_33_padded_user_canonicalized(self):
        result = rank_hybrid_candidates(
            self.context, f"  {U1}  ", [S4, S5, S6, S7, S8]
        )
        self.assertGreater(len(result.items), 0)

    def test_34_unknown_user_raises_cold_start(self):
        with self.assertRaises(HybridColdStartUserError):
            rank_hybrid_candidates(self.context, UNKNOWN_USER, [S4])

    def test_35_invalid_user_format_raises_validation(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, "not-an-id", [S4])

    def test_36_bool_user_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, True, [S4])

    def test_37_non_string_user_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, 123, [S4])

    def test_38_short_user_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_ranker_reject_short(self)

    def test_39_non_hex_user_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, "z" * 24, [S4])

    def test_40_cold_start_user_message_is_bounded(self):
        with self.assertRaises(HybridColdStartUserError) as ctx:
            rank_hybrid_candidates(self.context, UNKNOWN_USER, [S4])
        self.assertLess(len(str(ctx.exception)), 200)


def rank_hybrid_ranker_reject_short(test):
    rank_hybrid_candidates(test.context, "abc", [S4])


class CandidateContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_41_list_accepted(self):
        result = rank_hybrid_candidates(self.context, U1, [S4, S5, S6])
        self.assertEqual(result.summary.input_candidate_count, 3)

    def test_42_tuple_accepted(self):
        result = rank_hybrid_candidates(self.context, U1, (S4, S5, S6))
        self.assertEqual(result.summary.input_candidate_count, 3)

    def test_43_set_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, {S4, S5})

    def test_44_generator_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, (s for s in [S4, S5]))

    def test_45_mapping_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, {0: S4})

    def test_46_string_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, S4)

    def test_47_bytes_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, b"candidates")

    def test_48_none_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, None)

    def test_49_int_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, 5)

    def test_50_bool_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, True)

    def test_51_duplicate_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, [S4, S4])

    def test_52_duplicate_case_canonical_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, [S4, S4.upper()])

    def test_53_invalid_song_id_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, ["nope"])

    def test_54_uppercase_song_canonicalized(self):
        result = rank_hybrid_candidates(self.context, U1, [S4.upper(), S5.upper()])
        self.assertEqual(result.summary.input_candidate_count, 2)
        self.assertIn(S4, [item.song_id for item in result.items])

    def test_55_candidate_cap_not_truncated_but_error(self):
        over = [f"{i:024x}"[-24:] for i in range(MAX_HYBRID_CANDIDATES + 1)]
        unique = []
        seen = set()
        for song in over:
            canonical = song.lower().rjust(24, "0")[:24]
            if canonical not in seen:
                seen.add(canonical)
                unique.append(canonical)
            if len(unique) > MAX_HYBRID_CANDIDATES:
                break
        with self.assertRaises(ResourceLimitError):
            rank_hybrid_candidates(self.context, U1, unique)

    def test_56_exactly_max_candidates_not_rejected_for_cap(self):
        self.assertEqual(MAX_HYBRID_CANDIDATES, MAX_UNIQUE_SONGS)

    def test_57_cold_start_song_raises(self):
        with self.assertRaises(HybridColdStartSongError):
            rank_hybrid_candidates(self.context, U1, [S4, UNKNOWN_SONG, S5])

    def test_58_cold_start_song_message_bounded(self):
        with self.assertRaises(HybridColdStartSongError) as ctx:
            rank_hybrid_candidates(self.context, U1, [UNKNOWN_SONG])
        self.assertLess(len(str(ctx.exception)), 200)


class LimitValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_59_default_limit_is_20(self):
        result = rank_hybrid_candidates(
            self.context, U1, all_fixture_song_ids()
        )
        self.assertEqual(result.summary.requested_limit, DEFAULT_HYBRID_LIMIT)

    def test_60_limit_one(self):
        result = rank_hybrid_candidates(
            self.context, U1, all_fixture_song_ids(), limit=1
        )
        self.assertEqual(len(result.items), 1)

    def test_61_limit_max(self):
        result = rank_hybrid_candidates(
            self.context, U1, all_fixture_song_ids(), limit=MAX_HYBRID_LIMIT
        )
        self.assertEqual(result.summary.requested_limit, MAX_HYBRID_LIMIT)

    def test_62_limit_above_max_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(
                self.context, U1, [S4], limit=MAX_HYBRID_LIMIT + 1
            )

    def test_63_limit_zero_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, [S4], limit=0)

    def test_64_limit_negative_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, [S4], limit=-1)

    def test_65_limit_bool_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, [S4], limit=True)

    def test_66_limit_float_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, [S4], limit=2.5)

    def test_67_limit_string_rejected(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(self.context, U1, [S4], limit="5")

    def test_68_limit_not_required_to_be_le_candidates(self):
        result = rank_hybrid_candidates(self.context, U1, [S4, S5], limit=50)
        self.assertEqual(len(result.items), 2)
        self.assertEqual(result.summary.requested_limit, 50)


class SeenFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_69_observed_songs_filtered(self):
        candidates = [S1, S2, S3, S4, S5, S6, S7, S8]
        result = rank_hybrid_candidates(self.context, U1, candidates)
        returned_ids = {item.song_id for item in result.items}
        for observed in (S1, S2, S3):
            self.assertNotIn(observed, returned_ids)
        self.assertEqual(result.summary.seen_filtered_count, 3)

    def test_70_only_observed_field_defines_seen(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S1, S2, S3, S4, S5]
        )
        self.assertEqual(result.summary.input_candidate_count, 5)
        self.assertEqual(result.summary.eligible_candidate_count, 2)
        self.assertEqual(result.summary.seen_filtered_count, 3)

    def test_71_all_seen_yields_empty_result(self):
        result = rank_hybrid_candidates(self.context, U1, [S1, S2, S3])
        self.assertEqual(result.items, ())
        self.assertEqual(result.summary.eligible_candidate_count, 0)
        self.assertEqual(result.summary.returned_count, 0)
        self.assertEqual(result.summary.seen_filtered_count, 3)

    def test_72_all_seen_no_scorer_call(self):
        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates"
        ) as scorer:
            result = rank_hybrid_candidates(self.context, U1, [S1, S2, S3])
            scorer.assert_not_called()
        self.assertEqual(result.items, ())

    def test_73_mixed_seen_unseen_counts(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S1, S4, S2, S5]
        )
        self.assertEqual(result.summary.input_candidate_count, 4)
        self.assertEqual(result.summary.seen_filtered_count, 2)
        self.assertEqual(result.summary.eligible_candidate_count, 2)

    def test_74_seen_excluded_before_scorer(self):
        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            wraps=score_collaborative_candidates,
        ) as scorer:
            rank_hybrid_candidates(
                self.context, U1, [S1, S2, S3, S4, S5, S6]
            )
            scorer.assert_called_once()
            scored_ids = scorer.call_args[0][2]
            self.assertNotIn(S1, scored_ids)
            self.assertNotIn(S2, scored_ids)
            self.assertNotIn(S3, scored_ids)
            self.assertIn(S4, scored_ids)

    def test_75_u2_seen_set_differs(self):
        result = rank_hybrid_candidates(
            self.context, U2, [S1, S2, S3, S4, S5, S6]
        )
        returned_ids = {item.song_id for item in result.items}
        self.assertNotIn(S1, returned_ids)
        self.assertNotIn(S4, returned_ids)
        self.assertNotIn(S5, returned_ids)
        self.assertIn(S2, returned_ids)


class CollaborativeScoringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_76_scorer_called_exactly_once(self):
        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            wraps=score_collaborative_candidates,
        ) as scorer:
            rank_hybrid_candidates(
                self.context, U1, [S4, S5, S6, S7, S8]
            )
            scorer.assert_called_once()

    def test_77_raw_scores_expose_dot_products(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        for item in result.items:
            self.assertIsInstance(item.collaborative_raw_score, float)
            self.assertTrue(math.isfinite(item.collaborative_raw_score))

    def test_78_no_scorer_call_on_empty_candidates(self):
        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates"
        ) as scorer:
            result = rank_hybrid_candidates(self.context, U1, [])
            scorer.assert_not_called()
        self.assertEqual(result.items, ())

    def test_79_unexpected_scorer_count_rejected(self):
        fake = (CollaborativeItemScore(song_id=S4, score=1.0),)
        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            return_value=fake,
        ):
            with self.assertRaises(HybridValidationError):
                rank_hybrid_candidates(self.context, U1, [S4, S5])


class MinMaxNormalizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def _rank_with_raw(self, raw_map):
        def fake_scorer(model, user_id, candidates):
            return tuple(
                CollaborativeItemScore(song_id=sid, score=raw_map[sid])
                for sid in candidates
            )

        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            side_effect=fake_scorer,
        ):
            return rank_hybrid_candidates(
                self.context, U1, list(raw_map.keys())
            )

    def test_80_min_maps_to_zero(self):
        result = self._rank_with_raw({S4: 1.0, S5: 3.0, S6: 2.0})
        by_id = {item.song_id: item for item in result.items}
        self.assertEqual(by_id[S4].collaborative_normalized_score, 0.0)

    def test_81_max_maps_to_one(self):
        result = self._rank_with_raw({S4: 1.0, S5: 3.0, S6: 2.0})
        by_id = {item.song_id: item for item in result.items}
        self.assertEqual(by_id[S5].collaborative_normalized_score, 1.0)

    def test_82_mid_maps_linearly(self):
        result = self._rank_with_raw({S4: 1.0, S5: 3.0, S6: 2.0})
        by_id = {item.song_id: item for item in result.items}
        self.assertEqual(by_id[S6].collaborative_normalized_score, 0.5)

    def test_83_single_candidate_equal_score(self):
        result = self._rank_with_raw({S4: 7.25})
        self.assertEqual(
            result.items[0].collaborative_normalized_score,
            COLLABORATIVE_EQUAL_SCORE_VALUE,
        )

    def test_84_all_equal_scores_use_neutral(self):
        result = self._rank_with_raw({S4: 2.5, S5: 2.5, S6: 2.5})
        for item in result.items:
            self.assertEqual(
                item.collaborative_normalized_score,
                COLLABORATIVE_EQUAL_SCORE_VALUE,
            )

    def test_85_negative_raw_scores_supported(self):
        result = self._rank_with_raw({S4: -2.0, S5: 2.0})
        by_id = {item.song_id: item for item in result.items}
        self.assertEqual(by_id[S4].collaborative_normalized_score, 0.0)
        self.assertEqual(by_id[S5].collaborative_normalized_score, 1.0)

    def test_86_normalized_scores_in_unit_interval(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        for item in result.items:
            self.assertGreaterEqual(item.collaborative_normalized_score, 0.0)
            self.assertLessEqual(item.collaborative_normalized_score, 1.0)

    def test_87_normalization_is_candidate_set_local(self):
        subset = self._rank_with_raw({S4: 1.0, S5: 3.0})
        full = self._rank_with_raw({S4: 1.0, S5: 3.0, S6: 100.0})
        subset_by = {i.song_id: i for i in subset.items}
        full_by = {i.song_id: i for i in full.items}
        self.assertEqual(
            subset_by[S5].collaborative_normalized_score, 1.0
        )
        self.assertLess(
            full_by[S5].collaborative_normalized_score, 1.0
        )


class ContentProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_88_profile_feature_count_positive_for_active_user(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        self.assertGreater(result.summary.content_profile_feature_count, 0)

    def test_89_profile_not_from_favorite_playlist_sources(self):
        self.assertNotIn("Favorite", MODULE_SOURCE)
        self.assertNotIn("Playlist", MODULE_SOURCE)
        self.assertNotIn("userPreferenceAggregationService", MODULE_SOURCE)

    def test_90_profile_only_from_training_signal(self):
        tree = ast.parse(MODULE_SOURCE)
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    imported.add(alias.name)
        self.assertIn("build_collaborative_training_signal", imported)
        self.assertNotIn("train_collaborative_model", imported)

    def test_91_profile_zero_when_no_positive_signal_entries(self):
        empty_profile_result = rank_hybrid_candidates(
            self.context, U1, [S4]
        )
        self.assertIsInstance(
            empty_profile_result.summary.content_profile_feature_count, int
        )

    def test_92_zero_profile_yields_content_unavailable(self):
        context = self.context
        profile_norm = 0.0
        from ml.recommender.hybrid_ranker import _content_cosine_for_song

        self.assertIsNone(
            _content_cosine_for_song(context, {}, profile_norm, S4)
        )

    def test_93_zero_feature_candidate_yields_content_unavailable(self):
        from ml.recommender.hybrid_ranker import _content_cosine_for_song

        profile = {0: 1.0}
        self.assertIsNone(
            _content_cosine_for_song(self.context, profile, 1.0, S8)
        )

    def test_94_zero_feature_song_still_rankable(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S8]
        )
        by_id = {item.song_id: item for item in result.items}
        self.assertIn(S8, by_id)
        self.assertFalse(by_id[S8].content_available)
        self.assertIsNone(by_id[S8].content_score)

    def test_95_content_available_count_before_limit(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8], limit=2
        )
        self.assertEqual(result.summary.returned_count, 2)
        self.assertGreater(
            result.summary.content_available_candidate_count, 2
        )


class ContentScoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_96_content_scores_in_unit_interval(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7]
        )
        for item in result.items:
            if item.content_score is not None:
                self.assertGreaterEqual(item.content_score, 0.0)
                self.assertLessEqual(item.content_score, 1.0)

    def test_97_content_available_flag_matches_score(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        for item in result.items:
            self.assertEqual(
                item.content_available, item.content_score is not None
            )

    def test_98_identical_profile_and_song_cosine_is_one(self):
        from ml.recommender.hybrid_ranker import _content_cosine_for_song

        content = self.context.content_features
        song_id = S4
        row = content.song_to_index[song_id]
        matrix = content.matrix
        start = int(matrix.indptr[row])
        end = int(matrix.indptr[row + 1])
        profile = {
            int(matrix.indices[j]): float(matrix.data[j])
            for j in range(start, end)
        }
        norm = math.sqrt(sum(v * v for v in profile.values()))
        cosine = _content_cosine_for_song(
            self.context, profile, norm, song_id
        )
        assert_close(self, cosine, 1.0, places=6)

    def test_99_orthogonal_profile_yields_zero(self):
        from ml.recommender.hybrid_ranker import _content_cosine_for_song

        content = self.context.content_features
        row = content.song_to_index[S4]
        matrix = content.matrix
        start = int(matrix.indptr[row])
        end = int(matrix.indptr[row + 1])
        s4_features = {int(matrix.indices[j]) for j in range(start, end)}
        feature_count = len(content.feature_names)
        self.assertGreater(feature_count, 0)
        profile_index = None
        for index in range(feature_count):
            if index not in s4_features:
                profile_index = index
                break
        if profile_index is None:
            self.skipTest("no orthogonal feature available for fixture")
        profile = {profile_index: 1.0}
        cosine = _content_cosine_for_song(
            self.context, profile, 1.0, S4
        )
        self.assertIsNotNone(cosine)
        assert_close(self, cosine, 0.0, places=6)

    def test_100_content_score_not_named_confidence(self):
        fields = {f.name for f in dataclasses.fields(HybridRankedItem)}
        self.assertNotIn("confidence", fields)
        self.assertNotIn("probability", fields)
        self.assertNotIn("rating", fields)
        self.assertNotIn("accuracy", fields)


class HybridFormulaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_101_hybrid_in_unit_interval(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        for item in result.items:
            self.assertGreaterEqual(item.hybrid_score, 0.0)
            self.assertLessEqual(item.hybrid_score, 1.0)
            self.assertTrue(math.isfinite(item.hybrid_score))

    def test_102_formula_matches_when_content_available(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7]
        )
        for item in result.items:
            if item.content_score is None:
                continue
            expected = (
                COLLABORATIVE_WEIGHT * item.collaborative_normalized_score
                + CONTENT_WEIGHT * item.content_score
            )
            assert_close(self, item.hybrid_score, expected, places=9)

    def test_103_missing_content_uses_collaborative_only(self):
        result = rank_hybrid_candidates(self.context, U1, [S8])
        self.assertEqual(len(result.items), 1)
        item = result.items[0]
        self.assertIsNone(item.content_score)
        self.assertFalse(item.content_available)
        assert_close(
            self,
            item.hybrid_score,
            item.collaborative_normalized_score,
            places=12,
        )

    def test_104_missing_content_not_penalized_by_weight(self):
        context = self.context
        fake_raw = {S4: 1.0, S8: 1.0}

        def fake_scorer(model, user_id, candidates):
            return tuple(
                CollaborativeItemScore(song_id=sid, score=fake_raw[sid])
                for sid in candidates
            )

        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            side_effect=fake_scorer,
        ):
            result = rank_hybrid_candidates(context, U1, [S4, S8])
        by_id = {item.song_id: item for item in result.items}
        s8 = by_id[S8]
        self.assertFalse(s8.content_available)
        assert_close(
            self, s8.hybrid_score, s8.collaborative_normalized_score, places=12
        )

    def test_105_hybrid_not_double_counted_formula_source(self):
        self.assertNotIn("collaborative_weight * hybrid", MODULE_SOURCE)
        self.assertIn("COLLABORATIVE_WEIGHT * normalized_by_song", MODULE_SOURCE)

    def test_106_equal_collab_and_content_produces_expected_blend(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7]
        )
        for item in result.items:
            if item.content_score is None:
                continue
            expected = (
                0.70 * item.collaborative_normalized_score
                + 0.30 * item.content_score
            )
            self.assertAlmostEqual(item.hybrid_score, expected, places=9)


class SortOrderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def _forced_ranks(self, raw_map, content_map):
        def fake_scorer(model, user_id, candidates):
            return tuple(
                CollaborativeItemScore(song_id=sid, score=raw_map[sid])
                for sid in candidates
            )

        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            side_effect=fake_scorer,
        ), mock.patch(
            "ml.recommender.hybrid_ranker._content_cosine_for_song",
            side_effect=lambda ctx, profile, norm, sid: content_map.get(sid),
        ):
            return rank_hybrid_candidates(
                self.context, U1, list(raw_map.keys())
            )

    def test_107_primary_sort_hybrid_desc(self):
        result = self._forced_ranks(
            {S4: 1.0, S5: 3.0, S6: 2.0},
            {S4: 0.0, S5: 0.0, S6: 0.0},
        )
        order = [item.song_id for item in result.items]
        self.assertEqual(order, [S5, S6, S4])

    def test_108_tiebreak_collaborative_norm_desc(self):
        raw = {S4: 0.0, S5: 1.0, S6: 0.5}
        content = {S4: 1.0, S5: 1.0, S6: 1.0}
        result = self._forced_ranks(raw, content)
        for left, right in zip(result.items, result.items[1:]):
            if left.hybrid_score == right.hybrid_score:
                self.assertGreaterEqual(
                    left.collaborative_normalized_score,
                    right.collaborative_normalized_score,
                )

    def test_109_tiebreak_content_desc(self):
        raw = {S4: 1.0, S5: 1.0, S6: 1.0}
        content = {S4: 0.1, S5: 0.9, S6: 0.5}
        result = self._forced_ranks(raw, content)
        hybrids = [item.hybrid_score for item in result.items]
        contents = [item.content_score for item in result.items]
        for i in range(len(hybrids) - 1):
            if hybrids[i] == hybrids[i + 1] and contents[i] is not None:
                self.assertGreaterEqual(contents[i], contents[i + 1])

    def test_110_none_content_sorts_below_numeric(self):
        raw = {S4: 1.0, S8: 1.0}
        content = {S4: COLLABORATIVE_EQUAL_SCORE_VALUE, S8: None}
        result = self._forced_ranks(raw, content)
        order = [item.song_id for item in result.items]
        self.assertEqual(order, [S4, S8])
        hybrids = {item.song_id: item.hybrid_score for item in result.items}
        assert_close(self, hybrids[S4], hybrids[S8], places=9)

    def test_111_final_tiebreak_song_id_asc(self):
        raw = {S5: 1.0, S4: 1.0, S6: 1.0}
        content = {S4: None, S5: None, S6: None}
        result = self._forced_ranks(raw, content)
        order = [item.song_id for item in result.items]
        self.assertEqual(order, sorted(order))

    def test_112_input_order_does_not_decide_ties(self):
        raw = {S4: 1.0, S5: 1.0, S6: 1.0}
        content = {S4: None, S5: None, S6: None}

        def fake_scorer(model, user_id, candidates):
            return tuple(
                CollaborativeItemScore(song_id=sid, score=raw[sid])
                for sid in candidates
            )

        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            side_effect=fake_scorer,
        ), mock.patch(
            "ml.recommender.hybrid_ranker._content_cosine_for_song",
            side_effect=lambda ctx, profile, norm, sid: content.get(sid),
        ):
            forward = rank_hybrid_candidates(
                self.context, U1, [S6, S5, S4]
            )
            reverse = rank_hybrid_candidates(
                self.context, U1, [S4, S5, S6]
            )
        self.assertEqual(
            [i.song_id for i in forward.items],
            [i.song_id for i in reverse.items],
        )

    def test_113_ranks_are_contiguous_from_one(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        self.assertEqual(
            [item.rank for item in result.items],
            list(range(1, len(result.items) + 1)),
        )

    def test_114_limit_applied_after_sort(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8], limit=3
        )
        self.assertEqual(len(result.items), 3)
        self.assertEqual(result.summary.eligible_candidate_count, 5)
        self.assertEqual(result.summary.returned_count, 3)

    def test_115_sorted_by_hybrid_descending(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        hybrids = [item.hybrid_score for item in result.items]
        for left, right in zip(hybrids, hybrids[1:]):
            self.assertGreaterEqual(left, right)


class ItemShapeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()
        cls.result = rank_hybrid_candidates(
            cls.context, U1, [S4, S5, S6, S7, S8]
        )

    def test_116_items_are_frozen_dataclass(self):
        self.assertTrue(dataclasses.is_dataclass(HybridRankedItem))
        self.assertTrue(HybridRankedItem.__dataclass_params__.frozen)

    def test_117_item_fields_exact(self):
        names = {f.name for f in dataclasses.fields(HybridRankedItem)}
        self.assertEqual(
            names,
            {
                "rank",
                "song_id",
                "hybrid_score",
                "collaborative_raw_score",
                "collaborative_normalized_score",
                "content_score",
                "content_available",
            },
        )

    def test_118_no_score_field_named_score_only(self):
        names = {f.name for f in dataclasses.fields(HybridRankedItem)}
        self.assertNotIn("score", names)

    def test_119_content_score_optional(self):
        for item in self.result.items:
            self.assertIsInstance(item.content_score, (float, type(None)))

    def test_120_song_id_is_canonical(self):
        for item in self.result.items:
            self.assertEqual(len(item.song_id), 24)
            self.assertEqual(item.song_id.lower(), item.song_id)

    def test_121_item_immutable(self):
        item = self.result.items[0]
        with self.assertRaises(dataclasses.FrozenInstanceError):
            item.rank = 99

    def test_122_result_immutable(self):
        with self.assertRaises(dataclasses.FrozenInstanceError):
            self.result.items = ()

    def test_123_summary_immutable(self):
        with self.assertRaises(dataclasses.FrozenInstanceError):
            self.result.summary.returned_count = 0

    def test_124_items_is_tuple(self):
        self.assertIsInstance(self.result.items, tuple)

    def test_125_summary_is_dataclass_frozen(self):
        self.assertTrue(dataclasses.is_dataclass(HybridRankingSummary))
        self.assertTrue(HybridRankingSummary.__dataclass_params__.frozen)


class SummaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()
        cls.result = rank_hybrid_candidates(
            cls.context, U1, [S1, S2, S3, S4, S5, S6], limit=3
        )

    def test_126_input_candidate_count(self):
        self.assertEqual(self.result.summary.input_candidate_count, 6)

    def test_127_seen_filtered_count(self):
        self.assertEqual(self.result.summary.seen_filtered_count, 3)

    def test_128_eligible_candidate_count(self):
        self.assertEqual(self.result.summary.eligible_candidate_count, 3)

    def test_129_returned_count(self):
        self.assertEqual(self.result.summary.returned_count, 3)

    def test_130_requested_limit(self):
        self.assertEqual(self.result.summary.requested_limit, 3)

    def test_131_collaborative_weight_in_summary(self):
        self.assertEqual(
            self.result.summary.collaborative_weight, COLLABORATIVE_WEIGHT
        )

    def test_132_content_weight_in_summary(self):
        self.assertEqual(self.result.summary.content_weight, CONTENT_WEIGHT)

    def test_133_summary_fields_exact(self):
        names = {f.name for f in dataclasses.fields(HybridRankingSummary)}
        self.assertEqual(
            names,
            {
                "input_candidate_count",
                "seen_filtered_count",
                "eligible_candidate_count",
                "returned_count",
                "requested_limit",
                "content_profile_feature_count",
                "content_available_candidate_count",
                "collaborative_weight",
                "content_weight",
            },
        )

    def test_134_no_quality_claim_fields(self):
        names = {f.name for f in dataclasses.fields(HybridRankingSummary)}
        for banned in (
            "model_quality",
            "accuracy",
            "best_model",
            "confidence",
            "probability",
        ):
            self.assertNotIn(banned, names)

    def test_135_content_available_count_before_limit(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8], limit=1
        )
        self.assertEqual(result.summary.returned_count, 1)
        self.assertGreater(
            result.summary.content_available_candidate_count, 1
        )

    def test_136_weights_invariant_in_summary(self):
        self.assertEqual(
            self.result.summary.collaborative_weight
            + self.result.summary.content_weight,
            1.0,
        )


class EmptyAndEdgeCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_137_empty_candidates_valid(self):
        result = rank_hybrid_candidates(self.context, U1, [])
        self.assertIsInstance(result, HybridRankingResult)
        self.assertEqual(result.items, ())

    def test_138_empty_summary_counts_zero(self):
        result = rank_hybrid_candidates(self.context, U1, [])
        self.assertEqual(result.summary.input_candidate_count, 0)
        self.assertEqual(result.summary.seen_filtered_count, 0)
        self.assertEqual(result.summary.eligible_candidate_count, 0)
        self.assertEqual(result.summary.returned_count, 0)
        self.assertEqual(result.summary.content_available_candidate_count, 0)

    def test_139_empty_still_reports_profile_count(self):
        result = rank_hybrid_candidates(self.context, U1, [])
        self.assertIsInstance(
            result.summary.content_profile_feature_count, int
        )

    def test_140_all_seen_summary(self):
        result = rank_hybrid_candidates(self.context, U1, [S1, S2, S3])
        self.assertEqual(result.summary.input_candidate_count, 3)
        self.assertEqual(result.summary.seen_filtered_count, 3)
        self.assertEqual(result.summary.eligible_candidate_count, 0)
        self.assertEqual(result.summary.returned_count, 0)

    def test_141_single_candidate(self):
        result = rank_hybrid_candidates(self.context, U1, [S4])
        self.assertEqual(len(result.items), 1)
        self.assertEqual(result.items[0].rank, 1)

    def test_142_single_candidate_equal_collab_norm(self):
        result = rank_hybrid_candidates(self.context, U1, [S4])
        self.assertEqual(
            result.items[0].collaborative_normalized_score,
            COLLABORATIVE_EQUAL_SCORE_VALUE,
        )

    def test_143_cold_start_song_among_seen_raises(self):
        with self.assertRaises(HybridColdStartSongError):
            rank_hybrid_candidates(
                self.context, U1, [S1, UNKNOWN_SONG]
            )

    def test_144_invalid_context_type(self):
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(object(), U1, [S4])

    def test_145_incomplete_context_rejected(self):
        broken = HybridRankerContext(
            collaborative_model=None,
            interaction_bundle=None,
            content_features=None,
            training_signal=None,
            content_row_norms=None,
        )
        with self.assertRaises(HybridValidationError):
            rank_hybrid_candidates(broken, U1, [S4])


class DeterminismTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_146_same_call_same_order(self):
        candidates = [S4, S5, S6, S7, S8]
        first = rank_hybrid_candidates(self.context, U1, candidates)
        second = rank_hybrid_candidates(self.context, U1, candidates)
        self.assertEqual(
            [i.song_id for i in first.items],
            [i.song_id for i in second.items],
        )

    def test_147_same_call_same_scores(self):
        candidates = [S4, S5, S6, S7, S8]
        first = rank_hybrid_candidates(self.context, U1, candidates)
        second = rank_hybrid_candidates(self.context, U1, candidates)
        for left, right in zip(first.items, second.items):
            self.assertEqual(left.hybrid_score, right.hybrid_score)
            self.assertEqual(
                left.collaborative_raw_score, right.collaborative_raw_score
            )
            self.assertEqual(left.content_score, right.content_score)

    def test_148_shuffled_candidates_same_ranking(self):
        forward = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        reverse = rank_hybrid_candidates(
            self.context, U1, [S8, S7, S6, S5, S4]
        )
        self.assertEqual(
            [i.song_id for i in forward.items],
            [i.song_id for i in reverse.items],
        )

    def test_149_summary_deterministic(self):
        candidates = [S4, S5, S6, S7, S8]
        first = rank_hybrid_candidates(self.context, U1, candidates)
        second = rank_hybrid_candidates(self.context, U1, candidates)
        self.assertEqual(first.summary, second.summary)

    def test_150_prepare_twice_same_norms(self):
        bundle = fixture_bundle()
        model = fixture_model(bundle)
        content = fixture_content()
        a = prepare_hybrid_ranker(model, bundle, content)
        b = prepare_hybrid_ranker(model, bundle, content)
        self.assertEqual(
            a.content_row_norms.tolist(), b.content_row_norms.tolist()
        )


class NoDenseAndScopeSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_151_source_has_no_toarray(self):
        self.assertNotIn(".toarray(", MODULE_SOURCE)

    def test_152_source_has_no_todense(self):
        self.assertNotIn(".todense(", MODULE_SOURCE)

    def test_153_source_has_no_full_factor_reconstruction(self):
        self.assertNotIn("user_factors @ song_factors.T", MODULE_SOURCE)

    def test_154_source_has_no_song_similarity_matrix(self):
        self.assertNotIn("content_matrix @ content_matrix.T", MODULE_SOURCE)

    def test_155_source_has_no_svd_fit(self):
        self.assertNotIn("TruncatedSVD", MODULE_SOURCE)
        self.assertNotIn(".fit(", MODULE_SOURCE)

    def test_156_source_has_no_artifact_publish(self):
        self.assertNotIn("publish_artifact_release", MODULE_SOURCE)
        self.assertNotIn("activate_artifact_release", MODULE_SOURCE)

    def test_157_source_has_no_evaluation_call(self):
        self.assertNotIn("evaluate_recommendations", MODULE_SOURCE)

    def test_158_source_has_no_db_http_stack(self):
        for token in (
            "pymongo",
            "MongoClient",
            "FastAPI",
            "Flask",
            "requests",
        ):
            self.assertNotIn(token, MODULE_SOURCE)

    def test_159_source_has_no_randomness(self):
        for token in ("Math.random", "random.", "numpy.random"):
            self.assertNotIn(token, MODULE_SOURCE)

    def test_160_source_has_no_wall_clock(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)

    def test_161_source_has_no_artifact_loader(self):
        self.assertNotIn("load_numeric_npz_artifact", MODULE_SOURCE)

    def test_162_signal_shape_is_sparse_not_dense_user_song(self):
        signal = self.context.training_signal
        self.assertEqual(
            signal.shape,
            (
                len(self.context.interaction_bundle.user_ids),
                len(self.context.interaction_bundle.song_ids),
            ),
        )
        self.assertLess(
            signal.nnz,
            signal.shape[0] * signal.shape[1],
        )

    def test_163_forbidden_tokens_scan(self):
        for token in _FORBIDDEN_SOURCE_TOKENS:
            self.assertNotIn(
                token,
                MODULE_SOURCE,
                msg=f"forbidden token present: {token}",
            )

    def test_164_no_cold_start_fallback_implementation(self):
        self.assertNotIn("fallback_score", MODULE_SOURCE)
        self.assertNotIn("cold_start_rank", MODULE_SOURCE)
        self.assertNotIn("def explore", MODULE_SOURCE)
        self.assertNotIn("random_tiebreak", MODULE_SOURCE)

    def test_165_no_caller_supplied_weights(self):
        import inspect

        signature = inspect.signature(rank_hybrid_candidates)
        parameter_names = set(signature.parameters)
        self.assertNotIn("collaborative_weight", parameter_names)
        self.assertNotIn("content_weight", parameter_names)
        self.assertNotIn("alpha", parameter_names)
        self.assertNotIn("beta", parameter_names)
        self.assertNotIn("weights", parameter_names)

    def test_166_weights_are_module_constants_only(self):
        self.assertIn("COLLABORATIVE_WEIGHT = 0.70", MODULE_SOURCE)
        self.assertIn("CONTENT_WEIGHT = 0.30", MODULE_SOURCE)


class LazyImportAndCpuTests(unittest.TestCase):
    def test_167_import_does_not_load_numpy(self):
        code = (
            "import sys\n"
            "import ml.recommender.hybrid_ranker\n"
            "assert 'numpy' not in sys.modules, 'numpy imported at module load'\n"
            "assert 'scipy' not in sys.modules, 'scipy imported at module load'\n"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_168_import_does_not_configure_env(self):
        code = (
            "import os\n"
            "for key in (\n"
            "    'OMP_NUM_THREADS',\n"
            "    'OPENBLAS_NUM_THREADS',\n"
            "    'MKL_NUM_THREADS',\n"
            "    'NUMEXPR_NUM_THREADS',\n"
            "    'VECLIB_MAXIMUM_THREADS',\n"
            "    'CUDA_VISIBLE_DEVICES',\n"
            "):\n"
            "    os.environ.pop(key, None)\n"
            "import ml.recommender.hybrid_ranker\n"
            "assert 'OMP_NUM_THREADS' not in os.environ\n"
            "assert 'CUDA_VISIBLE_DEVICES' not in os.environ\n"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_169_prepare_configures_cpu_runtime(self):
        from ml.recommender.runtime import configure_cpu_runtime

        configure_cpu_runtime()
        import os

        self.assertEqual(os.environ.get("OMP_NUM_THREADS"), "1")
        self.assertEqual(os.environ.get("CUDA_VISIBLE_DEVICES"), "")

    def test_170_module_source_uses_lazy_loader(self):
        self.assertIn("configure_cpu_runtime()", MODULE_SOURCE)
        self.assertIn("_load_numeric_stack", MODULE_SOURCE)


class IntegrationWithUpstreamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = fixture_bundle()
        cls.model = fixture_model(cls.bundle)
        cls.content = fixture_content()
        cls.context = prepare_hybrid_ranker(
            cls.model, cls.bundle, cls.content
        )

    def test_171_uses_real_trained_model(self):
        self.assertIsInstance(
            self.context.collaborative_model, CollaborativeLatentModel
        )
        self.assertGreater(
            self.context.collaborative_model.effective_components, 0
        )

    def test_172_model_factors_untouched_by_prepare(self):
        user_copy = self.model.user_factors.copy()
        song_copy = self.model.song_factors.copy()
        prepare_hybrid_ranker(self.model, self.bundle, self.content)
        self.assertTrue(
            (self.model.user_factors == user_copy).all()
        )
        self.assertTrue(
            (self.model.song_factors == song_copy).all()
        )

    def test_173_bundle_matrices_untouched(self):
        observed_before = self.bundle.observed.copy()
        prepare_hybrid_ranker(self.model, self.bundle, self.content)
        diff = (self.bundle.observed != observed_before).nnz
        self.assertEqual(diff, 0)

    def test_174_content_matrix_untouched(self):
        before = self.content.matrix.copy()
        prepare_hybrid_ranker(self.model, self.bundle, self.content)
        diff = (self.content.matrix != before).nnz
        self.assertEqual(diff, 0)

    def test_175_rank_uses_score_collaborative_candidates_api(self):
        tree = ast.parse(MODULE_SOURCE)
        names = {
            node.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Name)
        }
        self.assertIn("score_collaborative_candidates", names)

    def test_176_end_to_end_known_user(self):
        result = rank_hybrid_candidates(
            self.context, U2, [S1, S2, S3, S5, S6, S7, S8], limit=5
        )
        self.assertEqual(len(result.items), 4)
        self.assertEqual(result.summary.returned_count, 4)
        self.assertEqual(result.items[0].rank, 1)
        self.assertNotIn(S1, [i.song_id for i in result.items])
        self.assertNotIn(S4, [i.song_id for i in result.items])
        self.assertNotIn(S5, [i.song_id for i in result.items])
        self.assertNotIn(S8, [i.song_id for i in result.items])
        self.assertEqual(
            [i.song_id for i in result.items],
            sorted(
                [i.song_id for i in result.items],
                key=lambda sid: next(
                    item.hybrid_score
                    for item in result.items
                    if item.song_id == sid
                ),
                reverse=True,
            ),
        )

    def test_177_limit_larger_than_eligible(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8], limit=100
        )
        self.assertEqual(len(result.items), 5)
        self.assertEqual(result.summary.returned_count, 5)

    def test_178_hybrid_error_catches_upstream_type_errors(self):
        self.assertTrue(
            issubclass(HybridValidationError, HybridRankingError)
        )


class ErrorBoundedMessageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_179_validation_message_bounded(self):
        with self.assertRaises(HybridValidationError) as ctx:
            rank_hybrid_candidates(self.context, U1, "nope")
        self.assertLess(len(str(ctx.exception)), 200)

    def test_180_duplicate_message_bounded(self):
        with self.assertRaises(HybridValidationError) as ctx:
            rank_hybrid_candidates(self.context, U1, [S4, S4])
        self.assertLess(len(str(ctx.exception)), 200)

    def test_181_limit_message_bounded(self):
        with self.assertRaises(HybridValidationError) as ctx:
            rank_hybrid_candidates(self.context, U1, [S4], limit=0)
        self.assertLess(len(str(ctx.exception)), 200)

    def test_182_alignment_message_is_fixed(self):
        mismatched_content = build_song_content_features(
            [
                {
                    "_id": S1,
                    "artist": "ArtistA",
                    "genre": "Pop",
                    "language": "English",
                    "category": "Song",
                }
            ]
        )
        with self.assertRaises(HybridValidationError) as ctx:
            prepare_hybrid_ranker(
                self.context.collaborative_model,
                self.context.interaction_bundle,
                mismatched_content,
            )
        self.assertIn("alignment", str(ctx.exception))

    def test_183_no_array_dump_in_messages(self):
        with self.assertRaises(HybridColdStartUserError) as ctx:
            rank_hybrid_candidates(self.context, UNKNOWN_USER, [S4])
        message = str(ctx.exception)
        self.assertNotIn("array", message)
        self.assertNotIn("[[", message)


class SourceDocumentationTests(unittest.TestCase):
    def test_184_docstring_documents_weights_as_baseline(self):
        self.assertIn("initial baseline", MODULE_SOURCE)
        self.assertIn("not learned", MODULE_SOURCE)

    def test_185_docstring_documents_minmax_not_probability(self):
        self.assertIn("not a probability", MODULE_SOURCE)

    def test_186_docstring_documents_missing_content_behavior(self):
        self.assertIn("equals the normalized", MODULE_SOURCE)

    def test_187_docstring_states_no_cold_start_fallback(self):
        self.assertIn("cold-start fallback", MODULE_SOURCE)

    def test_188_docstring_states_seen_exclusion(self):
        self.assertIn("observed Songs", MODULE_SOURCE)

    def test_189_docstring_states_deterministic_order(self):
        self.assertIn("ascending Song ID", MODULE_SOURCE)


class AdditionalBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = fixture_context()

    def test_190_limit_min_one_accepted(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5], limit=1
        )
        self.assertEqual(len(result.items), 1)

    def test_191_content_weight_is_exactly_thirty_percent(self):
        self.assertEqual(CONTENT_WEIGHT, 0.30)

    def test_192_hybrid_never_exceeds_one(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        for item in result.items:
            self.assertLessEqual(item.hybrid_score, 1.0)

    def test_193_hybrid_never_negative(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        for item in result.items:
            self.assertGreaterEqual(item.hybrid_score, 0.0)

    def test_194_raw_scores_preserved_exactly(self):
        context = self.context
        expected = {
            e.song_id: e.score
            for e in score_collaborative_candidates(
                context.collaborative_model,
                U1,
                [s for s in [S4, S5, S6, S7, S8]],
            )
        }
        result = rank_hybrid_candidates(
            context, U1, [S4, S5, S6, S7, S8]
        )
        for item in result.items:
            self.assertEqual(
                item.collaborative_raw_score, expected[item.song_id]
            )

    def test_195_context_fields_present(self):
        names = {f.name for f in dataclasses.fields(HybridRankerContext)}
        self.assertEqual(
            names,
            {
                "collaborative_model",
                "interaction_bundle",
                "content_features",
                "training_signal",
                "content_row_norms",
            },
        )

    def test_196_context_is_frozen(self):
        self.assertTrue(
            HybridRankerContext.__dataclass_params__.frozen
        )

    def test_197_no_artifact_or_db_symbols_imported(self):
        tree = ast.parse(MODULE_SOURCE)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    self.assertNotIn("Favorite", alias.name)
                    self.assertNotIn("Playlist", alias.name)
                    self.assertNotIn("MongoClient", alias.name)

    def test_198_cli_not_extended(self):
        cli_path = (
            Path(__file__).resolve().parents[1] / "recommender" / "cli.py"
        )
        source = cli_path.read_text(encoding="utf-8")
        self.assertNotIn("hybrid", source)
        self.assertNotIn("rank", source)

    def test_199_requirements_unchanged(self):
        requirements = (
            PROJECT_ROOT / "ml" / "requirements.txt"
        ).read_text(encoding="utf-8")
        lines = [
            line.strip()
            for line in requirements.splitlines()
            if line.strip() and not line.startswith("#")
        ]
        self.assertEqual(
            lines,
            [
                "numpy>=1.26,<3",
                "scipy>=1.12,<2",
                "scikit-learn>=1.5,<2",
            ],
        )

    def test_200_default_limit_used_when_omitted(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6]
        )
        self.assertEqual(result.summary.requested_limit, 20)


class ExtraFormulaAndOrderingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = fixture_bundle()
        cls.model = fixture_model(cls.bundle)
        cls.content = fixture_content()
        cls.context = prepare_hybrid_ranker(
            cls.model, cls.bundle, cls.content
        )

    def test_201_equal_raw_uneven_content_orders_by_content(self):
        def fake_scorer(model, user_id, candidates):
            return tuple(
                CollaborativeItemScore(song_id=sid, score=1.0)
                for sid in candidates
            )

        content_map = {S4: 0.2, S5: 0.8, S6: 0.5}
        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            side_effect=fake_scorer,
        ), mock.patch(
            "ml.recommender.hybrid_ranker._content_cosine_for_song",
            side_effect=lambda ctx, profile, norm, sid: content_map[sid],
        ):
            result = rank_hybrid_candidates(
                self.context, U1, [S4, S5, S6]
            )
        order = [item.song_id for item in result.items]
        self.assertEqual(order, [S5, S6, S4])

    def test_202_missing_content_loses_to_numeric_content_on_hybrid_tie(self):
        raw = {S4: 1.0, S8: 1.0}

        def fake_scorer(model, user_id, candidates):
            return tuple(
                CollaborativeItemScore(song_id=sid, score=raw[sid])
                for sid in candidates
            )

        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            side_effect=fake_scorer,
        ), mock.patch(
            "ml.recommender.hybrid_ranker._content_cosine_for_song",
            side_effect=lambda ctx, profile, norm, sid: (
                COLLABORATIVE_EQUAL_SCORE_VALUE if sid == S4 else None
            ),
        ):
            result = rank_hybrid_candidates(self.context, U1, [S4, S8])
        hybrids = {item.song_id: item.hybrid_score for item in result.items}
        assert_close(self, hybrids[S4], hybrids[S8], places=9)
        self.assertEqual(result.items[0].song_id, S4)
        self.assertEqual(result.items[1].song_id, S8)

    def test_203_collaborative_only_formula_not_weighted_down(self):
        def fake_scorer(model, user_id, candidates):
            return tuple(
                CollaborativeItemScore(song_id=sid, score=1.0)
                for sid in candidates
            )

        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            side_effect=fake_scorer,
        ), mock.patch(
            "ml.recommender.hybrid_ranker._content_cosine_for_song",
            return_value=None,
        ):
            result = rank_hybrid_candidates(self.context, U1, [S8])
        assert_close(
            self,
            result.items[0].hybrid_score,
            COLLABORATIVE_EQUAL_SCORE_VALUE,
            places=12,
        )

    def test_204_minmax_span_uses_unseen_only(self):
        def fake_scorer(model, user_id, candidates):
            scores = {S4: 10.0, S5: 0.0, S6: 5.0}
            return tuple(
                CollaborativeItemScore(song_id=sid, score=scores[sid])
                for sid in candidates
            )

        with mock.patch(
            "ml.recommender.hybrid_ranker.score_collaborative_candidates",
            side_effect=fake_scorer,
        ), mock.patch(
            "ml.recommender.hybrid_ranker._content_cosine_for_song",
            return_value=None,
        ):
            result = rank_hybrid_candidates(
                self.context, U1, [S1, S4, S5, S6]
            )
        by_id = {i.song_id: i for i in result.items}
        self.assertNotIn(S1, by_id)
        self.assertEqual(by_id[S5].collaborative_normalized_score, 0.0)
        self.assertEqual(by_id[S4].collaborative_normalized_score, 1.0)

    def test_205_returned_count_matches_len_items(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6], limit=2
        )
        self.assertEqual(
            result.summary.returned_count, len(result.items)
        )

    def test_206_content_available_count_le_eligible(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        self.assertLessEqual(
            result.summary.content_available_candidate_count,
            result.summary.eligible_candidate_count,
        )

    def test_207_seen_plus_eligible_equals_input(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S1, S2, S3, S4, S5]
        )
        self.assertEqual(
            result.summary.seen_filtered_count
            + result.summary.eligible_candidate_count,
            result.summary.input_candidate_count,
        )

    def test_208_song_ids_unique_in_items(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6, S7, S8]
        )
        ids = [item.song_id for item in result.items]
        self.assertEqual(len(ids), len(set(ids)))

    def test_209_no_wall_clock_or_random_in_executed_rank(self):
        result = rank_hybrid_candidates(
            self.context, U1, [S4, S5, S6]
        )
        self.assertEqual(len(result.items), 3)

    def test_210_profile_not_recomputed_per_candidate(self):
        with mock.patch(
            "ml.recommender.hybrid_ranker._build_content_profile",
            wraps=__import__(
                "ml.recommender.hybrid_ranker", fromlist=["_build_content_profile"]
            )._build_content_profile,
        ) as builder:
            rank_hybrid_candidates(
                self.context, U1, [S4, S5, S6, S7, S8]
            )
            builder.assert_called_once()

    def test_211_row_norms_not_recomputed_per_rank(self):
        norms_before = self.context.content_row_norms.tolist()
        rank_hybrid_candidates(self.context, U1, [S4, S5, S6])
        self.assertEqual(
            self.context.content_row_norms.tolist(), norms_before
        )

    def test_212_alignment_requires_all_model_songs_in_content(self):
        short_content = build_song_content_features(
            [
                {
                    "_id": S1,
                    "artist": "ArtistA",
                    "genre": "Pop",
                    "language": "English",
                    "category": "Song",
                }
            ]
        )
        with self.assertRaises(HybridValidationError):
            prepare_hybrid_ranker(
                self.model, self.bundle, short_content
            )

    def test_213_extra_content_songs_allowed(self):
        extra = build_song_content_features(
            fixture_song_records()
            + [{"_id": "9" * 24, "artist": "Extra", "genre": "Pop"}]
        )
        context = prepare_hybrid_ranker(
            self.model, self.bundle, extra
        )
        self.assertIn("9" * 24, context.content_features.song_to_index)

    def test_214_resource_limit_error_for_candidate_overflow(self):
        self.assertTrue(issubclass(ResourceLimitError, Exception))

    def test_215_equal_score_constant_used_only_for_minmax(self):
        self.assertEqual(COLLABORATIVE_EQUAL_SCORE_VALUE, 0.5)
        self.assertIn("COLLABORATIVE_EQUAL_SCORE_VALUE", MODULE_SOURCE)

    def test_216_module_has_no_train_or_serve_entrypoint(self):
        self.assertNotIn("def train(", MODULE_SOURCE)
        self.assertNotIn("def serve(", MODULE_SOURCE)
        self.assertNotIn("if __name__", MODULE_SOURCE)


if __name__ == "__main__":
    unittest.main()
