"""Test-only composition of checkpoints 23–31 using tiny synthetic evidence.

The five-item rankings exhaust each user's eligible catalog, so recall/coverage
check wiring, not model quality. No latent orientation or raw score order is
prescribed. Every test builds fresh inputs; production orchestration lives in
``ml/recommender/orchestrator.py`` (checkpoint 43/43) and this suite remains a
self-contained composition check ending at evaluation.
"""

from __future__ import annotations

import ast
import copy
import math
import unittest
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from ml.recommender.collaborative_model import train_collaborative_model
from ml.recommender.content_features import build_song_content_features
from ml.recommender.cold_start import (
    BASE_HYBRID_POLICY_WEIGHT,
    EXPLICIT_PROFILE_POLICY_WEIGHT,
    normalize_explicit_preference_profile,
    rank_with_cold_start_policy,
)
from ml.recommender.evaluation import evaluate_recommendations
from ml.recommender.hybrid_ranker import (
    MAX_HYBRID_LIMIT,
    prepare_hybrid_ranker,
    rank_hybrid_candidates,
)
from ml.recommender.sparse_interactions import MATRIX_NAMES, build_sparse_interactions
from ml.recommender.temporal_split import split_interactions_temporally


def oid(number):
    return f"{number:024x}"


U1, U2, U3, U4 = (oid(n) for n in range(101, 105))
S1, S2, S3, S4, S5, S6 = (oid(n) for n in range(1, 7))
USERS = (U1, U2, U3)
SONGS = (S1, S2, S3, S4, S5, S6)
PATTERNS = ((S1, S2, S4), (S2, S3, S1), (S3, S1, S2))
PARTITIONS = ("train", "validation", "test")
FACTOR_FIELDS = (
    "user_factors", "song_factors", "singular_values", "explained_variance_ratio",
)


def _fixture():
    events = []
    for user_number, (user, pattern) in enumerate(zip(USERS, PATTERNS), 1):
        for day, (partition, song) in enumerate(zip(PARTITIONS, pattern), 1):
            for sequence, event_type in enumerate(("play-started", "progress", "completed")):
                events.append({
                    "_id": oid(1000 + len(events)),
                    "user": user,
                    "song": song,
                    "session_id": f"u{user_number}-{partition}",
                    "sequence": sequence,
                    "event_type": event_type,
                    # One-minute intervals; sessions are on distinct fixed days.
                    "createdAt": f"2026-01-0{day}T10:0{sequence}:00Z",
                    "listened_seconds_delta": (15.0 * (user_number + 1)
                                               if sequence == 1 else 0.0),
                })
    catalog = [
        {"_id": song, "artist": artist, "genre": genre,
         "language": "English", "category": "Song"}
        for song, artist, genre in (
            (S1, "Alpha", "Rock"), (S2, "Beta", "Pop"),
            (S3, "Gamma", "Jazz"), (S4, "Delta", "Ambient"),
            (S5, "Epsilon", "Rock"),
        )
    ]
    catalog.append({"_id": S6, "artist": None, "genre": None,
                    "language": None, "category": None})
    profiles = {user: {"artist_counts": {artist: 3}}
                for user, artist in zip(USERS, ("Delta", "Alpha", "Beta"))}
    profiles[U4] = {"artist_counts": {"Delta": 5}}
    return events, catalog, profiles


def _relevance(test_events):
    """Caller-provided holdout membership only; event types are irrelevant."""
    relevant = {}
    for event in test_events:
        relevant.setdefault(event.user_id, set()).add(event.song_id)
    return relevant


