"""Standard-library tests for deterministic recommender evaluation metrics."""

from __future__ import annotations

import ast
import copy
import dataclasses
import math
import unittest
from pathlib import Path
from unittest import mock

from ml.recommender.content_features import SongContentFeatureBundle, build_song_content_features
from ml.recommender.evaluation import (
    COVERAGE_K,
    DIVERSITY_K,
    HIT_RATE_K,
    MAP_K,
    MAX_RECOMMENDATIONS_PER_USER,
    NDCG_KS,
    PRECISION_RECALL_KS,
    EvaluationError,
    EvaluationValidationError,
    RecommenderEvaluationResult,
    RecommenderEvaluationSummary,
    average_precision_at_k,
    catalog_coverage_at_k,
    evaluate_recommendations,
    hit_at_k,
    intra_list_diversity_at_k,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
)
from ml.recommender.runtime import (
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    RecommenderRuntimeError,
    ResourceLimitError,
)

MODULE_PATH = Path(__file__).resolve().parents[1] / "recommender" / "evaluation.py"
MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")

U1 = "a" * 24
U2 = "b" * 24
U3 = "c" * 24
S1 = "1" * 24
S2 = "2" * 24
S3 = "3" * 24
S4 = "4" * 24
S5 = "5" * 24
S6 = "6" * 24
S7 = "7" * 24
S8 = "8" * 24
S9 = "9" * 24
SA = "a" * 24
SB = "b" * 24


def songs_basic():
    return [
        {"_id": S1, "artist": "ArtistA", "genre": "Pop", "language": "English", "category": "Song"},
        {"_id": S2, "artist": "ArtistB", "genre": "Rock", "language": "English", "category": "Song"},
        {"_id": S3, "artist": "ArtistA", "genre": "Pop", "language": "English", "category": "Song"},
        {"_id": S4, "artist": "ArtistC", "genre": "Jazz", "language": "English", "category": "Song"},
        {"_id": S5, "artist": "ArtistD", "genre": "Pop", "language": "Hindi", "category": "Song"},
        {"_id": S6, "artist": "ArtistE", "genre": "Rock", "language": "Bengali", "category": "Song"},
        {"_id": S7, "artist": "ArtistF", "genre": "Jazz", "language": "English", "category": "Song"},
        {"_id": S8, "artist": "ArtistG", "genre": "Pop", "language": "English", "category": "Song"},
    ]


def bundle_basic():
    return build_song_content_features(songs_basic())


_DEFAULT = object()


def run_eval(recs=None, rel=None, catalog=None, bundle=_DEFAULT):
    if bundle is _DEFAULT:
        bundle = bundle_basic()
    return evaluate_recommendations(
        {} if recs is None else recs,
        {} if rel is None else rel,
        [] if catalog is None else catalog,
        bundle,
    )


def assert_close(testcase, actual, expected, places=12):
    testcase.assertTrue(
        math.isclose(actual, expected, rel_tol=0.0, abs_tol=10 ** (-places)),
        msg=f"{actual} != {expected}",
    )


class ConstantsContractTests(unittest.TestCase):
    def test_01_precision_recall_ks(self):
        self.assertEqual(PRECISION_RECALL_KS, (5, 10))

    def test_02_ndcg_ks(self):
        self.assertEqual(NDCG_KS, (5, 10))

    def test_03_map_k(self):
        self.assertEqual(MAP_K, 10)

    def test_04_hit_rate_k(self):
        self.assertEqual(HIT_RATE_K, 10)

    def test_05_coverage_k(self):
        self.assertEqual(COVERAGE_K, 10)

    def test_06_diversity_k(self):
        self.assertEqual(DIVERSITY_K, 10)

    def test_07_max_recommendations_per_user(self):
        self.assertEqual(MAX_RECOMMENDATIONS_PER_USER, 100)

    def test_08_no_overall_score_names_in_source(self):
        for name in ("overall_score", "quality_score", "model_score"):
            self.assertNotIn(name, MODULE_SOURCE)


class ErrorHierarchyTests(unittest.TestCase):
    def test_09_evaluation_error_under_runtime(self):
        self.assertTrue(issubclass(EvaluationError, RecommenderRuntimeError))

    def test_10_validation_error_under_evaluation(self):
        self.assertTrue(issubclass(EvaluationValidationError, EvaluationError))

    def test_11_resource_limit_error_under_runtime(self):
        self.assertTrue(issubclass(ResourceLimitError, RecommenderRuntimeError))

    def test_12_result_is_frozen_dataclass(self):
        self.assertTrue(dataclasses.is_dataclass(RecommenderEvaluationResult))
        fields = {f.name for f in dataclasses.fields(RecommenderEvaluationResult)}
        self.assertEqual(
            fields,
            {
                "precision_at_5",
                "precision_at_10",
                "recall_at_5",
                "recall_at_10",
                "ndcg_at_5",
                "ndcg_at_10",
                "map_at_10",
                "hit_rate_at_10",
                "catalog_coverage",
                "diversity",
                "summary",
            },
        )

    def test_13_summary_is_frozen_dataclass(self):
        self.assertTrue(dataclasses.is_dataclass(RecommenderEvaluationSummary))
        fields = {f.name for f in dataclasses.fields(RecommenderEvaluationSummary)}
        self.assertEqual(
            fields,
            {
                "evaluated_user_count",
                "recommendation_user_count",
                "relevance_user_count",
                "catalog_size",
                "unique_recommended_at_10",
                "diversity_evaluable_user_count",
                "diversity_pair_count",
            },
        )

    def test_14_result_frozen_instances(self):
        result = run_eval()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.precision_at_5 = 1.0

    def test_15_summary_frozen_instances(self):
        result = run_eval()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.summary.evaluated_user_count = 1


