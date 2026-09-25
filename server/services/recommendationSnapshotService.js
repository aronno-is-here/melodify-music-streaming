import crypto from 'node:crypto';
import mongoose from 'mongoose';
import RecommendationSnapshot, {
  IDENTIFIER_PATTERN,
  MAX_IDENTIFIER_LENGTH,
  MAX_SNAPSHOT_COUNT,
  MAX_SNAPSHOT_ITEMS,
  MAX_SNAPSHOT_VERSION_LENGTH,
  OBJECT_ID_PATTERN,
  RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_ITEM_BASES,
  SNAPSHOT_ITEM_INPUT_KEYS,
  SNAPSHOT_SUMMARY_COUNT_KEYS,
  SNAPSHOT_SUMMARY_KEYS,
  SNAPSHOT_TOP_LEVEL_KEYS,
  SNAPSHOT_VERSION_PATTERN,
} from '../models/RecommendationSnapshot.js';

export class RecommendationSnapshotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecommendationSnapshotError';
  }
}

export class RecommendationSnapshotValidationError extends RecommendationSnapshotError {
  constructor(message) {
    super(message);
    this.name = 'RecommendationSnapshotValidationError';
  }
}

export class RecommendationSnapshotConflictError extends RecommendationSnapshotError {
  constructor(message) {
    super(message);
    this.name = 'RecommendationSnapshotConflictError';
  }
}

export class RecommendationSnapshotPersistenceError extends RecommendationSnapshotError {
  constructor(message) {
    super(message);
    this.name = 'RecommendationSnapshotPersistenceError';
  }
}

export class RecommendationSnapshotImmutableError extends RecommendationSnapshotError {
  constructor(message) {
    super(message);
    this.name = 'RecommendationSnapshotImmutableError';
  }
}

const isPlainObjectLike = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isSnapshotCount = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_SNAPSHOT_COUNT;

const isRequestedLimit = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_SNAPSHOT_ITEMS;

const isSnapshotScore = (value) =>
  value === null ||
  (typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1);

const isSafeIdentifier = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= MAX_IDENTIFIER_LENGTH &&
  IDENTIFIER_PATTERN.test(value);

const rejectUnknownKeys = (value, allowedKeys, message) => {
  if (!isPlainObjectLike(value)) {
    throw new RecommendationSnapshotValidationError(message);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new RecommendationSnapshotValidationError(message);
    }
  }
};

export const normalizeSnapshotUserId = (value) => {
  if (typeof value !== 'string') {
    throw new RecommendationSnapshotValidationError('invalid snapshot user id');
  }
  if (value.length !== 24) {
    throw new RecommendationSnapshotValidationError('invalid snapshot user id');
  }
  if (value !== value.toLowerCase()) {
    if (!/^[A-F0-9]{24}$/.test(value)) {
      throw new RecommendationSnapshotValidationError('invalid snapshot user id');
    }
    return value.toLowerCase();
  }
  if (!OBJECT_ID_PATTERN.test(value)) {
    throw new RecommendationSnapshotValidationError('invalid snapshot user id');
  }
  return value;
};

export const normalizeSnapshotSongId = (value) => {
  if (typeof value !== 'string') {
    throw new RecommendationSnapshotValidationError('invalid snapshot song id');
  }
  if (value.length !== 24) {
    throw new RecommendationSnapshotValidationError('invalid snapshot song id');
  }
  if (value !== value.toLowerCase()) {
    if (!/^[A-F0-9]{24}$/.test(value)) {
      throw new RecommendationSnapshotValidationError('invalid snapshot song id');
    }
    return value.toLowerCase();
  }
  if (!OBJECT_ID_PATTERN.test(value)) {
    throw new RecommendationSnapshotValidationError('invalid snapshot song id');
  }
  return value;
};

export const normalizeSnapshotVersion = (value) => {
  if (typeof value !== 'string') {
    throw new RecommendationSnapshotValidationError('invalid snapshot version');
  }
  if (value.length < 1 || value.length > MAX_SNAPSHOT_VERSION_LENGTH) {
    throw new RecommendationSnapshotValidationError('invalid snapshot version');
  }
  if (value !== value.trim()) {
    throw new RecommendationSnapshotValidationError('invalid snapshot version');
  }
  if (value === '.' || value === '..') {
    throw new RecommendationSnapshotValidationError('invalid snapshot version');
  }
  if (!SNAPSHOT_VERSION_PATTERN.test(value)) {
    throw new RecommendationSnapshotValidationError('invalid snapshot version');
  }
  return value;
};

