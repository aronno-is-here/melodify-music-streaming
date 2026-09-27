import {
  createYouTubeCatalogClient,
  DEFAULT_SEARCH_MAX_RESULTS,
  MAX_SEARCH_MAX_RESULTS,
} from './youtubeCatalogClient.js';
import {
  normalizeYouTubeMusicCandidates,
  normalizeYouTubeVideoCandidate,
} from './youtubeMusicNormalizer.js';
import {
  inferLanguageFromRegion,
  normalizeRegionTag,
} from './regionalCatalog.js';
import {
  CATALOG_NON_MUSIC,
  classifyNonMusic,
  isVersionSensitiveTitle,
  resolveCatalogTrack,
} from '../utils/catalogMetadata.js';

export const CATALOG_PROVIDER = Object.freeze({
  YOUTUBE: 'youtube',
});

export const CATALOG_SEARCH_DEFAULT_LIMIT = 20;
export const CATALOG_SEARCH_MAX_LIMIT = 40;
export const YOUTUBE_TRACK_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeLimit = (value) => {
  if (!Number.isInteger(value) || value < 1 || value > CATALOG_SEARCH_MAX_LIMIT) {
    return CATALOG_SEARCH_DEFAULT_LIMIT;
  }
  return value;
};

export function isValidYouTubeTrackId(value) {
  if (typeof value !== 'string') return false;
  return YOUTUBE_TRACK_ID_PATTERN.test(value.trim());
}

function toSongSearchResult(candidate, { regionTag = null } = {}) {
  if (!isPlainObjectLike(candidate)) return null;
  if (!isValidYouTubeTrackId(candidate.youtube_id)) return null;
  if (typeof candidate.title !== 'string' || !candidate.title.trim()) return null;

  const rawTitle = candidate.title.trim();
  const channelTitle = typeof candidate.channel_title === 'string' ? candidate.channel_title : '';
  const legacyArtist = typeof candidate.artist_candidate === 'string' && candidate.artist_candidate.trim()
    ? candidate.artist_candidate.trim()
    : null;
  const legacyConfidence = candidate.artist_candidate_source === 'topic-channel' ? 'high' : 'uncertain';

  const resolved = isVersionSensitiveTitle(rawTitle)
    ? { title: rawTitle, artist: legacyArtist, artistConfidence: legacyConfidence }
    : resolveCatalogTrack({
      title: rawTitle,
      channelTitle,
      artistCandidate: candidate.artist_candidate,
      artistCandidateSource: candidate.artist_candidate_source,
    });

  if (!resolved.title) return null;

  const nonMusic = classifyNonMusic({
    title: resolved.title,
    artist: resolved.artist,
    durationSeconds: candidate.duration_seconds,
    category: candidate.category,
  });
  if (nonMusic.classification === CATALOG_NON_MUSIC.NON_MUSIC) return null;

  const title = resolved.title;
  const artist = resolved.artist;
  const sourceUrl = `https://www.youtube.com/watch?v=${candidate.youtube_id}`;

  return {
    id: `${CATALOG_PROVIDER.YOUTUBE}:${candidate.youtube_id}`,
    provider: CATALOG_PROVIDER.YOUTUBE,
    providerTrackId: candidate.youtube_id,
    title,
    artist,
    artistConfidence: resolved.artistConfidence,
    youtube_id: candidate.youtube_id,
    thumbnail: typeof candidate.poster_url === 'string' ? candidate.poster_url : null,
    duration: typeof candidate.duration === 'string' ? candidate.duration : null,
    durationSeconds: Number.isFinite(candidate.duration_seconds) ? candidate.duration_seconds : null,
    album: null,
    language: inferLanguageFromRegion(regionTag),
    regionTag,
    sourceUrl,
    sourceReference: sourceUrl,
    sourceChannel: channelTitle || null,
    sourceChannelId: typeof candidate.channel_id === 'string' ? candidate.channel_id : null,
    catalogEligible: candidate.catalog_eligible === true,
  };
}

export function createYouTubeCatalogProvider({ youtubeClient = createYouTubeCatalogClient() } = {}) {
  if (
    !youtubeClient
    || typeof youtubeClient.searchMusicVideos !== 'function'
    || typeof youtubeClient.getVideoDetails !== 'function'
  ) {
    throw new Error('YouTube catalog provider requires a YouTube client');
  }

  const search = async (query, options = {}) => {
    if (typeof query !== 'string' || !query.trim()) {
      return [];
    }
    const regionTag = normalizeRegionTag(options.regionTag);
    const limit = normalizeLimit(options.limit);
    const apiLimit = Math.min(limit, MAX_SEARCH_MAX_RESULTS, DEFAULT_SEARCH_MAX_RESULTS + 15);
    const requestQuery = query.trim();

    const searchResponse = await youtubeClient.searchMusicVideos({
      query: requestQuery,
      maxResults: apiLimit,
    });
    const ids = Array.isArray(searchResponse?.items)
      ? searchResponse.items
        .map((item) => item?.id?.videoId)
        .filter((id) => isValidYouTubeTrackId(id))
      : [];

    if (ids.length === 0) return [];

    const detailsResponse = await youtubeClient.getVideoDetails([...new Set(ids)].slice(0, apiLimit));
    const candidates = normalizeYouTubeMusicCandidates(searchResponse, detailsResponse);
    const results = [];
    for (const candidate of candidates) {
      const normalized = toSongSearchResult(candidate, { regionTag });
      if (normalized) {
        results.push(normalized);
      }
      if (results.length >= limit) break;
    }
    return results;
  };

  const getTrack = async (providerTrackId, options = {}) => {
    if (!isValidYouTubeTrackId(providerTrackId)) {
      throw new Error('invalid provider track id');
    }
    const regionTag = normalizeRegionTag(options.regionTag);
    const detailsResponse = await youtubeClient.getVideoDetails([providerTrackId.trim()]);
    const details = Array.isArray(detailsResponse?.items) ? detailsResponse.items[0] : null;
    const candidate = normalizeYouTubeVideoCandidate(details);
    const result = toSongSearchResult(candidate, { regionTag });
    if (!result) {
      throw new Error('provider track unavailable');
    }
    return result;
  };

  const normalize = (track, options = {}) => toSongSearchResult(track, options);

  return Object.freeze({
    provider: CATALOG_PROVIDER.YOUTUBE,
    search,
    getTrack,
    normalize,
  });
}

export function createCatalogProviderRegistry({ youtubeProvider = createYouTubeCatalogProvider() } = {}) {
  const providers = new Map([[CATALOG_PROVIDER.YOUTUBE, youtubeProvider]]);

  const getProvider = (provider) => {
    if (typeof provider !== 'string') return null;
    return providers.get(provider.trim().toLowerCase()) || null;
  };

  return Object.freeze({
    listProviders: () => [...providers.keys()],
    getProvider,
  });
}