class IdValidationTests(unittest.TestCase):
    def test_16_user_id_too_short(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={"abc": []})

    def test_17_user_id_too_long(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={"a" * 25: []})

    def test_18_user_id_non_hex(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={"u" * 24: []})

    def test_19_user_id_non_string(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={123: []})

    def test_20_user_id_bool_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={True: []})

    def test_21_user_id_uppercase_canonicalized(self):
        result = run_eval(
            recs={U1.upper(): [S1]},
            rel={U1.upper(): [S1]},
            catalog=[S1],
        )
        self.assertEqual(result.summary.evaluated_user_count, 1)

    def test_22_user_id_whitespace_trimmed(self):
        result = run_eval(
            recs={f"  {U1}  ": [S1]},
            rel={f" {U1}": [S1]},
            catalog=[S1],
        )
        self.assertEqual(result.summary.evaluated_user_count, 1)

    def test_23_song_id_too_short_in_recommendations(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={U1: ["abc"]}, rel={U1: [S1]}, catalog=[S1])

    def test_24_song_id_non_hex_in_relevance(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(rel={U1: ["z" * 24]}, catalog=[S1])

    def test_25_song_id_non_string_in_catalog(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(catalog=[1])

    def test_26_song_id_bool_in_catalog(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(catalog=[False])

    def test_27_song_id_uppercase_canonicalized(self):
        result = run_eval(
            recs={U1: [S1.upper()]},
            rel={U1: [S1.upper()]},
            catalog=[S1.upper()],
        )
        self.assertEqual(result.summary.evaluated_user_count, 1)

    def test_28_recommendations_not_mapping(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs=[S1])

    def test_29_relevance_not_mapping(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(rel=[S1])

    def test_30_recommendations_set_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={U1: {S1}}, rel={U1: [S1]}, catalog=[S1])

    def test_31_recommendations_generator_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={U1: (x for x in [S1])}, rel={U1: [S1]}, catalog=[S1])

    def test_32_recommendations_scalar_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(recs={U1: S1}, rel={U1: [S1]}, catalog=[S1])

    def test_33_relevance_string_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(rel={U1: S1}, catalog=[S1])

    def test_34_relevance_generator_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(rel={U1: (x for x in [S1])}, catalog=[S1])

    def test_35_catalog_string_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(catalog=S1)

    def test_36_catalog_generator_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(catalog=(x for x in [S1]))

    def test_37_duplicate_recommendation_song_rejected(self):
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(recs={U1: [S1, S1]}, rel={U1: [S1]}, catalog=[S1])
        self.assertEqual(str(ctx.exception), "duplicate recommendation song")

    def test_38_duplicate_relevance_list_rejected(self):
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(rel={U1: [S1, S1]}, catalog=[S1])
        self.assertEqual(str(ctx.exception), "duplicate relevance song")

    def test_39_relevance_set_duplicates_allowed(self):
        result = run_eval(rel={U1: {S1, S1}}, catalog=[S1])
        self.assertEqual(result.summary.evaluated_user_count, 1)

    def test_40_duplicate_catalog_list_rejected(self):
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(catalog=[S1, S1])
        self.assertEqual(str(ctx.exception), "duplicate catalog song")

    def test_41_relevance_frozenset_accepted(self):
        result = run_eval(rel={U1: frozenset([S1, S2])}, catalog=[S1, S2])
        self.assertEqual(result.summary.evaluated_user_count, 1)

    def test_42_catalog_set_accepted(self):
        result = run_eval(catalog={S1, S2})
        self.assertEqual(result.summary.catalog_size, 2)

    def test_43_catalog_tuple_accepted(self):
        result = run_eval(catalog=(S1, S2))
        self.assertEqual(result.summary.catalog_size, 2)

    def test_44_recommendations_tuple_accepted(self):
        result = run_eval(
            recs={U1: (S1, S2)},
            rel={U1: [S1]},
            catalog=[S1, S2],
        )
        self.assertEqual(result.summary.evaluated_user_count, 1)


class RuntimeBoundTests(unittest.TestCase):
    def test_45_recs_over_100_rejected(self):
        long_list = [f"{i:024x}" for i in range(101)]
        with self.assertRaises(ResourceLimitError):
            run_eval(recs={U1: long_list})

    def test_46_recs_exactly_100_accepted(self):
        catalog = [f"{i:024x}" for i in range(100)]
        bundle = build_song_content_features(
            [{"_id": sid} for sid in catalog]
        )
        result = run_eval(
            recs={U1: catalog},
            rel={U1: [catalog[0]]},
            catalog=catalog,
            bundle=bundle,
        )
        self.assertEqual(result.summary.evaluated_user_count, 1)

    def test_47_unique_users_over_cap_rejected(self):
        with mock.patch("ml.recommender.evaluation.MAX_UNIQUE_USERS", 2):
            recs = {f"{i:024x}": [] for i in range(3)}
            with self.assertRaises(ResourceLimitError):
                run_eval(recs=recs)

    def test_48_unique_users_at_cap_accepted(self):
        with mock.patch("ml.recommender.evaluation.MAX_UNIQUE_USERS", 2):
            recs = {f"{i:024x}": [] for i in range(2)}
            rel = {f"{i:024x}": [] for i in range(2)}
            result = run_eval(recs=recs, rel=rel)
            self.assertEqual(result.summary.recommendation_user_count, 2)

    def test_49_users_split_across_maps_counted_together(self):
        with mock.patch("ml.recommender.evaluation.MAX_UNIQUE_USERS", 2):
            with self.assertRaises(ResourceLimitError):
                run_eval(recs={U1: [], U2: []}, rel={U3: []})

    def test_50_catalog_over_song_cap_rejected(self):
        with mock.patch("ml.recommender.evaluation.MAX_UNIQUE_SONGS", 2):
            with self.assertRaises(ResourceLimitError):
                run_eval(catalog=[S1, S2, S3])

    def test_51_catalog_at_song_cap_accepted(self):
        with mock.patch("ml.recommender.evaluation.MAX_UNIQUE_SONGS", 2):
            bundle = build_song_content_features([{"_id": S1}, {"_id": S2}])
            result = run_eval(catalog=[S1, S2], bundle=bundle)
            self.assertEqual(result.summary.catalog_size, 2)

    def test_52_max_rec_limit_constant_matches_runtime_expectation(self):
        self.assertEqual(MAX_RECOMMENDATIONS_PER_USER, 100)
        self.assertEqual(MAX_UNIQUE_USERS, 50000)
        self.assertEqual(MAX_UNIQUE_SONGS, 25000)


class UserPopulationTests(unittest.TestCase):
    def test_53_empty_inputs_all_zero(self):
        result = run_eval(recs={}, rel={}, catalog=[])
        self.assertEqual(result.precision_at_5, 0.0)
        self.assertEqual(result.recall_at_10, 0.0)
        self.assertEqual(result.ndcg_at_5, 0.0)
        self.assertEqual(result.map_at_10, 0.0)
        self.assertEqual(result.hit_rate_at_10, 0.0)
        self.assertEqual(result.catalog_coverage, 0.0)
        self.assertEqual(result.diversity, 0.0)
        self.assertEqual(result.summary.evaluated_user_count, 0)

    def test_54_empty_relevance_not_evaluable(self):
        result = run_eval(recs={U1: [S1]}, rel={U1: []}, catalog=[S1])
        self.assertEqual(result.summary.evaluated_user_count, 0)
        self.assertEqual(result.summary.recommendation_user_count, 1)
        self.assertEqual(result.summary.relevance_user_count, 1)
        self.assertEqual(result.precision_at_5, 0.0)

    def test_55_missing_recommendations_treated_as_empty(self):
        result = run_eval(recs={}, rel={U1: [S1]}, catalog=[S1])
        self.assertEqual(result.summary.evaluated_user_count, 1)
        self.assertEqual(result.precision_at_5, 0.0)
        self.assertEqual(result.recall_at_5, 0.0)
        self.assertEqual(result.hit_rate_at_10, 0.0)
        self.assertEqual(result.map_at_10, 0.0)

    def test_56_extra_recommendation_only_users_ignored(self):
        result = run_eval(
            recs={U1: [S1, S2], U2: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
        )
        self.assertEqual(result.summary.evaluated_user_count, 1)
        self.assertEqual(result.summary.recommendation_user_count, 2)
        self.assertEqual(result.summary.unique_recommended_at_10, 2)
        assert_close(self, result.catalog_coverage, 1.0)

    def test_57_macro_average_two_users(self):
        bundle = bundle_basic()
        catalog = [S1, S2, S3, S4, S5, S6, S7, S8]
        recs = {U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]}
        rel = {U1: [S1, S3], U2: [S4]}
        result = run_eval(recs=recs, rel=rel, catalog=catalog, bundle=bundle)
        assert_close(self, result.precision_at_5, 0.2)
        assert_close(self, result.recall_at_5, 0.5)
        assert_close(self, result.hit_rate_at_10, 0.5)
        assert_close(self, result.map_at_10, (0.8333333333333333 + 0.0) / 2)

    def test_58_evaluable_users_sorted_ascending(self):
        recs = {U3: [S1], U1: [S1], U2: [S1]}
        rel = {U3: [S1], U1: [S1], U2: [S1]}
        result = run_eval(recs=recs, rel=rel, catalog=[S1])
        self.assertEqual(result.summary.evaluated_user_count, 3)
        self.assertEqual(result.summary.recommendation_user_count, 3)

    def test_59_summary_counts_distinct_maps(self):
        result = run_eval(
            recs={U1: [S1], U2: [S1]},
            rel={U1: [S1], U3: [S1]},
            catalog=[S1],
        )
        self.assertEqual(result.summary.evaluated_user_count, 2)
        self.assertEqual(result.summary.recommendation_user_count, 2)
        self.assertEqual(result.summary.relevance_user_count, 2)

    def test_60_single_evaluable_user_not_averaged_away(self):
        result = run_eval(
            recs={U1: [S1, S2, S3]},
            rel={U1: [S1, S3]},
            catalog=[S1, S2, S3],
        )
        assert_close(self, result.precision_at_5, 2 / 5)
        assert_close(self, result.recall_at_5, 1.0)

    def test_61_canonical_user_merge_case(self):
        result = run_eval(
            recs={U1.upper(): [S1]},
            rel={U1: [S1]},
            catalog=[S1],
        )
        self.assertEqual(result.summary.recommendation_user_count, 1)
        self.assertEqual(result.summary.evaluated_user_count, 1)
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(recs={U1: [S1], U1.upper(): [S1]}, rel={U1: [S1]}, catalog=[S1])
        self.assertEqual(str(ctx.exception), "duplicate evaluation user id")

    def test_62_evaluable_zero_returns_not_nan(self):
        result = run_eval(recs={}, rel={}, catalog=[S1])
        for value in (
            result.precision_at_5,
            result.recall_at_10,
            result.ndcg_at_5,
            result.map_at_10,
            result.hit_rate_at_10,
            result.catalog_coverage,
            result.diversity,
        ):
            self.assertFalse(math.isnan(value))
            self.assertIsNotNone(value)
            assert_close(self, value, 0.0)


class CatalogMembershipTests(unittest.TestCase):
    def test_63_relevant_outside_catalog_rejected(self):
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(rel={U1: [S9]}, catalog=[S1])
        self.assertEqual(str(ctx.exception), "relevant song is outside evaluation catalog")

    def test_64_recommended_outside_catalog_rejected(self):
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(recs={U1: [S9]}, rel={U1: [S1]}, catalog=[S1])
        self.assertEqual(
            str(ctx.exception), "recommended song is outside evaluation catalog"
        )

    def test_65_empty_catalog_with_relevance_rejected(self):
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(rel={U1: [S1]}, catalog=[])
        self.assertEqual(
            str(ctx.exception), "relevance exists against empty evaluation catalog"
        )

    def test_66_empty_catalog_without_evaluable_ok(self):
        result = run_eval(recs={}, rel={}, catalog=[])
        self.assertEqual(result.summary.catalog_size, 0)
        self.assertEqual(result.catalog_coverage, 0.0)

    def test_67_empty_catalog_with_empty_relevance_ok(self):
        result = run_eval(recs={}, rel={U1: []}, catalog=[])
        self.assertEqual(result.summary.evaluated_user_count, 0)
        self.assertEqual(result.summary.relevance_user_count, 1)

    def test_68_extra_rec_only_user_outside_catalog_ignored(self):
        result = run_eval(
            recs={U1: [S1], U2: [S9]},
            rel={U1: [S1]},
            catalog=[S1],
        )
        self.assertEqual(result.summary.evaluated_user_count, 1)
        self.assertEqual(result.summary.recommendation_user_count, 2)
        assert_close(self, result.catalog_coverage, 1.0)

    def test_69_empty_recommended_list_for_evaluable_ok(self):
        result = run_eval(recs={U1: []}, rel={U1: [S1]}, catalog=[S1])
        self.assertEqual(result.summary.evaluated_user_count, 1)
        self.assertEqual(result.precision_at_5, 0.0)

    def test_70_catalog_size_zero_coverage_zero(self):
        result = run_eval(rel={}, catalog=[])
        assert_close(self, result.catalog_coverage, 0.0)
        self.assertEqual(result.summary.unique_recommended_at_10, 0)


class ContentBundleTests(unittest.TestCase):
    def test_71_bundle_type_required(self):
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(bundle={"not": "a bundle"})
        self.assertEqual(str(ctx.exception), "invalid content feature bundle")

    def test_72_bundle_none_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            run_eval(bundle=None)

    def test_73_catalog_song_missing_from_bundle_rejected(self):
        small = build_song_content_features([{"_id": S1}])
        with self.assertRaises(EvaluationValidationError) as ctx:
            run_eval(catalog=[S1, S9], bundle=small)
        self.assertEqual(str(ctx.exception), "content feature catalog is misaligned")

    def test_74_bundle_extra_songs_allowed(self):
        big = build_song_content_features([{"_id": S1}, {"_id": S2}, {"_id": S9}])
        result = run_eval(catalog=[S1], bundle=big)
        self.assertEqual(result.summary.catalog_size, 1)

    def test_75_all_zero_bundle_valid(self):
        zero = build_song_content_features([{"_id": S1}, {"_id": S2}])
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
            bundle=zero,
        )
        self.assertEqual(result.diversity, 0.0)
        self.assertEqual(result.summary.diversity_pair_count, 0)

    def test_76_misaligned_matrix_rows_rejected(self):
        good = build_song_content_features([{"_id": S1}, {"_id": S2}])
        broken = SongContentFeatureBundle(
            song_ids=good.song_ids,
            feature_names=good.feature_names,
            song_to_index=good.song_to_index,
            feature_to_index=good.feature_to_index,
            matrix=good.matrix[0:1],
            summary=good.summary,
        )
        with self.assertRaises(EvaluationValidationError):
            run_eval(catalog=[S1, S2], bundle=broken)

    def test_77_empty_catalog_with_empty_bundle_ok(self):
        empty = build_song_content_features([])
        result = run_eval(catalog=[], bundle=empty)
        self.assertEqual(result.summary.catalog_size, 0)

    def test_78_bundle_song_to_index_missing_entry_rejected(self):
        good = build_song_content_features([{"_id": S1}])
        broken = SongContentFeatureBundle(
            song_ids=good.song_ids,
            feature_names=good.feature_names,
            song_to_index={},
            feature_to_index=good.feature_to_index,
            matrix=good.matrix,
            summary=good.summary,
        )
        with self.assertRaises(EvaluationValidationError):
            run_eval(catalog=[S1], bundle=broken)


class PrecisionTests(unittest.TestCase):
    def test_79_precision_exact_two_of_five(self):
        value = precision_at_k([S1, S9, S3, S8, S7], frozenset([S1, S3]), 5)
        assert_close(self, value, 2 / 5)

    def test_80_precision_denominator_always_k(self):
        value = precision_at_k([S1], frozenset([S1]), 5)
        assert_close(self, value, 1 / 5)

    def test_81_precision_at_10_short_list(self):
        value = precision_at_k([S1], frozenset([S1]), 10)
        assert_close(self, value, 1 / 10)

    def test_82_precision_no_hits(self):
        value = precision_at_k([S2, S4], frozenset([S1]), 5)
        assert_close(self, value, 0.0)

    def test_83_precision_hits_beyond_k_ignored(self):
        value = precision_at_k([S2, S4, S5, S6, S7, S1], frozenset([S1]), 5)
        assert_close(self, value, 0.0)

    def test_84_precision_k_zero_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            precision_at_k([S1], frozenset([S1]), 0)

    def test_85_precision_k_negative_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            precision_at_k([S1], frozenset([S1]), -1)

    def test_86_precision_macro_two_users(self):
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]},
            rel={U1: [S1, S3], U2: [S4]},
            catalog=[S1, S2, S3, S4, S5, S6, S7, S8],
        )
        assert_close(self, result.precision_at_5, (0.4 + 0.0) / 2)
        assert_close(self, result.precision_at_10, (0.2 + 0.0) / 2)

    def test_87_precision_empty_recommended(self):
        value = precision_at_k([], frozenset([S1]), 5)
        assert_close(self, value, 0.0)


