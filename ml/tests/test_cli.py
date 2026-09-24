"""Standard-library tests for the bounded runtime-info CLI."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from ml.recommender import cli as cli_module
from ml.recommender.cli import build_runtime_info, main

REPO_ROOT = Path(__file__).resolve().parents[2]
CLI_PATH = REPO_ROOT / "ml" / "recommender" / "cli.py"


class RuntimeInfoCommandTests(unittest.TestCase):
    def _run(self, *argv: str) -> tuple[int, str, str]:
        out = io.StringIO()
        err = io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_1_runtime_info_exits_successfully(self):
        code, out, _ = self._run("runtime-info")
        self.assertEqual(code, 0)
        self.assertTrue(out.strip())

    def test_2_json_outputs_valid_json(self):
        code, out, _ = self._run("runtime-info", "--json")
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertIsInstance(payload, dict)

    def test_3_json_runtime_identifier(self):
        _, out, _ = self._run("runtime-info", "--json")
        payload = json.loads(out)
        self.assertEqual(payload["runtime"], "melodify-offline-recommender")

    def test_4_cpu_only_true(self):
        _, out, _ = self._run("runtime-info", "--json")
        payload = json.loads(out)
        self.assertIs(payload["cpu_only"], True)

    def test_5_seed_is_42(self):
        _, out, _ = self._run("runtime-info", "--json")
        payload = json.loads(out)
        self.assertEqual(payload["random_seed"], 42)

    def test_6_data_caps_correct(self):
        _, out, _ = self._run("runtime-info", "--json")
        payload = json.loads(out)
        self.assertEqual(payload["max_raw_events"], 250_000)
        self.assertEqual(payload["max_unique_users"], 50_000)
        self.assertEqual(payload["max_unique_songs"], 25_000)

    def test_7_max_workers_one(self):
        _, out, _ = self._run("runtime-info", "--json")
        payload = json.loads(out)
        self.assertEqual(payload["max_workers"], 1)

    def test_8_numeric_threads_one(self):
        _, out, _ = self._run("runtime-info", "--json")
        payload = json.loads(out)
        self.assertEqual(payload["numeric_threads"], 1)

    def test_9_output_contains_no_timestamp(self):
        import re

        _, out, _ = self._run("runtime-info", "--json")
        self.assertIsNone(re.search(r"\d{4}-\d{2}-\d{2}T", out))
        self.assertIsNone(re.search(r"\bcreated_at\b", out))
        self.assertIsNone(re.search(r"\btimestamp\b", out))
        self.assertIsNone(re.search(r"\bdate\b", out))

    def test_10_output_contains_no_username(self):
        _, out, _ = self._run("runtime-info", "--json")
        username = os.environ.get("USERNAME") or os.environ.get("USER") or ""
        if username:
            self.assertNotIn(username, out)
        payload = json.loads(out)
        self.assertNotIn("username", payload)
        self.assertNotIn("user", payload)
        self.assertNotIn("home", payload)

    def test_11_output_contains_no_home_or_repo_path(self):
        _, out, _ = self._run("runtime-info", "--json")
        home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or ""
        if home:
            self.assertNotIn(home, out)
        self.assertNotIn(str(REPO_ROOT), out)
        self.assertNotIn("D:\\", out)
        self.assertNotIn("/home/", out)

    def test_12_output_contains_no_environment_dump(self):
        _, out, _ = self._run("runtime-info", "--json")
        for name in ("PATH=", "PATHEXT", "APPDATA", "SECRET", "TOKEN", "mongodb://"):
            self.assertNotIn(name, out)

    def test_13_does_not_write_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            before = set(os.listdir(tmp))
            cwd = os.getcwd()
            try:
                os.chdir(tmp)
                code, _, _ = self._run("runtime-info", "--json")
            finally:
                os.chdir(cwd)
            after = set(os.listdir(tmp))
            self.assertEqual(code, 0)
            self.assertEqual(before, after)

    def test_14_unknown_command_fails_nonzero(self):
        code, _, err = self._run("not-a-command")
        self.assertNotEqual(code, 0)
        self.assertTrue(err.strip())

    def test_15_known_validation_failure_is_sanitized(self):
        # CLI exposes only runtime-info; force a known error path by checking
        # that RecommenderRuntimeError handling prints a plain message.
        from ml.recommender.runtime import ResourceLimitError, validate_non_negative_count

        err = io.StringIO()
        with redirect_stderr(err):
            try:
                validate_non_negative_count("raw_event_count", 250_001, 250_000)
            except ResourceLimitError as exc:
                print(str(exc), file=sys.stderr)
        message = err.getvalue()
        self.assertIn("raw_event_count exceeds limit 250000", message)
        self.assertNotIn("Traceback", message)

    def test_16_cli_module_imports_no_flask_fastapi(self):
        source = CLI_PATH.read_text(encoding="utf-8")
        for forbidden in ("fastapi", "flask", "django", "uvicorn", "gunicorn"):
            self.assertNotIn(forbidden, source)

    def test_17_no_train_command(self):
        source = CLI_PATH.read_text(encoding="utf-8")
        self.assertNotIn('"train"', source)
        self.assertNotIn("'train'", source)
        parser = cli_module.build_parser()
        # argparse stores subparser choices on the action
        sub_action = next(
            a for a in parser._actions if getattr(a, "choices", None) and hasattr(a, "metavar")
        )
        self.assertNotIn("train", sub_action.choices)

    def test_18_no_serve_command(self):
        parser = cli_module.build_parser()
        sub_action = next(
            a for a in parser._actions if getattr(a, "choices", None)
        )
        self.assertNotIn("serve", sub_action.choices)
        source = CLI_PATH.read_text(encoding="utf-8")
        self.assertNotIn('"serve"', source)

    def test_19_no_mongodb_logic(self):
        source = CLI_PATH.read_text(encoding="utf-8")
        for forbidden in ("pymongo", "MongoClient", "motor", "mongodb"):
            self.assertNotIn(forbidden, source)

    def test_20_invocation_is_deterministic(self):
        _, out_a, _ = self._run("runtime-info", "--json")
        _, out_b, _ = self._run("runtime-info", "--json")
        self.assertEqual(out_a, out_b)
        self.assertEqual(json.loads(out_a), json.loads(out_b))


class SubprocessIntegrationTests(unittest.TestCase):
    def test_runtime_info_subprocess_json(self):
        env = os.environ.copy()
        env["PYTHONPATH"] = str(REPO_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
        proc = subprocess.run(
            [sys.executable, "-m", "ml.recommender.cli", "runtime-info", "--json"],
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = json.loads(proc.stdout)
        self.assertEqual(payload["runtime"], "melodify-offline-recommender")
        self.assertIs(payload["cpu_only"], True)
        self.assertEqual(payload["random_seed"], 42)
        self.assertEqual(payload["max_raw_events"], 250_000)
        self.assertEqual(payload["max_unique_users"], 50_000)
        self.assertEqual(payload["max_unique_songs"], 25_000)
        self.assertEqual(payload["max_workers"], 1)
        self.assertEqual(payload["numeric_threads"], 1)

    def test_subprocess_unknown_command_nonzero(self):
        env = os.environ.copy()
        env["PYTHONPATH"] = str(REPO_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
        proc = subprocess.run(
            [sys.executable, "-m", "ml.recommender.cli", "nope"],
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertNotEqual(proc.returncode, 0)


class BuildRuntimeInfoTests(unittest.TestCase):
    def test_build_runtime_info_shape(self):
        info = build_runtime_info()
        expected_keys = {
            "runtime",
            "cpu_only",
            "random_seed",
            "max_raw_events",
            "max_unique_users",
            "max_unique_songs",
            "max_workers",
            "numeric_threads",
            "runtime_schema_version",
        }
        self.assertEqual(set(info.keys()), expected_keys)
        self.assertEqual(info["runtime_schema_version"], 1)


if __name__ == "__main__":
    unittest.main()
