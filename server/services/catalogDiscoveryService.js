import Song from '../models/Song.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import {
  CATALOG_PROVIDER,
  createCatalogProviderRegistry,
} from './catalogProviderService.js';
import {
  REGIONAL_TAGS,
  normalizeRegionTag,
} from './regionalCatalog.js';

export const CATALOG_EXTERNAL_STATE = Object.freeze({
  READY: 'ready',
  SKIPPED: 'skipped',
  ERROR: 'error',
  DISABLED: 'disabled',
});

export const DEFAULT_CATALOG_LOCAL_LIMIT = 20;
export const DEFAULT_CATALOG_EXTERNAL_LIMIT = 20;
export const MAX_CATALOG_LIMIT = 40;
export const CATALOG_EXTERNAL_CACHE_TTL_MS = 120000;
export const MAX_CATALOG_EXTERNAL_CACHE_ENTRIES = 100;

const normalizeLimit = (value, fallback) => (
  Number.isInteger(value) && value >= 1 && value <= MAX_CATALOG_LIMIT
    ? value
    : fallback
);

const normalizeText = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const buildDedupeKey = ({ youtubeId, title, artist }) => {
  const normalizedYoutubeId = normalizeText(youtubeId);
  if (normalizedYoutubeId) {
    return `yt:${normalizedYoutubeId}`;
  }
  return `ta:${normalizeText(title)}|${normalizeText(artist)}`;
};

const projection = [
  '_id',
  'title',
  'artist',
  'genre',
  'youtube_id',
  'file_path',
  'poster_url',
  'duration',
  'album',
  'language',
  'regional_tag',
  'source_provider',
  'external_id',
].join(' ');

function buildRegionFilter(regionTag) {
  if (!regionTag) return null;
  if (regionTag === REGIONAL_TAGS.BANGLA_BD || regionTag === REGIONAL_TAGS.BENGALI_IN) {
    return {
      $or: [
        { regional_tag: regionTag },
        {
          $and: [
            { $or: [{ regional_tag: { $exists: false } }, { regional_tag: '' }, { regional_tag: null }] },
            { language: 'bn' },
          ],
        },
      ],
    };
  }
  if (regionTag === REGIONAL_TAGS.HINDI_IN) {
    return {
      $or: [
        { regional_tag: regionTag },
        {
          $and: [
            { $or: [{ regional_tag: { $exists: false } }, { regional_tag: '' }, { regional_tag: null }] },
            { language: 'hi' },
          ],
        },
      ],
    };
  }
  if (regionTag === REGIONAL_TAGS.ENGLISH) {
    return {
      $or: [
        { regional_tag: regionTag },
        {
          $and: [
            { $or: [{ regional_tag: { $exists: false } }, { regional_tag: '' }, { regional_tag: null }] },
            { language: 'en' },
          ],
        },
      ],
    };
  }
  return null;
}