def _run_pipeline():
    raw, catalog, profiles = _fixture()
    input_before = copy.deepcopy((raw, catalog, profiles))
    split = split_interactions_temporally(raw)
    interactions = build_sparse_interactions(split.train)
    interaction_before = {name: getattr(interactions, name).copy() for name in MATRIX_NAMES}
    content = build_song_content_features(catalog)
    content_before = content.matrix.copy()
    training = train_collaborative_model(interactions)
    model = training.model
    factor_before = {name: getattr(model, name).copy() for name in FACTOR_FIELDS}
    context = prepare_hybrid_ranker(model, interactions, content)
    rankings = {
        user: rank_with_cold_start_policy(
            context, user, SONGS, explicit_profile=profiles[user], limit=5,
        ) for user in USERS
    }
    recommendations = {user: tuple(item.song_id for item in result.items)
                       for user, result in rankings.items()}
    relevant = _relevance(split.test)
    evaluation = evaluate_recommendations(recommendations, relevant, SONGS, content)
    cold_profile = rank_with_cold_start_policy(
        context, U4, (S4, S5, S6), explicit_profile=profiles[U4], limit=3,
    )
    cold_empty = rank_with_cold_start_policy(
        context, U4, (S4, S5, S6), explicit_profile=None, limit=3,
    )
    return SimpleNamespace(
        raw=raw, catalog=catalog, profiles=profiles, input_before=input_before,
        split=split, interactions=interactions, interaction_before=interaction_before,
        content=content, content_before=content_before, training=training, model=model,
        factor_before=factor_before, context=context, rankings=rankings,
        recommendations=recommendations, relevant=relevant, evaluation=evaluation,
        cold_profile=cold_profile, cold_empty=cold_empty,
    )