const normalizeArtifactVersion = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isSafeIdentifier(value)) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot artifact version',
    );
  }
  return value;
};

const ISO_WITH_EXPLICIT_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const normalizeGeneratedAt = (value) => {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) {
      throw new RecommendationSnapshotValidationError(
        'invalid snapshot timestamp',
      );
    }
    return new Date(time);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!ISO_WITH_EXPLICIT_ZONE.test(text)) {
      throw new RecommendationSnapshotValidationError(
        'invalid snapshot timestamp',
      );
    }
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      throw new RecommendationSnapshotValidationError(
        'invalid snapshot timestamp',
      );
    }
    return parsed;
  }
  throw new RecommendationSnapshotValidationError(
    'invalid snapshot timestamp',
  );
};

const scoreOrMissing = (item, key) => {
  if (!Object.prototype.hasOwnProperty.call(item, key)) {
    return null;
  }
  const value = item[key];
  if (value === undefined) {
    return null;
  }
  return value;
};

const normalizeItem = (item, index) => {
  if (!isPlainObjectLike(item)) {
    throw new RecommendationSnapshotValidationError('invalid snapshot items');
  }
  rejectUnknownKeys(
    item,
    SNAPSHOT_ITEM_INPUT_KEYS,
    'invalid snapshot items',
  );

  const requiredKeys = ['rank', 'song_id', 'basis', 'collaborative_known'];
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) {
      throw new RecommendationSnapshotValidationError('invalid snapshot items');
    }
  }

  const rank = item.rank;
  if (
    typeof rank !== 'number' ||
    !Number.isInteger(rank) ||
    rank !== index + 1 ||
    rank < 1 ||
    rank > MAX_SNAPSHOT_ITEMS
  ) {
    throw new RecommendationSnapshotValidationError('invalid snapshot items');
  }

  const songId = normalizeSnapshotSongId(item.song_id);

  if (
    typeof item.basis !== 'string' ||
    !SNAPSHOT_ITEM_BASES.includes(item.basis)
  ) {
    throw new RecommendationSnapshotValidationError('invalid snapshot items');
  }

  const policyScore = scoreOrMissing(item, 'policy_score');
  const hybridScore = scoreOrMissing(item, 'hybrid_score');
  const profileScore = scoreOrMissing(item, 'profile_score');

  for (const score of [policyScore, hybridScore, profileScore]) {
    if (!isSnapshotScore(score)) {
      throw new RecommendationSnapshotValidationError('invalid snapshot items');
    }
  }

  if (typeof item.collaborative_known !== 'boolean') {
    throw new RecommendationSnapshotValidationError('invalid snapshot items');
  }

  if (hybridScore !== null && item.collaborative_known !== true) {
    throw new RecommendationSnapshotValidationError('invalid snapshot items');
  }

  if (item.basis === 'hybrid') {
    if (
      policyScore === null ||
      hybridScore === null ||
      profileScore !== null ||
      item.collaborative_known !== true
    ) {
      throw new RecommendationSnapshotValidationError('invalid snapshot items');
    }
  } else if (item.basis === 'hybrid-profile') {
    if (
      policyScore === null ||
      hybridScore === null ||
      profileScore === null ||
      item.collaborative_known !== true
    ) {
      throw new RecommendationSnapshotValidationError('invalid snapshot items');
    }
  } else if (item.basis === 'profile') {
    if (
      policyScore === null ||
      hybridScore !== null ||
      profileScore === null
    ) {
      throw new RecommendationSnapshotValidationError('invalid snapshot items');
    }
  } else if (item.basis === 'exploration') {
    if (policyScore !== null) {
      throw new RecommendationSnapshotValidationError('invalid snapshot items');
    }
  }

  return {
    rank,
    song_id: songId,
    basis: item.basis,
    policy_score: policyScore,
    hybrid_score: hybridScore,
    profile_score: profileScore,
    collaborative_known: item.collaborative_known,
  };
};