export function createCatalogDiscoveryService({
  SongModel = Song,
  providerRegistry = createCatalogProviderRegistry(),
  now = () => Date.now(),
  externalCacheTtlMs = CATALOG_EXTERNAL_CACHE_TTL_MS,
} = {}) {
  const externalCache = new Map();

  const readCache = (key) => {
    const cached = externalCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= now()) {
      externalCache.delete(key);
      return null;
    }
    return cached.results;
  };

  const writeCache = (key, results) => {
    externalCache.set(key, {
      results,
      expiresAt: now() + externalCacheTtlMs,
    });
    if (externalCache.size > MAX_CATALOG_EXTERNAL_CACHE_ENTRIES) {
      const first = externalCache.keys().next().value;
      if (first) externalCache.delete(first);
    }
  };

  const mapLocalSong = (songDoc) => {
    const song = {
      _id: String(songDoc._id),
      title: songDoc.title,
      artist: songDoc.artist,
      genre: songDoc.genre,
      youtube_id: songDoc.youtube_id,
      file_path: songDoc.file_path,
      poster_url: songDoc.poster_url,
      duration: songDoc.duration,
      album: songDoc.album || '',
      language: songDoc.language || null,
      regional_tag: songDoc.regional_tag || null,
      provider: songDoc.source_provider || null,
      providerTrackId: songDoc.external_id || null,
    };
    return {
      sourceType: 'local',
      dedupeKey: buildDedupeKey({
        youtubeId: song.youtube_id,
        title: song.title,
        artist: song.artist,
      }),
      song,
    };
  };

  const searchCatalog = async ({
    query,
    regionTag: inputRegionTag,
    localLimit = DEFAULT_CATALOG_LOCAL_LIMIT,
    externalLimit = DEFAULT_CATALOG_EXTERNAL_LIMIT,
    includeExternal = true,
    broadenExternal = false,
  } = {}) => {
    if (typeof query !== 'string' || !query.trim()) {
      return {
        query: '',
        regionTag: normalizeRegionTag(inputRegionTag),
        localResults: [],
        externalResults: [],
        mergedResults: [],
        externalState: CATALOG_EXTERNAL_STATE.SKIPPED,
        externalError: null,
      };
    }

    const trimmedQuery = query.trim();
    const regionTag = normalizeRegionTag(inputRegionTag);
    const safeLocalLimit = normalizeLimit(localLimit, DEFAULT_CATALOG_LOCAL_LIMIT);
    const safeExternalLimit = normalizeLimit(externalLimit, DEFAULT_CATALOG_EXTERNAL_LIMIT);

    const localQuery = {};
    const escaped = escapeRegex(trimmedQuery);
    if (escaped) {
      localQuery.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { artist: { $regex: escaped, $options: 'i' } },
        { genre: { $regex: escaped, $options: 'i' } },
        { album: { $regex: escaped, $options: 'i' } },
      ];
    }

    const regionFilter = buildRegionFilter(regionTag);
    if (regionFilter) {
      localQuery.$and = localQuery.$and || [];
      localQuery.$and.push(regionFilter);
    }

    const localDocs = await SongModel.find(localQuery)
      .select(projection)
      .sort({ createdAt: -1, _id: -1 })
      .limit(safeLocalLimit)
      .lean();

    const localResults = Array.isArray(localDocs)
      ? localDocs.map(mapLocalSong)
      : [];

    let externalState = CATALOG_EXTERNAL_STATE.SKIPPED;
    let externalError = null;
    let externalResults = [];

    if (includeExternal) {
      if (localResults.length >= safeLocalLimit && !broadenExternal) {
        externalState = CATALOG_EXTERNAL_STATE.SKIPPED;
      } else {
        const provider = providerRegistry.getProvider(CATALOG_PROVIDER.YOUTUBE);
        if (!provider) {
          externalState = CATALOG_EXTERNAL_STATE.DISABLED;
        } else {
          const cacheKey = `${trimmedQuery.toLowerCase()}|${regionTag || ''}|${safeExternalLimit}`;
          const cached = readCache(cacheKey);
          if (cached) {
            externalResults = cached;
            externalState = CATALOG_EXTERNAL_STATE.READY;
          } else {
            try {
              const providerResults = await provider.search(trimmedQuery, {
                regionTag,
                limit: safeExternalLimit,
              });
              externalResults = Array.isArray(providerResults)
                ? providerResults.map((entry) => ({
                  sourceType: 'external',
                  dedupeKey: buildDedupeKey({
                    youtubeId: entry.youtube_id,
                    title: entry.title,
                    artist: entry.artist,
                  }),
                  ...entry,
                }))
                : [];
              writeCache(cacheKey, externalResults);
              externalState = CATALOG_EXTERNAL_STATE.READY;
            } catch (error) {
              const message = error && typeof error.message === 'string' ? error.message : '';
              if (message.toLowerCase().includes('not configured')) {
                externalState = CATALOG_EXTERNAL_STATE.DISABLED;
              } else {
                externalState = CATALOG_EXTERNAL_STATE.ERROR;
                externalError = 'external catalog unavailable';
              }
            }
          }
        }
      }
    }

    const mergedResults = [];
    const dedupe = new Set();
    for (const item of localResults) {
      dedupe.add(item.dedupeKey);
      mergedResults.push(item);
    }
    for (const item of externalResults) {
      if (dedupe.has(item.dedupeKey)) continue;
      dedupe.add(item.dedupeKey);
      mergedResults.push(item);
    }

    return {
      query: trimmedQuery,
      regionTag,
      localResults,
      externalResults,
      mergedResults,
      externalState,
      externalError,
    };
  };

  return Object.freeze({
    searchCatalog,
    normalizeRegionTag,
    getExternalCacheSize: () => externalCache.size,
  });
}