class RecommenderPipelineSmokeTests(unittest.TestCase):
    def setUp(self):
        self.p = _run_pipeline()
        # Numeric imports follow the production CPU runtime bootstrap.
        import numpy as np
        self.np = np

    def assert_csr_equal(self, actual, expected):
        self.assertEqual(actual.format, "csr")
        self.assertEqual(actual.shape, expected.shape)
        self.assertEqual(actual.dtype, expected.dtype)
        for name in ("data", "indices", "indptr"):
            self.np.testing.assert_array_equal(getattr(actual, name), getattr(expected, name))

    def assert_close(self, actual, expected):
        self.assertTrue(math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12),
                        f"{actual} != {expected}")

    def test_synthetic_fixture_scope(self):
        self.assertEqual({event["user"] for event in self.p.raw}, set(USERS))
        self.assertEqual(tuple(song["_id"] for song in self.p.catalog), SONGS)
        self.assertEqual(set(self.p.profiles), {*USERS, U4})
        self.assertEqual(len(self.p.raw), 27)
        allowed = {"_id", "user", "song", "session_id", "sequence", "event_type",
                   "createdAt", "listened_seconds_delta"}
        for event in self.p.raw:
            self.assertEqual(set(event), allowed)
        self.assertNotIn("@", repr((self.p.raw, self.p.catalog, self.p.profiles)))

    def test_fixture_ids_are_canonical_and_events_unique(self):
        event_ids = [event["_id"] for event in self.p.raw]
        self.assertEqual(len(set(event_ids)), 27)
        self.assertEqual(event_ids, [oid(n) for n in range(1000, 1027)])
        for value in (*USERS, U4, *SONGS, *event_ids):
            self.assertRegex(value, r"^[0-9a-f]{24}$")

    def test_fixture_timezone_and_session_sequences(self):
        groups = {}
        for event in self.p.raw:
            timestamp = datetime.fromisoformat(event["createdAt"].replace("Z", "+00:00"))
            self.assertEqual(timestamp.utcoffset().total_seconds(), 0)
            groups.setdefault((event["user"], event["session_id"]), []).append(event)
        self.assertEqual(len(groups), 9)
        for (_, session), events in groups.items():
            self.assertLessEqual(len(session), 128)
            self.assertEqual([e["sequence"] for e in events], [0, 1, 2])
            self.assertEqual([e["event_type"] for e in events],
                             ["play-started", "progress", "completed"])
            self.assertTrue(30 <= events[1]["listened_seconds_delta"] <= 60)

    def test_split_evaluable_users_and_no_overlap(self):
        summary = self.p.split.summary
        self.assertEqual(summary.unique_user_count, 3)
        self.assertEqual(summary.evaluable_user_count, 3)
        self.assertEqual(summary.train_only_user_count, 0)
        self.assertEqual(summary.overlap_train_only_user_count, 0)

    def test_split_event_conservation(self):
        split = self.p.split
        parts = [{e.event_id for e in getattr(split, name)} for name in PARTITIONS]
        self.assertEqual([len(part) for part in parts], [9, 9, 9])
        self.assertEqual(set.union(*parts), {e["_id"] for e in self.p.raw})
        self.assertEqual(sum(map(len, parts)), split.summary.input_event_count)
        self.assertEqual((split.summary.train_event_count, split.summary.validation_event_count,
                          split.summary.test_event_count), (9, 9, 9))
        for i, part in enumerate(parts):
            for other in parts[i + 1:]:
                self.assertTrue(part.isdisjoint(other))

    def test_split_session_conservation(self):
        split = self.p.split
        parts = [{(e.user_id, e.session_id) for e in getattr(split, name)}
                 for name in PARTITIONS]
        self.assertEqual([len(part) for part in parts], [3, 3, 3])
        self.assertEqual(len(set.union(*parts)), split.summary.session_count)
        self.assertEqual(split.summary.session_count, 9)
        self.assertEqual((split.summary.train_session_count,
                          split.summary.validation_session_count,
                          split.summary.test_session_count), (3, 3, 3))

    def test_each_user_session_pattern_and_chronology(self):
        for number, (user, pattern) in enumerate(zip(USERS, PATTERNS), 1):
            previous_end = None
            for name, song in zip(PARTITIONS, pattern):
                events = [e for e in getattr(self.p.split, name) if e.user_id == user]
                self.assertEqual(len(events), 3)
                self.assertEqual({e.song_id for e in events}, {song})
                self.assertEqual({e.session_id for e in events}, {f"u{number}-{name}"})
                if previous_end is not None:
                    self.assertLess(previous_end, min(e.created_at for e in events))
                previous_end = max(e.created_at for e in events)

    def test_sparse_boundary_receives_only_actual_train_partition(self):
        with mock.patch(f"{__name__}.build_sparse_interactions",
                        wraps=build_sparse_interactions) as builder:
            p = _run_pipeline()
        builder.assert_called_once_with(p.split.train)
        supplied = builder.call_args.args[0]
        self.assertIs(supplied, p.split.train)
        held_out = (*p.split.validation, *p.split.test)
        self.assertTrue({e.event_id for e in supplied}.isdisjoint(e.event_id for e in held_out))
        self.assertTrue(all(e is not held for e in supplied for held in held_out))

    def test_sparse_indexes_and_pair_count(self):
        b = self.p.interactions
        self.assertEqual(b.user_ids, USERS)
        self.assertEqual(b.song_ids, (S1, S2, S3))
        self.assertEqual(dict(b.user_to_index), dict(zip(USERS, range(3))))
        self.assertEqual(dict(b.song_to_index), dict(zip((S1, S2, S3), range(3))))
        self.assertEqual((b.summary.unique_user_count, b.summary.unique_song_count,
                          b.summary.interaction_pair_count), (3, 3, 3))
        self.assertTrue({S4, S5, S6}.isdisjoint(b.song_ids))

    def test_sparse_matrices_have_only_three_training_pairs(self):
        b = self.p.interactions
        self.assertEqual(b.summary.matrix_shape, (3, 3))
        self.assertEqual(b.observed.nnz, 3)
        for name in MATRIX_NAMES:
            matrix = getattr(b, name)
            self.assertEqual(matrix.format, "csr")
            self.assertEqual(matrix.shape, (3, 3))
            rows, cols = matrix.nonzero()
            self.assertTrue(all(row == col for row, col in zip(rows, cols)))
        self.np.testing.assert_array_equal(b.observed.diagonal(), [1, 1, 1])

    def test_sparse_factual_counts_exclude_holdouts(self):
        b = self.p.interactions
        self.assertEqual((b.summary.event_count, b.summary.session_count), (9, 3))
        for name in ("session_count", "play_started_count", "completed_count"):
            self.np.testing.assert_array_equal(getattr(b, name).diagonal(), [1, 1, 1])
        self.np.testing.assert_array_equal(b.listened_seconds.diagonal(), [30, 45, 60])
        for name in ("replay_started_count", "skipped_count", "stopped_count"):
            self.assertEqual(getattr(b, name).nnz, 0)

    def test_full_content_catalog_includes_training_extras(self):
        content = self.p.content
        self.assertEqual(content.song_ids, SONGS)
        self.assertEqual(content.summary.song_count, 6)
        self.assertLess(set(self.p.interactions.song_ids), set(content.song_ids))
        self.assertEqual(set(content.song_ids) - set(self.p.model.song_ids), {S4, S5, S6})

    def test_content_features_are_factual_normalized_and_sorted(self):
        content = self.p.content
        expected = tuple(sorted((
            "artist::alpha", "artist::beta", "artist::gamma", "artist::delta",
            "artist::epsilon", "genre::rock", "genre::pop", "genre::jazz",
            "genre::ambient", "language::english", "category::song",
        )))
        self.assertEqual(content.feature_names, expected)
        self.assertEqual(content.summary.feature_count, 11)
        self.assertEqual(content.matrix.shape, (6, 11))
        self.np.testing.assert_array_equal(content.matrix.data, self.np.ones(20))

    def test_content_rows_preserve_zero_feature_song(self):
        content = self.p.content
        for song in SONGS[:5]:
            self.assertEqual(content.matrix.getrow(content.song_to_index[song]).nnz, 4)
        self.assertEqual(content.matrix.getrow(content.song_to_index[S6]).nnz, 0)
        self.assertEqual(content.summary.zero_feature_song_count, 1)
        self.assertEqual(self.p.context.content_row_norms[content.song_to_index[S6]], 0)

    def test_collaborative_training_defaults_and_effective_size(self):
        result = self.p.training
        self.assertEqual(result.status, "trained")
        self.assertIsNotNone(result.model)
        self.assertEqual(result.summary.status, "trained")
        self.assertEqual(result.summary.requested_components, 32)
        self.assertEqual(result.summary.effective_components, 2)
        self.assertEqual(result.summary.random_seed, 42)
        self.assertEqual(result.summary.interaction_pair_count, 3)
        self.assertEqual((result.model.algorithm, result.model.n_iter), ("randomized", 7))

    def test_model_indexes_exclude_cold_start_users_and_songs(self):
        model = self.p.model
        self.assertEqual(model.user_ids, USERS)
        self.assertEqual(model.song_ids, (S1, S2, S3))
        self.assertNotIn(U4, model.user_to_index)
        self.assertTrue({S4, S5, S6}.isdisjoint(model.song_to_index))
        self.assertEqual((self.p.training.summary.user_count,
                          self.p.training.summary.song_count), (3, 3))

    def test_latent_arrays_are_finite_and_correctly_shaped(self):
        for name in FACTOR_FIELDS:
            array = getattr(self.p.model, name)
            expected = (3, 2) if name in ("user_factors", "song_factors") else (2,)
            self.assertEqual(array.shape, expected)
            self.assertTrue(self.np.isfinite(array).all())
            self.assertFalse(array.flags.writeable)

    def test_hybrid_context_aligns_model_interactions_and_content(self):
        c = self.p.context
        self.assertEqual(c.collaborative_model.user_ids, c.interaction_bundle.user_ids)
        self.assertEqual(c.collaborative_model.song_ids, c.interaction_bundle.song_ids)
        self.assertEqual(dict(c.collaborative_model.user_to_index),
                         dict(c.interaction_bundle.user_to_index))
        self.assertEqual(dict(c.collaborative_model.song_to_index),
                         dict(c.interaction_bundle.song_to_index))
        self.assertEqual(c.content_features.song_ids, SONGS)
        self.assertEqual(c.training_signal.shape, (3, 3))
        self.assertEqual(c.training_signal.nnz, 3)
        self.assertTrue((c.training_signal.data > 0).all())
        self.assertFalse(c.training_signal.data.flags.writeable)

    def test_prepare_does_not_retrain(self):
        # Scoped guards; actual prepare executes and all patches are restored.
        with mock.patch("ml.recommender.collaborative_model.train_collaborative_model",
                        side_effect=AssertionError("unexpected retraining")) as train, \
             mock.patch("sklearn.decomposition.TruncatedSVD.fit_transform",
                        side_effect=AssertionError("unexpected fit")) as fit:
            context = prepare_hybrid_ranker(self.p.model, self.p.interactions, self.p.content)
        train.assert_not_called()
        fit.assert_not_called()
        self.assert_csr_equal(context.training_signal, self.p.context.training_signal)

    def test_known_users_reach_real_hybrid_once_each(self):
        with mock.patch("ml.recommender.cold_start.rank_hybrid_candidates",
                        wraps=rank_hybrid_candidates) as hybrid:
            for user, seen in zip(USERS, (S1, S2, S3)):
                hybrid.reset_mock()
                result = rank_with_cold_start_policy(
                    self.p.context, user, SONGS, explicit_profile=self.p.profiles[user], limit=5,
                )
                hybrid.assert_called_once_with(
                    self.p.context, user, [s for s in (S1, S2, S3) if s != seen],
                    limit=MAX_HYBRID_LIMIT,
                )
                self.assertEqual(result, self.p.rankings[user])

    def test_direct_artist_profiles_normalize_without_source_exclusions(self):
        for user, artist in zip(USERS, ("delta", "alpha", "beta")):
            profile = normalize_explicit_preference_profile(self.p.profiles[user])
            self.assertEqual(dict(profile.artist_counts), {artist: 3})
            self.assertEqual(profile.favorite_song_ids, ())
            self.assertEqual(dict(profile.playlist_song_counts), {})
            summary = self.p.rankings[user].summary
            self.assertEqual(summary.profile_source_excluded_count, 0)
            self.assertEqual(summary.profile_feature_count, 1)
            self.assertTrue(summary.profile_available)

    def test_known_rankings_exhaust_eligible_catalog_with_contiguous_ranks(self):
        for user, seen in zip(USERS, (S1, S2, S3)):
            result = self.p.rankings[user]
            self.assertEqual(len(result.items), 5)
            self.assertEqual(result.summary.returned_count, 5)
            self.assertEqual([item.rank for item in result.items], [1, 2, 3, 4, 5])
            ids = [item.song_id for item in result.items]
            self.assertEqual(len(set(ids)), 5)
            self.assertEqual(set(ids), set(SONGS) - {seen})

    def test_known_policy_seen_and_cold_start_counts(self):
        for result in self.p.rankings.values():
            summary = result.summary
            self.assertTrue(summary.collaborative_known_user)
            self.assertEqual(summary.input_candidate_count, 6)
            self.assertEqual(summary.seen_excluded_count, 1)
            self.assertEqual(summary.eligible_candidate_count, 5)
            self.assertEqual(summary.collaborative_known_candidate_count, 2)
            self.assertEqual(summary.cold_start_song_candidate_count, 3)
            self.assertEqual(summary.exploration_selected_count, 1)
            self.assertEqual(summary.exploitation_selected_count, 4)

    def test_known_rankings_retain_each_held_out_song(self):
        for user, song in ((U1, S4), (U2, S1), (U3, S2)):
            self.assertIn(song, self.p.recommendations[user])
            item = next(i for i in self.p.rankings[user].items if i.song_id == song)
            self.assertGreater(item.profile_score, 0)
            self.assertTrue(1 <= item.rank <= 5)

    def test_policy_score_and_basis_contract_across_real_rankings(self):
        results = (*self.p.rankings.values(), self.p.cold_profile, self.p.cold_empty)
        for result in results:
            for item in result.items:
                self.assertIn(item.basis, ("hybrid-profile", "hybrid", "profile", "exploration"))
                for value in (item.policy_score, item.hybrid_score, item.profile_score):
                    if value is not None:
                        self.assertTrue(math.isfinite(value) and 0 <= value <= 1)
                if item.basis == "exploration":
                    self.assertIsNone(item.policy_score)
                elif item.basis == "profile":
                    self.assertIsNone(item.hybrid_score)
                    self.assert_close(item.policy_score, item.profile_score)
                elif item.basis == "hybrid":
                    self.assertIsNone(item.profile_score)
                    self.assert_close(item.policy_score, item.hybrid_score)
                else:
                    self.assert_close(item.policy_score,
                                      BASE_HYBRID_POLICY_WEIGHT * item.hybrid_score
                                      + EXPLICIT_PROFILE_POLICY_WEIGHT * item.profile_score)

    def test_held_out_only_s4_complete_boundary_chain(self):
        p = self.p
        raw = [e for e in p.raw if e["song"] == S4]
        self.assertEqual(len(raw), 3)
        self.assertEqual({(e["user"], e["session_id"]) for e in raw}, {(U1, "u1-test")})
        self.assertEqual({e.event_id for e in p.split.test if e.song_id == S4},
                         {e["_id"] for e in raw})
        self.assertNotIn(S4, {e.song_id for e in p.split.train})
        self.assertNotIn(S4, p.interactions.song_ids)
        self.assertNotIn(S4, p.model.song_ids)
        self.assertIn(S4, p.content.song_ids)
        self.assertIn(S4, p.recommendations[U1])
        item = next(i for i in p.rankings[U1].items if i.song_id == S4)
        self.assertFalse(item.collaborative_known)
        self.assertIsNone(item.hybrid_score)
        self.assertEqual(item.basis, "profile")
        self.assert_close(item.profile_score, 0.5)  # Artist-only vs four binary features.
        self.assert_close(item.policy_score, item.profile_score)

    def test_relevance_is_grouped_test_partition_membership(self):
        self.assertEqual(self.p.relevant, {U1: {S4}, U2: {S1}, U3: {S2}})
        self.assertEqual(len(self.p.relevant), 3)
        for user, songs in self.p.relevant.items():
            self.assertEqual(len(songs), 1)
            self.assertEqual(songs, {e.song_id for e in self.p.split.test if e.user_id == user})

    def test_relevance_is_independent_of_playback_types_and_deltas(self):
        changed = tuple(replace(e, event_type="paused", listened_seconds_delta=0.0)
                        for e in self.p.split.test)
        self.assertEqual(_relevance(changed), self.p.relevant)
        # Even only the start event in each held-out session carries membership.
        self.assertEqual(_relevance([e for e in self.p.split.test if e.sequence == 0]),
                         self.p.relevant)

    def test_evaluator_receives_actual_ordered_policy_output(self):
        with mock.patch(f"{__name__}.evaluate_recommendations",
                        wraps=evaluate_recommendations) as evaluator:
            p = _run_pipeline()
        evaluator.assert_called_once_with(p.recommendations, p.relevant, SONGS, p.content)
        for user in USERS:
            self.assertEqual(p.recommendations[user], tuple(i.song_id for i in p.rankings[user].items))
        self.assertEqual((p.evaluation.summary.evaluated_user_count,
                          p.evaluation.summary.recommendation_user_count,
                          p.evaluation.summary.relevance_user_count,
                          p.evaluation.summary.catalog_size), (3, 3, 3, 6))

    def test_stable_precision_recall_and_hit_metrics(self):
        for name, expected in (("precision_at_5", 0.2), ("precision_at_10", 0.1),
                               ("recall_at_5", 1.0), ("recall_at_10", 1.0),
                               ("hit_rate_at_10", 1.0)):
            with self.subTest(metric=name):
                self.assert_close(getattr(self.p.evaluation, name), expected)

    def test_rank_dependent_metrics_follow_actual_relevant_positions(self):
        ranks = [next(i.rank for i in self.p.rankings[user].items
                      if i.song_id in self.p.relevant[user]) for user in USERS]
        # One relevant Song each: ideal DCG = 1 and AP = reciprocal rank.
        ndcg = sum(1 / math.log2(rank + 1) for rank in ranks) / 3
        ap = sum(1 / rank for rank in ranks) / 3
        for name, expected in (("ndcg_at_5", ndcg), ("ndcg_at_10", ndcg), ("map_at_10", ap)):
            value = getattr(self.p.evaluation, name)
            self.assertTrue(math.isfinite(value) and 0 < value <= 1)
            self.assert_close(value, expected)

    def test_coverage_comes_from_union_of_actual_rankings(self):
        union = set().union(*self.p.recommendations.values())
        self.assertEqual(union, set(SONGS))
        self.assertEqual(self.p.evaluation.summary.unique_recommended_at_10, 6)
        self.assert_close(self.p.evaluation.catalog_coverage, 1.0)

    def test_diversity_counts_exclude_zero_feature_pairs(self):
        evaluation = self.p.evaluation
        self.assertTrue(math.isfinite(evaluation.diversity))
        self.assertTrue(0 <= evaluation.diversity <= 1)
        self.assertEqual(evaluation.summary.diversity_evaluable_user_count, 3)
        # Four scorable Songs per user: C(4,2) * 3, not C(5,2) * 3.
        self.assertEqual(evaluation.summary.diversity_pair_count, 18)

    def test_u4_has_no_collaborative_identity_or_hybrid_calls(self):
        self.assertNotIn(U4, self.p.interactions.user_ids)
        self.assertNotIn(U4, self.p.model.user_ids)
        with mock.patch("ml.recommender.cold_start.rank_hybrid_candidates",
                        side_effect=AssertionError("unknown user reached hybrid")) as hybrid:
            for profile in (self.p.profiles[U4], None):
                result = rank_with_cold_start_policy(
                    self.p.context, U4, (S4, S5, S6), explicit_profile=profile, limit=3,
                )
                self.assertFalse(result.summary.collaborative_known_user)
                self.assertTrue(all(i.hybrid_score is None for i in result.items))
                self.assertTrue(all(not i.collaborative_known for i in result.items))
        hybrid.assert_not_called()

    def test_u4_profile_only_exploitation_and_zero_feature_backfill(self):
        result = self.p.cold_profile
        self.assertEqual({i.song_id for i in result.items}, {S4, S5, S6})
        self.assertEqual([i.rank for i in result.items], [1, 2, 3])
        s4 = next(i for i in result.items if i.song_id == S4)
        self.assertEqual(s4.basis, "profile")
        self.assert_close(s4.profile_score, 0.5)
        self.assert_close(s4.policy_score, s4.profile_score)
        s6 = next(i for i in result.items if i.song_id == S6)
        self.assertEqual(s6.basis, "exploration")
        self.assertIsNone(s6.policy_score)
        self.assertIsNone(s6.profile_score)

    def test_u4_empty_profile_is_exploration_only(self):
        result = self.p.cold_empty
        self.assertEqual({i.song_id for i in result.items}, {S4, S5, S6})
        self.assertEqual(result.summary.returned_count, 3)
        self.assertEqual(result.summary.exploration_selected_count, 3)
        self.assertFalse(result.summary.profile_available)
        for item in result.items:
            self.assertEqual(item.basis, "exploration")
            self.assertIsNone(item.policy_score)
            self.assertIsNone(item.hybrid_score)
            self.assertIsNone(item.profile_score)

    def test_u4_repeat_and_reversed_candidates_are_identical(self):
        for profile, expected in ((None, self.p.cold_empty),
                                  (self.p.profiles[U4], self.p.cold_profile)):
            for candidates in ((S4, S5, S6), (S6, S5, S4)):
                self.assertEqual(rank_with_cold_start_policy(
                    self.p.context, U4, candidates, explicit_profile=profile, limit=3,
                ), expected)

    def test_s6_is_exploration_eligible_for_every_user(self):
        for result in (*self.p.rankings.values(), self.p.cold_profile, self.p.cold_empty):
            item = next(i for i in result.items if i.song_id == S6)
            self.assertEqual(item.basis, "exploration")
            self.assertIsNone(item.policy_score)
            self.assertIsNone(item.profile_score)
            self.assertIsNone(item.hybrid_score)
            self.assertFalse(item.collaborative_known)

    def test_full_repeat_split_and_sparse_outputs(self):
        other = _run_pipeline()
        self.assertEqual(self.p.split, other.split)
        a, b = self.p.interactions, other.interactions
        self.assertEqual(a.summary, b.summary)
        self.assertEqual((a.user_ids, a.song_ids), (b.user_ids, b.song_ids))
        for name in MATRIX_NAMES:
            self.assert_csr_equal(getattr(a, name), getattr(b, name))

    def test_full_repeat_content_indexes_summary_and_matrix(self):
        other = _run_pipeline().content
        self.assertEqual(self.p.content.song_ids, other.song_ids)
        self.assertEqual(self.p.content.feature_names, other.feature_names)
        self.assertEqual(self.p.content.summary, other.summary)
        self.assert_csr_equal(self.p.content.matrix, other.matrix)

    def test_full_repeat_training_configuration_and_latent_arrays(self):
        other = _run_pipeline()
        self.assertEqual(self.p.training.status, other.training.status)
        self.assertEqual(self.p.training.summary, other.training.summary)
        for name in ("schema_version", "user_ids", "song_ids", "requested_components",
                     "effective_components", "random_seed", "algorithm", "n_iter"):
            self.assertEqual(getattr(self.p.model, name), getattr(other.model, name))
        for name in FACTOR_FIELDS:
            self.np.testing.assert_allclose(getattr(self.p.model, name), getattr(other.model, name),
                                            rtol=1e-6, atol=1e-7)

    def test_full_repeat_rankings_for_all_four_users(self):
        other = _run_pipeline()
        self.assertEqual(self.p.rankings, other.rankings)
        self.assertEqual(self.p.cold_profile, other.cold_profile)
        self.assertEqual(self.p.cold_empty, other.cold_empty)
        self.assertEqual(self.p.recommendations, other.recommendations)

    def test_full_repeat_evaluation_and_relevance(self):
        other = _run_pipeline()
        self.assertEqual(self.p.relevant, other.relevant)
        self.assertEqual(self.p.evaluation, other.evaluation)

    def test_raw_catalog_and_profile_inputs_are_not_mutated(self):
        self.assertEqual((self.p.raw, self.p.catalog, self.p.profiles), self.p.input_before)

    def test_content_matrix_is_not_mutated_by_downstream_steps(self):
        self.assert_csr_equal(self.p.content.matrix, self.p.content_before)

    def test_interaction_matrices_are_not_mutated_by_downstream_steps(self):
        for name in MATRIX_NAMES:
            self.assert_csr_equal(getattr(self.p.interactions, name), self.p.interaction_before[name])

    def test_model_arrays_are_not_mutated_by_prepare_ranking_evaluation(self):
        for name in FACTOR_FIELDS:
            self.np.testing.assert_array_equal(getattr(self.p.model, name), self.p.factor_before[name])


