"""Deterministic collaborative latent-factor model for Melodify.

Builds a fixed-formula implicit-signal CSR ``float32`` matrix from a
25/43 ``SparseInteractionBundle``, fits ``sklearn.decomposition.TruncatedSVD``
(CPU-only, thread-bounded) when enough data exists, and scores candidate
Songs with raw user·song latent-factor dot products.

Signal coefficients are a fixed initial heuristic policy — not learned
weights, not an optimized configuration, and not a quality claim.
``stopped_count`` is deliberately unused (ambiguous abandonment semantics).
Every term uses ``numpy.log1p`` damping and the final signal is clipped
to ``[0, 8]``.

No dense user×song reconstruction, no content-based features, no external
preference-source folding, no evaluation-based hyperparameter search, no
artifact publication, no MongoDB/HTTP, and no CLI training command.
Importing this module does not import NumPy, SciPy, or scikit-learn; they
load lazily after ``configure_cpu_runtime()``.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping, Sequence

from .runtime import (
    DEFAULT_RANDOM_SEED,
    MAX_SEED,
    MAX_UNIQUE_SONGS,
    MAX_UNIQUE_USERS,
    RecommenderRuntimeError,
    ResourceLimitError,
    configure_cpu_runtime,
)
from .sparse_interactions import SparseInteractionBundle

COLLABORATIVE_MODEL_SCHEMA_VERSION = 1

DEFAULT_LATENT_FACTORS = 32
MAX_LATENT_FACTORS = 32
SVD_ALGORITHM = "randomized"
SVD_N_ITER = 7

OBSERVED_WEIGHT = 1.00
SESSION_LOG_WEIGHT = 0.50
PLAY_START_LOG_WEIGHT = 0.25
COMPLETION_LOG_WEIGHT = 1.50
REPLAY_LOG_WEIGHT = 1.00
LISTENED_MINUTE_LOG_WEIGHT = 0.25
SKIP_LOG_PENALTY = 0.75
MAX_IMPLICIT_SIGNAL = 8.0

MIN_COLLABORATIVE_USERS = 2
MIN_COLLABORATIVE_SONGS = 2
MIN_COLLABORATIVE_INTERACTION_PAIRS = 2

STATUS_TRAINED = "trained"
STATUS_INSUFFICIENT_DATA = "insufficient-data"

_MATRIX_FIELD_NAMES = (
    "observed",
    "session_count",
    "play_started_count",
    "replay_started_count",
    "completed_count",
    "skipped_count",
    "stopped_count",
    "listened_seconds",
)

_HEX_CHARS = frozenset("0123456789abcdef")

_np = None
_sp = None
_TruncatedSVD = None


class CollaborativeError(RecommenderRuntimeError):
    """Base collaborative-model failure."""


class CollaborativeValidationError(CollaborativeError):
    """Input failed deterministic validation."""


class CollaborativeUnknownUserError(CollaborativeError):
    """Requested user is not present in the trained model."""


class CollaborativeUnknownSongError(CollaborativeError):
    """Requested candidate Song is not present in the trained model."""


@dataclass(frozen=True)
class CollaborativeItemScore:
    """One raw latent-factor score for a single candidate Song."""

    song_id: str
    score: float


@dataclass(frozen=True)
class CollaborativeTrainingSummary:
    """Factual counts describing one collaborative training attempt."""

    user_count: int
    song_count: int
    interaction_pair_count: int
    training_signal_nnz: int
    requested_components: int
    effective_components: int
    random_seed: int
    status: str
    explained_variance_ratio_sum: float | None


@dataclass(frozen=True)
class CollaborativeLatentModel:
    """Immutable trained latent factors plus indexing metadata."""

    schema_version: int
    user_ids: tuple[str, ...]
    song_ids: tuple[str, ...]
    user_to_index: Mapping[str, int]
    song_to_index: Mapping[str, int]
    user_factors: object
    song_factors: object
    singular_values: object
    explained_variance_ratio: object
    requested_components: int
    effective_components: int
    random_seed: int
    algorithm: str
    n_iter: int


@dataclass(frozen=True)
class CollaborativeTrainingResult:
    """Immutable status, optional model, and factual summary."""

    status: str
    model: CollaborativeLatentModel | None
    summary: CollaborativeTrainingSummary


def _load_ml_stack():
    """Configure CPU thread bounds first, then import NumPy/SciPy/sklearn once."""
    global _np, _sp, _TruncatedSVD
    if _np is None or _sp is None or _TruncatedSVD is None:
        configure_cpu_runtime()
        import numpy as numpy_module
        import scipy.sparse as scipy_sparse_module
        from sklearn.decomposition import TruncatedSVD as TruncatedSVDClass

        _np = numpy_module
        _sp = scipy_sparse_module
        _TruncatedSVD = TruncatedSVDClass
    return _np, _sp, _TruncatedSVD


def _canonical_id(value: object, kind: str) -> str:
    if isinstance(value, bool) or not isinstance(value, str):
        raise CollaborativeValidationError(f"invalid collaborative {kind} id")
    text = value.strip().lower()
    if len(text) != 24 or any(ch not in _HEX_CHARS for ch in text):
        raise CollaborativeValidationError(f"invalid collaborative {kind} id")
    return text


def _validate_n_components(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise CollaborativeValidationError("n_components must be an integer")
    if value < 1 or value > MAX_LATENT_FACTORS:
        raise CollaborativeValidationError(
            f"n_components must be between 1 and {MAX_LATENT_FACTORS}"
        )
    return value


def _validate_random_seed(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise CollaborativeValidationError("random_seed must be an integer")
    if value < 0 or value > MAX_SEED:
        raise CollaborativeValidationError(
            f"random_seed must be between 0 and {MAX_SEED}"
        )
    return value


def _matrix_format(matrix: object) -> str | None:
    get_format = getattr(matrix, "get_format", None)
    if callable(get_format):
        return str(get_format())
    fmt = getattr(matrix, "format", None)
    if isinstance(fmt, str):
        return fmt
    return None


def _validate_bundle(bundle: object) -> SparseInteractionBundle:
    if not isinstance(bundle, SparseInteractionBundle):
        raise CollaborativeValidationError(
            "bundle must be a SparseInteractionBundle"
        )

    user_ids = bundle.user_ids
    song_ids = bundle.song_ids
    if not isinstance(user_ids, tuple) or not isinstance(song_ids, tuple):
        raise CollaborativeValidationError("bundle ID indexes must be tuples")
    for raw in user_ids:
        if not isinstance(raw, str) or raw.lower() != raw:
            raise CollaborativeValidationError("invalid collaborative user id")
        _canonical_id(raw, "user")
    for raw in song_ids:
        if not isinstance(raw, str) or raw.lower() != raw:
            raise CollaborativeValidationError("invalid collaborative song id")
        _canonical_id(raw, "song")

    user_count = len(user_ids)
    song_count = len(song_ids)
    if user_count > MAX_UNIQUE_USERS:
        raise ResourceLimitError(
            f"unique_user_count exceeds limit {MAX_UNIQUE_USERS}"
        )
    if song_count > MAX_UNIQUE_SONGS:
        raise ResourceLimitError(
            f"unique_song_count exceeds limit {MAX_UNIQUE_SONGS}"
        )

    shape = (user_count, song_count)
    np, sp, _ = _load_ml_stack()

    for field in _MATRIX_FIELD_NAMES:
        matrix = getattr(bundle, field)
        if not sp.issparse(matrix):
            raise CollaborativeValidationError(
                f"bundle matrix {field} must be sparse"
            )
        if _matrix_format(matrix) != "csr":
            raise CollaborativeValidationError(
                f"bundle matrix {field} must be CSR"
            )
        if tuple(matrix.shape) != shape:
            raise CollaborativeValidationError(
                f"bundle matrix {field} shape mismatch"
            )
        if matrix.dtype != np.float32:
            raise CollaborativeValidationError(
                f"bundle matrix {field} must be float32"
            )
        data = matrix.data
        if data.size and not bool(np.isfinite(data).all()):
            raise CollaborativeValidationError(
                f"bundle matrix {field} must be finite"
            )
        if data.size and bool((data < 0.0).any()):
            raise CollaborativeValidationError(
                f"bundle matrix {field} must be non-negative"
            )

    observed = bundle.observed
    if observed.nnz and not bool((observed.data == 1.0).all()):
        raise CollaborativeValidationError(
            "bundle matrix observed must be binary"
        )

    if not isinstance(bundle.user_to_index, Mapping) or not isinstance(
        bundle.song_to_index, Mapping
    ):
        raise CollaborativeValidationError("bundle index maps must be mappings")
    if len(bundle.user_to_index) != user_count:
        raise CollaborativeValidationError("bundle user index map size mismatch")
    if len(bundle.song_to_index) != song_count:
        raise CollaborativeValidationError("bundle song index map size mismatch")
    for index, user_id in enumerate(user_ids):
        if bundle.user_to_index.get(user_id) != index:
            raise CollaborativeValidationError(
                "bundle user index map is inconsistent"
            )
    for index, song_id in enumerate(song_ids):
        if bundle.song_to_index.get(song_id) != index:
            raise CollaborativeValidationError(
                "bundle song index map is inconsistent"
            )

    summary = bundle.summary
    if summary.unique_user_count != user_count:
        raise CollaborativeValidationError(
            "bundle summary user count mismatch"
        )
    if summary.unique_song_count != song_count:
        raise CollaborativeValidationError(
            "bundle summary song count mismatch"
        )
    if summary.interaction_pair_count != int(observed.nnz):
        raise CollaborativeValidationError(
            "bundle summary interaction pair count mismatch"
        )
    if summary.matrix_shape != shape:
        raise CollaborativeValidationError(
            "bundle summary matrix shape mismatch"
        )

    return bundle


def _log1p_csr(np, matrix):
    out = matrix.copy()
    out.data = np.log1p(out.data)
    return out


def build_collaborative_training_signal(
    bundle: object,
):
    """Return the fixed-formula implicit-signal CSR ``float32`` matrix.

    Formula (initial heuristic policy, not learned weights)::

        signal = clip(
            1.00 * observed
          + 0.50 * log1p(session_count)
          + 0.25 * log1p(play_started_count)
          + 1.50 * log1p(completed_count)
          + 1.00 * log1p(replay_started_count)
          + 0.25 * log1p(listened_seconds / 60.0)
          - 0.75 * log1p(skipped_count),
            0.0, 8.0)

    ``stopped_count`` intentionally contributes nothing. Output is canonical
    CSR ``float32`` with finite values in ``[0, 8]``; the input bundle is
    never mutated. No dense user×song allocation.
    """
    validated = _validate_bundle(bundle)
    np, sp, _ = _load_ml_stack()

    observed = validated.observed.astype(np.float32, copy=True)
    signal = observed * np.float32(OBSERVED_WEIGHT)
    signal = signal + np.float32(SESSION_LOG_WEIGHT) * _log1p_csr(
        np, validated.session_count
    )
    signal = signal + np.float32(PLAY_START_LOG_WEIGHT) * _log1p_csr(
        np, validated.play_started_count
    )
    signal = signal + np.float32(COMPLETION_LOG_WEIGHT) * _log1p_csr(
        np, validated.completed_count
    )
    signal = signal + np.float32(REPLAY_LOG_WEIGHT) * _log1p_csr(
        np, validated.replay_started_count
    )

    listened_minutes = validated.listened_seconds.copy()
    listened_minutes.data = listened_minutes.data / np.float32(60.0)
    signal = signal + np.float32(LISTENED_MINUTE_LOG_WEIGHT) * _log1p_csr(
        np, listened_minutes
    )
    signal = signal - np.float32(SKIP_LOG_PENALTY) * _log1p_csr(
        np, validated.skipped_count
    )

    signal = sp.csr_matrix(signal, dtype=np.float32)
    signal.data = np.clip(signal.data, 0.0, np.float32(MAX_IMPLICIT_SIGNAL))
    signal.eliminate_zeros()
    signal.sum_duplicates()
    signal.sort_indices()
    signal.data = signal.data.astype(np.float32, copy=False)
    return signal


def train_collaborative_model(
    bundle: object,
    *,
    n_components: int = DEFAULT_LATENT_FACTORS,
    random_seed: int = DEFAULT_RANDOM_SEED,
) -> CollaborativeTrainingResult:
    """Fit deterministic truncated SVD latent factors over the signal matrix.

    Returns ``status="trained"`` with a frozen model when the bundle has at
    least ``MIN_COLLABORATIVE_USERS`` users, ``MIN_COLLABORATIVE_SONGS``
    songs, and ``MIN_COLLABORATIVE_INTERACTION_PAIRS`` non-zero signal
    entries; otherwise ``status="insufficient-data"`` with ``model=None``
    (no exception, no fabricated factors). ``effective_components`` is
    ``min(requested, user_count - 1, song_count - 1)`` so the randomized SVD
    always fits within the matrix rank bound. Same bundle and seed yield
    byte-identical factor arrays. Does not publish artifacts, query
    MongoDB, expose HTTP, or search hyperparameters.
    """
    requested = _validate_n_components(n_components)
    seed = _validate_random_seed(random_seed)
    validated = _validate_bundle(bundle)
    signal = build_collaborative_training_signal(validated)

    np, _, TruncatedSVDClass = _load_ml_stack()

    user_count = len(validated.user_ids)
    song_count = len(validated.song_ids)
    pair_count = int(validated.observed.nnz)
    signal_nnz = int(signal.nnz)

    if (
        user_count < MIN_COLLABORATIVE_USERS
        or song_count < MIN_COLLABORATIVE_SONGS
        or pair_count < MIN_COLLABORATIVE_INTERACTION_PAIRS
        or signal_nnz < 1
    ):
        summary = CollaborativeTrainingSummary(
            user_count=user_count,
            song_count=song_count,
            interaction_pair_count=pair_count,
            training_signal_nnz=signal_nnz,
            requested_components=requested,
            effective_components=0,
            random_seed=seed,
            status=STATUS_INSUFFICIENT_DATA,
            explained_variance_ratio_sum=None,
        )
        return CollaborativeTrainingResult(
            status=STATUS_INSUFFICIENT_DATA,
            model=None,
            summary=summary,
        )

    effective = min(requested, user_count - 1, song_count - 1)
    if effective < 1:
        summary = CollaborativeTrainingSummary(
            user_count=user_count,
            song_count=song_count,
            interaction_pair_count=pair_count,
            training_signal_nnz=signal_nnz,
            requested_components=requested,
            effective_components=0,
            random_seed=seed,
            status=STATUS_INSUFFICIENT_DATA,
            explained_variance_ratio_sum=None,
        )
        return CollaborativeTrainingResult(
            status=STATUS_INSUFFICIENT_DATA,
            model=None,
            summary=summary,
        )

    svd = TruncatedSVDClass(
        n_components=effective,
        algorithm=SVD_ALGORITHM,
        n_iter=SVD_N_ITER,
        random_state=seed,
    )
    user_factors = np.asarray(svd.fit_transform(signal), dtype=np.float32)
    song_factors = np.asarray(svd.components_.T, dtype=np.float32)
    singular_values = np.asarray(svd.singular_values_, dtype=np.float32)
    explained = np.asarray(svd.explained_variance_ratio_, dtype=np.float32)

    for name, array in (
        ("user_factors", user_factors),
        ("song_factors", song_factors),
        ("singular_values", singular_values),
        ("explained_variance_ratio", explained),
    ):
        if not bool(np.isfinite(array).all()):
            raise CollaborativeError(f"collaborative {name} contains non-finite values")
        array.setflags(write=False)

    explained_sum = float(explained.sum(dtype=np.float64))

    model = CollaborativeLatentModel(
        schema_version=COLLABORATIVE_MODEL_SCHEMA_VERSION,
        user_ids=tuple(validated.user_ids),
        song_ids=tuple(validated.song_ids),
        user_to_index=MappingProxyType(dict(validated.user_to_index)),
        song_to_index=MappingProxyType(dict(validated.song_to_index)),
        user_factors=user_factors,
        song_factors=song_factors,
        singular_values=singular_values,
        explained_variance_ratio=explained,
        requested_components=requested,
        effective_components=int(effective),
        random_seed=seed,
        algorithm=SVD_ALGORITHM,
        n_iter=SVD_N_ITER,
    )

    summary = CollaborativeTrainingSummary(
        user_count=user_count,
        song_count=song_count,
        interaction_pair_count=pair_count,
        training_signal_nnz=signal_nnz,
        requested_components=requested,
        effective_components=int(effective),
        random_seed=seed,
        status=STATUS_TRAINED,
        explained_variance_ratio_sum=explained_sum,
    )
    return CollaborativeTrainingResult(
        status=STATUS_TRAINED,
        model=model,
        summary=summary,
    )


def score_collaborative_candidates(
    model: object,
    user_id: object,
    candidate_song_ids: object,
) -> tuple[CollaborativeItemScore, ...]:
    """Score candidate Songs with raw user·song latent-factor dot products.

    Returns one :class:`CollaborativeItemScore` per input candidate in the
    exact input order (no sorting, no rank labels, no seen-song filtering,
    no clipping or squashing). Scores are raw factor inner products — not
    probabilities, ratings, confidences, or calibrated preferences; they may
    be negative, zero, or positive. Working data is bounded by
    ``candidate_count × effective_components`` (per-candidate dot only; no
    full user×song reconstruction). Unknown users raise
    :class:`CollaborativeUnknownUserError`; unknown candidate Songs raise
    :class:`CollaborativeUnknownSongError`.
    """
    if not isinstance(model, CollaborativeLatentModel):
        raise CollaborativeValidationError(
            "model must be a CollaborativeLatentModel"
        )
    if not isinstance(candidate_song_ids, (list, tuple)):
        raise CollaborativeValidationError(
            "candidate_song_ids must be a list or tuple"
        )
    if len(candidate_song_ids) > MAX_UNIQUE_SONGS:
        raise ResourceLimitError(
            f"unique_song_count exceeds limit {MAX_UNIQUE_SONGS}"
        )

    canonical_user = _canonical_id(user_id, "user")
    canonical_candidates: list[str] = []
    seen: set[str] = set()
    for raw_song in candidate_song_ids:
        song_id = _canonical_id(raw_song, "song")
        if song_id in seen:
            raise CollaborativeValidationError(
                "duplicate collaborative candidate song"
            )
        seen.add(song_id)
        canonical_candidates.append(song_id)

    np, _, _ = _load_ml_stack()

    if canonical_user not in model.user_to_index:
        raise CollaborativeUnknownUserError("unknown collaborative user id")
    user_index = model.user_to_index[canonical_user]
    user_row = model.user_factors[user_index]

    scores: list[CollaborativeItemScore] = []
    for song_id in canonical_candidates:
        song_index = model.song_to_index.get(song_id)
        if song_index is None:
            raise CollaborativeUnknownSongError(
                "unknown collaborative candidate song id"
            )
        song_row = model.song_factors[song_index]
        raw = float(np.dot(user_row, song_row))
        scores.append(CollaborativeItemScore(song_id=song_id, score=raw))
    return tuple(scores)
