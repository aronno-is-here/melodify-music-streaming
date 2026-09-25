import Song from '../models/Song.js';
import {
  CATALOG_PROVIDER,
  createCatalogProviderRegistry,
} from './catalogProviderService.js';
import { inferLanguageFromRegion, normalizeRegionTag } from './regionalCatalog.js';

export const CATALOG_IMPORT_MESSAGES = Object.freeze({
  invalidRequest: 'invalid catalog import request',
  unsupportedProvider: 'unsupported catalog provider',
  providerUnavailable: 'catalog provider unavailable',
  importFailed: 'catalog import failed',
});

export class CatalogImportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CatalogImportError';
    this.code = code;
  }
}

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function sanitizeSong(song) {
  if (!song) return null;
  const source = isPlainObjectLike(song) && typeof song.toObject === 'function' ? song.toObject() : song;
  if (!isPlainObjectLike(source)) return null;
  return {
    _id: String(source._id),
    title: source.title,
    artist: source.artist,
    genre: source.genre,
    youtube_id: source.youtube_id,
    file_path: source.file_path,
    poster_url: source.poster_url,
    duration: source.duration,
    language: source.language ?? null,
    regional_tag: source.regional_tag ?? null,
    source_provider: source.source_provider ?? null,
    external_id: source.external_id ?? null,
  };
}

export function createCatalogImportService({
  SongModel = Song,
  providerRegistry = createCatalogProviderRegistry(),
} = {}) {
  const importProviderTrack = async ({ provider, providerTrackId, regionTag, genre, language } = {}) => {
    const providerId = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
    const providerTrack = typeof providerTrackId === 'string' ? providerTrackId.trim() : '';
    if (!providerId || !providerTrack) {
      throw new CatalogImportError(CATALOG_IMPORT_MESSAGES.invalidRequest, 'INVALID_REQUEST');
    }

    const region = normalizeRegionTag(regionTag);
    const resolvedProvider = providerRegistry.getProvider(providerId);
    if (!resolvedProvider) {
      throw new CatalogImportError(CATALOG_IMPORT_MESSAGES.unsupportedProvider, 'UNSUPPORTED_PROVIDER');
    }

    let track;
    try {
      track = await resolvedProvider.getTrack(providerTrack, { regionTag: region });
    } catch (error) {
      const message = error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
      if (message.includes('not configured') || message.includes('unavailable')) {
        throw new CatalogImportError(CATALOG_IMPORT_MESSAGES.providerUnavailable, 'PROVIDER_UNAVAILABLE');
      }
      throw new CatalogImportError(CATALOG_IMPORT_MESSAGES.importFailed, 'PROVIDER_READ_FAILED');
    }

    const byIdentity = await SongModel.findOne({
      source_provider: CATALOG_PROVIDER.YOUTUBE,
      external_id: providerTrack,
    });
    if (byIdentity) {
      return {
        status: 'existing',
        song: sanitizeSong(byIdentity),
        provider: providerId,
        providerTrackId: providerTrack,
      };
    }

    const byYoutubeId = track.youtube_id
      ? await SongModel.findOne({ youtube_id: track.youtube_id })
      : null;

    const resolvedLanguage =
      (typeof language === 'string' && language.trim() ? language.trim() : null)
      || track.language
      || inferLanguageFromRegion(region)
      || undefined;

    const resolvedGenre = typeof genre === 'string' && genre.trim() ? genre.trim() : 'Unknown';

    if (byYoutubeId) {
      byYoutubeId.source_provider = CATALOG_PROVIDER.YOUTUBE;
      byYoutubeId.external_id = providerTrack;
      if (!byYoutubeId.poster_url && track.thumbnail) byYoutubeId.poster_url = track.thumbnail;
      if (!byYoutubeId.duration && track.duration) byYoutubeId.duration = track.duration;
      if (!byYoutubeId.genre) byYoutubeId.genre = resolvedGenre;
      if (!byYoutubeId.language && resolvedLanguage) byYoutubeId.language = resolvedLanguage;
      if (!byYoutubeId.regional_tag && region) byYoutubeId.regional_tag = region;
      await byYoutubeId.save();
      return {
        status: 'adopted-legacy',
        song: sanitizeSong(byYoutubeId),
        provider: providerId,
        providerTrackId: providerTrack,
      };
    }

    let created;
    try {
      created = await SongModel.create({
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        genre: resolvedGenre,
        youtube_id: track.youtube_id || '',
        poster_url: track.thumbnail || 'https://picsum.photos/150/150?random',
        duration: track.duration || '3:00',
        source_provider: CATALOG_PROVIDER.YOUTUBE,
        external_id: providerTrack,
        language: resolvedLanguage,
        regional_tag: region || undefined,
        recommendation_eligible: true,
      });
    } catch {
      throw new CatalogImportError(CATALOG_IMPORT_MESSAGES.importFailed, 'UPSERT_FAILED');
    }

    return {
      status: 'inserted',
      song: sanitizeSong(created),
      provider: providerId,
      providerTrackId: providerTrack,
    };
  };

  return Object.freeze({ importProviderTrack });
}
