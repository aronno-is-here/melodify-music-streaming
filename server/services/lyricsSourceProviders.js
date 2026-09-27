import {
  normalizeTrackArtist,
  normalizeTrackTitle,
  prepareTrackForProvider,
} from '../utils/trackNormalization.js';
import { romanizeText } from '../utils/lyricsRomanization.js';

export const MAX_DISCOVERY_SOURCES = 5;
export const MAX_QUERY_VARIANTS = 3;
export const LYRICFIND_PROVIDER_ID = 'lyricfind';

const DASH_SEPARATOR = /\s+[-–—]\s+/;
const ARTIST_SPLIT = /\s+[-–—]\s+|\s*\|\s*|\s+·\s+/;

const normalizeComparable = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function removeArtistMention(text, artist) {
  const source = String(text || '');
  const trimmedArtist = String(artist || '').trim();
  if (!source || !trimmedArtist) return source;
  const escaped = escapeRegExp(trimmedArtist);
  const suffixPattern = new RegExp(`\\s*[-–—|]\\s*${escaped}\\s*$`, 'i');
  const prefixPattern = new RegExp(`^\\s*${escaped}\\s*[-–—|]\\s*`, 'i');
  let next = source.replace(suffixPattern, ' ').replace(prefixPattern, ' ');
  if (normalizeComparable(next) === normalizeComparable(trimmedArtist) || !next.trim()) {
    next = source;
  }
  if (next === source) {
    next = source.replace(new RegExp(escaped, 'i'), ' ');
  }
  return next.replace(/\s+[-–—]\s*$/, '').replace(/^[\s|]+/, '').replace(/\s+/g, ' ').trim();
}

function derivePathCandidate(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/lyrics\/([^/]+)\/([^/]+)\.html$/i);
    if (!match) return null;
    const artist = decodeURIComponent(match[1]).replace(/[-_+]+/g, ' ').trim();
    const title = decodeURIComponent(match[2]).replace(/[-_+]+/g, ' ').trim();
    if (!artist || !title) return null;
    return { artistName: artist, trackName: title };
  } catch {
    return null;
  }
}

function getUrlComparable(url) {
  try {
    const parsed = new URL(url);
    return normalizeComparable(`${parsed.hostname} ${decodeURIComponent(parsed.pathname)}`);
  } catch {
    return '';
  }
}

/**
 * Derive track title + artist metadata from a discovered search-result link.
 * Only the anchor href and anchor text are used; page content is never read.
 * Returns null when the artist cannot be established (strict matching keeps
 * ambiguous candidates out of the suggested source list).
 */
export function deriveSourceCandidate({ url, text, song } = {}) {
  if (!song || typeof song !== 'object') return null;
  const songArtist = normalizeTrackArtist(song.artist);
  const songTitle = normalizeTrackTitle(song.title);
  if (!songArtist || !songTitle) return null;

  const pipe = String(text || '').split('|')[0].trim();
  let artistName = '';
  let titleText = pipe;

  const byMatch = pipe.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    titleText = byMatch[1].trim();
    artistName = byMatch[2].split(ARTIST_SPLIT)[0].trim();
  }

  if (!artistName) {
    const pathCandidate = typeof url === 'string' ? derivePathCandidate(url) : null;
    if (pathCandidate) {
      artistName = pathCandidate.artistName;
      titleText = pathCandidate.trackName;
    }
  }

  if (!artistName && pipe) {
    const parts = pipe.split(DASH_SEPARATOR);
    if (parts.length >= 2) {
      const artistIndex = parts.findIndex((part) => normalizeTrackArtist(part) === songArtist);
      if (artistIndex >= 0) {
        artistName = song.artist;
        titleText = parts.filter((_, index) => index !== artistIndex).join(' ');
      }
    }
  }

  if (!artistName && normalizeComparable(pipe).includes(songArtist.toLowerCase())) {
    artistName = song.artist;
  }

  const urlComparable = typeof url === 'string' ? getUrlComparable(url) : '';
  if (!artistName
    && urlComparable
    && urlComparable.includes(normalizeComparable(songArtist))
    && urlComparable.includes(normalizeComparable(songTitle))) {
    artistName = song.artist;
  }

  let trackName = normalizeTrackTitle(removeArtistMention(titleText, artistName));
  if (!trackName && urlComparable && urlComparable.includes(normalizeComparable(songTitle))) {
    trackName = normalizeTrackTitle(song.title);
  }

  const finalArtist = normalizeTrackArtist(artistName);
  const finalTitle = normalizeTrackTitle(trackName);
  if (!finalArtist || !finalTitle) return null;
  return {
    trackName: finalTitle.toLowerCase() === songTitle.toLowerCase() ? songTitle : finalTitle,
    artistName: finalArtist.toLowerCase() === songArtist.toLowerCase() ? songArtist : finalArtist,
  };
}