class RecallTests(unittest.TestCase):
    def test_88_recall_both_hits(self):
        value = recall_at_k([S1, S2, S3], frozenset([S1, S3]), 5)
        assert_close(self, value, 1.0)

    def test_89_recall_one_of_two(self):
        value = recall_at_k([S1, S2], frozenset([S1, S3]), 5)
        assert_close(self, value, 0.5)

    def test_90_recall_zero_hits(self):
        value = recall_at_k([S2, S4], frozenset([S1]), 5)
        assert_close(self, value, 0.0)

    def test_91_recall_hit_beyond_k_ignored(self):
        value = recall_at_k([S2, S4, S5, S6, S7, S1], frozenset([S1]), 5)
        assert_close(self, value, 0.0)

    def test_92_recall_empty_relevant_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            recall_at_k([S1], frozenset(), 5)

    def test_93_recall_k_zero_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            recall_at_k([S1], frozenset([S1]), 0)

    def test_94_recall_larger_relevant_set(self):
        value = recall_at_k([S1, S2], frozenset([S1, S2, S3, S4]), 10)
        assert_close(self, value, 0.5)

    def test_95_recall_macro_two_users(self):
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]},
            rel={U1: [S1, S3], U2: [S4]},
            catalog=[S1, S2, S3, S4, S5, S6, S7, S8],
        )
        assert_close(self, result.recall_at_5, (1.0 + 0.0) / 2)
        assert_close(self, result.recall_at_10, (1.0 + 0.0) / 2)


