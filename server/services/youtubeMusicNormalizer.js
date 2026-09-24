import { MAX_VIDEO_ID_LENGTH } from './youtubeCatalogClient.js';
import { normalizeSourceProvider, normalizeExternalId } from '../utils/catalogIdentity.js';

export const YOUTUBE_SOURCE_PROVIDER = normalizeSourceProvider('youtube');
export const YOUTUBE_MUSIC_CATEGORY_ID = '10';
export const YOUTUBE_MUSIC_CATEGORY = 'Music';
export const MAX_TITLE_LENGTH = 200;
export const MAX_CHANNEL_TITLE_LENGTH = 200;
export const MAX_STATUS_VALUE_LENGTH = 64;
export const MAX_THUMBNAIL_URL_LENGTH = 1024;
export const TOPIC_CHANNEL_SUFFIX = ' - Topic';

export const ARTIST_CANDIDATE_SOURCES = Object.freeze(['topic-channel', 'channel-title']);

export const INELIGIBILITY_REASONS = Object.freeze([
  'missing-title',
  'invalid-duration',
  'not-public',
  'not-embeddable',
  'incompatible-upload-status',
  'missing-live-status',
  'live-content',
]);

const THUMBNAIL_QUALITY_ORDER = Object.freeze(['maxres', 'standard', 'high', 'medium', 'default']);
const COMPATIBLE_UPLOAD_STATUSES = Object.freeze(['uploaded', 'processed']);
const KNOWN_LIVE_BROADCAST_CONTENT = Object.freeze(['none', 'live', 'upcoming']);
const TOPIC_ARTIST_SOURCE = 'topic-channel';
const CHANNEL_ARTIST_SOURCE = 'channel-title';

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeBoundedString = (value, maxLength) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
};

export function parseYouTubeDuration(value) {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const days = match[1];
  const hours = match[2];
  const minutes = match[3];
  const seconds = match[4];
  const hasDateComponent = days !== undefined;
  const hasTimeComponent = hours !== undefined || minutes !== undefined || seconds !== undefined;
  if (!hasDateComponent && !hasTimeComponent) return null;
  if (value.includes('T') && !hasTimeComponent) return null;
  const totalSeconds =
    Number(days || 0) * 86400 +
    Number(hours || 0) * 3600 +
    Number(minutes || 0) * 60 +
    Number(seconds || 0);
  if (!Number.isSafeInteger(totalSeconds) || totalSeconds < 0) return null;
  return totalSeconds;
}

export function formatDurationSeconds(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  const wholeSeconds = seconds;
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

const normalizeVideoId = (value) => {
  const externalId = normalizeExternalId(value);
  if (externalId === null || externalId.length > MAX_VIDEO_ID_LENGTH) return null;
  return externalId;
};

const selectThumbnailUrl = (thumbnails) => {
  if (!isPlainObjectLike(thumbnails)) return null;
  for (const quality of THUMBNAIL_QUALITY_ORDER) {
    const entry = thumbnails[quality];
    if (!isPlainObjectLike(entry)) continue;
    if (typeof entry.url !== 'string') continue;
    const url = entry.url.trim();
    if (!url || url.length > MAX_THUMBNAIL_URL_LENGTH) continue;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url;
    }
  }
  return null;
};

const deriveArtistCandidate = (rawChannelTitle) => {
  if (typeof rawChannelTitle !== 'string') {
    return { artist_candidate: null, artist_candidate_source: null };
  }
  const trimmedFull = rawChannelTitle.trim();
  if (!trimmedFull || trimmedFull.length > MAX_CHANNEL_TITLE_LENGTH) {
    return { artist_candidate: null, artist_candidate_source: null };
  }
  const withoutTrailingWhitespace = rawChannelTitle.trimEnd();
  if (withoutTrailingWhitespace.endsWith(TOPIC_CHANNEL_SUFFIX)) {
    const base = withoutTrailingWhitespace.slice(0, -TOPIC_CHANNEL_SUFFIX.length).trim();
    if (!base || base.length > MAX_CHANNEL_TITLE_LENGTH) {
      return { artist_candidate: null, artist_candidate_source: null };
    }
    return { artist_candidate: base, artist_candidate_source: TOPIC_ARTIST_SOURCE };
  }
  return { artist_candidate: trimmedFull, artist_candidate_source: CHANNEL_ARTIST_SOURCE };
};

const normalizePublishedAt = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizeCategory = (categoryId) => {
  const normalizedId = normalizeBoundedString(categoryId, MAX_STATUS_VALUE_LENGTH);
  const numericId = normalizedId !== null && /^\d{1,8}$/.test(normalizedId) ? normalizedId : null;
  return {
    category: numericId === YOUTUBE_MUSIC_CATEGORY_ID ? YOUTUBE_MUSIC_CATEGORY : null,
    youtube_category_id: numericId,
  };
};

