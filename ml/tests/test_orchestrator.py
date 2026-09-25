"""Standard-library tests for the checkpoint-43/43 retrain orchestrator."""

from __future__ import annotations

import ast
import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from ml.recommender import cli as cli_module
from ml.recommender.orchestrator import (
    MAX_SNAPSHOT_LIMIT,
    PIPELINE_STAGE,
    RETRAIN_INPUT_SCHEMA_VERSION,
    OrchestratorArtifactConflictError,
    OrchestratorInsufficientDataError,
    OrchestratorValidationError,
    parse_retrain_input,
    run_retraining,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
METRIC_KEYS = (
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
)
SUMMARY_KEYS = (
    "evaluated_user_count",
    "recommendation_user_count",
    "relevance_user_count",
    "catalog_size",
    "unique_recommended_at_10",
    "diversity_evaluable_user_count",
    "diversity_pair_count",
)
DATASET_KEYS = (
    "raw_event_count",
    "train_event_count",
    "validation_event_count",
    "test_event_count",
    "unique_user_count",
    "unique_song_count",
    "session_count",
    "interaction_pair_count",
    "content_feature_count",
)
CONFIGURATION_KEYS = (
    "random_seed",
    "algorithm",
    "requested_components",
    "effective_components",
    "collaborative_weight",
    "content_weight",
    "base_hybrid_policy_weight",
    "explicit_profile_policy_weight",
    "exploration_interval",
)
SNAPSHOT_SUMMARY_KEYS = (
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
)


def oid(number: int) -> str:
    return f"{number:024x}"


U1, U2, U3, U4 = (oid(n) for n in range(101, 105))
S1, S2, S3, S4, S5, S6 = (oid(n) for n in range(1, 7))
USERS = [U1, U2, U3]
SONGS = [S1, S2, S3, S4, S5, S6]
PATTERNS = ((S1, S2, S4), (S2, S3, S1), (S3, S1, S2))
PARTITIONS = ("train", "validation", "test")


def build_events() -> list[dict]:
    events = []
    for user_number, (user, pattern) in enumerate(zip(USERS, PATTERNS), 1):
        for day, (partition, song) in enumerate(zip(PARTITIONS, pattern), 1):
            for sequence, event_type in enumerate(
                ("play-started", "progress", "completed")
            ):
                events.append(
                    {
                        "_id": oid(1000 + len(events)),
                        "user": user,
                        "song": song,
                        "session_id": f"u{user_number}-{partition}",
                        "sequence": sequence,
                        "event_type": event_type,
                        "createdAt": f"2026-01-0{day}T10:0{sequence}:00Z",
                        "listened_seconds_delta": (
                            15.0 * (user_number + 1) if sequence == 1 else 0.0
                        ),
                    }
                )
    return events


def build_songs() -> list[dict]:
    return [
        {"_id": S1, "artist": "Alpha", "genre": "Rock", "language": "English", "category": "Song"},
        {"_id": S2, "artist": "Beta", "genre": "Pop", "language": "English", "category": "Song"},
        {"_id": S3, "artist": "Gamma", "genre": "Jazz", "language": "English", "category": "Song"},
        {"_id": S4, "artist": "Delta", "genre": "Ambient", "language": "English", "category": "Song"},
        {"_id": S5, "artist": "Epsilon", "genre": "Rock", "language": "English", "category": "Song"},
        {"_id": S6, "artist": None, "genre": None, "language": None, "category": None},
    ]


def base_input(artifact_root: str, **overrides) -> dict:
    payload = {
        "schema_version": RETRAIN_INPUT_SCHEMA_VERSION,
        "run_id": "run-43-01",
        "run_at": "2026-09-15T12:00:00+00:00",
        "snapshot_limit": 5,
        "random_seed": 42,
        "artifact_root": artifact_root,
        "songs": build_songs(),
        "users": list(USERS),
        "events": build_events(),
        "profiles": {
            U1: {"artist_counts": {"Delta": 3}},
            U2: {"artist_counts": {"Alpha": 3}},
            U3: {"artist_counts": {"Beta": 3}},
        },
    }
    payload.update(overrides)
    return payload


class ParseRetrainInputTests(unittest.TestCase):
    def test_1_accepts_valid_payload(self):
        with tempfile.TemporaryDirectory() as root:
            parsed = parse_retrain_input(base_input(root))
        self.assertEqual(parsed["run_id"], "run-43-01")
        self.assertEqual(parsed["snapshot_limit"], 5)
        self.assertEqual(parsed["random_seed"], 42)
        self.assertEqual(len(parsed["songs"]), 6)
        self.assertEqual(parsed["users"], sorted(USERS))

    def test_2_rejects_unknown_top_level_key(self):
        payload = base_input("root")
        payload["extra"] = 1
        with self.assertRaises(OrchestratorValidationError):
            parse_retrain_input(payload)

    def test_3_rejects_wrong_schema_version(self):
        payload = base_input("root")
        payload["schema_version"] = 2
        with self.assertRaises(OrchestratorValidationError):
            parse_retrain_input(payload)

    def test_4_rejects_bad_run_id(self):
        for bad in ("", "UPPER", ".hidden", "a" * 65, "has space", 1):
            payload = base_input("root", run_id=bad)
            with self.assertRaises(OrchestratorValidationError):
                parse_retrain_input(payload)

    def test_5_rejects_naive_run_at(self):
        payload = base_input("root", run_at="2026-09-15T12:00:00")
        with self.assertRaises(OrchestratorValidationError):
            parse_retrain_input(payload)

    def test_6_normalizes_run_at_to_utc_z(self):
        payload = base_input("root", run_at="2026-09-15T14:00:00+02:00")
        parsed = parse_retrain_input(payload)
        self.assertEqual(parsed["run_at"], "2026-09-15T12:00:00Z")

    def test_7_rejects_bad_snapshot_limit(self):
        for bad in (0, -1, 101, True, 1.5, "5"):
            payload = base_input("root", snapshot_limit=bad)
            with self.assertRaises(OrchestratorValidationError):
                parse_retrain_input(payload)

    def test_8_accepts_max_snapshot_limit(self):
        with tempfile.TemporaryDirectory() as root:
            parsed = parse_retrain_input(
                base_input(root, snapshot_limit=MAX_SNAPSHOT_LIMIT)
            )
        self.assertEqual(parsed["snapshot_limit"], 100)

    def test_9_rejects_duplicate_song(self):
        payload = base_input("root")
        payload["songs"] = [payload["songs"][0], payload["songs"][0]]
        with self.assertRaises(OrchestratorValidationError):
            parse_retrain_input(payload)

    def test_10_rejects_unknown_profile_user(self):
        payload = base_input("root")
        payload["profiles"][U4] = {"artist_counts": {"X": 1}}
        with self.assertRaises(OrchestratorValidationError):
            parse_retrain_input(payload)

    def test_11_rejects_unknown_profile_key(self):
        payload = base_input("root")
        payload["profiles"][U1] = {"mood": "happy"}
        with self.assertRaises(OrchestratorValidationError):
            parse_retrain_input(payload)

    def test_12_rejects_missing_required_key(self):
        payload = base_input("root")
        del payload["events"]
        with self.assertRaises(OrchestratorValidationError):
            parse_retrain_input(payload)


class RunRetrainingTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def test_1_successful_run_output_shape(self):
        output = run_retraining(base_input(self.root))
        self.assertEqual(output["schema_version"], 1)
        self.assertEqual(output["run_id"], "run-43-01")
        self.assertEqual(output["artifact_version"], "run-43-01")
        self.assertEqual(output["pipeline_stage"], PIPELINE_STAGE)
        self.assertEqual(output["filtering"]["input_event_count"], 27)
        self.assertEqual(output["filtering"]["usable_event_count"], 27)
        self.assertEqual(output["filtering"]["dropped_event_count"], 0)
        evaluation = output["evaluation"]
        self.assertEqual(evaluation["run_id"], "run-43-01")
        self.assertEqual(evaluation["pipeline_stage"], "policy")
        self.assertEqual(evaluation["artifact_version"], "run-43-01")
        self.assertEqual(evaluation["evaluated_at"], "2026-09-15T12:00:00Z")
        self.assertEqual(tuple(evaluation["metrics"]), METRIC_KEYS)
        self.assertEqual(tuple(evaluation["summary"]), SUMMARY_KEYS)
        self.assertEqual(tuple(evaluation["dataset"]), DATASET_KEYS)
        self.assertEqual(tuple(evaluation["configuration"]), CONFIGURATION_KEYS)
        self.assertEqual(len(output["snapshots"]), 3)
        self.assertTrue(output["artifact"]["created"])
        self.assertEqual(output["artifact"]["artifact_version"], "run-43-01")

    def test_2_dataset_conservation(self):
        output = run_retraining(base_input(self.root))
        dataset = output["evaluation"]["dataset"]
        self.assertEqual(
            dataset["raw_event_count"],
            dataset["train_event_count"]
            + dataset["validation_event_count"]
            + dataset["test_event_count"],
        )
        self.assertEqual(dataset["raw_event_count"], 27)
        self.assertEqual(dataset["unique_user_count"], 3)

    def test_3_snapshot_identity_invariants(self):
        output = run_retraining(base_input(self.root))
        for snapshot in output["snapshots"]:
            self.assertEqual(snapshot["snapshot_version"], "run-43-01")
            self.assertEqual(snapshot["artifact_version"], "run-43-01")
            self.assertEqual(snapshot["generated_at"], "2026-09-15T12:00:00Z")
            ranks = [item["rank"] for item in snapshot["items"]]
            self.assertEqual(ranks, list(range(1, len(ranks) + 1)))
            self.assertEqual(
                tuple(snapshot["summary"]), SNAPSHOT_SUMMARY_KEYS
            )
            songs = [item["song_id"] for item in snapshot["items"]]
            self.assertEqual(len(songs), len(set(songs)))

    def test_4_snapshot_users_unique_and_ordered(self):
        output = run_retraining(base_input(self.root))
        users = [s["user_id"] for s in output["snapshots"]]
        self.assertEqual(users, sorted(set(users)))
        self.assertEqual(users, sorted(USERS))

    def test_5_filters_out_of_catalog_events(self):
        payload = base_input(self.root)
        foreign = oid(99)
        payload["events"].append(
            {
                "_id": oid(2000),
                "user": U1,
                "song": foreign,
                "session_id": "x-1",
                "sequence": 0,
                "event_type": "play-started",
                "createdAt": "2026-02-01T10:00:00Z",
            }
        )
        output = run_retraining(payload)
        self.assertEqual(output["filtering"]["input_event_count"], 28)
        self.assertEqual(output["filtering"]["usable_event_count"], 27)
        self.assertEqual(output["filtering"]["dropped_event_count"], 1)

    def test_6_filters_out_of_target_user_events(self):
        payload = base_input(self.root, users=[U1, U2])
        payload["profiles"] = {
            U1: {"artist_counts": {"Delta": 3}},
            U2: {"artist_counts": {"Alpha": 3}},
        }
        output = run_retraining(payload)
        self.assertEqual(output["filtering"]["input_event_count"], 27)
        self.assertEqual(output["filtering"]["usable_event_count"], 18)
        self.assertEqual(output["filtering"]["dropped_event_count"], 9)
        self.assertEqual(len(output["snapshots"]), 2)

    def test_7_all_events_filtered_fails_insufficient(self):
        payload = base_input(self.root)
        payload["events"] = [
            {
                "_id": oid(3000),
                "user": U1,
                "song": oid(99),
                "session_id": "z-1",
                "sequence": 0,
                "event_type": "play-started",
                "createdAt": "2026-03-01T10:00:00Z",
            }
        ]
        with self.assertRaises(OrchestratorInsufficientDataError):
            run_retraining(payload)

    def test_8_empty_events_fails_insufficient(self):
        payload = base_input(self.root, events=[])
        with self.assertRaises(OrchestratorInsufficientDataError):
            run_retraining(payload)

    def test_9_identical_rerun_reuses_artifact(self):
        first = run_retraining(base_input(self.root))
        self.assertTrue(first["artifact"]["created"])
        second = run_retraining(base_input(self.root))
        self.assertFalse(second["artifact"]["created"])
        self.assertEqual(second["artifact"]["artifact_version"], "run-43-01")

    def test_10_deterministic_output_metrics(self):
        first = run_retraining(base_input(self.root))
        second = run_retraining(base_input(self.root))
        self.assertEqual(first["evaluation"], second["evaluation"])
        self.assertEqual(first["snapshots"], second["snapshots"])

    def test_11_does_not_mutate_input(self):
        payload = base_input(self.root)
        before = copy.deepcopy(payload)
        run_retraining(payload)
        self.assertEqual(payload, before)

    def test_12_metrics_are_finite_unit_interval(self):
        output = run_retraining(base_input(self.root))
        for key, value in output["evaluation"]["metrics"].items():
            self.assertIsInstance(value, float)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_13_configuration_fixed_baseline(self):
        output = run_retraining(base_input(self.root))
        config = output["evaluation"]["configuration"]
        self.assertEqual(config["random_seed"], 42)
        self.assertEqual(config["algorithm"], "randomized")
        self.assertEqual(config["collaborative_weight"], 0.70)
        self.assertEqual(config["content_weight"], 0.30)
        self.assertEqual(config["base_hybrid_policy_weight"], 0.80)
        self.assertEqual(config["explicit_profile_policy_weight"], 0.20)
        self.assertEqual(config["exploration_interval"], 5)

    def test_14_no_user_emails_in_output(self):
        output = run_retraining(base_input(self.root))
        text = json.dumps(output)
        self.assertNotIn("@", text)
        self.assertNotIn("password", text)
        self.assertNotIn("token", text)

    def test_15_output_is_json_serializable(self):
        output = run_retraining(base_input(self.root))
        encoded = json.dumps(output, allow_nan=False)
        self.assertIsInstance(encoded, str)


class RetrainCliTests(unittest.TestCase):
    def _run(self, payload_text: str) -> tuple[int, str, str]:
        import sys

        old_stdin = sys.stdin
        out = io.StringIO()
        err = io.StringIO()
        try:
            sys.stdin = io.TextIOWrapper(
                io.BytesIO(payload_text.encode("utf-8")),
                encoding="utf-8",
            )
            with redirect_stdout(out), redirect_stderr(err):
                code = cli_module.main(["retrain-json"])
        finally:
            sys.stdin = old_stdin
        return code, out.getvalue(), err.getvalue()

    def test_1_retrain_json_success(self):
        with tempfile.TemporaryDirectory() as root:
            text = json.dumps(base_input(root))
            code, out, err = self._run(text)
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
        payload = json.loads(out)
        self.assertEqual(payload["run_id"], "run-43-01")
        self.assertEqual(payload["pipeline_stage"], "policy")

    def test_2_retrain_json_invalid_json(self):
        code, out, err = self._run("{not json")
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("valid JSON", err)

    def test_3_retrain_json_insufficient_marker(self):
        with tempfile.TemporaryDirectory() as root:
            payload = base_input(root, events=[])
            code, out, err = self._run(json.dumps(payload))
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("INSUFFICIENT_TRAINING_DATA", err)

    def test_4_retrain_json_conflict_marker(self):
        with tempfile.TemporaryDirectory() as root:
            text = json.dumps(base_input(root))
            first_code, _, _ = self._run(text)
            self.assertEqual(first_code, 0)
            # Corrupt the published release so reuse fails verification.
            release = Path(root) / "releases" / "run-43-01" / "metadata.json"
            release.write_bytes(b"{}")
            code, out, err = self._run(text)
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("ARTIFACT_VERSION_CONFLICT", err)

    def test_5_runtime_info_still_works(self):
        out = io.StringIO()
        err = io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cli_module.main(["runtime-info", "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload["random_seed"], 42)


class OrchestratorStaticSafetyTests(unittest.TestCase):
    def test_1_no_forbidden_imports(self):
        source = (REPO_ROOT / "ml" / "recommender" / "orchestrator.py").read_text(
            encoding="utf-8"
        )
        tree = ast.parse(source)
        forbidden = {
            "pymongo",
            "flask",
            "fastapi",
            "requests",
            "urllib",
            "socket",
            "subprocess",
            "pickle",
            "joblib",
            "http.client",
            "express",
        }
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertNotIn(alias.name.split(".")[0], forbidden)
            elif isinstance(node, ast.ImportFrom):
                root = (node.module or "").split(".")[0]
                self.assertNotIn(root, forbidden)

    def test_2_no_shell_or_network_calls(self):
        source = (REPO_ROOT / "ml" / "recommender" / "orchestrator.py").read_text(
            encoding="utf-8"
        )
        for token in (
            "subprocess",
            "os.system",
            "urlopen",
            "pymongo",
            "MongoClient",
            "pickle",
            "joblib",
            "shell=True",
            "express",
        ):
            self.assertNotIn(token, source)

    def test_3_cli_has_retrain_json_command(self):
        source = (REPO_ROOT / "ml" / "recommender" / "cli.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('subparsers.add_parser(\n        "retrain-json"', source)
        self.assertIn("run_retraining", source)

    def test_4_pipeline_and_train_still_absent(self):
        root = REPO_ROOT / "ml" / "recommender"
        self.assertFalse((root / "pipeline.py").exists())
        self.assertFalse((root / "train.py").exists())
        self.assertTrue((root / "orchestrator.py").exists())


if __name__ == "__main__":
    unittest.main()