class NdcgTests(unittest.TestCase):
    def test_96_ndcg_perfect_order(self):
        value = ndcg_at_k([S1, S3], frozenset([S1, S3]), 5)
        assert_close(self, value, 1.0)

    def test_97_ndcg_hits_ranks_two_and_four(self):
        recommended = [S9, S1, S8, S3, S7]
        relevant = frozenset([S1, S3])
        dcg = 1 / math.log2(3) + 1 / math.log2(5)
        idcg = 1 / math.log2(2) + 1 / math.log2(3)
        value = ndcg_at_k(recommended, relevant, 5)
        assert_close(self, value, dcg / idcg)

    def test_98_ndcg_no_hits(self):
        value = ndcg_at_k([S2, S4, S5], frozenset([S1]), 5)
        assert_close(self, value, 0.0)

    def test_99_ndcg_more_relevant_than_k(self):
        recommended = [S1, S2, S3, S4, S5]
        relevant = frozenset([S1, S2, S3, S4, S5, S6, S7, S8])
        dcg = sum(1 / math.log2(r + 1) for r in range(1, 6))
        idcg = sum(1 / math.log2(r + 1) for r in range(1, 6))
        value = ndcg_at_k(recommended, relevant, 5)
        assert_close(self, value, dcg / idcg)

    def test_100_ndcg_empty_relevant_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            ndcg_at_k([S1], frozenset(), 5)

    def test_101_ndcg_k_zero_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            ndcg_at_k([S1], frozenset([S1]), 0)

    def test_102_ndcg_single_hit_rank_one(self):
        value = ndcg_at_k([S1, S2], frozenset([S1]), 5)
        idcg = 1 / math.log2(2)
        assert_close(self, value, 1.0)

    def test_103_ndcg_macro_two_users(self):
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]},
            rel={U1: [S1, S3], U2: [S4]},
            catalog=[S1, S2, S3, S4, S5, S6, S7, S8],
        )
        user_a = ndcg_at_k([S1, S2, S3, S4, S5], frozenset([S1, S3]), 5)
        assert_close(self, result.ndcg_at_5, (user_a + 0.0) / 2)
        assert_close(self, result.ndcg_at_5, 0.4598603945740938)

    def test_104_ndcg_at_10_covers_longer_list(self):
        recommended = [S1] + [S2, S3, S4, S5, S6, S7, S8, S9, SA]
        relevant = frozenset([S1, S9])
        value = ndcg_at_k(recommended, relevant, 10)
        dcg = 1 / math.log2(2) + 1 / math.log2(10)
        idcg = 1 / math.log2(2) + 1 / math.log2(3)
        assert_close(self, value, dcg / idcg)