const normalizeItems = (value) => {
  if (!Array.isArray(value)) {
    throw new RecommendationSnapshotValidationError('invalid snapshot items');
  }
  if (value.length > MAX_SNAPSHOT_ITEMS) {
    throw new RecommendationSnapshotValidationError('invalid snapshot items');
  }

  const seenSongs = new Set();
  const normalized = [];
  let explorationCount = 0;

  for (let index = 0; index < value.length; index += 1) {
    const item = normalizeItem(value[index], index);
    if (seenSongs.has(item.song_id)) {
      throw new RecommendationSnapshotValidationError('duplicate snapshot item');
    }
    seenSongs.add(item.song_id);
    if (item.basis === 'exploration') {
      explorationCount += 1;
    }
    normalized.push(item);
  }

  return { items: normalized, explorationCount };
};

const normalizeSummary = (value, itemCount, explorationCount) => {
  rejectUnknownKeys(value, SNAPSHOT_SUMMARY_KEYS, 'invalid snapshot summary');

  const normalized = {};
  for (const key of SNAPSHOT_SUMMARY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new RecommendationSnapshotValidationError(
        'invalid snapshot summary',
      );
    }
  }

  for (const key of SNAPSHOT_SUMMARY_COUNT_KEYS) {
    const count = value[key];
    if (!isSnapshotCount(count)) {
      throw new RecommendationSnapshotValidationError(
        'invalid snapshot summary',
      );
    }
    normalized[key] = count;
  }

  if (!isRequestedLimit(value.requested_limit)) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  normalized.requested_limit = value.requested_limit;

  if (typeof value.collaborative_known_user !== 'boolean') {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (typeof value.profile_available !== 'boolean') {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  normalized.collaborative_known_user = value.collaborative_known_user;
  normalized.profile_available = value.profile_available;

  if (
    normalized.profile_source_excluded_count +
      normalized.seen_excluded_count +
      normalized.eligible_candidate_count !==
    normalized.input_candidate_count
  ) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (
    normalized.collaborative_known_candidate_count +
      normalized.cold_start_song_candidate_count !==
    normalized.eligible_candidate_count
  ) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (
    normalized.exploitation_selected_count +
      normalized.exploration_selected_count !==
    normalized.returned_count
  ) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (normalized.returned_count !== itemCount) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (normalized.returned_count > normalized.requested_limit) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (
    normalized.profile_available !==
    normalized.profile_feature_count > 0
  ) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (
    normalized.collaborative_known_user === false &&
    normalized.seen_excluded_count !== 0
  ) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (normalized.exploration_selected_count !== explorationCount) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }
  if (
    normalized.exploitation_selected_count !==
    itemCount - explorationCount
  ) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot summary',
    );
  }

  return normalized;
};

const orderedSummary = (summary) => {
  const ordered = {};
  for (const key of SNAPSHOT_SUMMARY_KEYS) {
    ordered[key] = summary[key];
  }
  return ordered;
};

const generatedAtIso = (value) => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RecommendationSnapshotValidationError(
      'invalid snapshot timestamp',
    );
  }
  return parsed.toISOString();
};

export const normalizeRecommendationSnapshotPayload = (payload) => {
  if (!isPlainObjectLike(payload)) {
    throw new RecommendationSnapshotValidationError(
      'invalid recommendation snapshot',
    );
  }
  rejectUnknownKeys(
    payload,
    SNAPSHOT_TOP_LEVEL_KEYS,
    'invalid recommendation snapshot',
  );

  if (payload.schema_version !== undefined) {
    if (payload.schema_version !== RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION) {
      throw new RecommendationSnapshotValidationError(
        'unsupported snapshot schema version',
      );
    }
  }

  if (
    payload.user_id === undefined ||
    payload.snapshot_version === undefined ||
    payload.generated_at === undefined ||
    payload.items === undefined ||
    payload.summary === undefined
  ) {
    throw new RecommendationSnapshotValidationError(
      'invalid recommendation snapshot',
    );
  }

  const { items, explorationCount } = normalizeItems(payload.items);
  const summary = normalizeSummary(
    payload.summary,
    items.length,
    explorationCount,
  );

  return {
    schema_version: RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION,
    user_id: normalizeSnapshotUserId(payload.user_id),
    snapshot_version: normalizeSnapshotVersion(payload.snapshot_version),
    artifact_version: normalizeArtifactVersion(payload.artifact_version),
    generated_at: normalizeGeneratedAt(payload.generated_at),
    items,
    summary,
  };
};

