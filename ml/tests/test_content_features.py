"""Standard-library tests for deterministic Song content-feature encoding."""

from __future__ import annotations

import ast
import copy
import dataclasses
import inspect
import os
import subprocess
import sys
import unittest
from pathlib import Path
from types import MappingProxyType

from ml.recommender.content_features import (
    CONTENT_FEATURE_FAMILIES,
    MAX_CONTENT_FEATURES,
    MAX_CONTENT_VALUE_LENGTH,
    ContentFeatureError,
    ContentFeatureValidationError,
    SongContentFeatureBundle,
    SongContentFeatureSummary,
    build_song_content_features,
    normalize_content_value,
)
from ml.recommender.runtime import (
    CPU_THREAD_ENV_VARS,
    CUDA_VISIBLE_DEVICES_VAR,
    MAX_UNIQUE_SONGS,
    ResourceLimitError,
    THREADS_PER_NUMERIC_LIBRARY,
)

MODULE_PATH = Path(__file__).resolve().parents[1] / "recommender" / "content_features.py"
MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
PROJECT_ROOT = Path(__file__).resolve().parents[2]

U1 = "a" * 24
U2 = "b" * 24
U3 = "c" * 24
S1 = "1" * 24
S2 = "2" * 24
S3 = "3" * 24


def make_song(
    *,
    _id: object = S1,
    artist: object | None = None,
    genre: object | None = None,
    language: object | None = None,
    category: object | None = None,
    normalized_artist: object | None = None,
    normalized_genre: object | None = None,
    include_id: bool = True,
    include_metadata: bool = True,
    extra: dict | None = None,
) -> dict:
    song: dict = {}
    if include_id:
        song["_id"] = _id
    if include_metadata:
        song["artist"] = artist
        song["genre"] = genre
        song["language"] = language
        song["category"] = category
        if normalized_artist is not None:
            song["normalized_artist"] = normalized_artist
        if normalized_genre is not None:
            song["normalized_genre"] = normalized_genre
    if extra:
        song.update(extra)
    return song


def bare_song(_id: object = S1) -> dict:
    return {"_id": _id}


def run_build(songs) -> SongContentFeatureBundle:
    return build_song_content_features(songs)


class ConstantsContractTests(unittest.TestCase):
    def test_01_feature_families_exact_tuple(self):
        self.assertEqual(
            CONTENT_FEATURE_FAMILIES, ("artist", "genre", "language", "category")
        )

    def test_02_max_value_length_is_512(self):
        self.assertEqual(MAX_CONTENT_VALUE_LENGTH, 512)

    def test_03_max_content_features_derives_from_runtime_cap(self):
        self.assertEqual(
            MAX_CONTENT_FEATURES, MAX_UNIQUE_SONGS * len(CONTENT_FEATURE_FAMILIES)
        )
        self.assertEqual(MAX_CONTENT_FEATURES, 100_000)
        self.assertEqual(MAX_UNIQUE_SONGS, 25_000)

    def test_04_no_arbitrary_feature_weight_constants(self):
        for name in (
            "ARTIST_WEIGHT",
            "GENRE_WEIGHT",
            "LANGUAGE_WEIGHT",
            "CATEGORY_WEIGHT",
            "CONTENT_SCORE",
            "CONTENT_WEIGHT",
            "FEATURE_WEIGHT",
        ):
            self.assertNotIn(name, MODULE_SOURCE)


class EmptyInputTests(unittest.TestCase):
    def test_05_empty_list_accepted(self):
        bundle = run_build([])
        self.assertIsInstance(bundle, SongContentFeatureBundle)

    def test_06_empty_tuple_accepted(self):
        bundle = run_build(())
        self.assertEqual(bundle.song_ids, ())

    def test_07_empty_song_ids(self):
        self.assertEqual(run_build([]).song_ids, ())

    def test_08_empty_feature_names(self):
        self.assertEqual(run_build([]).feature_names, ())

    def test_09_matrix_shape_zero(self):
        self.assertEqual(run_build([]).matrix.shape, (0, 0))

    def test_10_matrix_is_csr(self):
        self.assertEqual(run_build([]).matrix.format, "csr")

    def test_11_matrix_is_float32(self):
        self.assertEqual(run_build([]).matrix.dtype.name, "float32")

    def test_12_matrix_nnz_zero(self):
        self.assertEqual(run_build([]).matrix.nnz, 0)

    def test_13_summary_all_zero(self):
        summary = run_build([]).summary
        self.assertEqual(summary.song_count, 0)
        self.assertEqual(summary.feature_count, 0)
        self.assertEqual(summary.nonzero_count, 0)
        self.assertEqual(summary.zero_feature_song_count, 0)
        self.assertEqual(summary.artist_feature_count, 0)
        self.assertEqual(summary.genre_feature_count, 0)
        self.assertEqual(summary.language_feature_count, 0)
        self.assertEqual(summary.category_feature_count, 0)
        self.assertEqual(summary.matrix_shape, (0, 0))


class InputContractTests(unittest.TestCase):
    def test_14_string_input_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features("songs")

    def test_15_bytes_input_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features(b"songs")

    def test_16_mapping_as_whole_input_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features({"_id": S1})

    def test_17_generator_rejected(self):
        def gen():
            yield make_song()

        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features(gen())

    def test_18_arbitrary_object_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features(object())

    def test_19_non_mapping_song_item_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([123])
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(_id=S1), "not-a-song"])


