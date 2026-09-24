"""Bounded argparse CLI for the Melodify offline recommender runtime.

Commands: ``runtime-info`` and ``retrain-json`` (checkpoint 43/43).
``retrain-json`` reads one bounded stdin JSON document, runs the offline
orchestrator, and writes exactly one JSON document to stdout. Standard
library only at import time.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Sequence

from .orchestrator import (
    OrchestratorArtifactConflictError,
    OrchestratorError,
    OrchestratorInsufficientDataError,
    OrchestratorOutputError,
    OrchestratorValidationError,
    run_retraining,
)
from .runtime import (
    DEFAULT_RANDOM_SEED,
    MAX_RAW_EVENTS,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    MAX_WORKERS,
    RUNTIME_NAME,
    RUNTIME_SCHEMA_VERSION,
    THREADS_PER_NUMERIC_LIBRARY,
    RecommenderRuntimeError,
    ResourceLimitError,
    configure_cpu_runtime,
    get_runtime_limits,
)

_EXIT_OK = 0
_EXIT_KNOWN_ERROR = 2

MAX_RETRAIN_STDIN_BYTES = 256 * 1024 * 1024


def build_runtime_info() -> dict[str, object]:
    """Return a deterministic, bounded runtime summary object."""
    limits = get_runtime_limits()
    return {
        "runtime": RUNTIME_NAME,
        "cpu_only": True,
        "random_seed": limits.random_seed,
        "max_raw_events": limits.max_raw_events,
        "max_unique_users": limits.max_unique_users,
        "max_unique_songs": limits.max_unique_songs,
        "max_workers": limits.max_workers,
        "numeric_threads": limits.numeric_threads,
        "runtime_schema_version": RUNTIME_SCHEMA_VERSION,
    }


def _cmd_runtime_info(args: argparse.Namespace) -> int:
    info = build_runtime_info()
    if args.json:
        print(json.dumps(info, sort_keys=True, separators=(",", ":")))
    else:
        for key in (
            "runtime",
            "cpu_only",
            "random_seed",
            "max_raw_events",
            "max_unique_users",
            "max_unique_songs",
            "max_workers",
            "numeric_threads",
            "runtime_schema_version",
        ):
            print(f"{key}={info[key]}")
    return _EXIT_OK


def _read_bounded_stdin() -> str:
    data = sys.stdin.buffer.read(MAX_RETRAIN_STDIN_BYTES + 1)
    if len(data) > MAX_RETRAIN_STDIN_BYTES:
        raise OrchestratorValidationError("retrain input exceeds size limit")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise OrchestratorValidationError("retrain input must be UTF-8") from None


def _cmd_retrain_json(args: argparse.Namespace) -> int:
    del args
    text = _read_bounded_stdin()
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, ValueError, RecursionError):
        raise OrchestratorValidationError("retrain input must be valid JSON") from None
    output = run_retraining(payload)
    try:
        encoded = json.dumps(
            output, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
    except (TypeError, ValueError):
        raise OrchestratorOutputError("retrain output is not JSON serializable") from None
    sys.stdout.write(encoded)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return _EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m ml.recommender.cli",
        description="Bounded offline Melodify recommender runtime tools.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    runtime_info = subparsers.add_parser(
        "runtime-info",
        help="Print a deterministic bounded runtime summary.",
    )
    runtime_info.add_argument(
        "--json",
        action="store_true",
        help="Emit the runtime summary as JSON.",
    )
    runtime_info.set_defaults(func=_cmd_runtime_info)
    retrain_json = subparsers.add_parser(
        "retrain-json",
        help="Run one bounded offline retrain from stdin JSON.",
    )
    retrain_json.set_defaults(func=_cmd_retrain_json)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Configure CPU runtime, parse args, run one bounded command."""
    configure_cpu_runtime()
    parser = build_parser()
    try:
        args = parser.parse_args(list(argv) if argv is not None else None)
    except SystemExit as exc:
        code = exc.code
        if code is None:
            return _EXIT_OK
        if isinstance(code, int):
            return code
        return _EXIT_KNOWN_ERROR
    try:
        return int(args.func(args))
    except OrchestratorInsufficientDataError as exc:
        print(f"INSUFFICIENT_TRAINING_DATA: {exc}", file=sys.stderr)
        return _EXIT_KNOWN_ERROR
    except OrchestratorArtifactConflictError as exc:
        print(f"ARTIFACT_VERSION_CONFLICT: {exc}", file=sys.stderr)
        return _EXIT_KNOWN_ERROR
    except OrchestratorValidationError as exc:
        print(str(exc), file=sys.stderr)
        return _EXIT_KNOWN_ERROR
    except ResourceLimitError as exc:
        print(f"TRAINING_INPUT_LIMIT_EXCEEDED: {exc}", file=sys.stderr)
        return _EXIT_KNOWN_ERROR
    except OrchestratorOutputError as exc:
        print(str(exc), file=sys.stderr)
        return _EXIT_KNOWN_ERROR
    except OrchestratorError as exc:
        print(str(exc), file=sys.stderr)
        return _EXIT_KNOWN_ERROR
    except RecommenderRuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return _EXIT_KNOWN_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
