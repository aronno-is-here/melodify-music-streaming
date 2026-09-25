import Song from '../models/Song.js';
import { createLrclibClient } from './lrclibClient.js';
import { createLyricsCache } from './lyricsCache.js';
import {
  LYRICS_MATCH_CLASS,
  scoreLyricsMatch,
  selectBestLyricsCandidate,
} from './lyricsMatchScoring.js';

export const LYRICS_RESOLUTION_STATUS = Object.freeze({
  VERIFIED: 'verified',
  PROVIDER: 'provider',
  LEGACY_UNVERIFIED: 'legacy-unverified',
  AMBIGUOUS: 'ambiguous',
  UNAVAILABLE: 'unavailable',
});

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const toSeconds = (value) => {
  if (Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const parts = value.split(':').map((part) => Number.parseInt(part, 10));
  if (!parts.every((entry) => Number.isFinite(entry) && entry >= 0)) return null;
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return null;
};

export function parseLrc(lyricsText) {
  if (typeof lyricsText !== 'string' || !lyricsText.trim()) return [];
  const lines = [];
  const rows = lyricsText.split('\n');
  for (const row of rows) {
    const matches = [...row.matchAll(/\[(\d{2}):(\d{2})\.(\d{2,3})\]/g)];
    const text = row.replace(/\[(\d{2}):(\d{2})\.(\d{2,3})\]/g, '').trim();
    if (matches.length === 0) {
      if (text) lines.push({ time: null, text });
      continue;
    }
    for (const match of matches) {
      const min = Number.parseInt(match[1], 10);
      const sec = Number.parseInt(match[2], 10);
      const fraction = match[3].length === 2
        ? Number.parseInt(match[3], 10) * 10
        : Number.parseInt(match[3], 10);
      if (!Number.isFinite(min) || !Number.isFinite(sec) || !Number.isFinite(fraction)) continue;
      lines.push({
        time: (min * 60) + sec + (fraction / 1000),
        text,
      });
    }
  }
  return lines.sort((a, b) => {
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time - b.time;
  });
}

function plainLines(lyricsText) {
  if (typeof lyricsText !== 'string') return [];
  return lyricsText.split('\n').map((line) => line.trim()).filter(Boolean).map((text) => ({ time: null, text }));
}

function normalizeProviderLyrics(raw) {
  if (!isPlainObjectLike(raw)) return null;
  const syncedLyrics = typeof raw.syncedLyrics === 'string' ? raw.syncedLyrics : '';
  const plainLyrics = typeof raw.plainLyrics === 'string' ? raw.plainLyrics : '';
  const lyricsId = raw.id !== undefined && raw.id !== null ? String(raw.id) : null;
  const parsedSynced = parseLrc(syncedLyrics);
  const lines = parsedSynced.length > 0 ? parsedSynced : plainLines(plainLyrics || syncedLyrics);
  const plain = plainLyrics || syncedLyrics || '';
  return {
    providerLyricsId: lyricsId,
    trackName: raw.trackName || null,
    artistName: raw.artistName || null,
    albumName: raw.albumName || null,
    duration: raw.duration ?? null,
    synced: parsedSynced.length > 0,
    lines,
    plain,
  };
}

function resolveLegacyLyrics(song, { source = 'legacy-unverified' } = {}) {
  const plain = typeof song.lyrics === 'string' ? song.lyrics : '';
  const syncedLines = parseLrc(plain);
  return {
    source,
    status: source === 'verified-db' ? LYRICS_RESOLUTION_STATUS.VERIFIED : LYRICS_RESOLUTION_STATUS.LEGACY_UNVERIFIED,
    synced: syncedLines.length > 0,
    lines: syncedLines.length > 0 ? syncedLines : plainLines(plain),
    plain,
    match: null,
    provider: null,
  };
}

export function createLyricsProviderService({
  SongModel = Song,
  lrclibClient = createLrclibClient(),
  lyricsCache = createLyricsCache(),
} = {}) {
  const resolveSongLyrics = async (songId) => {
    const song = await SongModel.findById(songId);
    if (!song) return { notFound: true };

    if (song.lyrics_verified === true && typeof song.lyrics === 'string' && song.lyrics.trim()) {
      return {
        notFound: false,
        song,
        lyrics: resolveLegacyLyrics(song, { source: 'verified-db' }),
      };
    }

    const cacheKey = [
      String(song._id),
      String(song.youtube_id || ''),
      String(song.title || ''),
      String(song.artist || ''),
      String(song.duration || ''),
    ].join('|');
    const cached = lyricsCache.get(cacheKey);
    if (cached) {
      if (cached.status === LYRICS_RESOLUTION_STATUS.UNAVAILABLE && typeof song.lyrics === 'string' && song.lyrics.trim()) {
        return { notFound: false, song, lyrics: resolveLegacyLyrics(song) };
      }
      return { notFound: false, song, lyrics: cached };
    }

    const params = {
      track_name: song.title,
      artist_name: song.artist,
      album_name: song.album || undefined,
      duration: toSeconds(song.duration) || undefined,
    };

    try {
      const exactResponse = await lrclibClient.getExact(params);
      if (exactResponse.status === 200 && exactResponse.body) {
        const normalized = normalizeProviderLyrics(exactResponse.body);
        if (normalized && normalized.lines.length > 0) {
          const match = scoreLyricsMatch({ song, candidate: exactResponse.body });
          if (match.classification === LYRICS_MATCH_CLASS.EXACT || match.classification === LYRICS_MATCH_CLASS.HIGH) {
            const payload = {
              source: 'lrclib-exact',
              status: LYRICS_RESOLUTION_STATUS.PROVIDER,
              synced: normalized.synced,
              lines: normalized.lines,
              plain: normalized.plain,
              match: match.classification,
              provider: {
                provider: 'lrclib',
                providerLyricsId: normalized.providerLyricsId,
                trackName: normalized.trackName,
                artistName: normalized.artistName,
                albumName: normalized.albumName,
              },
            };
            lyricsCache.set(cacheKey, payload);
            return { notFound: false, song, lyrics: payload };
          }
          if (match.classification === LYRICS_MATCH_CLASS.AMBIGUOUS) {
            const payload = {
              source: 'provider-ambiguous',
              status: LYRICS_RESOLUTION_STATUS.AMBIGUOUS,
              synced: false,
              lines: [],
              plain: '',
              match: match.classification,
              provider: {
                provider: 'lrclib',
                providerLyricsId: normalized.providerLyricsId,
                trackName: normalized.trackName,
                artistName: normalized.artistName,
                albumName: normalized.albumName,
              },
            };
            lyricsCache.set(cacheKey, payload, { negative: true });
            return { notFound: false, song, lyrics: payload };
          }
        }
      }
    } catch {
      // Continue to search fallback.
    }

    try {
      const searchResponse = await lrclibClient.search({
        q: `${song.title} ${song.artist}`,
      });
      if (searchResponse.status === 200 && Array.isArray(searchResponse.body) && searchResponse.body.length > 0) {
        const { best, classification } = selectBestLyricsCandidate(song, searchResponse.body);
        if (best && (classification === LYRICS_MATCH_CLASS.EXACT || classification === LYRICS_MATCH_CLASS.HIGH)) {
          const normalized = normalizeProviderLyrics(best);
          if (normalized && normalized.lines.length > 0) {
            const payload = {
              source: 'lrclib-search',
              status: LYRICS_RESOLUTION_STATUS.PROVIDER,
              synced: normalized.synced,
              lines: normalized.lines,
              plain: normalized.plain,
              match: classification,
              provider: {
                provider: 'lrclib',
                providerLyricsId: normalized.providerLyricsId,
                trackName: normalized.trackName,
                artistName: normalized.artistName,
                albumName: normalized.albumName,
              },
            };
            lyricsCache.set(cacheKey, payload);
            return { notFound: false, song, lyrics: payload };
          }
        }

        if (classification === LYRICS_MATCH_CLASS.AMBIGUOUS) {
          const payload = {
            source: 'provider-ambiguous',
            status: LYRICS_RESOLUTION_STATUS.AMBIGUOUS,
            synced: false,
            lines: [],
            plain: '',
            match: classification,
            provider: { provider: 'lrclib' },
          };
          lyricsCache.set(cacheKey, payload, { negative: true });
          return { notFound: false, song, lyrics: payload };
        }
      }
    } catch {
      // Fallback to legacy/unavailable.
    }

    if (typeof song.lyrics === 'string' && song.lyrics.trim()) {
      const payload = resolveLegacyLyrics(song);
      lyricsCache.set(cacheKey, payload, { negative: true });
      return { notFound: false, song, lyrics: payload };
    }

    const payload = {
      source: 'unavailable',
      status: LYRICS_RESOLUTION_STATUS.UNAVAILABLE,
      synced: false,
      lines: [],
      plain: '',
      match: LYRICS_MATCH_CLASS.NONE,
      provider: null,
    };
    lyricsCache.set(cacheKey, payload, { negative: true });
    return { notFound: false, song, lyrics: payload };
  };

  return Object.freeze({ resolveSongLyrics });
}