class SongIdTests(unittest.TestCase):
    def test_20_valid_lowercase_id_accepted(self):
        bundle = run_build([make_song(_id=S1)])
        self.assertEqual(bundle.song_ids, (S1,))

    def test_21_uppercase_id_normalized_lowercase(self):
        bundle = run_build([make_song(_id=S1.upper())])
        self.assertEqual(bundle.song_ids, (S1,))

    def test_22_missing_id_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(include_id=False)])

    def test_23_blank_id_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(_id="")])
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(_id="   ")])

    def test_24_short_id_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(_id="abc")])

    def test_25_non_hex_id_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(_id="z" * 24)])

    def test_26_numeric_id_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(_id=12345)])

    def test_27_object_id_value_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(_id=object())])

    def test_28_duplicate_canonical_song_id_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features(
                [make_song(_id=S1), make_song(_id=S1.upper())]
            )


class MetadataTypeTests(unittest.TestCase):
    def test_29_missing_artist_accepted(self):
        song = make_song()
        del song["artist"]
        bundle = run_build([song])
        self.assertEqual(bundle.summary.song_count, 1)

    def test_30_null_artist_accepted(self):
        bundle = run_build([make_song(artist=None)])
        self.assertEqual(bundle.summary.song_count, 1)

    def test_31_numeric_artist_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(artist=42)])

    def test_32_boolean_genre_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(genre=True)])

    def test_33_list_language_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(language=["en"])])

    def test_34_dict_category_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(category={"a": 1})])

    def test_35_object_normalized_artist_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features(
                [make_song(normalized_artist=object())]
            )

    def test_36_object_normalized_genre_rejected(self):
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features(
                [make_song(normalized_genre={"x": 1})]
            )


class NormalizationTests(unittest.TestCase):
    def test_37_leading_trailing_whitespace_removed(self):
        self.assertEqual(normalize_content_value("  Pop  "), "pop")

    def test_38_repeated_internal_whitespace_collapsed(self):
        self.assertEqual(
            normalize_content_value("  Pop   Rock "), "pop rock"
        )

    def test_39_case_normalized_with_casefold(self):
        self.assertEqual(normalize_content_value("Arijit Singh"), "arijit singh")
        self.assertEqual(normalize_content_value("Straße"), "strasse")

    def test_40_nfkc_normalization_deterministic(self):
        composed = normalize_content_value("ﬁn")  # Latin small ligature fi
        self.assertEqual(composed, normalize_content_value("ﬁn"))
        self.assertEqual(composed, "fin")
        self.assertEqual(
            normalize_content_value("ＡＢＣ"), normalize_content_value("ABC")
        )

    def test_41_punctuation_preserved(self):
        self.assertEqual(normalize_content_value("Rock & Roll"), "rock & roll")
        self.assertEqual(normalize_content_value("pop-rock"), "pop-rock")

    def test_42_accents_not_stripped(self):
        self.assertEqual(normalize_content_value("Beyoncé"), "beyoncé")

    def test_43_no_transliteration(self):
        self.assertEqual(normalize_content_value("আরিজিৎ"), "আরিজিৎ")
        self.assertEqual(normalize_content_value("कैसे"), "कैसे")

    def test_44_empty_normalized_value_omitted(self):
        bundle = run_build([make_song(artist="   ", genre="  ")])
        self.assertEqual(bundle.feature_names, ())
        self.assertEqual(bundle.matrix.nnz, 0)
        self.assertEqual(bundle.summary.zero_feature_song_count, 1)

    def test_45_over_512_normalized_value_rejected(self):
        long_value = "a" * (MAX_CONTENT_VALUE_LENGTH + 1)
        with self.assertRaises(ContentFeatureValidationError):
            build_song_content_features([make_song(artist=long_value)])

    def test_46_exactly_512_accepted(self):
        exact = "a" * MAX_CONTENT_VALUE_LENGTH
        bundle = run_build([make_song(artist=exact)])
        self.assertIn(f"artist::{exact}", bundle.feature_names)


class ArtistTests(unittest.TestCase):
    def test_47_artist_produces_namespaced_feature(self):
        bundle = run_build([make_song(artist="Arijit Singh")])
        self.assertEqual(bundle.feature_names, ("artist::arijit singh",))

    def test_48_normalized_artist_takes_precedence(self):
        bundle = run_build(
            [
                make_song(
                    artist="Artist Display",
                    normalized_artist="Artist Canonical",
                )
            ]
        )
        self.assertEqual(
            bundle.feature_names, ("artist::artist canonical",)
        )

    def test_49_blank_normalized_artist_falls_back_to_artist(self):
        bundle = run_build(
            [make_song(artist="Real Artist", normalized_artist="  ")]
        )
        self.assertEqual(bundle.feature_names, ("artist::real artist",))

    def test_50_missing_both_yields_no_artist_feature(self):
        song = make_song(artist=None)
        del song["artist"]
        bundle = run_build([song])
        self.assertFalse(
            any(name.startswith("artist::") for name in bundle.feature_names)
        )

    def test_51_artist_string_not_split_on_comma(self):
        bundle = run_build([make_song(artist="Artist A, Artist B")])
        self.assertEqual(
            bundle.feature_names, ("artist::artist a, artist b",)
        )

    def test_52_artist_string_not_split_on_ampersand(self):
        bundle = run_build([make_song(artist="Artist A & Artist B")])
        self.assertEqual(
            bundle.feature_names, ("artist::artist a & artist b",)
        )
        self.assertEqual(bundle.summary.artist_feature_count, 1)

    def test_53_artist_not_inferred_from_other_fields(self):
        song = make_song(artist=None)
        del song["artist"]
        song["title"] = "Some Song Title"
        song["youtube_id"] = "abcdefghijk"
        bundle = run_build([song])
        self.assertFalse(
            any(name.startswith("artist::") for name in bundle.feature_names)
        )