class MapTests(unittest.TestCase):
    def test_105_ap_hits_ranks_one_and_three(self):
        recommended = [S1, S9, S3]
        relevant = frozenset([S1, S3])
        expected = (1.0 + 2 / 3) / 2
        value = average_precision_at_k(recommended, relevant, 10)
        assert_close(self, value, expected)

    def test_106_ap_partial_hits_larger_relevant(self):
        recommended = [S1, S9, S3]
        relevant = frozenset([S1, S3, S4])
        expected = (1.0 + 2 / 3) / 3
        value = average_precision_at_k(recommended, relevant, 10)
        assert_close(self, value, expected)

    def test_107_ap_no_hits(self):
        value = average_precision_at_k([S2, S4], frozenset([S1]), 10)
        assert_close(self, value, 0.0)

    def test_108_ap_denominator_min_relevant_k(self):
        recommended = [S1, S2, S3]
        relevant = frozenset([S1, S2, S3, S4, S5])
        expected = (1.0 + 2 / 2 + 3 / 3) / 3
        value = average_precision_at_k(recommended, relevant, 3)
        assert_close(self, value, expected)

    def test_109_ap_empty_relevant_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            average_precision_at_k([S1], frozenset(), 10)

    def test_110_ap_k_zero_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            average_precision_at_k([S1], frozenset([S1]), 0)

    def test_111_ap_perfect_single(self):
        value = average_precision_at_k([S1, S2], frozenset([S1]), 10)
        assert_close(self, value, 1.0)

    def test_112_map_macro_two_users(self):
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]},
            rel={U1: [S1, S3], U2: [S4]},
            catalog=[S1, S2, S3, S4, S5, S6, S7, S8],
        )
        assert_close(self, result.map_at_10, 0.41666666666666663)

    def test_113_ap_hits_beyond_k_ignored(self):
        recommended = [S2, S4, S5, S6, S7, S8, S9, SA, SB, S3, S1]
        relevant = frozenset([S1])
        value = average_precision_at_k(recommended, relevant, 10)
        assert_close(self, value, 0.0)


class HitRateTests(unittest.TestCase):
    def test_114_hit_found(self):
        value = hit_at_k([S9, S1], frozenset([S1]), 10)
        self.assertEqual(value, 1.0)

    def test_115_hit_not_found(self):
        value = hit_at_k([S2, S4], frozenset([S1]), 10)
        self.assertEqual(value, 0.0)

    def test_116_hit_at_boundary_rank_10(self):
        recommended = [S2, S3, S4, S5, S6, S7, S8, S9, SA, S1]
        value = hit_at_k(recommended, frozenset([S1]), 10)
        self.assertEqual(value, 1.0)

    def test_117_hit_beyond_k_ignored(self):
        recommended = [S2, S3, S4, S5, S6, S7, S8, S9, SA, SB, S1]
        value = hit_at_k(recommended, frozenset([S1]), 10)
        self.assertEqual(value, 0.0)

    def test_118_hit_k_zero_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            hit_at_k([S1], frozenset([S1]), 0)

    def test_119_hit_rate_macro(self):
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]},
            rel={U1: [S1, S3], U2: [S4]},
            catalog=[S1, S2, S3, S4, S5, S6, S7, S8],
        )
        assert_close(self, result.hit_rate_at_10, 0.5)

    def test_120_hit_empty_recommended(self):
        value = hit_at_k([], frozenset([S1]), 10)
        self.assertEqual(value, 0.0)


class CoverageTests(unittest.TestCase):
    def test_121_coverage_full_catalog(self):
        result = run_eval(
            recs={U1: [S1, S2, S3, S4]},
            rel={U1: [S1]},
            catalog=[S1, S2, S3, S4],
        )
        assert_close(self, result.catalog_coverage, 1.0)

    def test_122_coverage_half_catalog(self):
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2, S3, S4],
        )
        assert_close(self, result.catalog_coverage, 0.5)

    def test_123_coverage_union_across_users(self):
        result = run_eval(
            recs={U1: [S1, S2], U2: [S2, S3]},
            rel={U1: [S1], U2: [S3]},
            catalog=[S1, S2, S3, S4],
        )
        assert_close(self, result.catalog_coverage, 0.75)
        self.assertEqual(result.summary.unique_recommended_at_10, 3)

    def test_124_coverage_only_top10_counted(self):
        long_catalog = [f"{i:024x}" for i in range(20)]
        bundle = build_song_content_features([{"_id": s} for s in long_catalog])
        result = run_eval(
            recs={U1: long_catalog},
            rel={U1: [long_catalog[0]]},
            catalog=long_catalog,
            bundle=bundle,
        )
        self.assertEqual(result.summary.unique_recommended_at_10, 10)
        assert_close(self, result.catalog_coverage, 10 / 20)

    def test_125_coverage_ignores_relevance(self):
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: []},
            catalog=[S1, S2, S3],
        )
        assert_close(self, result.catalog_coverage, 0.0)
        self.assertEqual(result.summary.evaluated_user_count, 0)

    def test_126_coverage_helper_empty_catalog(self):
        value = catalog_coverage_at_k({U1: [S1]}, [U1], frozenset(), 10)
        assert_close(self, value, 0.0)

    def test_127_coverage_k_zero_rejected(self):
        with self.assertRaises(EvaluationValidationError):
            catalog_coverage_at_k({U1: [S1]}, [U1], frozenset([S1]), 0)

    def test_128_coverage_only_evaluable_users(self):
        value = catalog_coverage_at_k(
            {U1: [S1], U2: [S2]},
            [U1],
            frozenset([S1, S2]),
            10,
        )
        assert_close(self, value, 0.5)


