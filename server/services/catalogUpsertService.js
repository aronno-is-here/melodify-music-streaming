import Song from '../models/Song.js';
import { normalizeSourceProvider, normalizeExternalId } from '../utils/catalogIdentity.js';
import { formatDurationSeconds } from './youtubeMusicNormalizer.js';

export const YOUTUBE_CATALOG_PROVIDER = normalizeSourceProvider('youtube');
export const UNKNOWN_GENRE_SENTINEL = 'Unknown';

export const UPSERT_STATUSES = Object.freeze([
  'inserted',
  'updated',
  'adopted-legacy',
  'skipped',
  'conflict',
]);

export const UPSERT_REASONS = Object.freeze([
  'ineligible',
  'invalid-identity',
  'missing-artist',
  'ambiguous-legacy-match',
  'conflicting-legacy-identity',
  'persistence-failed',
]);

export const UPSERT_CONTEXT_FIELDS = Object.freeze(['genre', 'language']);

const MAX_GENRE_CONTEXT_LENGTH = 128;
const MAX_LANGUAGE_CONTEXT_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;
const MAX_ARTIST_LENGTH = 200;

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeContextString = (value, maxLength) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
};

const normalizeArtistValue = (value) => {
  const normalized = normalizeContextString(value, MAX_ARTIST_LENGTH);
  if (normalized === null) return null;
  return normalized.toLowerCase().replace(/\s+/g, ' ');
};

const isDuplicateKeyError = (error) => {
  if (!error) return false;
  if (error.code === 11000 || error.code === 'E11000') return true;
  if (typeof error.message === 'string') {
    return error.message.includes('E11000') || /duplicate key/i.test(error.message);
  }
  return false;
};

const skippedResult = (reason) => ({ status: 'skipped', reason, song: null });
const conflictResult = (reason) => ({ status: 'conflict', reason, song: null });
const persistenceFailure = () => skippedResult('persistence-failed');