class GenreTests(unittest.TestCase):
    def test_54_genre_produces_namespaced_feature(self):
        bundle = run_build([make_song(genre="Pop")])
        self.assertEqual(bundle.feature_names, ("genre::pop",))

    def test_55_normalized_genre_takes_precedence(self):
        bundle = run_build(
            [make_song(genre="Pop Rock", normalized_genre="PopRock")]
        )
        self.assertEqual(bundle.feature_names, ("genre::poprock",))

    def test_56_blank_normalized_genre_falls_back_to_genre(self):
        bundle = run_build(
            [make_song(genre="Rock", normalized_genre="   ")]
        )
        self.assertEqual(bundle.feature_names, ("genre::rock",))

    def test_57_missing_both_yields_no_genre_feature(self):
        song = make_song(genre=None)
        del song["genre"]
        bundle = run_build([song])
        self.assertFalse(
            any(name.startswith("genre::") for name in bundle.feature_names)
        )

    def test_58_genre_string_not_split_on_comma_or_slash(self):
        bundle = run_build([make_song(genre="Pop, Rock")])
        self.assertEqual(bundle.feature_names, ("genre::pop, rock",))
        bundle = run_build([make_song(genre="Pop/Rock")])
        self.assertEqual(bundle.feature_names, ("genre::pop/rock",))

    def test_59_genre_not_inferred_from_category_or_title(self):
        song = make_song(genre=None, category="music")
        del song["genre"]
        song["title"] = "Title"
        bundle = run_build([song])
        self.assertFalse(
            any(name.startswith("genre::") for name in bundle.feature_names)
        )


class LanguageTests(unittest.TestCase):
    def test_60_language_produces_namespaced_feature(self):
        bundle = run_build([make_song(language="Bangla")])
        self.assertIn("language::bangla", bundle.feature_names)

    def test_61_missing_language_yields_no_language_feature(self):
        bundle = run_build([make_song(language=None)])
        self.assertFalse(
            any(name.startswith("language::") for name in bundle.feature_names)
        )

    def test_62_language_not_inferred_from_title_or_artist(self):
        song = make_song(language=None, artist="Bangla Artist")
        song["title"] = "Bangla Song"
        bundle = run_build([song])
        self.assertFalse(
            any(name.startswith("language::") for name in bundle.feature_names)
        )


class CategoryTests(unittest.TestCase):
    def test_63_category_produces_namespaced_feature(self):
        bundle = run_build([make_song(category="Music")])
        self.assertIn("category::music", bundle.feature_names)

    def test_64_missing_category_yields_no_category_feature(self):
        bundle = run_build([make_song(category=None)])
        self.assertFalse(
            any(name.startswith("category::") for name in bundle.feature_names)
        )

    def test_65_category_not_inferred_from_genre(self):
        bundle = run_build([make_song(genre="Pop", category=None)])
        self.assertFalse(
            any(name.startswith("category::") for name in bundle.feature_names)
        )


class UnknownPlaceholderTests(unittest.TestCase):
    def test_66_persisted_unknown_becomes_factual_feature(self):
        bundle = run_build([make_song(genre="Unknown")])
        self.assertIn("genre::unknown", bundle.feature_names)

    def test_67_no_special_placeholder_suppression(self):
        bundle = run_build(
            [
                make_song(
                    artist="Unknown",
                    genre="Unknown",
                    language="Unknown",
                    category="Unknown",
                )
            ]
        )
        self.assertIn("artist::unknown", bundle.feature_names)
        self.assertIn("genre::unknown", bundle.feature_names)
        self.assertIn("language::unknown", bundle.feature_names)
        self.assertIn("category::unknown", bundle.feature_names)

    def test_68_na_remains_factual_categorical_string(self):
        bundle = run_build([make_song(language="N/A")])
        self.assertIn("language::n/a", bundle.feature_names)


class NamespaceTests(unittest.TestCase):
    def test_69_same_value_artist_and_genre_yields_two_features(self):
        bundle = run_build(
            [make_song(artist="rock", genre="rock")]
        )
        self.assertIn("artist::rock", bundle.feature_names)
        self.assertIn("genre::rock", bundle.feature_names)
        self.assertEqual(bundle.matrix.nnz, 2)

    def test_70_same_value_genre_and_category_yields_two_features(self):
        bundle = run_build(
            [make_song(artist=None, genre="rock", category="rock")]
        )
        self.assertIn("genre::rock", bundle.feature_names)
        self.assertIn("category::rock", bundle.feature_names)
        self.assertEqual(
            bundle.summary.genre_feature_count, 1
        )
        self.assertEqual(
            bundle.summary.category_feature_count, 1
        )

    def test_71_namespace_prevents_collisions(self):
        bundle = run_build(
            [make_song(artist="rock", genre="rock", category="rock")]
        )
        rock_features = [n for n in bundle.feature_names if n.endswith("::rock")]
        self.assertEqual(
            rock_features,
            ["artist::rock", "category::rock", "genre::rock"],
        )


