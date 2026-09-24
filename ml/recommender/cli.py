"""Bounded argparse CLI for the Melodify offline recommender runtime.

Only one command exists in this checkpoint: ``runtime-info``. No train,
evaluate, recommend, snapshot, or serve commands. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Sequence

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
    configure_cpu_runtime,
    get_runtime_limits,
)

_EXIT_OK = 0
_EXIT_KNOWN_ERROR = 2


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
    except RecommenderRuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return _EXIT_KNOWN_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