class DiversityTests(unittest.TestCase):
    def test_129_identical_features_diversity_zero(self):
        bundle = build_song_content_features(
            [
                {"_id": S1, "artist": "Same", "genre": "Pop"},
                {"_id": S2, "artist": "Same", "genre": "Pop"},
            ]
        )
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
            bundle=bundle,
        )
        assert_close(self, result.diversity, 0.0)
        self.assertEqual(result.summary.diversity_pair_count, 1)
        self.assertEqual(result.summary.diversity_evaluable_user_count, 1)

    def test_130_orthogonal_features_diversity_one(self):
        bundle = build_song_content_features(
            [
                {"_id": S1, "artist": "A", "genre": "Pop"},
                {"_id": S2, "artist": "B", "genre": "Rock"},
            ]
        )
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
            bundle=bundle,
        )
        assert_close(self, result.diversity, 1.0, places=6)

    def test_131_partial_share_diversity_half(self):
        bundle = build_song_content_features(
            [
                {"_id": S1, "artist": "A", "genre": "Pop"},
                {"_id": S2, "artist": "B", "genre": "Pop"},
            ]
        )
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
            bundle=bundle,
        )
        assert_close(self, result.diversity, 0.5, places=6)

    def test_132_zero_feature_pair_excluded(self):
        bundle = build_song_content_features([{"_id": S1, "artist": "A"}, {"_id": S2}])
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
            bundle=bundle,
        )
        assert_close(self, result.diversity, 0.0)
        self.assertEqual(result.summary.diversity_pair_count, 0)
        self.assertEqual(result.summary.diversity_evaluable_user_count, 0)

    def test_133_single_song_no_pairs(self):
        result = run_eval(
            recs={U1: [S1]},
            rel={U1: [S1]},
            catalog=[S1],
        )
        assert_close(self, result.diversity, 0.0)
        self.assertEqual(result.summary.diversity_pair_count, 0)

    def test_134_empty_recommendations_no_diversity(self):
        result = run_eval(recs={U1: []}, rel={U1: [S1]}, catalog=[S1])
        assert_close(self, result.diversity, 0.0)
        self.assertEqual(result.summary.diversity_evaluable_user_count, 0)

    def test_135_three_songs_three_pairs(self):
        bundle = build_song_content_features(
            [
                {"_id": S1, "artist": "A", "genre": "Pop"},
                {"_id": S2, "artist": "B", "genre": "Rock"},
                {"_id": S3, "artist": "C", "genre": "Jazz"},
            ]
        )
        result = run_eval(
            recs={U1: [S1, S2, S3]},
            rel={U1: [S1]},
            catalog=[S1, S2, S3],
            bundle=bundle,
        )
        self.assertEqual(result.summary.diversity_pair_count, 3)
        self.assertEqual(result.summary.diversity_evaluable_user_count, 1)

    def test_136_global_mean_equal_user_weight(self):
        bundle_a = build_song_content_features(
            [
                {"_id": S1, "artist": "A", "genre": "Pop"},
                {"_id": S2, "artist": "B", "genre": "Rock"},
            ]
        )
        result_a = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
            bundle=bundle_a,
        )
        bundle_b = build_song_content_features(
            [
                {"_id": S1, "artist": "Same", "genre": "Pop"},
                {"_id": S2, "artist": "Same", "genre": "Pop"},
            ]
        )
        result_b = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
            bundle=bundle_b,
        )
        combined = build_song_content_features(
            [
                {"_id": S1, "artist": "A", "genre": "Pop"},
                {"_id": S2, "artist": "B", "genre": "Rock"},
                {"_id": S3, "artist": "Same", "genre": "Pop"},
                {"_id": S4, "artist": "Same", "genre": "Pop"},
            ]
        )
        result = run_eval(
            recs={U1: [S1, S2], U2: [S3, S4]},
            rel={U1: [S1], U2: [S3]},
            catalog=[S1, S2, S3, S4],
            bundle=combined,
        )
        expected = (result_a.diversity + result_b.diversity) / 2
        assert_close(self, result.diversity, expected, places=6)
        self.assertEqual(result.summary.diversity_evaluable_user_count, 2)
        self.assertEqual(result.summary.diversity_pair_count, 2)

    def test_137_diversity_k_truncates_to_10(self):
        ids = [f"{i:024x}" for i in range(12)]
        bundle = build_song_content_features([{"_id": s, "artist": f"A{i}"} for i, s in enumerate(ids)])
        result = run_eval(
            recs={U1: ids},
            rel={U1: [ids[0]]},
            catalog=ids,
            bundle=bundle,
        )
        self.assertEqual(result.summary.diversity_pair_count, 45)

    def test_138_diversity_helper_k_zero_rejected(self):
        bundle = bundle_basic()
        with self.assertRaises(EvaluationValidationError):
            intra_list_diversity_at_k([S1, S2], bundle, 0, {})

    def test_139_diversity_helper_short_list(self):
        bundle = bundle_basic()
        value, pairs = intra_list_diversity_at_k([S1], bundle, 10, {})
        self.assertIsNone(value)
        self.assertEqual(pairs, 0)

    def test_140_diversity_helper_caches_norms(self):
        bundle = bundle_basic()
        cache: dict = {}
        v1, p1 = intra_list_diversity_at_k([S1, S2], bundle, 10, cache)
        v2, p2 = intra_list_diversity_at_k([S1, S2], bundle, 10, cache)
        assert_close(self, v1, v2, places=9)
        self.assertEqual(p1, p2)
        self.assertIn(S1, cache)
        self.assertIn(S2, cache)

    def test_141_diversity_not_averaged_with_zero_feature_users(self):
        bundle = build_song_content_features(
            [
                {"_id": S1, "artist": "A", "genre": "Pop"},
                {"_id": S2, "artist": "B", "genre": "Rock"},
                {"_id": S3},
                {"_id": S4},
            ]
        )
        result = run_eval(
            recs={U1: [S1, S2], U2: [S3, S4]},
            rel={U1: [S1], U2: [S3]},
            catalog=[S1, S2, S3, S4],
            bundle=bundle,
        )
        assert_close(self, result.diversity, 1.0, places=6)
        self.assertEqual(result.summary.diversity_evaluable_user_count, 1)
        self.assertEqual(result.summary.diversity_pair_count, 1)

    def test_142_diversity_clamped_nonnegative(self):
        bundle = build_song_content_features(
            [
                {"_id": S1, "artist": "A", "genre": "Pop"},
                {"_id": S2, "artist": "A", "genre": "Pop"},
            ]
        )
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
            bundle=bundle,
        )
        self.assertGreaterEqual(result.diversity, 0.0)
        self.assertLessEqual(result.diversity, 1.0)