class OneFeaturePerFamilyTests(unittest.TestCase):
    def test_72_one_song_has_at_most_four_nonzeros(self):
        bundle = run_build(
            [
                make_song(
                    artist="a",
                    genre="g",
                    language="l",
                    category="c",
                )
            ]
        )
        self.assertEqual(bundle.matrix.nnz, 4)
        self.assertEqual(bundle.matrix.shape, (1, 4))

    def test_73_normalized_plus_raw_artist_do_not_create_two_features(self):
        bundle = run_build(
            [
                make_song(
                    artist="Display Artist",
                    normalized_artist="canonical artist",
                )
            ]
        )
        artist_features = [
            n for n in bundle.feature_names if n.startswith("artist::")
        ]
        self.assertEqual(artist_features, ["artist::canonical artist"])
        self.assertEqual(bundle.matrix.nnz, 1)

    def test_74_normalized_plus_raw_genre_do_not_create_two_features(self):
        bundle = run_build(
            [
                make_song(
                    genre="Display Genre",
                    normalized_genre="canonical genre",
                )
            ]
        )
        genre_features = [
            n for n in bundle.feature_names if n.startswith("genre::")
        ]
        self.assertEqual(genre_features, ["genre::canonical genre"])
        self.assertEqual(bundle.matrix.nnz, 1)


class DeterministicSongIndexTests(unittest.TestCase):
    def test_75_song_ids_sorted_ascending(self):
        bundle = run_build(
            [
                make_song(_id=S3, artist="c"),
                make_song(_id=S1, artist="a"),
                make_song(_id=S2, artist="b"),
            ]
        )
        self.assertEqual(bundle.song_ids, (S1, S2, S3))

    def test_76_input_encounter_order_ignored(self):
        songs_a = [
            make_song(_id=S1, artist="a"),
            make_song(_id=S2, artist="b"),
        ]
        songs_b = list(reversed(songs_a))
        bundle_a = run_build(songs_a)
        bundle_b = run_build(songs_b)
        self.assertEqual(bundle_a.song_ids, bundle_b.song_ids)
        self.assertEqual(
            dict(bundle_a.song_to_index), dict(bundle_b.song_to_index)
        )

    def test_77_song_to_index_matches_sorted_tuple(self):
        bundle = run_build(
            [make_song(_id=S2), make_song(_id=S1)]
        )
        self.assertEqual(bundle.song_to_index[S1], 0)
        self.assertEqual(bundle.song_to_index[S2], 1)

    def test_78_song_to_index_immutable(self):
        bundle = run_build([make_song()])
        self.assertIsInstance(bundle.song_to_index, MappingProxyType)
        with self.assertRaises(TypeError):
            bundle.song_to_index["x"] = 0  # type: ignore[index]


class DeterministicFeatureIndexTests(unittest.TestCase):
    def test_79_feature_names_sorted_lexicographically(self):
        bundle = run_build(
            [
                make_song(
                    artist="zzz",
                    genre="aaa",
                    language="mmm",
                    category="bbb",
                )
            ]
        )
        self.assertEqual(
            bundle.feature_names, tuple(sorted(bundle.feature_names))
        )
        self.assertEqual(
            bundle.feature_names,
            (
                "artist::zzz",
                "category::bbb",
                "genre::aaa",
                "language::mmm",
            ),
        )

    def test_80_feature_encounter_order_ignored(self):
        songs_a = [
            make_song(_id=S1, artist="alpha", genre="beta"),
            make_song(_id=S2, artist="gamma", genre="delta"),
        ]
        songs_b = list(reversed(songs_a))
        self.assertEqual(
            run_build(songs_a).feature_names,
            run_build(songs_b).feature_names,
        )

    def test_81_feature_to_index_matches_sorted_tuple(self):
        bundle = run_build([make_song(artist="b", genre="a")])
        self.assertEqual(
            bundle.feature_to_index["artist::b"], 0
        )
        self.assertEqual(
            bundle.feature_to_index["genre::a"], 1
        )

    def test_82_feature_to_index_immutable(self):
        bundle = run_build([make_song()])
        self.assertIsInstance(bundle.feature_to_index, MappingProxyType)
        with self.assertRaises(TypeError):
            bundle.feature_to_index["x"] = 0  # type: ignore[index]

    def test_83_repeated_normalized_values_share_one_column(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist="Same Artist", genre=None),
                make_song(_id=S2, artist="same   artist", genre=None),
            ]
        )
        self.assertEqual(
            bundle.feature_names, ("artist::same artist",)
        )
        self.assertEqual(bundle.matrix.nnz, 2)
        self.assertEqual(bundle.matrix[0, 0], 1.0)
        self.assertEqual(bundle.matrix[1, 0], 1.0)