const encode = (value) => encodeURIComponent(String(value || '').trim());

const PROVIDERS = Object.freeze([
  {
    id: 'azlyrics',
    label: 'AZLyrics',
    hosts: ['azlyrics.com'],
    searchUrl: (query) => `https://search.azlyrics.com/search.php?q=${encode(query)}`,
  },
  {
    id: 'genius',
    label: 'Genius',
    hosts: ['genius.com'],
    searchUrl: (query) => `https://genius.com/search?q=${encode(query)}`,
  },
  {
    id: 'smule',
    label: 'Smule',
    hosts: ['smule.com'],
    searchUrl: (query) => `https://www.smule.com/search?q=${encode(query)}`,
  },
  {
    id: 'gaana',
    label: 'Gaana',
    hosts: ['gaana.com'],
    searchUrl: (query) => `https://gaana.com/search/${encode(query)}`,
  },
  {
    id: 'lyricsmode',
    label: 'LyricsMode',
    hosts: ['lyricsmode.com'],
    searchUrl: (query) => `https://www.lyricsmode.com/search/?q=${encode(query)}`,
  },
  {
    id: 'amarkobita4u',
    label: 'Amar Kobita 4U',
    hosts: ['amarkobita4u.com'],
    searchUrl: (query) => `https://www.amarkobita4u.com/?s=${encode(query)}`,
  },
  {
    id: 'banglaganlyrics',
    label: 'Bangla Gan Lyrics',
    hosts: ['banglaganlyrics.wordpress.com'],
    searchUrl: (query) => `https://banglaganlyrics.wordpress.com/?s=${encode(query)}`,
  },
  {
    id: 'gdn8',
    label: 'GDN8',
    hosts: ['gdn8.com'],
    searchUrl: (query) => `https://www.gdn8.com/?s=${encode(query)}`,
  },
  {
    id: 'scribd',
    label: 'Scribd',
    hosts: ['scribd.com'],
    searchUrl: (query) => `https://www.scribd.com/search?q=${encode(query)}`,
  },
  {
    id: 'ilyricshub',
    label: 'iLyrics Hub',
    hosts: ['ilyricshub.com'],
    searchUrl: (query) => `https://www.ilyricshub.com/search?q=${encode(query)}`,
  },
  {
    id: 'musixmatch',
    label: 'Musixmatch',
    hosts: ['musixmatch.com'],
    searchUrl: (query) => `https://www.musixmatch.com/search/${encode(query)}`,
  },
  {
    id: 'starmakerstudios',
    label: 'StarMaker',
    hosts: ['starmakerstudios.com'],
    searchUrl: (query) => `https://www.starmakerstudios.com/search?q=${encode(query)}`,
  },
  {
    id: 'letras',
    label: 'Letras',
    hosts: ['letras.com'],
    searchUrl: (query) => `https://www.letras.com/search/?q=${encode(query)}`,
  },
  {
    id: 'kkbox',
    label: 'KKBOX',
    hosts: ['kkbox.com'],
    searchUrl: (query) => `https://www.kkbox.com/search?q=${encode(query)}`,
  },
  {
    id: LYRICFIND_PROVIDER_ID,
    label: 'LyricFind',
    hosts: ['lyrics.lyricfind.com', 'lyricfind.com'],
    searchUrl: (query) => `https://lyrics.lyricfind.com/search?q=${encode(query)}`,
  },
]);

