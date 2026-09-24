"""Safe versioned artifact store for the Melodify offline recommender.

Persists only non-executable JSON and numeric NPZ payloads under a local
versioned release tree with SHA-256 manifests, staging + atomic rename
publication, explicit activation, and last-known-good ``current.json``
pointer semantics. NumPy loads lazily **after** ``configure_cpu_runtime()``
so importing this module alone does not mutate the process environment.

This module does not train models, fit SVD, query MongoDB, expose HTTP,
or load executable object payloads.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Sequence

from .runtime import RecommenderRuntimeError, configure_cpu_runtime

ARTIFACT_SCHEMA_VERSION = 1

MAX_ARTIFACT_FILES = 32
MAX_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024
MAX_ARTIFACT_TOTAL_BYTES = 128 * 1024 * 1024
MAX_METADATA_ENTRIES = 64
MAX_METADATA_JSON_BYTES = 64 * 1024
MAX_NPZ_ARRAYS = 64
MAX_NPZ_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
MAX_NPZ_ZIP_ENTRIES = 128
MAX_IDENTIFIER_LENGTH = 64
MAX_ARTIFACT_FILENAME_LENGTH = 128
MAX_METADATA_KEY_LENGTH = 128

_ALLOWED_SUFFIXES = (".json", ".npz")
_RESERVED_NAMES = frozenset({"manifest.json", "current.json"})

_IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_FILENAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_ARRAY_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]{0,63}$")

_SUPPORTED_DTYPE_KINDS = frozenset({"b", "i", "u", "f"})

_np = None


class ArtifactError(RecommenderRuntimeError):
    """Base artifact-store failure."""


class ArtifactValidationError(ArtifactError):
    """Artifact input failed deterministic validation."""


class ArtifactIntegrityError(ArtifactError):
    """Stored artifact bytes failed integrity verification."""


class ArtifactConflictError(ArtifactError):
    """Requested artifact version already exists."""


class ArtifactNotFoundError(ArtifactError):
    """Requested artifact release or file is missing."""


@dataclass(frozen=True)
class ArtifactFileRecord:
    """Immutable SHA-256 record for one published payload file."""

    name: str
    format: str
    size_bytes: int
    sha256: str


@dataclass(frozen=True)
class ArtifactManifest:
    """Immutable published-release manifest."""

    schema_version: int
    artifact_version: str
    artifact_kind: str
    created_at: str
    files: tuple[ArtifactFileRecord, ...]
    metadata: Mapping[str, Any]


def _load_numpy():
    """Configure CPU thread bounds first, then import NumPy once."""
    global _np
    if _np is None:
        configure_cpu_runtime()
        import numpy as numpy_module

        _np = numpy_module
    return _np


def validate_artifact_version(version: object) -> str:
    """Validate a caller-supplied artifact version identifier."""
    if not isinstance(version, str):
        raise ArtifactValidationError("invalid artifact version")
    if version != version.strip():
        raise ArtifactValidationError("invalid artifact version")
    if version in (".", ".."):
        raise ArtifactValidationError("invalid artifact version")
    if len(version) < 1 or len(version) > MAX_IDENTIFIER_LENGTH:
        raise ArtifactValidationError("invalid artifact version")
    if not _IDENTIFIER_RE.match(version):
        raise ArtifactValidationError("invalid artifact version")
    return version


def validate_artifact_kind(artifact_kind: object) -> str:
    """Validate a caller-supplied artifact kind identifier."""
    if not isinstance(artifact_kind, str):
        raise ArtifactValidationError("invalid artifact kind")
    if artifact_kind != artifact_kind.strip():
        raise ArtifactValidationError("invalid artifact kind")
    if artifact_kind in (".", ".."):
        raise ArtifactValidationError("invalid artifact kind")
    if len(artifact_kind) < 1 or len(artifact_kind) > MAX_IDENTIFIER_LENGTH:
        raise ArtifactValidationError("invalid artifact kind")
    if not _IDENTIFIER_RE.match(artifact_kind):
        raise ArtifactValidationError("invalid artifact kind")
    return artifact_kind


def validate_artifact_filename(name: object) -> str:
    """Validate a simple payload basename with a supported suffix."""
    if not isinstance(name, str):
        raise ArtifactValidationError("invalid artifact filename")
    if name != name.strip() or not name:
        raise ArtifactValidationError("invalid artifact filename")
    if len(name) > MAX_ARTIFACT_FILENAME_LENGTH:
        raise ArtifactValidationError("invalid artifact filename")
    if name in _RESERVED_NAMES:
        raise ArtifactValidationError("reserved artifact filename")
    if "/" in name or "\\" in name or ":" in name:
        raise ArtifactValidationError("invalid artifact filename")
    if name in (".", "..") or ".." in name:
        raise ArtifactValidationError("invalid artifact filename")
    if not _FILENAME_RE.match(name):
        raise ArtifactValidationError("invalid artifact filename")
    if not name.endswith(_ALLOWED_SUFFIXES):
        raise ArtifactValidationError("unsupported artifact format")
    return name


def _validate_array_name(name: object) -> str:
    if not isinstance(name, str):
        raise ArtifactValidationError("invalid NPZ array name")
    if not _ARRAY_NAME_RE.match(name):
        raise ArtifactValidationError("invalid NPZ array name")
    return name


def _validate_created_at(value: object) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ArtifactValidationError("created_at must include timezone")
        moment = value.astimezone(timezone.utc)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise ArtifactValidationError("invalid created_at")
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            moment = datetime.fromisoformat(text)
        except ValueError as exc:
            raise ArtifactValidationError("invalid created_at") from exc
        if moment.tzinfo is None or moment.utcoffset() is None:
            raise ArtifactValidationError("created_at must include timezone")
        moment = moment.astimezone(timezone.utc)
    else:
        raise ArtifactValidationError(
            "created_at must be a timezone-aware datetime or ISO-8601 string"
        )
    iso_text = moment.isoformat()
    if iso_text.endswith("+00:00"):
        return iso_text[:-6] + "Z"
    return iso_text


def encode_json_artifact(value: object) -> bytes:
    """Encode a JSON-compatible value as deterministic UTF-8 bytes."""
    try:
        text = json.dumps(
            value,
            sort_keys=True,
            allow_nan=False,
            separators=(",", ":"),
            ensure_ascii=False,
        )
    except (TypeError, ValueError) as exc:
        raise ArtifactValidationError("invalid JSON artifact value") from None
    return text.encode("utf-8")


def _reject_json_constant(name: str) -> None:
    raise ArtifactValidationError("invalid JSON constant")


def decode_json_artifact(data: object) -> Any:
    """Decode UTF-8 JSON bytes without code execution."""
    if not isinstance(data, (bytes, bytearray)):
        raise ArtifactValidationError("JSON artifact must be bytes")
    try:
        text = bytes(data).decode("utf-8")
    except UnicodeDecodeError:
        raise ArtifactValidationError("invalid UTF-8 in JSON artifact") from None
    try:
        return json.loads(text, parse_constant=_reject_json_constant)
    except ArtifactValidationError:
        raise
    except (json.JSONDecodeError, ValueError, TypeError, RecursionError):
        raise ArtifactValidationError("invalid JSON artifact") from None


def _validate_metadata(metadata: object) -> MappingProxyType:
    if metadata is None:
        metadata = {}
    if not isinstance(metadata, Mapping):
        raise ArtifactValidationError("metadata must be a mapping")
    if len(metadata) > MAX_METADATA_ENTRIES:
        raise ArtifactValidationError("metadata entry count exceeds limit")
    cleaned: dict[str, Any] = {}
    for key, value in metadata.items():
        if not isinstance(key, str) or not key:
            raise ArtifactValidationError("invalid metadata key")
        if len(key) > MAX_METADATA_KEY_LENGTH:
            raise ArtifactValidationError("invalid metadata key")
        if isinstance(value, bool) or value is None:
            cleaned[key] = value
        elif isinstance(value, int):
            cleaned[key] = value
        elif isinstance(value, float):
            if not math.isfinite(value):
                raise ArtifactValidationError("invalid metadata value")
            cleaned[key] = value
        elif isinstance(value, str):
            cleaned[key] = value
        else:
            raise ArtifactValidationError("invalid metadata value")
    encoded = encode_json_artifact(cleaned)
    if len(encoded) > MAX_METADATA_JSON_BYTES:
        raise ArtifactValidationError("metadata exceeds maximum JSON size")
    return MappingProxyType(cleaned)


def _validate_dtype(np, dtype) -> None:
    kind = getattr(dtype, "kind", None)
    if kind not in _SUPPORTED_DTYPE_KINDS:
        raise ArtifactValidationError("unsupported NPZ array dtype")


def _validate_finite(np, array) -> None:
    if array.dtype.kind == "f":
        if not bool(np.isfinite(array).all()):
            raise ArtifactValidationError("NPZ array values must be finite")


def encode_numeric_npz(arrays: object) -> bytes:
    """Encode bounded finite numeric arrays as an uncompressed NPZ blob."""
    if not isinstance(arrays, Mapping):
        raise ArtifactValidationError("NPZ arrays must be a mapping")
    if len(arrays) > MAX_NPZ_ARRAYS:
        raise ArtifactValidationError("NPZ array count exceeds limit")
    np = _load_numpy()
    prepared: dict[str, Any] = {}
    for raw_name, array in arrays.items():
        name = _validate_array_name(raw_name)
        if not isinstance(array, np.ndarray):
            raise ArtifactValidationError("NPZ values must be NumPy arrays")
        _validate_dtype(np, array.dtype)
        _validate_finite(np, array)
        prepared[name] = array
    buffer = io.BytesIO()
    try:
        np.savez(buffer, **prepared)
    except (TypeError, ValueError, OSError):
        raise ArtifactValidationError("failed to encode NPZ artifact") from None
    data = buffer.getvalue()
    if len(data) > MAX_ARTIFACT_FILE_BYTES:
        raise ArtifactValidationError("encoded NPZ exceeds maximum file size")
    return data


def _inspect_npz_zip(data: bytes) -> None:
    buffer = io.BytesIO(data)
    try:
        with zipfile.ZipFile(buffer, "r") as archive:
            infos = archive.infolist()
            if len(infos) > MAX_NPZ_ZIP_ENTRIES:
                raise ArtifactValidationError("NPZ ZIP entry count exceeds limit")
            total_uncompressed = 0
            for info in infos:
                member = info.filename
                if not member:
                    raise ArtifactValidationError("unsafe ZIP member path")
                normalized = member.replace("\\", "/")
                if normalized.startswith("/") or normalized.startswith("//"):
                    raise ArtifactValidationError("unsafe ZIP member path")
                if len(normalized) >= 2 and normalized[1] == ":":
                    raise ArtifactValidationError("unsafe ZIP member path")
                parts = [part for part in normalized.split("/") if part != ""]
                if any(part == ".." for part in parts):
                    raise ArtifactValidationError("unsafe ZIP member path")
                if info.is_dir():
                    continue
                if info.file_size < 0:
                    raise ArtifactValidationError("malformed NPZ ZIP archive")
                total_uncompressed += int(info.file_size)
            if total_uncompressed > MAX_NPZ_UNCOMPRESSED_BYTES:
                raise ArtifactValidationError(
                    "NPZ uncompressed size exceeds limit"
                )
    except ArtifactValidationError:
        raise
    except zipfile.BadZipFile:
        raise ArtifactValidationError("malformed NPZ ZIP archive") from None
    except (OSError, ValueError, RuntimeError, EOFError):
        raise ArtifactValidationError("malformed NPZ ZIP archive") from None


def decode_numeric_npz(data: object) -> Mapping[str, Any]:
    """Safely decode an NPZ blob with ``allow_pickle=False``."""
    if not isinstance(data, (bytes, bytearray)):
        raise ArtifactValidationError("NPZ artifact must be bytes")
    payload = bytes(data)
    _inspect_npz_zip(payload)
    np = _load_numpy()
    buffer = io.BytesIO(payload)
    loaded_map: dict[str, Any] = {}
    try:
        with np.load(buffer, allow_pickle=False) as loaded:
            for name in loaded.files:
                array = loaded[name]
                if not isinstance(array, np.ndarray):
                    raise ArtifactValidationError("unsupported NPZ array dtype")
                _validate_dtype(np, array.dtype)
                _validate_finite(np, array)
                owned = np.array(array, copy=True)
                owned.flags.writeable = False
                loaded_map[name] = owned
    except ArtifactValidationError:
        raise
    except Exception:
        raise ArtifactValidationError("failed to decode NPZ artifact") from None
    ordered = {name: loaded_map[name] for name in sorted(loaded_map)}
    return MappingProxyType(ordered)


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _format_for_filename(name: str) -> str:
    if name.endswith(".json"):
        return "json"
    if name.endswith(".npz"):
        return "npz"
    raise ArtifactValidationError("unsupported artifact format")


def _validate_payload(name: str, payload: bytes) -> str:
    validate_artifact_filename(name)
    if not isinstance(payload, (bytes, bytearray)):
        raise ArtifactValidationError("artifact payload must be bytes")
    data = bytes(payload)
    if len(data) > MAX_ARTIFACT_FILE_BYTES:
        raise ArtifactValidationError("artifact file exceeds maximum size")
    fmt = _format_for_filename(name)
    if fmt == "json":
        decode_json_artifact(data)
    else:
        decode_numeric_npz(data)
    return fmt


def _encode_manifest(manifest: ArtifactManifest) -> bytes:
    document = {
        "schema_version": manifest.schema_version,
        "artifact_version": manifest.artifact_version,
        "artifact_kind": manifest.artifact_kind,
        "created_at": manifest.created_at,
        "files": [
            {
                "name": record.name,
                "format": record.format,
                "size_bytes": record.size_bytes,
                "sha256": record.sha256,
            }
            for record in manifest.files
        ],
        "metadata": dict(manifest.metadata),
    }
    return encode_json_artifact(document)


def _decode_manifest(data: bytes, expected_version: str) -> ArtifactManifest:
    document = decode_json_artifact(data)
    if not isinstance(document, dict):
        raise ArtifactValidationError("invalid artifact manifest")
    if document.get("schema_version") != ARTIFACT_SCHEMA_VERSION:
        raise ArtifactValidationError("unsupported artifact schema version")
    artifact_version = validate_artifact_version(document.get("artifact_version"))
    if artifact_version != expected_version:
        raise ArtifactValidationError("manifest version mismatch")
    artifact_kind = validate_artifact_kind(document.get("artifact_kind"))
    created_at = _validate_created_at(document.get("created_at"))
    raw_files = document.get("files")
    if not isinstance(raw_files, list) or not raw_files:
        raise ArtifactValidationError("invalid artifact manifest files")
    if len(raw_files) > MAX_ARTIFACT_FILES:
        raise ArtifactValidationError("artifact file count exceeds limit")
    records: list[ArtifactFileRecord] = []
    seen_names: set[str] = set()
    previous_name: str | None = None
    for entry in raw_files:
        if not isinstance(entry, dict):
            raise ArtifactValidationError("invalid artifact manifest file record")
        name = validate_artifact_filename(entry.get("name"))
        if name in seen_names:
            raise ArtifactValidationError("duplicate artifact filename")
        if previous_name is not None and name < previous_name:
            raise ArtifactValidationError("manifest files must be sorted by name")
        previous_name = name
        seen_names.add(name)
        fmt = entry.get("format")
        if fmt != _format_for_filename(name):
            raise ArtifactValidationError("unsupported artifact format")
        size_bytes = entry.get("size_bytes")
        if isinstance(size_bytes, bool) or not isinstance(size_bytes, int):
            raise ArtifactValidationError("invalid artifact file size")
        if size_bytes < 0 or size_bytes > MAX_ARTIFACT_FILE_BYTES:
            raise ArtifactValidationError("artifact file exceeds maximum size")
        sha256 = entry.get("sha256")
        if not isinstance(sha256, str) or len(sha256) != 64:
            raise ArtifactValidationError("invalid artifact checksum")
        if any(ch not in "0123456789abcdef" for ch in sha256):
            raise ArtifactValidationError("invalid artifact checksum")
        records.append(
            ArtifactFileRecord(
                name=name,
                format=fmt,
                size_bytes=size_bytes,
                sha256=sha256,
            )
        )
    metadata = _validate_metadata(document.get("metadata") or {})
    return ArtifactManifest(
        schema_version=ARTIFACT_SCHEMA_VERSION,
        artifact_version=artifact_version,
        artifact_kind=artifact_kind,
        created_at=created_at,
        files=tuple(records),
        metadata=metadata,
    )


def _release_dir(root: Path, version: str) -> Path:
    return root / "releases" / version


def _verify_release_dir(release: Path, expected_version: str) -> ArtifactManifest:
    if release.is_symlink():
        raise ArtifactValidationError("release directory must not be a symlink")
    if not release.exists():
        raise ArtifactNotFoundError("artifact release not found")
    if not release.is_dir():
        raise ArtifactValidationError("invalid release path")
    manifest_path = release / "manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ArtifactValidationError("missing artifact manifest")
    try:
        manifest_bytes = manifest_path.read_bytes()
    except OSError:
        raise ArtifactValidationError("missing artifact manifest") from None
    manifest = _decode_manifest(manifest_bytes, expected_version)

    declared = {record.name for record in manifest.files}
    actual_payloads: set[str] = set()
    for entry in release.iterdir():
        if entry.name == "manifest.json":
            continue
        if entry.is_symlink():
            raise ArtifactValidationError("unexpected symlink entry in release")
        if entry.is_dir():
            raise ArtifactValidationError("unexpected directory in release")
        if not entry.is_file():
            raise ArtifactValidationError("unexpected entry in release")
        actual_payloads.add(entry.name)

    undeclared = actual_payloads - declared
    if undeclared:
        raise ArtifactValidationError("undeclared file in release")
    missing = declared - actual_payloads
    if missing:
        raise ArtifactNotFoundError("artifact release file missing")

    for record in manifest.files:
        path = release / record.name
        if path.is_symlink() or not path.is_file():
            raise ArtifactValidationError("artifact file must be a regular file")
        try:
            data = path.read_bytes()
        except OSError:
            raise ArtifactNotFoundError("artifact release file missing") from None
        if len(data) != record.size_bytes:
            raise ArtifactIntegrityError("artifact checksum mismatch")
        if _sha256_hex(data) != record.sha256:
            raise ArtifactIntegrityError("artifact checksum mismatch")
        if record.format == "json":
            decode_json_artifact(data)
        elif record.format == "npz":
            decode_numeric_npz(data)
        else:
            raise ArtifactValidationError("unsupported artifact format")
    return manifest


def publish_artifact_release(
    root: object,
    *,
    version: object,
    artifact_kind: object,
    created_at: object,
    artifacts: object,
    metadata: object = None,
) -> ArtifactManifest:
    """Validate, stage, verify, then atomically publish one immutable release.

    Does not create or update the active-version pointer file. Existing
    versions reject without mutation. Temporary staging randomness is never
    used as a version identifier.
    """
    if not isinstance(root, (str, os.PathLike)):
        raise ArtifactValidationError("invalid artifact root")
    root_path = Path(root)
    version_id = validate_artifact_version(version)
    kind_id = validate_artifact_kind(artifact_kind)
    created_text = _validate_created_at(created_at)
    metadata_map = _validate_metadata(metadata)

    if not isinstance(artifacts, Mapping):
        raise ArtifactValidationError("artifacts must be a mapping")
    if len(artifacts) == 0:
        raise ArtifactValidationError("release must contain at least one artifact")
    if len(artifacts) > MAX_ARTIFACT_FILES:
        raise ArtifactValidationError("artifact file count exceeds limit")

    validated: dict[str, tuple[bytes, str]] = {}
    total_bytes = 0
    for raw_name, raw_payload in artifacts.items():
        name = validate_artifact_filename(raw_name)
        if name in validated:
            raise ArtifactValidationError("duplicate artifact filename")
        if not isinstance(raw_payload, (bytes, bytearray)):
            raise ArtifactValidationError("artifact payload must be bytes")
        payload = bytes(raw_payload)
        if len(payload) > MAX_ARTIFACT_FILE_BYTES:
            raise ArtifactValidationError("artifact file exceeds maximum size")
        total_bytes += len(payload)
        if total_bytes > MAX_ARTIFACT_TOTAL_BYTES:
            raise ArtifactValidationError("artifact total size exceeds limit")
        fmt = _validate_payload(name, payload)
        validated[name] = (payload, fmt)

    final_dir = _release_dir(root_path, version_id)
    if final_dir.exists() or final_dir.is_symlink():
        raise ArtifactConflictError("artifact version already exists")

    staging_root = root_path / ".staging"
    try:
        staging_root.mkdir(parents=True, exist_ok=True)
        (root_path / "releases").mkdir(parents=True, exist_ok=True)
    except OSError:
        raise ArtifactValidationError("failed to prepare artifact store") from None

    staging_dir = Path(
        tempfile.mkdtemp(prefix="rel-", dir=str(staging_root))
    )
    published = False
    try:
        records: list[ArtifactFileRecord] = []
        for name in sorted(validated):
            payload, fmt = validated[name]
            target = staging_dir / name
            target.write_bytes(payload)
            records.append(
                ArtifactFileRecord(
                    name=name,
                    format=fmt,
                    size_bytes=len(payload),
                    sha256=_sha256_hex(payload),
                )
            )
        manifest = ArtifactManifest(
            schema_version=ARTIFACT_SCHEMA_VERSION,
            artifact_version=version_id,
            artifact_kind=kind_id,
            created_at=created_text,
            files=tuple(records),
            metadata=metadata_map,
        )
        (staging_dir / "manifest.json").write_bytes(_encode_manifest(manifest))
        verified = _verify_release_dir(staging_dir, version_id)
        if final_dir.exists() or final_dir.is_symlink():
            raise ArtifactConflictError("artifact version already exists")
        os.replace(str(staging_dir), str(final_dir))
        published = True
        return verified
    except ArtifactError:
        raise
    except OSError:
        raise ArtifactValidationError("failed to publish artifact release") from None
    finally:
        if not published and staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)


def verify_artifact_release(root: object, version: object) -> ArtifactManifest:
    """Fully verify one published release and return its immutable manifest."""
    if not isinstance(root, (str, os.PathLike)):
        raise ArtifactValidationError("invalid artifact root")
    root_path = Path(root)
    version_id = validate_artifact_version(version)
    return _verify_release_dir(_release_dir(root_path, version_id), version_id)


def activate_artifact_release(root: object, version: object) -> ArtifactManifest:
    """Verify a release, then atomically point ``current.json`` at it.

    The previous pointer remains unchanged if verification or the pointer
    write fails before ``os.replace``. Does not mutate release payloads.
    """
    if not isinstance(root, (str, os.PathLike)):
        raise ArtifactValidationError("invalid artifact root")
    root_path = Path(root)
    version_id = validate_artifact_version(version)
    manifest = _verify_release_dir(_release_dir(root_path, version_id), version_id)

    pointer_bytes = encode_json_artifact(
        {
            "schema_version": ARTIFACT_SCHEMA_VERSION,
            "artifact_version": version_id,
        }
    )
    try:
        root_path.mkdir(parents=True, exist_ok=True)
    except OSError:
        raise ArtifactValidationError("failed to prepare artifact store") from None

    fd, tmp_name = tempfile.mkstemp(
        prefix=".current-", suffix=".tmp", dir=str(root_path)
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(pointer_bytes)
            handle.flush()
            try:
                os.fsync(handle.fileno())
            except OSError:
                pass
        os.replace(str(tmp_path), str(root_path / "current.json"))
    except OSError:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise ArtifactValidationError("failed to update current pointer") from None
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass
        raise
    return manifest


def resolve_active_artifact_release(root: object) -> ArtifactManifest | None:
    """Resolve and verify the explicit last-known-good release pointer."""
    if not isinstance(root, (str, os.PathLike)):
        raise ArtifactValidationError("invalid artifact root")
    root_path = Path(root)
    pointer_path = root_path / "current.json"
    if pointer_path.is_symlink():
        raise ArtifactValidationError("current pointer must not be a symlink")
    if not pointer_path.exists():
        return None
    try:
        pointer_bytes = pointer_path.read_bytes()
    except OSError:
        raise ArtifactValidationError("invalid current pointer") from None
    document = decode_json_artifact(pointer_bytes)
    if not isinstance(document, dict):
        raise ArtifactValidationError("invalid current pointer")
    if document.get("schema_version") != ARTIFACT_SCHEMA_VERSION:
        raise ArtifactValidationError("unsupported artifact schema version")
    version_id = validate_artifact_version(document.get("artifact_version"))
    return _verify_release_dir(_release_dir(root_path, version_id), version_id)


def _load_declared_payload(
    root: object, version: object, name: object, expected_format: str
) -> tuple[ArtifactManifest, ArtifactFileRecord, bytes]:
    if not isinstance(root, (str, os.PathLike)):
        raise ArtifactValidationError("invalid artifact root")
    root_path = Path(root)
    version_id = validate_artifact_version(version)
    file_name = validate_artifact_filename(name)
    if not file_name.endswith(f".{expected_format}"):
        raise ArtifactValidationError("unsupported artifact format")
    manifest = _verify_release_dir(_release_dir(root_path, version_id), version_id)
    record = next(
        (item for item in manifest.files if item.name == file_name), None
    )
    if record is None:
        raise ArtifactNotFoundError("artifact file not declared in release")
    if record.format != expected_format:
        raise ArtifactValidationError("unsupported artifact format")
    path = _release_dir(root_path, version_id) / file_name
    if path.is_symlink() or not path.is_file():
        raise ArtifactValidationError("artifact file must be a regular file")
    try:
        data = path.read_bytes()
    except OSError:
        raise ArtifactNotFoundError("artifact release file missing") from None
    if len(data) != record.size_bytes or _sha256_hex(data) != record.sha256:
        raise ArtifactIntegrityError("artifact checksum mismatch")
    return manifest, record, data


def load_json_artifact(root: object, version: object, name: object) -> Any:
    """Verify a release, then decode one declared JSON payload."""
    _, _, data = _load_declared_payload(root, version, name, "json")
    return decode_json_artifact(data)


def load_numeric_npz_artifact(
    root: object, version: object, name: object
) -> Mapping[str, Any]:
    """Verify a release, then safely decode one declared NPZ payload."""
    _, _, data = _load_declared_payload(root, version, name, "npz")
    return decode_numeric_npz(data)