class MatrixTests(unittest.TestCase):
    def test_84_one_song_one_feature_shape(self):
        bundle = run_build([make_song(artist="solo", genre=None)])
        self.assertEqual(bundle.matrix.shape, (1, 1))

    def test_85_one_song_four_features_shape(self):
        bundle = run_build(
            [
                make_song(
                    artist="a",
                    genre="g",
                    language="l",
                    category="c",
                )
            ]
        )
        self.assertEqual(bundle.matrix.shape, (1, 4))

    def test_86_two_songs_shared_feature_coordinate(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist="shared", genre=None),
                make_song(_id=S2, artist="shared", genre=None),
            ]
        )
        col = bundle.feature_to_index["artist::shared"]
        self.assertEqual(bundle.matrix[0, col], 1.0)
        self.assertEqual(bundle.matrix[1, col], 1.0)
        self.assertEqual(bundle.matrix.nnz, 2)

    def test_87_two_songs_distinct_features(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist="one", genre=None),
                make_song(_id=S2, artist="two", genre=None),
            ]
        )
        self.assertEqual(bundle.matrix.shape, (2, 2))
        self.assertEqual(bundle.matrix.nnz, 2)

    def test_88_every_active_matrix_value_is_one(self):
        bundle = run_build(
            [
                make_song(
                    _id=S1,
                    artist="a",
                    genre="g",
                    language="l",
                    category="c",
                ),
                make_song(_id=S2, artist="a", genre="z"),
            ]
        )
        self.assertTrue((bundle.matrix.data == 1.0).all())

    def test_89_no_matrix_value_greater_than_one(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist="a"),
                make_song(_id=S2, artist="a"),
                make_song(_id=S3, artist="a"),
            ]
        )
        self.assertTrue((bundle.matrix.data <= 1.0).all())

    def test_90_absent_feature_remains_implicit_zero(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist="a", genre=None),
                make_song(_id=S2, artist="b", genre=None),
            ]
        )
        col_a = bundle.feature_to_index["artist::a"]
        col_b = bundle.feature_to_index["artist::b"]
        self.assertEqual(bundle.matrix[0, col_b], 0.0)
        self.assertEqual(bundle.matrix[1, col_a], 0.0)


class ZeroFeatureSongTests(unittest.TestCase):
    def test_91_zero_feature_valid_song_retained(self):
        bundle = run_build(
            [
                make_song(
                    _id=S1,
                    artist=None,
                    genre=None,
                    language=None,
                    category=None,
                )
            ]
        )
        self.assertEqual(bundle.song_ids, (S1,))
        self.assertIn(S1, bundle.song_to_index)

    def test_92_zero_feature_row_nnz_zero(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist="a", genre=None),
                make_song(
                    _id=S2,
                    artist=None,
                    genre=None,
                    language=None,
                    category=None,
                ),
            ]
        )
        row = bundle.song_to_index[S2]
        self.assertEqual(bundle.matrix[row].nnz, 0)

    def test_93_zero_feature_song_count_increments(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist="a", genre=None),
                make_song(
                    _id=S2,
                    artist=None,
                    genre=None,
                    language=None,
                    category=None,
                ),
            ]
        )
        self.assertEqual(bundle.summary.zero_feature_song_count, 1)

    def test_94_mix_preserves_both_rows(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist="kept", genre=None),
                make_song(
                    _id=S2,
                    artist=None,
                    genre=None,
                    language=None,
                    category=None,
                ),
            ]
        )
        self.assertEqual(bundle.song_ids, (S1, S2))
        self.assertEqual(bundle.summary.song_count, 2)
        self.assertEqual(bundle.summary.zero_feature_song_count, 1)
        self.assertEqual(bundle.matrix.shape[0], 2)


class AllZeroFeatureTests(unittest.TestCase):
    def test_95_three_zero_feature_songs_shape(self):
        bundle = run_build(
            [
                make_song(
                    _id=S1,
                    artist=None,
                    genre=None,
                    language=None,
                    category=None,
                ),
                make_song(
                    _id=S2,
                    artist=None,
                    genre=None,
                    language=None,
                    category=None,
                ),
                make_song(
                    _id=S3,
                    artist=None,
                    genre=None,
                    language=None,
                    category=None,
                ),
            ]
        )
        self.assertEqual(bundle.matrix.shape, (3, 0))

    def test_96_song_mappings_remain_valid(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist=None),
                make_song(_id=S2, artist=None),
                make_song(_id=S3, artist=None),
            ]
        )
        self.assertEqual(len(bundle.song_to_index), 3)
        self.assertEqual(bundle.song_to_index[S3], 2)

    def test_97_matrix_remains_csr_float32(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist=None),
                make_song(_id=S2, artist=None),
                make_song(_id=S3, artist=None),
            ]
        )
        self.assertEqual(bundle.matrix.format, "csr")
        self.assertEqual(bundle.matrix.dtype.name, "float32")

    def test_98_nnz_remains_zero(self):
        bundle = run_build(
            [
                make_song(_id=S1, artist=None),
                make_song(_id=S2, artist=None),
                make_song(_id=S3, artist=None),
            ]
        )
        self.assertEqual(bundle.matrix.nnz, 0)
        self.assertEqual(bundle.summary.nonzero_count, 0)
        self.assertEqual(bundle.summary.zero_feature_song_count, 3)