const PROVIDER_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export const LYRICS_DISCOVERY_PROVIDER_LISTS = Object.freeze({
  HINDI: Object.freeze(['azlyrics', 'genius', 'smule', 'gaana', 'lyricsmode']),
  BENGALI_INDIA: Object.freeze(['smule', 'amarkobita4u', 'banglaganlyrics', 'gdn8', 'scribd', 'ilyricshub']),
  BENGALI_BANGLADESH: Object.freeze(['musixmatch', 'genius', 'smule', 'starmakerstudios']),
  BENGALI: Object.freeze(['smule', 'amarkobita4u', 'banglaganlyrics', 'gdn8', 'scribd', 'ilyricshub', 'musixmatch', 'genius', 'starmakerstudios']),
  ENGLISH: Object.freeze(['azlyrics', 'genius', 'gaana', 'letras', 'kkbox', 'musixmatch']),
  OTHER: Object.freeze([]),
});

export function getLyricsSourceProvider(providerId) {
  return PROVIDER_BY_ID.get(providerId) || null;
}

export function listLyricsSourceProviders() {
  return PROVIDERS.map((provider) => provider);
}

export function selectLyricsDiscoveryProviders(category) {
  const ids = LYRICS_DISCOVERY_PROVIDER_LISTS[category] || [];
  return ids.map((id) => PROVIDER_BY_ID.get(id)).filter(Boolean);
}

export function isSearchResultUrl(url, searchUrl) {
  if (typeof url !== 'string') return true;
  if (typeof searchUrl === 'string' && url === searchUrl) return true;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.includes('/search')) return true;
    for (const key of ['q', 'query', 's', 'search']) {
      if (parsed.searchParams.has(key)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Bounded query variants per category. Never more than MAX_QUERY_VARIANTS.
 */
export function buildLyricsSourceQueries({ song = {}, category = '' } = {}) {
  const prepared = prepareTrackForProvider({
    title: song.title,
    artist: song.artist,
    album: song.album,
  });

  const originalTitle = String(song.title || '').trim();
  const originalArtist = String(song.artist || '').trim();
  const normalizedTitle = prepared.title || originalTitle;
  const normalizedArtist = prepared.artist || originalArtist;
  const album = prepared.album || '';

  const queries = [];
  const push = (value) => {
    const candidate = String(value || '').replace(/\s+/g, ' ').trim();
    if (candidate && !queries.includes(candidate)) queries.push(candidate);
  };

  const pushRomanized = () => {
    const romanizedTitle = romanizeText(normalizedTitle);
    const romanizedArtist = romanizeText(normalizedArtist);
    if (romanizedTitle || romanizedArtist) {
      push(`${romanizedTitle || normalizedTitle} ${romanizedArtist || normalizedArtist} lyrics`);
    }
  };

  if (category === 'BENGALI' || category === 'BENGALI_INDIA' || category === 'BENGALI_BANGLADESH') {
    push(`${originalTitle} ${originalArtist} lyrics`);
    push(`${normalizedTitle} ${normalizedArtist} lyrics`);
    pushRomanized();
  } else if (category === 'HINDI') {
    push(`${originalTitle} ${originalArtist} lyrics`);
    push(`${normalizedTitle} ${normalizedArtist} lyrics`);
    pushRomanized();
  } else if (category === 'ENGLISH') {
    push(`${normalizedTitle} ${normalizedArtist} lyrics`);
    if (album) push(`${normalizedTitle} ${normalizedArtist} ${album} lyrics`);
  } else {
    push(`${normalizedTitle} ${normalizedArtist} lyrics`);
    push(`${originalTitle} ${originalArtist} lyrics`);
  }

  return queries.slice(0, MAX_QUERY_VARIANTS);
}