class ResultShapeTests(unittest.TestCase):
    def test_143_all_metrics_finite_unit_interval(self):
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5]},
            rel={U1: [S1, S3]},
            catalog=[S1, S2, S3, S4, S5, S6, S7, S8],
        )
        for name in (
            "precision_at_5",
            "precision_at_10",
            "recall_at_5",
            "recall_at_10",
            "ndcg_at_5",
            "ndcg_at_10",
            "map_at_10",
            "hit_rate_at_10",
            "catalog_coverage",
            "diversity",
        ):
            value = getattr(result, name)
            self.assertFalse(math.isnan(value), name)
            self.assertFalse(math.isinf(value), name)
            self.assertGreaterEqual(value, 0.0, name)
            self.assertLessEqual(value, 1.0, name)

    def test_144_summary_types(self):
        result = run_eval()
        summary = result.summary
        self.assertIsInstance(summary.evaluated_user_count, int)
        self.assertIsInstance(summary.recommendation_user_count, int)
        self.assertIsInstance(summary.relevance_user_count, int)
        self.assertIsInstance(summary.catalog_size, int)
        self.assertIsInstance(summary.unique_recommended_at_10, int)
        self.assertIsInstance(summary.diversity_evaluable_user_count, int)
        self.assertIsInstance(summary.diversity_pair_count, int)

    def test_145_no_rounding_in_results(self):
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1, S2, S3]},
            catalog=[S1, S2, S3],
        )
        assert_close(self, result.recall_at_5, 2 / 3, places=12)
        self.assertNotEqual(result.recall_at_5, round(result.recall_at_5, 2))

    def test_146_result_has_nested_summary(self):
        result = run_eval()
        self.assertIsInstance(result.summary, RecommenderEvaluationSummary)

    def test_147_precision_never_exceeds_one(self):
        ids = [f"{i:024x}" for i in range(10)]
        bundle = build_song_content_features([{"_id": sid, "artist": f"A{i}"} for i, sid in enumerate(ids)])
        result = run_eval(
            recs={U1: list(ids)},
            rel={U1: list(ids)},
            catalog=list(ids),
            bundle=bundle,
        )
        self.assertLessEqual(result.precision_at_5, 1.0)
        self.assertLessEqual(result.precision_at_10, 1.0)
        assert_close(self, result.precision_at_10, 1.0)

    def test_148_recall_never_exceeds_one(self):
        result = run_eval(
            recs={U1: [S1, S2, S3]},
            rel={U1: [S1]},
            catalog=[S1, S2, S3],
        )
        self.assertLessEqual(result.recall_at_5, 1.0)
        assert_close(self, result.recall_at_5, 1.0)

    def test_149_ndcg_never_exceeds_one(self):
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1, S2]},
            catalog=[S1, S2],
        )
        self.assertLessEqual(result.ndcg_at_5, 1.0)
        assert_close(self, result.ndcg_at_5, 1.0)

    def test_150_map_never_exceeds_one(self):
        result = run_eval(
            recs={U1: [S1]},
            rel={U1: [S1]},
            catalog=[S1],
        )
        self.assertLessEqual(result.map_at_10, 1.0)
        assert_close(self, result.map_at_10, 1.0)


class ReferenceExampleTests(unittest.TestCase):
    def test_151_reference_two_user_metrics(self):
        catalog = [S1, S2, S3, S4, S5, S6, S7, S8]
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]},
            rel={U1: [S1, S3], U2: [S4]},
            catalog=catalog,
        )
        assert_close(self, result.precision_at_5, 0.2)
        assert_close(self, result.precision_at_10, 0.1)
        assert_close(self, result.recall_at_5, 0.5)
        assert_close(self, result.recall_at_10, 0.5)
        assert_close(self, result.ndcg_at_5, 0.4598603945740938)
        assert_close(self, result.map_at_10, 0.41666666666666663)
        assert_close(self, result.hit_rate_at_10, 0.5)

    def test_152_reference_summary_counts(self):
        catalog = [S1, S2, S3, S4, S5, S6, S7, S8]
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]},
            rel={U1: [S1, S3], U2: [S4]},
            catalog=catalog,
        )
        self.assertEqual(result.summary.evaluated_user_count, 2)
        self.assertEqual(result.summary.recommendation_user_count, 2)
        self.assertEqual(result.summary.relevance_user_count, 2)
        self.assertEqual(result.summary.catalog_size, 8)
        self.assertEqual(result.summary.unique_recommended_at_10, 7)

    def test_153_reference_coverage(self):
        catalog = [S1, S2, S3, S4, S5, S6, S7, S8]
        result = run_eval(
            recs={U1: [S1, S2, S3, S4, S5], U2: [S2, S6, S7]},
            rel={U1: [S1, S3], U2: [S4]},
            catalog=catalog,
        )
        assert_close(self, result.catalog_coverage, 7 / 8)

    def test_154_reference_hand_precision_per_user(self):
        value_a = precision_at_k([S1, S2, S3, S4, S5], frozenset([S1, S3]), 5)
        value_b = precision_at_k([S2, S6, S7], frozenset([S4]), 5)
        assert_close(self, value_a, 0.4)
        assert_close(self, value_b, 0.0)
        assert_close(self, (value_a + value_b) / 2, 0.2)


class DeterminismTests(unittest.TestCase):
    def test_155_repeat_calls_identical(self):
        kwargs = dict(
            recs={U1: [S1, S2, S3], U2: [S4, S5]},
            rel={U1: [S1], U2: [S4]},
            catalog=[S1, S2, S3, S4, S5, S6],
        )
        first = run_eval(**kwargs)
        second = run_eval(**kwargs)
        self.assertEqual(first, second)

    def test_156_dict_order_does_not_change_result(self):
        recs_a = {U1: [S1, S2], U2: [S3]}
        recs_b = {U2: [S3], U1: [S1, S2]}
        rel_a = {U1: [S1], U2: [S3]}
        rel_b = {U2: [S3], U1: [S1]}
        catalog = [S1, S2, S3]
        result_a = run_eval(recs=recs_a, rel=rel_a, catalog=catalog)
        result_b = run_eval(recs=recs_b, rel=rel_b, catalog=catalog)
        self.assertEqual(result_a, result_b)

    def test_157_relevance_set_order_irrelevant(self):
        catalog = [S1, S2, S3]
        result_list = run_eval(rel={U1: [S1, S2]}, catalog=catalog)
        result_set = run_eval(rel={U1: {S2, S1}}, catalog=catalog)
        self.assertEqual(result_list, result_set)

    def test_158_repeat_three_runs_stable(self):
        kwargs = dict(
            recs={U1: [S1, S2, S3, S4, S5]},
            rel={U1: [S1, S3]},
            catalog=[S1, S2, S3, S4, S5],
        )
        runs = [run_eval(**kwargs) for _ in range(3)]
        self.assertEqual(runs[0], runs[1])
        self.assertEqual(runs[1], runs[2])