class SummaryTests(unittest.TestCase):
    def setUp(self):
        self.bundle = run_build(
            [
                make_song(
                    _id=S1,
                    artist="shared",
                    genre="pop",
                    language="bangla",
                    category="music",
                ),
                make_song(_id=S2, artist="shared", genre="rock"),
                make_song(
                    _id=S3,
                    artist=None,
                    genre=None,
                    language=None,
                    category=None,
                ),
            ]
        )

    def test_99_song_count_correct(self):
        self.assertEqual(self.bundle.summary.song_count, 3)

    def test_100_feature_count_correct(self):
        self.assertEqual(
            self.bundle.summary.feature_count,
            len(self.bundle.feature_names),
        )
        self.assertEqual(
            self.bundle.summary.feature_count,
            len(
                {
                    "artist::shared",
                    "genre::pop",
                    "language::bangla",
                    "category::music",
                    "genre::rock",
                }
            ),
        )

    def test_101_nonzero_count_correct(self):
        self.assertEqual(
            self.bundle.summary.nonzero_count, int(self.bundle.matrix.nnz)
        )
        self.assertEqual(self.bundle.summary.nonzero_count, 6)

    def test_102_zero_feature_song_count_correct(self):
        self.assertEqual(self.bundle.summary.zero_feature_song_count, 1)

    def test_103_artist_feature_count_counts_unique_artist_columns(self):
        self.assertEqual(self.bundle.summary.artist_feature_count, 1)
        artist_cols = [
            n for n in self.bundle.feature_names if n.startswith("artist::")
        ]
        self.assertEqual(
            self.bundle.summary.artist_feature_count, len(artist_cols)
        )

    def test_104_genre_feature_count_correct(self):
        self.assertEqual(self.bundle.summary.genre_feature_count, 2)

    def test_105_language_feature_count_correct(self):
        self.assertEqual(self.bundle.summary.language_feature_count, 1)

    def test_106_category_feature_count_correct(self):
        self.assertEqual(self.bundle.summary.category_feature_count, 1)

    def test_107_matrix_shape_correct(self):
        self.assertEqual(
            self.bundle.summary.matrix_shape, self.bundle.matrix.shape
        )
        self.assertEqual(self.bundle.summary.matrix_shape, (3, 5))

    def test_108_summary_immutable(self):
        with self.assertRaises(dataclasses.FrozenInstanceError):
            self.bundle.summary.song_count = 99  # type: ignore[misc]


class CsrRequirementTests(unittest.TestCase):
    def setUp(self):
        self.bundle = run_build(
            [
                make_song(_id=S1, artist="a", genre="g"),
                make_song(_id=S2, artist="a", genre="h"),
            ]
        )
        self.matrix = self.bundle.matrix

    def test_109_matrix_is_scipy_csr_matrix(self):
        from scipy.sparse import csr_matrix

        self.assertIsInstance(self.matrix, csr_matrix)

    def test_110_dtype_exactly_float32(self):
        import numpy as np

        self.assertEqual(self.matrix.dtype, np.float32)

    def test_111_has_sorted_indices(self):
        self.assertTrue(self.matrix.has_sorted_indices)

    def test_112_duplicate_sparse_coordinates_consolidated(self):
        coo = self.matrix.tocoo()
        keys = list(zip(coo.row.tolist(), coo.col.tolist()))
        self.assertEqual(len(keys), len(set(keys)))

    def test_113_explicit_zeros_eliminated(self):
        if self.matrix.nnz:
            self.assertTrue((self.matrix.data != 0).all())

    def test_114_all_matrix_data_finite(self):
        import numpy as np

        if self.matrix.nnz:
            self.assertTrue(np.isfinite(self.matrix.data).all())


class DeterminismTests(unittest.TestCase):
    def _songs(self):
        return [
            make_song(_id=S1, artist="alpha", genre="pop", language="en"),
            make_song(_id=S2, artist="beta", genre="rock", category="music"),
            make_song(_id=S3, artist=None, genre=None),
        ]

    def assert_bundle_equal(self, a, b):
        self.assertEqual(a.song_ids, b.song_ids)
        self.assertEqual(a.feature_names, b.feature_names)
        self.assertEqual(dict(a.song_to_index), dict(b.song_to_index))
        self.assertEqual(dict(a.feature_to_index), dict(b.feature_to_index))
        self.assertEqual(a.summary, b.summary)
        self.assertEqual(a.matrix.shape, b.matrix.shape)
        diff = (a.matrix != b.matrix)
        self.assertEqual(diff.nnz, 0)

    def test_115_reversed_song_input_yields_equivalent_bundle(self):
        songs = self._songs()
        self.assert_bundle_equal(
            run_build(songs), run_build(list(reversed(songs)))
        )

    def test_116_arbitrary_permutation_yields_equivalent_bundle(self):
        songs = self._songs()
        permuted = [songs[1], songs[2], songs[0]]
        self.assert_bundle_equal(run_build(songs), run_build(permuted))

    def test_117_repeated_call_yields_equivalent_bundle(self):
        songs = self._songs()
        self.assert_bundle_equal(run_build(songs), run_build(songs))

    def test_118_source_song_mappings_not_mutated(self):
        songs = [
            make_song(_id=S1, artist="Keep Me", genre="Pop"),
            make_song(_id=S2, artist="Also Keep", genre="Rock"),
        ]
        snapshot = copy.deepcopy(songs)
        run_build(songs)
        self.assertEqual(songs, snapshot)

    def test_119_no_random_dependency(self):
        self.assertNotIn("import random", MODULE_SOURCE)
        self.assertNotIn("random.", MODULE_SOURCE)
        self.assertNotIn("np.random", MODULE_SOURCE)

    def test_120_no_current_time_dependency(self):
        self.assertNotIn("datetime.now", MODULE_SOURCE)
        self.assertNotIn("time.time", MODULE_SOURCE)