export const createCatalogUpsertService = ({ SongModel = Song, now = () => new Date() } = {}) => {
  if (
    !SongModel
    || typeof SongModel.findOne !== 'function'
    || typeof SongModel.find !== 'function'
    || typeof SongModel.findOneAndUpdate !== 'function'
  ) {
    throw new Error('Catalog upsert service requires a Song model with findOne, find, and findOneAndUpdate');
  }

  let refreshedAt;
  const getTimestamp = () => {
    if (refreshedAt === undefined) {
      refreshedAt = now();
    }
    return refreshedAt;
  };

  const buildRefreshSet = (provider, externalId, youtubeId, candidate, contextGenre, contextLanguage, displayDuration, durationSeconds) => {
    const $set = {
      youtube_id: youtubeId,
      source_provider: provider,
      external_id: externalId,
      metadata_refreshed_at: getTimestamp(),
    };
    if (typeof candidate.poster_url === 'string' && candidate.poster_url) {
      $set.poster_url = candidate.poster_url;
    }
    if (typeof displayDuration === 'string' && displayDuration) {
      $set.duration = displayDuration;
    }
    if (Number.isSafeInteger(durationSeconds) && durationSeconds > 0) {
      $set.duration_seconds = durationSeconds;
    }
    if (typeof candidate.category === 'string' && candidate.category) {
      $set.category = candidate.category;
    }
    if (typeof candidate.recommendation_eligible === 'boolean') {
      $set.recommendation_eligible = candidate.recommendation_eligible;
    }
    if (contextLanguage !== null) {
      $set.language = contextLanguage;
    }
    return $set;
  };

  const upsertYouTubeCandidate = async (candidate, context = {}) => {
    if (!isPlainObjectLike(candidate)) {
      return skippedResult('invalid-identity');
    }

    const provider = normalizeSourceProvider(candidate.source_provider);
    const externalId = normalizeExternalId(candidate.external_id);
    const youtubeId = normalizeExternalId(candidate.youtube_id);
    if (
      provider !== YOUTUBE_CATALOG_PROVIDER
      || externalId === null
      || youtubeId === null
      || externalId !== youtubeId
    ) {
      return skippedResult('invalid-identity');
    }

    if (candidate.catalog_eligible !== true) {
      return skippedResult('ineligible');
    }

    const title = normalizeContextString(candidate.title, MAX_TITLE_LENGTH);
    const durationSeconds = candidate.duration_seconds;
    if (title === null || !Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
      return skippedResult('ineligible');
    }

    const artist = normalizeContextString(candidate.artist_candidate, MAX_ARTIST_LENGTH);
    if (artist === null) {
      return skippedResult('missing-artist');
    }

    const safeContext = isPlainObjectLike(context) ? context : {};
    const contextGenre = normalizeContextString(safeContext.genre, MAX_GENRE_CONTEXT_LENGTH);
    const contextLanguage = normalizeContextString(safeContext.language, MAX_LANGUAGE_CONTEXT_LENGTH);
    const displayDuration = typeof candidate.duration === 'string' && candidate.duration
      ? candidate.duration
      : formatDurationSeconds(durationSeconds);

    let existing = null;
    try {
      existing = await SongModel.findOne({ source_provider: provider, external_id: externalId });
    } catch {
      return persistenceFailure();
    }

    if (existing) {
      const $set = buildRefreshSet(provider, externalId, youtubeId, candidate, contextGenre, contextLanguage, displayDuration, durationSeconds);
      try {
        const updated = await SongModel.findOneAndUpdate(
          { _id: existing._id },
          { $set },
          { new: true, runValidators: true },
        );
        if (!updated) {
          return persistenceFailure();
        }
        return { status: 'updated', reason: null, song: updated };
      } catch {
        return persistenceFailure();
      }
    }

    let legacyMatches = [];
    try {
      legacyMatches = await SongModel.find({ youtube_id: youtubeId });
    } catch {
      return persistenceFailure();
    }

    if (legacyMatches.length > 1) {
      return conflictResult('ambiguous-legacy-match');
    }

    if (legacyMatches.length === 1) {
      const legacyDoc = legacyMatches[0];
      const legacyProvider = normalizeSourceProvider(legacyDoc.source_provider);
      const legacyExternalId = normalizeExternalId(legacyDoc.external_id);
      if (legacyProvider !== null || legacyExternalId !== null) {
        return conflictResult('conflicting-legacy-identity');
      }

      const $set = buildRefreshSet(provider, externalId, youtubeId, candidate, contextGenre, contextLanguage, displayDuration, durationSeconds);
      $set.metadata_provenance = {
        source: provider,
        reference: externalId,
        imported_at: getTimestamp(),
      };
      try {
        const adopted = await SongModel.findOneAndUpdate(
          { _id: legacyDoc._id },
          { $set },
          { new: true, runValidators: true },
        );
        if (!adopted) {
          return persistenceFailure();
        }
        return { status: 'adopted-legacy', reason: null, song: adopted };
      } catch {
        return persistenceFailure();
      }
    }

    const insertFields = {
      title,
      artist,
      genre: contextGenre ?? UNKNOWN_GENRE_SENTINEL,
      youtube_id: youtubeId,
      duration: displayDuration,
      duration_seconds: durationSeconds,
      source_provider: provider,
      external_id: externalId,
      recommendation_eligible: typeof candidate.recommendation_eligible === 'boolean'
        ? candidate.recommendation_eligible
        : true,
      normalized_artist: normalizeArtistValue(artist),
      metadata_provenance: {
        source: provider,
        reference: externalId,
        imported_at: getTimestamp(),
      },
      metadata_refreshed_at: getTimestamp(),
    };
    if (typeof candidate.poster_url === 'string' && candidate.poster_url) {
      insertFields.poster_url = candidate.poster_url;
    }
    if (typeof candidate.category === 'string' && candidate.category) {
      insertFields.category = candidate.category;
    }
    if (contextLanguage !== null) {
      insertFields.language = contextLanguage;
    }
    if (contextGenre !== null) {
      insertFields.normalized_genre = normalizeArtistValue(contextGenre);
    }

    try {
      const outcome = await SongModel.findOneAndUpdate(
        { source_provider: provider, external_id: externalId },
        { $setOnInsert: insertFields },
        { upsert: true, new: true, runValidators: true, rawResult: true },
      );
      const doc = isPlainObjectLike(outcome) && Object.hasOwn(outcome, 'value')
        ? outcome.value
        : outcome;
      if (!doc) {
        return persistenceFailure();
      }
      const updatedExisting = Boolean(
        isPlainObjectLike(outcome)
        && isPlainObjectLike(outcome.lastErrorObject)
        && outcome.lastErrorObject.updatedExisting === true,
      );
      return { status: updatedExisting ? 'updated' : 'inserted', reason: null, song: doc };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        return persistenceFailure();
      }
      let recovered = null;
      try {
        recovered = await SongModel.findOne({ source_provider: provider, external_id: externalId });
      } catch {
        recovered = null;
      }
      if (recovered) {
        return { status: 'updated', reason: null, song: recovered };
      }
      return persistenceFailure();
    }
  };

  return Object.freeze({ upsertYouTubeCandidate });
};