class ImmutabilityTests(unittest.TestCase):
    def test_159_inputs_not_mutated(self):
        recs = {U1: [S1, S2]}
        rel = {U1: [S1, S2]}
        catalog = [S1, S2]
        recs_copy = copy.deepcopy(recs)
        rel_copy = copy.deepcopy(rel)
        catalog_copy = copy.deepcopy(catalog)
        run_eval(recs=recs, rel=rel, catalog=catalog)
        self.assertEqual(recs, recs_copy)
        self.assertEqual(rel, rel_copy)
        self.assertEqual(catalog, catalog_copy)

    def test_160_relevance_inner_list_not_consumed(self):
        relevant = [S1, S2]
        run_eval(rel={U1: relevant}, catalog=[S1, S2])
        self.assertEqual(relevant, [S1, S2])

    def test_161_recommendation_list_not_consumed(self):
        ranked = [S1, S2, S3]
        run_eval(recs={U1: ranked}, rel={U1: [S1]}, catalog=[S1, S2, S3])
        self.assertEqual(ranked, [S1, S2, S3])

    def test_162_catalog_list_not_consumed(self):
        catalog = [S1, S2]
        run_eval(catalog=catalog)
        self.assertEqual(catalog, [S1, S2])

    def test_163_result_is_immutable(self):
        result = run_eval()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.map_at_10 = 1.0
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.summary.catalog_size = 0


class StaticScopeSafetyTests(unittest.TestCase):
    def test_164_no_forbidden_imports(self):
        tree = ast.parse(MODULE_SOURCE)
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imported.add(alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        forbidden = {
            "pymongo",
            "sklearn",
            "pandas",
            "requests",
            "fastapi",
            "flask",
            "joblib",
            "torch",
            "tensorflow",
        }
        self.assertFalse(imported & forbidden, imported & forbidden)

    def test_165_no_dense_matrix_calls(self):
        for needle in (".toarray(", ".todense("):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_166_no_fit_or_predict(self):
        self.assertNotIn(".fit(", MODULE_SOURCE)
        self.assertNotIn("predict(", MODULE_SOURCE)

    def test_167_no_truncated_svd(self):
        self.assertNotIn("TruncatedSVD", MODULE_SOURCE)

    def test_168_no_mongo_or_favorite_playlist(self):
        for needle in (
            "pymongo",
            "MongoClient",
            "Favorite",
            "Playlist",
            "ListeningEvent",
            "TemporalInteractionEvent",
        ):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_169_no_artifact_publish_activate(self):
        self.assertNotIn("publish_artifact_release", MODULE_SOURCE)
        self.assertNotIn("activate_artifact_release", MODULE_SOURCE)

    def test_170_no_http_frameworks(self):
        for needle in ("FastAPI", "Flask", "requests"):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_171_no_overall_or_model_score_fields(self):
        for needle in ("overall_score", "quality_score", "model_score"):
            self.assertNotIn(needle, MODULE_SOURCE)

    def test_172_no_relevance_inference_from_events(self):
        self.assertNotIn("completed", MODULE_SOURCE)
        self.assertNotIn("skipped", MODULE_SOURCE)
        self.assertNotIn("stopped", MODULE_SOURCE)

    def test_173_no_time_or_random(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)
        self.assertNotIn("random.", MODULE_SOURCE)
        self.assertNotIn("import random", MODULE_SOURCE)

    def test_174_no_bare_recommend_call(self):
        import re

        self.assertIsNone(re.search(r"(?<![a-zA-Z_])recommend\s*\(", MODULE_SOURCE))

    def test_175_no_sklearn_pandas_strings(self):
        self.assertNotIn("sklearn", MODULE_SOURCE)
        self.assertNotIn("pandas", MODULE_SOURCE)

    def test_176_no_training_language(self):
        for needle in ("gradient_descent", "fit_transform", "SGDRegressor", "optimizer.step"):
            self.assertNotIn(needle, MODULE_SOURCE)
        self.assertNotIn("does train", MODULE_SOURCE)


class EdgeCaseTests(unittest.TestCase):
    def test_177_relevance_empty_set_only_user(self):
        result = run_eval(rel={U1: set()}, catalog=[S1])
        self.assertEqual(result.summary.evaluated_user_count, 0)
        self.assertEqual(result.summary.relevance_user_count, 1)

    def test_178_recs_empty_tuple_ok(self):
        result = run_eval(recs={U1: ()}, rel={U1: [S1]}, catalog=[S1])
        self.assertEqual(result.precision_at_5, 0.0)

    def test_179_both_maps_empty_with_catalog(self):
        result = run_eval(recs={}, rel={}, catalog=[S1, S2])
        self.assertEqual(result.summary.catalog_size, 2)
        self.assertEqual(result.summary.evaluated_user_count, 0)
        assert_close(self, result.catalog_coverage, 0.0)

    def test_180_error_messages_sanitized(self):
        try:
            run_eval(rel={U1: [S9]}, catalog=[S1])
            self.fail("expected error")
        except EvaluationValidationError as exc:
            message = str(exc)
            self.assertNotIn(S9, message)
            self.assertNotIn(U1, message)
            self.assertTrue(message)

    def test_181_tuple_recommendations_and_set_relevance(self):
        result = run_eval(
            recs={U1: (S1, S2)},
            rel={U1: frozenset([S1])},
            catalog=[S1, S2],
        )
        assert_close(self, result.precision_at_5, 1 / 5)
        assert_close(self, result.recall_at_5, 1.0)

    def test_182_hit_rate_with_only_evaluable_hits(self):
        ids = [S1, S2, S9]
        bundle = build_song_content_features([{"_id": sid, "artist": f"A{i}"} for i, sid in enumerate(ids)])
        result = run_eval(
            recs={U1: [S1], U2: [S2]},
            rel={U1: [S1], U2: [S9]},
            catalog=ids,
            bundle=bundle,
        )
        assert_close(self, result.hit_rate_at_10, 0.5)

    def test_183_coverage_uses_top10_union_not_sum(self):
        result = run_eval(
            recs={U1: [S1, S2], U2: [S1, S2]},
            rel={U1: [S1], U2: [S2]},
            catalog=[S1, S2, S3],
        )
        self.assertEqual(result.summary.unique_recommended_at_10, 2)
        assert_close(self, result.catalog_coverage, 2 / 3)

    def test_184_all_metric_helpers_reject_nonpositive_k(self):
        helpers = [
            precision_at_k,
            recall_at_k,
            ndcg_at_k,
            average_precision_at_k,
            hit_at_k,
        ]
        for helper in helpers:
            with self.assertRaises(EvaluationValidationError):
                helper([S1], frozenset([S1]), 0)

    def test_185_evaluate_returns_frozen_pair(self):
        result = run_eval(
            recs={U1: [S1, S2]},
            rel={U1: [S1]},
            catalog=[S1, S2],
        )
        self.assertIsInstance(result, RecommenderEvaluationResult)
        self.assertIsInstance(result.summary, RecommenderEvaluationSummary)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.summary = None


if __name__ == "__main__":
    unittest.main()
