import Karaoke from '../models/Karaoke.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { createCatalogDiscoveryService, MAX_CATALOG_LIMIT } from './catalogDiscoveryService.js';

export const KARAOKE_DISCOVERY_CLASSIFICATION = Object.freeze({
  KARAOKE_READY: 'KARAOKE_READY',
  SING_ALONG: 'SING_ALONG',
});

export const KARAOKE_DISCOVERY_MODE = Object.freeze({
  MIXED: 'MIXED',
  COMPOSITE: 'COMPOSITE',
  MIC_ONLY: 'MIC_ONLY',
});

const DIRECT_BACKING_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|webm)$/i;

const toSafeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeText = (value) => toSafeString(value).toLowerCase().replace(/\s+/g, ' ');

const buildDedupeKey = ({ youtubeId, title, artist }) => {
  const normalizedYoutubeId = normalizeText(youtubeId);
  if (normalizedYoutubeId) return `yt:${normalizedYoutubeId}`;
  return `ta:${normalizeText(title)}|${normalizeText(artist)}`;
};

const buildTrackClassification = ({ filePath, youtubeId }) => {
  if (toSafeString(filePath)) return KARAOKE_DISCOVERY_CLASSIFICATION.KARAOKE_READY;
  if (toSafeString(youtubeId)) return KARAOKE_DISCOVERY_CLASSIFICATION.SING_ALONG;
  return KARAOKE_DISCOVERY_CLASSIFICATION.SING_ALONG;
};

const toAssetAudioUrl = (filePath) => {
  const value = toSafeString(filePath);
  if (!value) return null;
  if (value.includes('..')) return null;
  if (!value.startsWith('assets/')) return null;
  if (!DIRECT_BACKING_EXTENSIONS.test(value)) return null;
  return `/${value}`;
};

const mapPlaybackDescriptor = ({ filePath, youtubeId }) => {
  const audioUrl = toAssetAudioUrl(filePath);
  if (audioUrl) {
    return {
      playbackType: 'audio',
      backingAudioUrl: audioUrl,
      backingProvider: 'local-asset',
      backingProviderTrackId: null,
    };
  }

  const normalizedYoutubeId = toSafeString(youtubeId);
  if (normalizedYoutubeId) {
    return {
      playbackType: 'youtube',
      backingAudioUrl: null,
      backingProvider: 'youtube',
      backingProviderTrackId: normalizedYoutubeId,
    };
  }

  return {
    playbackType: 'none',
    backingAudioUrl: null,
    backingProvider: null,
    backingProviderTrackId: null,
  };
};

function mapKaraokeTrack(track) {
  const playback = mapPlaybackDescriptor({ filePath: track.file_path, youtubeId: track.youtube_id });
  const classification = buildTrackClassification({ filePath: playback.backingAudioUrl, youtubeId: track.youtube_id });
  return {
    id: `karaoke:${String(track._id)}`,
    karaokeId: String(track._id),
    catalogSongId: null,
    title: track.title,
    artist: track.artist,
    posterUrl: track.poster_url,
    duration: track.duration,
    lyrics: track.lyrics || '',
    source: 'karaoke',
    sourceType: 'local',
    youtubeId: toSafeString(track.youtube_id) || null,
    ...playback,
    classification,
    recordingMode: classification === KARAOKE_DISCOVERY_CLASSIFICATION.KARAOKE_READY
      ? KARAOKE_DISCOVERY_MODE.MIXED
      : KARAOKE_DISCOVERY_MODE.COMPOSITE,
    dedupeKey: buildDedupeKey({
      youtubeId: track.youtube_id,
      title: track.title,
      artist: track.artist,
    }),
  };
}

function mapCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  if (entry.sourceType === 'local' && entry.song && typeof entry.song === 'object') {
    const song = entry.song;
    const playback = mapPlaybackDescriptor({ filePath: song.file_path, youtubeId: song.youtube_id });
    const classification = buildTrackClassification({ filePath: playback.backingAudioUrl, youtubeId: song.youtube_id });
    return {
      id: `catalog:${String(song._id)}`,
      karaokeId: null,
      catalogSongId: String(song._id),
      title: song.title,
      artist: song.artist,
      posterUrl: song.poster_url,
      duration: song.duration,
      lyrics: song.lyrics || '',
      source: 'catalog',
      sourceType: 'local',
      youtubeId: toSafeString(song.youtube_id) || null,
      ...playback,
      classification,
      recordingMode: classification === KARAOKE_DISCOVERY_CLASSIFICATION.KARAOKE_READY
        ? KARAOKE_DISCOVERY_MODE.MIXED
        : KARAOKE_DISCOVERY_MODE.COMPOSITE,
      dedupeKey: buildDedupeKey({
        youtubeId: song.youtube_id,
        title: song.title,
        artist: song.artist,
      }),
    };
  }

  const playback = mapPlaybackDescriptor({ filePath: '', youtubeId: entry.youtube_id || entry.providerTrackId });
  const youtubeId = toSafeString(entry.youtube_id || entry.providerTrackId) || null;
  return {
    id: `provider:${toSafeString(entry.provider) || 'youtube'}:${youtubeId || normalizeText(entry.title)}`,
    karaokeId: null,
    catalogSongId: null,
    title: entry.title,
    artist: entry.artist,
    posterUrl: entry.thumbnail || entry.poster_url || '',
    duration: entry.duration || '',
    lyrics: '',
    source: 'provider',
    sourceType: 'external',
    youtubeId,
    ...playback,
    classification: KARAOKE_DISCOVERY_CLASSIFICATION.SING_ALONG,
    recordingMode: KARAOKE_DISCOVERY_MODE.COMPOSITE,
    dedupeKey: buildDedupeKey({
      youtubeId,
      title: entry.title,
      artist: entry.artist,
    }),
  };
}

const stripInternalFields = (entry) => {
  const { dedupeKey, ...safe } = entry;
  return safe;
};

export function createKaraokeDiscoveryService({
  KaraokeModel = Karaoke,
  catalogDiscoveryService = createCatalogDiscoveryService(),
} = {}) {
  const discoverTracks = async ({ query = '', regionTag, limit = 12, page = 1 } = {}) => {
    const safeQuery = toSafeString(query);
    const safeLimit = Number.isInteger(limit) && limit >= 1 ? limit : 12;
    const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
    const searchWindow = Math.min(MAX_CATALOG_LIMIT, safeLimit * safePage);

    const karaokeQuery = { available: true };
    if (safeQuery) {
      const escaped = escapeRegex(safeQuery);
      karaokeQuery.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { artist: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [karaokeDocs, catalogResult] = await Promise.all([
      KaraokeModel.find(karaokeQuery)
        .select('_id title artist poster_url duration lyrics file_path youtube_id')
        .sort({ createdAt: -1, _id: -1 })
        .limit(searchWindow)
        .lean(),
      catalogDiscoveryService.searchCatalog({
        query: safeQuery || 'karaoke',
        regionTag,
        localLimit: searchWindow,
        externalLimit: searchWindow,
        includeExternal: true,
        broadenExternal: true,
      }),
    ]);

    const dedupe = new Set();
    const merged = [];

    for (const doc of karaokeDocs || []) {
      const item = mapKaraokeTrack(doc);
      if (!item || dedupe.has(item.dedupeKey)) continue;
      dedupe.add(item.dedupeKey);
      merged.push(item);
    }

    for (const entry of catalogResult?.mergedResults || []) {
      const item = mapCatalogEntry(entry);
      if (!item || dedupe.has(item.dedupeKey)) continue;
      dedupe.add(item.dedupeKey);
      merged.push(item);
    }

    const total = merged.length;
    const pages = Math.max(1, Math.ceil(total / safeLimit));
    const start = (safePage - 1) * safeLimit;
    const paged = merged.slice(start, start + safeLimit).map(stripInternalFields);

    return {
      query: safeQuery,
      regionTag: regionTag || null,
      page: safePage,
      limit: safeLimit,
      total,
      pages,
      items: paged,
      externalState: catalogResult?.externalState || 'skipped',
      externalError: catalogResult?.externalError || null,
    };
  };

  return Object.freeze({
    discoverTracks,
    toAssetAudioUrl,
    mapCatalogEntry,
    mapKaraokeTrack,
  });
}