class SmokeScopeTests(unittest.TestCase):
    def test_imports_are_only_test_utilities_numeric_and_existing_public_apis(self):
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        permitted = {
            "__future__", "ast", "copy", "math", "unittest", "dataclasses", "datetime",
            "pathlib", "types", "numpy", "ml.recommender.collaborative_model",
            "ml.recommender.content_features", "ml.recommender.cold_start",
            "ml.recommender.evaluation", "ml.recommender.hybrid_ranker",
            "ml.recommender.sparse_interactions", "ml.recommender.temporal_split",
        }
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                self.assertTrue({alias.name for alias in node.names} <= permitted)
            elif isinstance(node, ast.ImportFrom):
                self.assertIn(node.module, permitted)

    def test_no_io_writes_dynamic_imports_clock_or_random_fixture_calls(self):
        tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
        forbidden = {
            "open", "write_text", "write_bytes", "save", "savez", "savez_compressed",
            "savetxt", "dump", "dumps", "tofile", "mkdir", "touch", "unlink",
            "publish_artifact_release", "activate_artifact_release", "Popen", "system",
            "connect", "urlopen", "getenv", "now", "utcnow", "today", "time",
            "random", "default_rng", "uuid4", "token_hex", "__import__", "import_module",
            "eval", "exec",
        }
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = (node.func.id if isinstance(node.func, ast.Name)
                        else node.func.attr if isinstance(node.func, ast.Attribute) else None)
                self.assertNotIn(name, forbidden)
            if isinstance(node, ast.Attribute):
                self.assertNotIn(node.attr, ("environ", "path", "sys_path"))
        root = Path(__file__).resolve().parents[1] / "recommender"
        for name in ("pipeline.py", "train.py"):
            self.assertFalse((root / name).exists())
        self.assertTrue((root / "orchestrator.py").exists())


if __name__ == "__main__":
    unittest.main()