const evaluateEligibility = ({
  hasTitle,
  durationSeconds,
  privacyStatus,
  embeddable,
  uploadStatus,
  liveBroadcastContent,
}) => {
  const reasons = [];
  if (!hasTitle) reasons.push('missing-title');
  if (!(Number.isSafeInteger(durationSeconds) && durationSeconds > 0)) reasons.push('invalid-duration');
  if (privacyStatus !== 'public') reasons.push('not-public');
  if (embeddable !== true) reasons.push('not-embeddable');
  if (uploadStatus !== null && !COMPATIBLE_UPLOAD_STATUSES.includes(uploadStatus)) {
    reasons.push('incompatible-upload-status');
  }
  if (liveBroadcastContent === 'live' || liveBroadcastContent === 'upcoming') {
    reasons.push('live-content');
  } else if (liveBroadcastContent !== 'none') {
    reasons.push('missing-live-status');
  }
  return reasons;
};

export function normalizeYouTubeVideoCandidate(video) {
  if (!isPlainObjectLike(video)) return null;
  const videoId = normalizeVideoId(video.id);
  if (videoId === null) return null;

  const snippet = isPlainObjectLike(video.snippet) ? video.snippet : {};
  const contentDetails = isPlainObjectLike(video.contentDetails) ? video.contentDetails : {};
  const status = isPlainObjectLike(video.status) ? video.status : {};

  const rawTitle = normalizeBoundedString(snippet.title, MAX_TITLE_LENGTH);
  const channelTitle = normalizeBoundedString(snippet.channelTitle, MAX_CHANNEL_TITLE_LENGTH);
  const artist = deriveArtistCandidate(snippet.channelTitle);
  const durationSeconds = parseYouTubeDuration(contentDetails.duration);
  const { category, youtube_category_id: youtubeCategoryId } = normalizeCategory(snippet.categoryId);

  const privacyStatus = normalizeBoundedString(status.privacyStatus, MAX_STATUS_VALUE_LENGTH);
  const uploadStatus = normalizeBoundedString(status.uploadStatus, MAX_STATUS_VALUE_LENGTH);
  const embeddable = status.embeddable === true ? true : status.embeddable === false ? false : null;
  const rawLive = normalizeBoundedString(snippet.liveBroadcastContent, MAX_STATUS_VALUE_LENGTH);
  const liveBroadcastContent = KNOWN_LIVE_BROADCAST_CONTENT.includes(rawLive) ? rawLive : null;

  const ineligibilityReasons = evaluateEligibility({
    hasTitle: rawTitle !== null,
    durationSeconds,
    privacyStatus,
    embeddable,
    uploadStatus,
    liveBroadcastContent,
  });
  const catalogEligible = ineligibilityReasons.length === 0;

  return {
    source_provider: YOUTUBE_SOURCE_PROVIDER,
    external_id: videoId,
    youtube_id: videoId,
    title: rawTitle,
    channel_title: channelTitle,
    artist_candidate: artist.artist_candidate,
    artist_candidate_source: artist.artist_candidate_source,
    poster_url: selectThumbnailUrl(snippet.thumbnails),
    duration_seconds: durationSeconds,
    duration: durationSeconds === null ? null : formatDurationSeconds(durationSeconds),
    category,
    youtube_category_id: youtubeCategoryId,
    genre: null,
    language: null,
    privacy_status: privacyStatus,
    upload_status: uploadStatus,
    embeddable,
    live_broadcast_content: liveBroadcastContent,
    published_at: normalizePublishedAt(snippet.publishedAt),
    catalog_eligible: catalogEligible,
    recommendation_eligible: catalogEligible,
    ineligibility_reasons: ineligibilityReasons,
  };
}

const extractSearchVideoId = (item) => {
  if (!isPlainObjectLike(item)) return null;
  if (!isPlainObjectLike(item.id)) return null;
  return normalizeVideoId(item.id.videoId);
};

const buildDetailsById = (detailsResponse) => {
  if (!isPlainObjectLike(detailsResponse)) {
    throw new Error('Invalid YouTube video details response');
  }
  if (!Array.isArray(detailsResponse.items)) {
    throw new Error('Invalid YouTube video details response');
  }
  const byId = new Map();
  for (const item of detailsResponse.items) {
    if (!isPlainObjectLike(item)) continue;
    const videoId = normalizeVideoId(item.id);
    if (videoId === null) continue;
    if (!byId.has(videoId)) {
      byId.set(videoId, item);
    }
  }
  return byId;
};

export function normalizeYouTubeMusicCandidates(searchResponse, detailsResponse) {
  if (!isPlainObjectLike(searchResponse)) {
    throw new Error('Invalid YouTube search response');
  }
  if (!Array.isArray(searchResponse.items)) {
    throw new Error('Invalid YouTube search response');
  }
  const detailsById = buildDetailsById(detailsResponse);

  const orderedUniqueIds = [];
  const seen = new Set();
  for (const item of searchResponse.items) {
    const videoId = extractSearchVideoId(item);
    if (videoId === null || seen.has(videoId)) continue;
    seen.add(videoId);
    orderedUniqueIds.push(videoId);
  }

  const candidates = [];
  for (const videoId of orderedUniqueIds) {
    const details = detailsById.get(videoId);
    if (details === undefined) continue;
    const candidate = normalizeYouTubeVideoCandidate(details);
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }
  return candidates;
}