class _FakeLongList(list):
    def __init__(self, length: int):
        super().__init__()
        self._length = length

    def __len__(self) -> int:
        return self._length

    def __iter__(self):
        raise AssertionError("should not iterate when over cap")


class RuntimeLimitTests(unittest.TestCase):
    def test_121_max_song_count_comes_from_runtime_contract(self):
        from ml.recommender import content_features as cf

        self.assertEqual(cf.MAX_UNIQUE_SONGS, MAX_UNIQUE_SONGS)
        self.assertEqual(MAX_UNIQUE_SONGS, 25_000)

    def test_122_over_cap_input_raises_before_expensive_processing(self):
        fake = _FakeLongList(MAX_UNIQUE_SONGS + 1)
        with self.assertRaises(ResourceLimitError):
            build_song_content_features(fake)

    def test_123_no_silent_truncation(self):
        fake = _FakeLongList(MAX_UNIQUE_SONGS + 1)
        with self.assertRaises(ResourceLimitError):
            build_song_content_features(fake)

    def test_124_feature_hard_bound_derived_from_song_cap_and_families(self):
        from ml.recommender import content_features as cf

        self.assertEqual(
            cf.MAX_CONTENT_FEATURES,
            cf.MAX_UNIQUE_SONGS * len(CONTENT_FEATURE_FAMILIES),
        )
        self.assertEqual(cf.MAX_CONTENT_FEATURES, 100_000)


