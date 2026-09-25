import Song from '../models/Song.js';
import { createRecommendationSnapshotService } from './recommendationSnapshotService.js';

export const DEFAULT_RECOMMENDATION_API_LIMIT = 10;
export const MAX_RECOMMENDATION_API_LIMIT = 100;

export const RECOMMENDATION_SOURCE = 'personalized-snapshot';
export const RECOMMENDATION_STATUS = Object.freeze({
  READY: 'ready',
  NO_SNAPSHOT: 'no-snapshot',
});

export const PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES = Object.freeze({
  disabled: 'Personalized recommendations are currently unavailable.',
  invalidQuery: 'Invalid recommendation query',
  failed: 'failed to load personalized recommendations',
});

const SONG_SELECT =
  '_id title artist genre youtube_id file_path poster_url duration duration_seconds release_date language category recommendation_eligible';

const SONG_OUTPUT_FIELDS = Object.freeze([
  '_id', 'title', 'artist', 'genre', 'youtube_id', 'file_path', 'poster_url',
  'duration', 'duration_seconds', 'release_date', 'language', 'category',
]);

export class PersonalizedRecommendationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PersonalizedRecommendationError';
  }
}

export class PersonalizedRecommendationValidationError extends PersonalizedRecommendationError {
  constructor(message) {
    super(message);
    this.name = 'PersonalizedRecommendationValidationError';
  }
}

export class PersonalizedRecommendationReadError extends PersonalizedRecommendationError {
  constructor(message) {
    super(message);
    this.name = 'PersonalizedRecommendationReadError';
  }
}

const canonicalId = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'object' && typeof value.toHexString === 'function') {
    try {
      return String(value.toHexString()).toLowerCase();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value._id !== undefined) return canonicalId(value._id);
  return null;
};

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const isPlayable = (song) =>
  nonEmptyString(song.youtube_id) || nonEmptyString(song.file_path);

const isEligible = (song) => song.recommendation_eligible !== false;

const isAvailableSong = (song) => Boolean(song)
  && isEligible(song)
  && isPlayable(song)
  && nonEmptyString(song.title);

const projectSong = (song) => {
  const output = {};
  for (const field of SONG_OUTPUT_FIELDS) {
    if (song[field] !== undefined) output[field] = song[field];
  }
  if (output._id !== undefined) output._id = canonicalId(output._id) ?? output._id;
  return output;
};

const normalizeApiLimit = (limit) => {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    throw new PersonalizedRecommendationValidationError('invalid recommendation limit');
  }
  if (limit < 1 || limit > MAX_RECOMMENDATION_API_LIMIT) {
    throw new PersonalizedRecommendationValidationError('invalid recommendation limit');
  }
  return limit;
};

const normalizeUserId = (userId) => {
  const key = canonicalId(userId);
  if (!key || !/^[a-f0-9]{24}$/.test(key)) {
    throw new PersonalizedRecommendationValidationError('invalid recommendation user id');
  }
  return key;
};

const snapshotSongIds = (items) => {
  const ordered = [];
  const seen = new Set();
  for (const item of items) {
    const key = canonicalId(item?.song);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
};

export function createPersonalizedRecommendationService({
  recommendationSnapshotService = createRecommendationSnapshotService(),
  SongModel = Song,
} = {}) {
  if (!recommendationSnapshotService
    || typeof recommendationSnapshotService.getLatestRecommendationSnapshotForUser !== 'function') {
    throw new PersonalizedRecommendationValidationError('invalid recommendation snapshot service');
  }
  if (typeof SongModel?.find !== 'function') {
    throw new PersonalizedRecommendationValidationError('invalid recommendation song model');
  }

  const getPersonalizedRecommendations = async ({ userId, limit } = {}) => {
    const userKey = normalizeUserId(userId);
    const publicLimit = normalizeApiLimit(limit);

    let snapshot;
    try {
      snapshot = await recommendationSnapshotService.getLatestRecommendationSnapshotForUser(userKey);
    } catch (error) {
      if (error instanceof PersonalizedRecommendationError) throw error;
      throw new PersonalizedRecommendationReadError(
        PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.failed,
      );
    }

    if (!snapshot) {
      return {
        status: RECOMMENDATION_STATUS.NO_SNAPSHOT,
        source: RECOMMENDATION_SOURCE,
        items: [],
        snapshot: null,
      };
    }

    const snapshotItems = Array.isArray(snapshot.items) ? snapshot.items : [];
    const songIdKeys = snapshotSongIds(snapshotItems);

    let songDocs = [];
    if (songIdKeys.length > 0) {
      try {
        songDocs = await SongModel.find({ _id: { $in: songIdKeys } })
          .select(SONG_SELECT)
          .lean();
      } catch {
        throw new PersonalizedRecommendationReadError(
          PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.failed,
        );
      }
      if (!Array.isArray(songDocs)) {
        throw new PersonalizedRecommendationReadError(
          PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.failed,
        );
      }
    }

    const songMap = new Map();
    for (const doc of songDocs) {
      const key = canonicalId(doc?._id);
      if (key) songMap.set(key, doc);
    }

    const availableSongs = [];
    let unavailableCount = 0;
    for (const item of snapshotItems) {
      const key = canonicalId(item?.song);
      const song = key ? songMap.get(key) : null;
      if (!isAvailableSong(song)) {
        unavailableCount += 1;
        continue;
      }
      availableSongs.push(song);
    }

    const items = availableSongs
      .slice(0, publicLimit)
      .map((song, index) => ({
        rank: index + 1,
        song: projectSong(song),
      }));

    return {
      status: RECOMMENDATION_STATUS.READY,
      source: RECOMMENDATION_SOURCE,
      items,
      snapshot: {
        snapshot_version: snapshot.snapshot_version,
        generated_at: snapshot.generated_at,
        item_count: snapshotItems.length,
        available_count: availableSongs.length,
        unavailable_count: unavailableCount,
      },
    };
  };

  return { getPersonalizedRecommendations };
}

export default createPersonalizedRecommendationService;
