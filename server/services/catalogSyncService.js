import { normalizeYouTubeMusicCandidates } from './youtubeMusicNormalizer.js';
import {
  DEFAULT_SEARCH_MAX_RESULTS,
  MAX_QUERY_LENGTH,
} from './youtubeCatalogClient.js';
import { CATALOG_SYNC_MAX_RESULTS_LIMIT } from '../utils/catalogSyncRequest.js';

export const CATALOG_SYNC_DISABLED_ERROR = 'Catalog synchronization is disabled';
export const CATALOG_SYNC_UPSTREAM_ERROR = 'Catalog synchronization failed';

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const catalogSyncError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const extractSearchVideoIds = (searchResponse) => {
  if (!isPlainObjectLike(searchResponse) || !Array.isArray(searchResponse.items)) {
    throw catalogSyncError('CATALOG_SYNC_UPSTREAM', CATALOG_SYNC_UPSTREAM_ERROR);
  }
  const ids = [];
  const seen = new Set();
  for (const item of searchResponse.items) {
    if (!isPlainObjectLike(item) || !isPlainObjectLike(item.id)) continue;
    const videoId = item.id.videoId;
    if (typeof videoId !== 'string') continue;
    const trimmed = videoId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return ids;
};

const emptySummary = (query, requested) => ({
  query,
  requested,
  searched: 0,
  normalized: 0,
  inserted: 0,
  updated: 0,
  adoptedLegacy: 0,
  skipped: 0,
  conflicts: 0,
  failed: 0,
  results: [],
});

const sanitizeUpstreamError = (error) => {
  if (error && error.code === 'CATALOG_SYNC_DISABLED') return error;
  return catalogSyncError('CATALOG_SYNC_UPSTREAM', CATALOG_SYNC_UPSTREAM_ERROR);
};

export const createCatalogSyncService = ({
  youtubeClient,
  normalizer = { normalizeYouTubeMusicCandidates },
  catalogUpsertService,
  catalogSyncEnabled = true,
} = {}) => {
  if (
    !youtubeClient
    || typeof youtubeClient.searchMusicVideos !== 'function'
    || typeof youtubeClient.getVideoDetails !== 'function'
  ) {
    throw new Error('Catalog sync service requires a YouTube client with searchMusicVideos and getVideoDetails');
  }
  if (!normalizer || typeof normalizer.normalizeYouTubeMusicCandidates !== 'function') {
    throw new Error('Catalog sync service requires a normalizer with normalizeYouTubeMusicCandidates');
  }
  if (!catalogUpsertService || typeof catalogUpsertService.upsertYouTubeCandidate !== 'function') {
    throw new Error('Catalog sync service requires an upsert service with upsertYouTubeCandidate');
  }

  const syncCatalogSearch = async ({ query, genre, language, maxResults } = {}) => {
    if (catalogSyncEnabled !== true) {
      throw catalogSyncError('CATALOG_SYNC_DISABLED', CATALOG_SYNC_DISABLED_ERROR);
    }
    if (typeof query !== 'string' || !query.trim() || query.trim().length > MAX_QUERY_LENGTH) {
      throw catalogSyncError('CATALOG_SYNC_INVALID', 'Invalid catalog sync query');
    }
    const trimmedQuery = query.trim();
    const limit = Number.isInteger(maxResults)
      && maxResults >= 1
      && maxResults <= CATALOG_SYNC_MAX_RESULTS_LIMIT
      ? maxResults
      : DEFAULT_SEARCH_MAX_RESULTS;

    let searchResponse;
    try {
      searchResponse = await youtubeClient.searchMusicVideos({
        query: trimmedQuery,
        maxResults: limit,
      });
    } catch (error) {
      throw sanitizeUpstreamError(error);
    }

    let videoIds;
    try {
      videoIds = extractSearchVideoIds(searchResponse);
    } catch (error) {
      throw sanitizeUpstreamError(error);
    }

    if (videoIds.length === 0) {
      return emptySummary(trimmedQuery, limit);
    }

    let detailsResponse;
    try {
      detailsResponse = await youtubeClient.getVideoDetails(videoIds);
    } catch (error) {
      throw sanitizeUpstreamError(error);
    }

    let candidates;
    try {
      candidates = normalizer.normalizeYouTubeMusicCandidates(searchResponse, detailsResponse);
      if (!Array.isArray(candidates)) {
        throw catalogSyncError('CATALOG_SYNC_UPSTREAM', CATALOG_SYNC_UPSTREAM_ERROR);
      }
    } catch (error) {
      throw sanitizeUpstreamError(error);
    }

    const boundedCandidates = candidates.slice(0, limit);
    const upsertContext = {};
    if (genre !== undefined && genre !== null) {
      upsertContext.genre = genre;
    }
    if (language !== undefined && language !== null) {
      upsertContext.language = language;
    }

    const summary = {
      query: trimmedQuery,
      requested: limit,
      searched: videoIds.length,
      normalized: boundedCandidates.length,
      inserted: 0,
      updated: 0,
      adoptedLegacy: 0,
      skipped: 0,
      conflicts: 0,
      failed: 0,
      results: [],
    };

    for (const candidate of boundedCandidates) {
      let result;
      try {
        result = await catalogUpsertService.upsertYouTubeCandidate(candidate, upsertContext);
      } catch {
        result = { status: 'skipped', reason: 'persistence-failed', song: null };
      }
      if (!isPlainObjectLike(result) || typeof result.status !== 'string') {
        result = { status: 'skipped', reason: 'persistence-failed', song: null };
      }

      if (result.status === 'inserted') {
        summary.inserted += 1;
      } else if (result.status === 'updated') {
        summary.updated += 1;
      } else if (result.status === 'adopted-legacy') {
        summary.adoptedLegacy += 1;
      } else if (result.status === 'conflict') {
        summary.conflicts += 1;
      } else if (result.status === 'skipped' && result.reason === 'persistence-failed') {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }

      const song = isPlainObjectLike(result.song) ? result.song : null;
      summary.results.push({
        videoId: typeof candidate.youtube_id === 'string' ? candidate.youtube_id : null,
        songId: song && song._id !== undefined && song._id !== null ? String(song._id) : null,
        status: result.status,
        reason: typeof result.reason === 'string' ? result.reason : null,
      });
    }

    return summary;
  };

  return Object.freeze({ syncCatalogSearch });
};