export const computeRecommendationSnapshotPayloadSha256 = (normalized) => {
  if (!isPlainObjectLike(normalized)) {
    throw new RecommendationSnapshotValidationError(
      'invalid recommendation snapshot',
    );
  }
  const canonical = {
    schema_version: RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION,
    user_id: normalized.user_id,
    snapshot_version: normalized.snapshot_version,
    artifact_version:
      normalized.artifact_version === undefined
        ? null
        : normalized.artifact_version,
    generated_at: generatedAtIso(normalized.generated_at),
    items: normalized.items.map((item) => ({
      rank: item.rank,
      song_id: item.song_id,
      basis: item.basis,
      policy_score: item.policy_score,
      hybrid_score: item.hybrid_score,
      profile_score: item.profile_score,
      collaborative_known: item.collaborative_known,
    })),
    summary: orderedSummary(normalized.summary),
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');
};

const isDuplicateKeyError = (error) => {
  if (!error) return false;
  return error.code === 11000 || error.code === 'E11000';
};

const toPlainSnapshot = (snapshot) => {
  if (snapshot == null) return snapshot;
  if (typeof snapshot.toObject === 'function') return snapshot.toObject();
  return snapshot;
};

export const createRecommendationSnapshotService = ({
  RecommendationSnapshotModel = RecommendationSnapshot,
} = {}) => {
  const recordRecommendationSnapshot = async (payload) => {
    const normalized = normalizeRecommendationSnapshotPayload(payload);
    const payload_sha256 = computeRecommendationSnapshotPayloadSha256(normalized);

    const document = {
      schema_version: normalized.schema_version,
      user: new mongoose.Types.ObjectId(normalized.user_id),
      snapshot_version: normalized.snapshot_version,
      artifact_version: normalized.artifact_version,
      generated_at: normalized.generated_at,
      items: normalized.items.map((item) => ({
        rank: item.rank,
        song: new mongoose.Types.ObjectId(item.song_id),
        basis: item.basis,
        policy_score: item.policy_score,
        hybrid_score: item.hybrid_score,
        profile_score: item.profile_score,
        collaborative_known: item.collaborative_known,
      })),
      summary: orderedSummary(normalized.summary),
      payload_sha256,
    };

    try {
      const created = await RecommendationSnapshotModel.create(document);
      return { created: true, snapshot: toPlainSnapshot(created) };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw new RecommendationSnapshotPersistenceError(
          'failed to persist recommendation snapshot',
        );
      }

      let existing = null;
      try {
        existing = await RecommendationSnapshotModel.findOne({
          user: document.user,
          snapshot_version: normalized.snapshot_version,
        });
      } catch {
        throw new RecommendationSnapshotPersistenceError(
          'failed to persist recommendation snapshot',
        );
      }

      if (!existing) {
        throw new RecommendationSnapshotPersistenceError(
          'failed to persist recommendation snapshot',
        );
      }

      const existingHash =
        typeof existing.payload_sha256 === 'string'
          ? existing.payload_sha256
          : existing.get?.('payload_sha256');
      if (existingHash !== payload_sha256) {
        throw new RecommendationSnapshotConflictError(
          'recommendation snapshot already exists with different content',
        );
      }
      return { created: false, snapshot: toPlainSnapshot(existing) };
    }
  };

  const getLatestRecommendationSnapshotForUser = async (userId) => {
    const normalizedUserId = normalizeSnapshotUserId(userId);
    try {
      const snapshot = await RecommendationSnapshotModel.findOne({
        user: new mongoose.Types.ObjectId(normalizedUserId),
      })
        .sort({ generated_at: -1, _id: -1 })
        .lean();
      return snapshot ?? null;
    } catch (error) {
      if (error instanceof RecommendationSnapshotError) throw error;
      throw new RecommendationSnapshotPersistenceError(
        'failed to persist recommendation snapshot',
      );
    }
  };

  const getRecommendationSnapshotByVersion = async (
    userId,
    snapshotVersion,
  ) => {
    const normalizedUserId = normalizeSnapshotUserId(userId);
    const normalizedVersion = normalizeSnapshotVersion(snapshotVersion);
    try {
      const snapshot = await RecommendationSnapshotModel.findOne({
        user: new mongoose.Types.ObjectId(normalizedUserId),
        snapshot_version: normalizedVersion,
      }).lean();
      return snapshot ?? null;
    } catch (error) {
      if (error instanceof RecommendationSnapshotError) throw error;
      throw new RecommendationSnapshotPersistenceError(
        'failed to persist recommendation snapshot',
      );
    }
  };

  return {
    recordRecommendationSnapshot,
    getLatestRecommendationSnapshotForUser,
    getRecommendationSnapshotByVersion,
  };
};

export default createRecommendationSnapshotService;