class CpuNumericLoadingTests(unittest.TestCase):
    def test_125_importing_module_does_not_secretly_configure_env(self):
        keys = list(CPU_THREAD_ENV_VARS) + [CUDA_VISIBLE_DEVICES_VAR]
        code = (
            "import os\n"
            f"keys = {keys!r}\n"
            "before = {k: os.environ.get(k) for k in keys}\n"
            "import ml.recommender.content_features\n"
            "after = {k: os.environ.get(k) for k in keys}\n"
            "print(before == after)\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertEqual(result.stdout.strip().splitlines()[0], "True")

    def test_126_build_path_configures_runtime_before_numeric_loader(self):
        from ml.recommender import content_features as cf

        source = inspect.getsource(cf._load_numeric_stack)
        configure_pos = source.find("configure_cpu_runtime")
        numpy_pos = source.find("import numpy")
        self.assertGreater(configure_pos, -1)
        self.assertGreater(numpy_pos, configure_pos)

    def test_127_numeric_thread_variables_remain_one(self):
        run_build([make_song()])
        for name in CPU_THREAD_ENV_VARS:
            self.assertEqual(
                os.environ.get(name), str(THREADS_PER_NUMERIC_LIBRARY), msg=name
            )

    def test_128_cuda_visible_devices_remains_empty(self):
        run_build([make_song()])
        self.assertEqual(os.environ.get(CUDA_VISIBLE_DEVICES_VAR), "")

    def test_129_repeated_builds_preserve_idempotent_runtime_setup(self):
        run_build([make_song(_id=S1, artist="a")])
        first = {name: os.environ.get(name) for name in CPU_THREAD_ENV_VARS}
        run_build([make_song(_id=S2, artist="b")])
        second = {name: os.environ.get(name) for name in CPU_THREAD_ENV_VARS}
        self.assertEqual(first, second)

    def test_no_eager_numeric_import_at_module_level(self):
        tree = ast.parse(MODULE_SOURCE)
        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertNotIn("numpy", alias.name)
                    self.assertNotIn("scipy", alias.name)
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                self.assertNotIn("numpy", module)
                self.assertNotIn("scipy", module)


class NoDenseNoSimilarityTests(unittest.TestCase):
    def test_130_no_toarray_usage(self):
        self.assertNotIn(".toarray(", MODULE_SOURCE)

    def test_131_no_todense_usage(self):
        self.assertNotIn(".todense(", MODULE_SOURCE)

    def test_132_no_dense_song_feature_allocation(self):
        for name in (
            "np.zeros",
            "numpy.zeros",
            "np.ones",
            "numpy.ones",
            "np.empty",
            "numpy.empty",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_133_no_song_by_song_similarity_multiplication(self):
        self.assertNotIn("matrix @ matrix", MODULE_SOURCE)
        self.assertNotIn("@ self.matrix", MODULE_SOURCE)
        self.assertNotIn(".dot(", MODULE_SOURCE)

    def test_134_no_cosine_similarity_implementation(self):
        self.assertNotIn("cosine_similarity", MODULE_SOURCE)

    def test_135_no_nearest_neighbor_implementation(self):
        self.assertNotIn("NearestNeighbors", MODULE_SOURCE)
        self.assertNotIn("nearest_neighbors", MODULE_SOURCE)
        self.assertNotIn("kneighbors", MODULE_SOURCE)


class NoMlWeightingScopeTests(unittest.TestCase):
    def test_136_no_artist_weight(self):
        self.assertNotIn("ARTIST_WEIGHT", MODULE_SOURCE)

    def test_137_no_genre_weight(self):
        self.assertNotIn("GENRE_WEIGHT", MODULE_SOURCE)

    def test_138_no_language_weight(self):
        self.assertNotIn("LANGUAGE_WEIGHT", MODULE_SOURCE)

    def test_139_no_category_weight(self):
        self.assertNotIn("CATEGORY_WEIGHT", MODULE_SOURCE)

    def test_140_no_recommendation_score(self):
        self.assertNotIn("recommendation_score", MODULE_SOURCE)

    def test_141_no_preference_score(self):
        self.assertNotIn("preference_score", MODULE_SOURCE)

    def test_142_no_similarity_score(self):
        self.assertNotIn("similarity_score", MODULE_SOURCE)

    def test_143_no_tfidf(self):
        self.assertNotIn("Tfidf", MODULE_SOURCE)
        self.assertNotIn("TF-IDF", MODULE_SOURCE)
        self.assertNotIn("tfidf", MODULE_SOURCE)

    def test_144_no_sklearn_import(self):
        self.assertNotIn("sklearn", MODULE_SOURCE)

    def test_145_no_pandas_import(self):
        self.assertNotIn("pandas", MODULE_SOURCE)

    def test_146_no_pymongo_bson_import(self):
        self.assertNotIn("pymongo", MODULE_SOURCE)
        self.assertNotIn("import bson", MODULE_SOURCE)
        self.assertNotIn("from bson", MODULE_SOURCE)

    def test_147_no_favorite_playlist_import(self):
        self.assertNotIn("Favorite", MODULE_SOURCE)
        self.assertNotIn("Playlist", MODULE_SOURCE)

    def test_148_no_user_interaction_import(self):
        for name in (
            "ListeningEvent",
            "TemporalInteractionEvent",
            "SparseInteractionBundle",
            "userPreference",
            "build_sparse_interactions",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_149_no_artifact_write(self):
        for name in (
            "write_text",
            "json.dump",
            "np.save",
            "to_csv",
            "joblib",
            ".npz",
            ".npy",
            ".pkl",
            "pickle",
            "open(",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_150_no_model_fitting(self):
        for name in ("def train", "def fit", "TruncatedSVD", "SVD("):
            self.assertNotIn(name, MODULE_SOURCE)


class AdditionalStaticSafetyTests(unittest.TestCase):
    def test_no_tensorflow(self):
        self.assertNotIn("tensorflow", MODULE_SOURCE)

    def test_no_torch(self):
        self.assertNotIn("torch", MODULE_SOURCE)

    def test_no_one_hot_or_vectorizer_sklearn_style(self):
        for name in (
            "OneHotEncoder",
            "CountVectorizer",
            "HashingVectorizer",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_recommendation_eligible_filtering(self):
        self.assertNotIn("recommendation_eligible", MODULE_SOURCE)

    def test_no_http_framework(self):
        for name in ("fastapi", "flask", "django", "uvicorn"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_title_lyrics_chords_encoding(self):
        for name in (
            "title_tokens",
            "tokenize",
            "lyrics",
            "chords",
            "release_date",
            "duration_seconds",
            "youtube_id",
            "poster_url",
            "file_path",
            "source_provider",
        ):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_no_split_multi_value_markers_in_extractor(self):
        for name in ("split(\",\")", "split(\"/\")", "split(\"&\")"):
            self.assertNotIn(name, MODULE_SOURCE)

    def test_exception_hierarchy(self):
        self.assertTrue(
            issubclass(ContentFeatureValidationError, ContentFeatureError)
        )
        from ml.recommender.runtime import RecommenderRuntimeError

        self.assertTrue(issubclass(ContentFeatureError, RecommenderRuntimeError))

    def test_bundle_and_summary_frozen(self):
        bundle = run_build([make_song()])
        with self.assertRaises(dataclasses.FrozenInstanceError):
            bundle.song_ids = ()  # type: ignore[misc]
        with self.assertRaises(dataclasses.FrozenInstanceError):
            bundle.summary.feature_count = 0  # type: ignore[misc]

    def test_validation_error_message_bounded(self):
        try:
            build_song_content_features([make_song(_id="bad")])
        except ContentFeatureValidationError as exc:
            message = str(exc)
            self.assertNotIn("Traceback", message)
            self.assertNotIn("mongodb", message.lower())
            self.assertNotIn("password", message.lower())
            self.assertLess(len(message), 200)

    def test_runtime_info_unchanged_contract_reference(self):
        # content_features must not redefine conflicting runtime caps
        self.assertNotIn("MAX_UNIQUE_SONGS = 25_000", MODULE_SOURCE)
        self.assertNotIn("MAX_UNIQUE_SONGS = 25000", MODULE_SOURCE)


if __name__ == "__main__":
    unittest.main()
