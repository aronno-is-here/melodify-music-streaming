import { REGIONAL_TAGS, inferLanguageFromRegion } from '../services/regionalCatalog.js';

export const MAX_CATALOG_TITLE_LENGTH = 200;
export const MAX_CATALOG_ARTIST_LENGTH = 200;
export const MAX_CATALOG_CHANNEL_LENGTH = 200;
export const MAX_CATALOG_LANGUAGE_LENGTH = 16;

export const CATALOG_NON_MUSIC = Object.freeze({
  MUSIC: 'MUSIC',
  LIKELY_MUSIC: 'LIKELY_MUSIC',
  NON_MUSIC: 'NON_MUSIC',
  UNCERTAIN: 'UNCERTAIN',
});

export const UPLOADER_AS_ARTIST_LEVEL = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NONE: 'NONE',
});

export const CATALOG_ARTIST_CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  UNCERTAIN: 'uncertain',
  NONE: 'none',
});

export const CATALOG_REPAIR_CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NONE: 'NONE',
});

export const CATALOG_LANGUAGE_CODES = Object.freeze(['bn', 'hi', 'en']);

const NON_MUSIC_STRONG_PATTERNS = Object.freeze([
  /\binterviews?\b/i,
  /\bpodcasts?\b/i,
  /\bvlogs?\b/i,
  /\bpress conference\b/i,
  /\btalk show\b/i,
  /\bfull episode\b/i,
  /\bbehind the scenes\b/i,
  /\bdocumentary\b/i,
  /\blectures?\b/i,
  /\bsermons?\b/i,
  /\bunboxing\b/i,
  /\bgameplay\b/i,
  /\bwalkthrough\b/i,
]);

const NON_MUSIC_MODERATE_PATTERNS = Object.freeze([
  /\bnews\b/i,
  /\bbreaking\b/i,
  /\breactions?\b/i,
  /\bcommentary\b/i,
  /\breviews?\b/i,
  /\bmaking of\b/i,
  /\bannouncement\b/i,
  /\btrailer\b/i,
  /\bteaser\b/i,
]);

const MUSIC_DECORATION_PATTERNS = Object.freeze([
  /\bofficial music video\b/i,
  /\bofficial video\b/i,
  /\bmusic video\b/i,
  /\blyrics?\s+video\b/i,
  /\bwith lyrics\b/i,
  /\bofficial audio\b/i,
  /\bkaraoke\b/i,
  /\bstudio version\b/i,
]);

const LABEL_TOKEN_PATTERNS = Object.freeze([
  /\bmusic\b/i,
  /\brecords?\b/i,
  /\brecordings?\b/i,
  /\bfilms?\b/i,
  /\bentertainment\b/i,
  /\bproductions?\b/i,
  /\bstudios?\b/i,
  /\bvision\b/i,
  /\bchannel\b/i,
  /\bofficial\b/i,
  /\bnetwork\b/i,
  /\bmedia\b/i,
  /\bpublishing\b/i,
  /\blabel\b/i,
  /\bseries\b/i,
  /\blyrical\b/i,
  /\bvideos?\b/i,
  /\buncensored\b/i,
  /\bworldwide\b/i,
  /\bcollection\b/i,
  /\bcompany\b/i,
  /\binc\b/i,
  /\bltd\b/i,
]);

const DECORATION_SEGMENTS = Object.freeze(new Set([
  'official video',
  'official music video',
  'music video',
  'video',
  'lyrics video',
  'lyric video',
  'lyrical video',
  'lyrics',
  'lyric',
  'full video',
  'official audio',
  'audio',
  'studio version',
  'official',
  'official lyric video',
  'with lyrics',
  'hq',
  'hd',
  'mv',
  'm/v',
  'visualizer',
  'visualiser',
  'promo',
  'song',
  'official song',
]));

const DECORATION_PARENTHESIS_PATTERN = /^\(?\s*(?:official(?:\s+music)?\s+video|lyrics?(?:\s+video)?|official\s+audio|audio|studio\s+version|official|hq|hd|with\s+lyrics|visuali[sz]er|remastered|explicit)\s*\)?$/i;

const VERSION_SENSITIVE_PATTERN = /\b(karaoke|instrumental)\b/i;
const VERSION_MARKER_SEGMENTS = Object.freeze(new Set(['live', 'acoustic', 'remix', 'cover']));
const FEATURING_PATTERN = /\s+(?:featuring|feat\.?|ft\.?)\s+/i;

const BANGLADESH_REGION_PATTERN = /\b(bangladesh|bangladeshi|dhaka|\u09a8\u09cd\u09b0\u09ac|\u09a2\u09be\u0995\u09be)\b/i;
const BENGALI_INDIA_REGION_PATTERN = /\b(kolkata|calcutta|west\s+bengal|tollywood|bengali\s+india|indian\s+bengali)\b/i;
const HINDI_INDIA_REGION_PATTERN = /\b(bollywood|mumbai|delhi|hindi)\b/i;

const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;
const BENGALI_SCRIPT_PATTERN = /[\u0980-\u09FF]/;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const STYLIZED_ALPHABET_PATTERN = /[\u{1D400}-\u{1D7FF}\u{1F110}-\u{1F189}]/u;

const REGION_TAG_VALUES = new Set(Object.values(REGIONAL_TAGS));

const asText = (value) => (typeof value === 'string' ? value : '');

export function normalizeCatalogText(value, maxLength = MAX_CATALOG_TITLE_LENGTH) {
  const normalized = asText(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

export const LYRICS_PLACEHOLDER_PATTERN = /^(?=[?\s]*\?)[\s?]+$/;
export const MAX_LYRICS_SCRIPT_SAMPLE_LENGTH = 4000;

export function looksLikePlaceholderLyrics(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError('looksLikePlaceholderLyrics expects a string');
  }
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return LYRICS_PLACEHOLDER_PATTERN.test(trimmed);
}

export function extractLyricsScriptSample(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError('extractLyricsScriptSample expects a string');
  }
  if (looksLikePlaceholderLyrics(raw)) return '';
  const withoutTimestamps = raw.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, ' ');
  const normalized = withoutTimestamps.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, MAX_LYRICS_SCRIPT_SAMPLE_LENGTH);
}

export function detectMetadataScript(text) {
  if (typeof text !== 'string') {
    throw new TypeError('detectMetadataScript expects a string');
  }
  const sample = text;
  let devanagari = 0;
  let bengali = 0;
  let latin = 0;
  for (const char of sample) {
    if (DEVANAGARI_PATTERN.test(char)) devanagari += 1;
    else if (BENGALI_SCRIPT_PATTERN.test(char)) bengali += 1;
    else if (LATIN_LETTER_PATTERN.test(char)) latin += 1;
  }
  if (devanagari === 0 && bengali === 0) return latin > 0 ? 'latin' : 'unknown';
  if (devanagari >= bengali) return 'devanagari';
  return 'bengali';
}

const compareKey = (value) => asText(value)
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const wordCount = (value) => compareKey(value).split(' ').filter(Boolean).length;

export function isDecorationSegment(value) {
  const normalized = compareKey(value);
  if (!normalized) return false;
  if (DECORATION_SEGMENTS.has(normalized)) return true;
  return /^(?:official|lyric|lyrics|music|full|studio|original|hd|hq)?\s*(?:video|audio|version|track|visuali[sz]er)$/.test(normalized);
}

export function isLabelLikeArtist(value) {
  const normalized = normalizeCatalogText(value, MAX_CATALOG_ARTIST_LENGTH);
  if (!normalized) return false;
  if (STYLIZED_ALPHABET_PATTERN.test(asText(value))) return true;
  return LABEL_TOKEN_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasStylizedArtistScript(value) {
  return STYLIZED_ALPHABET_PATTERN.test(asText(value));
}

const stripDecorationParentheses = (value) => asText(value).replace(/\s*\([^)]*\)/g, (match) => {
  const inner = match.slice(match.indexOf('(') + 1, match.lastIndexOf(')')).trim();
  return DECORATION_PARENTHESIS_PATTERN.test(inner) && !VERSION_SENSITIVE_PATTERN.test(inner) ? ' ' : match;
});

const splitOnColon = (segment) => {
  if (!segment.includes(':')) return [segment];
  const parts = segment.split(/\s*:\s*/);
  if (parts.some((part) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(part.trim()))) return [segment];
  return parts;
};

export function splitCatalogTitleSegments(value) {
  const normalized = normalizeCatalogText(value, MAX_CATALOG_TITLE_LENGTH) || asText(value);
  const base = stripDecorationParentheses(normalized);
  return base
    .split(/\s*[|\uFF5C]\s*|\s+[-\u2013\u2014]\s+/)
    .flatMap(splitOnColon)
    .map((part) => part.trim())
    .filter(Boolean);
}

const extractFeaturingLead = (value) => {
  const normalized = asText(value);
  if (!FEATURING_PATTERN.test(normalized)) return { lead: normalized, featured: false };
  const lead = normalized.split(FEATURING_PATTERN)[0].trim();
  return { lead: lead || normalized, featured: true };
};

export function classifyNonMusic({ title, artist, durationSeconds, category } = {}) {
  const haystack = [asText(title), asText(artist)].filter(Boolean).join(' ');
  const strongHits = NON_MUSIC_STRONG_PATTERNS.filter((pattern) => pattern.test(haystack)).length;
  const moderateHits = NON_MUSIC_MODERATE_PATTERNS.filter((pattern) => pattern.test(haystack)).length;
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null;
  const musicDecoration = MUSIC_DECORATION_PATTERNS.some((pattern) => pattern.test(haystack));
  const reasons = [];

  if (strongHits > 0) reasons.push('non-music-title-token');
  else if (moderateHits >= 2) reasons.push('multiple-non-music-title-tokens');
  else if (moderateHits >= 1 && duration !== null && duration >= 1500) reasons.push('non-music-title-token-long-video');

  if (reasons.length > 0) return { classification: CATALOG_NON_MUSIC.NON_MUSIC, reasons };
  if (category === 'Music' || musicDecoration) return { classification: CATALOG_NON_MUSIC.MUSIC, reasons: ['music-decoration'] };
  if (duration !== null && duration >= 1800) return { classification: CATALOG_NON_MUSIC.UNCERTAIN, reasons: ['long-video'] };
  if (duration !== null && duration <= 1200) return { classification: CATALOG_NON_MUSIC.LIKELY_MUSIC, reasons: ['short-video'] };
  return { classification: CATALOG_NON_MUSIC.UNCERTAIN, reasons: ['no-signal'] };
}

export function isCreditSegment(value) {
  const normalized = normalizeCatalogText(value, MAX_CATALOG_ARTIST_LENGTH);
  if (!normalized) return false;
  if (isDecorationSegment(normalized)) return false;
  if (isLabelLikeArtist(normalized)) return false;
  if (detectMetadataScript(normalized) !== 'latin') return false;
  if (classifyNonMusic({ title: normalized }).classification === CATALOG_NON_MUSIC.NON_MUSIC) return false;
  const { lead, featured } = extractFeaturingLead(normalized);
  if (!featured && wordCount(lead) < 2) return false;
  return true;
}

export function extractCatalogArtistCandidate(value) {
  const normalized = normalizeCatalogText(value, MAX_CATALOG_ARTIST_LENGTH);
  if (!normalized || !isCreditSegment(normalized)) return null;
  const { lead } = extractFeaturingLead(normalized);
  return normalizeCatalogText(lead, MAX_CATALOG_ARTIST_LENGTH);
}

export function isVersionSensitiveTitle(value) {
  const normalized = compareKey(value);
  if (VERSION_SENSITIVE_PATTERN.test(normalized)) return true;
  return splitCatalogTitleSegments(value).some((segment) => VERSION_MARKER_SEGMENTS.has(compareKey(segment)));
}

const buildTitleFromSegments = (segments) => {
  const nonDecoration = segments.filter((segment) => !isDecorationSegment(segment));
  return nonDecoration.length > 0 ? nonDecoration[0] : null;
};

export function extractTrackTitle(value) {
  const raw = normalizeCatalogText(value, MAX_CATALOG_TITLE_LENGTH);
  if (!raw) return { title: null, changed: false };
  if (isVersionSensitiveTitle(raw)) return { title: raw, changed: false };
  const derived = buildTitleFromSegments(splitCatalogTitleSegments(raw));
  if (!derived) return { title: raw, changed: false };
  return { title: derived, changed: derived !== raw };
}

export function isNoisyTitle(value) {
  const raw = normalizeCatalogText(value, MAX_CATALOG_TITLE_LENGTH);
  if (!raw) return false;
  const derived = buildTitleFromSegments(splitCatalogTitleSegments(raw));
  return derived !== null && derived !== raw;
}

const channelMatchesSegment = (channel, segments) => {
  const key = compareKey(channel);
  if (!key) return -1;
  return segments.findIndex((segment) => compareKey(segment) === key);
};

export function resolveCatalogTrack({ title, channelTitle, artistCandidate, artistCandidateSource } = {}) {
  const rawTitle = normalizeCatalogText(title, MAX_CATALOG_TITLE_LENGTH);
  const channel = normalizeCatalogText(channelTitle, MAX_CATALOG_CHANNEL_LENGTH);
  const candidate = normalizeCatalogText(artistCandidate, MAX_CATALOG_ARTIST_LENGTH);
  const topicChannel = artistCandidateSource === 'topic-channel';
  const candidateUsable = Boolean(candidate) && !topicChannel && !isLabelLikeArtist(candidate);

  if (!rawTitle) {
    return { title: null, artist: null, artistConfidence: CATALOG_ARTIST_CONFIDENCE.NONE, reasons: ['missing-title'] };
  }

  const segments = splitCatalogTitleSegments(rawTitle).filter((segment) => !isDecorationSegment(segment));

  if (topicChannel && candidate) {
    const matchIndex = channelMatchesSegment(candidate, segments);
    const derivedTitle = matchIndex >= 0 && segments.length > 1
      ? segments.filter((_, index) => index !== matchIndex)[0]
      : segments[0] || rawTitle;
    return {
      title: derivedTitle,
      artist: candidate,
      artistConfidence: CATALOG_ARTIST_CONFIDENCE.HIGH,
      reasons: ['topic-channel'],
    };
  }

  if (channel && !isLabelLikeArtist(channel)) {
    const matchIndex = channelMatchesSegment(channel, segments);
    if (matchIndex >= 0) {
      const others = segments.filter((_, index) => index !== matchIndex);
      return {
        title: others[0] || segments[matchIndex],
        artist: channel,
        artistConfidence: CATALOG_ARTIST_CONFIDENCE.HIGH,
        reasons: ['channel-credit-match'],
      };
    }
  }

  if (segments.length === 2) {
    return {
      title: rawTitle,
      artist: candidateUsable ? candidate : null,
      artistConfidence: candidateUsable ? CATALOG_ARTIST_CONFIDENCE.UNCERTAIN : CATALOG_ARTIST_CONFIDENCE.NONE,
      reasons: ['ambiguous-split'],
    };
  }

  const creditWindow = segments.slice(1, 3);
  const credits = creditWindow.map((segment) => extractCatalogArtistCandidate(segment)).filter(Boolean);

  if (credits.length === 1) {
    return {
      title: segments[0] || rawTitle,
      artist: credits[0],
      artistConfidence: CATALOG_ARTIST_CONFIDENCE.HIGH,
      reasons: ['single-credit'],
    };
  }
  if (credits.length > 1) {
    return {
      title: segments[0] || rawTitle,
      artist: null,
      artistConfidence: CATALOG_ARTIST_CONFIDENCE.NONE,
      reasons: ['ambiguous-credit'],
    };
  }

  if (candidateUsable) {
    return {
      title: segments[0] || rawTitle,
      artist: candidate,
      artistConfidence: CATALOG_ARTIST_CONFIDENCE.UNCERTAIN,
      reasons: ['channel-fallback'],
    };
  }

  return {
    title: segments[0] || rawTitle,
    artist: null,
    artistConfidence: CATALOG_ARTIST_CONFIDENCE.NONE,
    reasons: [candidate ? 'label-channel' : 'missing-artist'],
  };
}

export function detectUploaderAsArtist({ title, artist, channelTitle } = {}) {
  const rawArtist = normalizeCatalogText(artist, MAX_CATALOG_ARTIST_LENGTH);
  const rawTitle = normalizeCatalogText(title, MAX_CATALOG_TITLE_LENGTH);
  if (!rawArtist || !rawTitle) {
    return { level: UPLOADER_AS_ARTIST_LEVEL.NONE, reasons: [] };
  }

  const reasons = [];
  if (isLabelLikeArtist(rawArtist)) reasons.push('label-style-artist');
  if (hasStylizedArtistScript(artist)) reasons.push('stylized-artist');
  if (channelTitle && compareKey(channelTitle) === compareKey(rawArtist)) reasons.push('artist-equals-channel');

  if (!compareKey(rawTitle).includes(compareKey(rawArtist))) reasons.push('artist-not-in-title');

  const segments = splitCatalogTitleSegments(rawTitle).filter((segment) => !isDecorationSegment(segment));
  const credits = segments
    .slice(1)
    .map((segment) => extractCatalogArtistCandidate(segment) || segment)
    .filter((value) => isCreditSegment(value));
  const creditsDiffer = credits.length > 0
    && !credits.some((credit) => compareKey(credit) === compareKey(rawArtist));
  if (creditsDiffer) reasons.push('title-credits-different-artist');

  let level = UPLOADER_AS_ARTIST_LEVEL.NONE;
  if (
    reasons.includes('label-style-artist')
    || reasons.includes('stylized-artist')
    || reasons.includes('artist-equals-channel')
  ) {
    level = UPLOADER_AS_ARTIST_LEVEL.HIGH;
  } else if (reasons.includes('artist-not-in-title') && reasons.includes('title-credits-different-artist')) {
    level = credits.length === 1
      ? UPLOADER_AS_ARTIST_LEVEL.HIGH
      : UPLOADER_AS_ARTIST_LEVEL.MEDIUM;
  }

  return { level, reasons };
}

const validLanguageToken = (value) => {
  const normalized = asText(value).trim().toLowerCase();
  if (!normalized || normalized.length > MAX_CATALOG_LANGUAGE_LENGTH) return null;
  const base = normalized.split(/[-_]/)[0];
  return CATALOG_LANGUAGE_CODES.includes(base) ? base : null;
};

export function inferCatalogLanguage(song = {}) {
  const existing = validLanguageToken(song.language);
  if (existing) return { language: existing, confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['existing-language'] };

  const regionTag = asText(song.regional_tag).trim().toLowerCase();
  const fromRegion = REGION_TAG_VALUES.has(regionTag) ? inferLanguageFromRegion(regionTag) : null;
  if (fromRegion) return { language: fromRegion, confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['regional-tag'] };

  const titleScript = detectMetadataScript([song.title, song.artist, song.album].filter(Boolean).join(' '));
  if (titleScript === 'devanagari') return { language: 'hi', confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['devanagari-script'] };
  if (titleScript === 'bengali') return { language: 'bn', confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['bengali-script'] };

  const lyricsSample = typeof song.lyrics === 'string' ? extractLyricsScriptSample(song.lyrics) : '';
  const lyricsScript = lyricsSample ? detectMetadataScript(lyricsSample) : 'unknown';
  if (lyricsScript === 'devanagari') return { language: 'hi', confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['devanagari-lyrics'] };
  if (lyricsScript === 'bengali') return { language: 'bn', confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['bengali-lyrics'] };

  const genre = asText(song.genre).toLowerCase();
  if (/\bhindi\b/.test(genre)) return { language: 'hi', confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['genre-hint'] };
  if (/\b(bengali|bangla)\b/.test(genre)) return { language: 'bn', confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['genre-hint'] };

  return { language: null, confidence: CATALOG_REPAIR_CONFIDENCE.NONE, reasons: ['no-signal'] };
}

export function inferCatalogRegionTag(song = {}) {
  const existing = asText(song.regional_tag).trim().toLowerCase();
  if (REGION_TAG_VALUES.has(existing)) {
    return { regionalTag: existing, confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['existing-regional-tag'] };
  }

  const haystack = [song.title, song.album, song.genre].filter(Boolean).join(' ');
  if (!haystack) return { regionalTag: null, confidence: CATALOG_REPAIR_CONFIDENCE.NONE, reasons: ['no-signal'] };

  if (BANGLADESH_REGION_PATTERN.test(haystack)) {
    return { regionalTag: REGIONAL_TAGS.BANGLA_BD, confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['region-text'] };
  }
  if (BENGALI_INDIA_REGION_PATTERN.test(haystack)) {
    return { regionalTag: REGIONAL_TAGS.BENGALI_IN, confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['region-text'] };
  }
  if (HINDI_INDIA_REGION_PATTERN.test(haystack)) {
    return { regionalTag: REGIONAL_TAGS.HINDI_IN, confidence: CATALOG_REPAIR_CONFIDENCE.HIGH, reasons: ['region-text'] };
  }
  return { regionalTag: null, confidence: CATALOG_REPAIR_CONFIDENCE.NONE, reasons: ['unknown-region'] };
}

const toDurationSeconds = (value) => {
  if (Number.isFinite(value) && value > 0) return value;
  const parts = asText(value).split(':').map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => Number.isFinite(part) && part >= 0)) return null;
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
};

export const CATALOG_TRACK_REPAIR_FIELDS = Object.freeze(['title', 'artist']);

export function buildCatalogSongAssessment(song = {}) {
  const songId = song?._id == null ? '' : String(song._id);
  const title = normalizeCatalogText(song.title, MAX_CATALOG_TITLE_LENGTH);
  const artist = normalizeCatalogText(song.artist, MAX_CATALOG_ARTIST_LENGTH);
  const durationSeconds = toDurationSeconds(song.duration_seconds ?? song.duration);
  const nonMusic = classifyNonMusic({ title, artist, durationSeconds, category: song.category });
  const uploader = detectUploaderAsArtist({ title, artist, channelTitle: song.source_channel });
  const noisyTitle = isNoisyTitle(title);
  const regionSong = uploader.level === UPLOADER_AS_ARTIST_LEVEL.NONE
    ? song
    : { title: song.title, album: song.album, genre: song.genre };
  const language = inferCatalogLanguage(song);
  const region = inferCatalogRegionTag(regionSong);
  const versionSensitive = isVersionSensitiveTitle(title);

  const repair = { confidence: CATALOG_REPAIR_CONFIDENCE.NONE, reasons: [], changes: [] };

  const canRepairTrack = !versionSensitive
    && nonMusic.classification !== CATALOG_NON_MUSIC.NON_MUSIC
    && uploader.level === UPLOADER_AS_ARTIST_LEVEL.HIGH;

  if (canRepairTrack) {
    const resolved = resolveCatalogTrack({
      title,
      channelTitle: song.source_channel,
      artistCandidate: song.source_channel || artist,
      artistCandidateSource: song.artist_candidate_source,
    });
    const artistResolved = Boolean(resolved.artist)
      && resolved.artistConfidence === CATALOG_ARTIST_CONFIDENCE.HIGH
      && resolved.artist !== artist;
    if (artistResolved) {
      if (resolved.title && resolved.title !== title) {
        repair.changes.push({ field: 'title', from: title, to: resolved.title, reason: 'drop-uploader-title-noise' });
      }
      repair.changes.push({ field: 'artist', from: artist, to: resolved.artist, reason: 'drop-uploader-as-artist' });
      repair.confidence = CATALOG_REPAIR_CONFIDENCE.HIGH;
      repair.reasons.push('high-confidence-track-metadata');
    }
  }

  if (nonMusic.classification === CATALOG_NON_MUSIC.NON_MUSIC && song.recommendation_eligible !== false) {
    repair.changes.push({ field: 'recommendation_eligible', from: true, to: false, reason: 'non-music-content' });
    if (repair.confidence === CATALOG_REPAIR_CONFIDENCE.NONE) repair.confidence = CATALOG_REPAIR_CONFIDENCE.HIGH;
    repair.reasons.push('non-music-eligibility');
  }

  const currentLanguage = validLanguageToken(song.language);
  if (language.language && language.language !== currentLanguage && language.confidence === CATALOG_REPAIR_CONFIDENCE.HIGH) {
    repair.changes.push({ field: 'language', from: currentLanguage, to: language.language, reason: language.reasons.join('+') });
    if (repair.confidence === CATALOG_REPAIR_CONFIDENCE.NONE) repair.confidence = CATALOG_REPAIR_CONFIDENCE.HIGH;
    repair.reasons.push('language-enrichment');
  }

  const currentRegion = asText(song.regional_tag).trim().toLowerCase();
  const existingRegion = REGION_TAG_VALUES.has(currentRegion) ? currentRegion : null;
  if (region.regionalTag && region.regionalTag !== existingRegion && region.confidence === CATALOG_REPAIR_CONFIDENCE.HIGH) {
    repair.changes.push({ field: 'regional_tag', from: existingRegion, to: region.regionalTag, reason: region.reasons.join('+') });
    if (repair.confidence === CATALOG_REPAIR_CONFIDENCE.NONE) repair.confidence = CATALOG_REPAIR_CONFIDENCE.HIGH;
    repair.reasons.push('region-enrichment');
  }

  const hasTrackRepair = repair.changes.some((change) => CATALOG_TRACK_REPAIR_FIELDS.includes(change.field));
  const review = [];
  if (uploader.level !== UPLOADER_AS_ARTIST_LEVEL.NONE && !hasTrackRepair) {
    review.push({
      field: 'artist',
      from: artist,
      to: null,
      confidence: CATALOG_REPAIR_CONFIDENCE.LOW,
      reason: nonMusic.classification === CATALOG_NON_MUSIC.NON_MUSIC
        ? 'non-music-no-artist'
        : 'artist-credit-ambiguous',
    });
  }

  return {
    songId,
    title,
    artist,
    durationSeconds,
    findings: {
      good: uploader.level === UPLOADER_AS_ARTIST_LEVEL.NONE && nonMusic.classification !== CATALOG_NON_MUSIC.NON_MUSIC,
      uploaderAsArtist: uploader.level !== UPLOADER_AS_ARTIST_LEVEL.NONE,
      noisyTitle,
      missingLanguage: !currentLanguage,
      missingRegion: !existingRegion,
      placeholderLyrics: typeof song.lyrics === 'string' && looksLikePlaceholderLyrics(song.lyrics),
      nonMusic: nonMusic.classification === CATALOG_NON_MUSIC.NON_MUSIC,
      ambiguous: review.length > 0 && repair.confidence !== CATALOG_REPAIR_CONFIDENCE.HIGH,
    },
    uploaderLevel: uploader.level,
    uploaderReasons: uploader.reasons,
    nonMusic: nonMusic.classification,
    nonMusicReasons: nonMusic.reasons,
    language: language.language,
    languageConfidence: language.confidence,
    regionalTag: region.regionalTag,
    versionSensitive,
    repair,
    review,
  };
}

export function summarizeCatalogAssessments(assessments) {
  const list = Array.isArray(assessments) ? assessments : [];
  const summary = {
    audited: list.length,
    good: 0,
    probableUploaderAsArtist: 0,
    noisyTitle: 0,
    missingLanguage: 0,
    missingRegion: 0,
    placeholderLyrics: 0,
    nonMusic: 0,
    ambiguous: 0,
    highConfidenceRepairs: 0,
    highConfidenceRows: 0,
    skippedRepairs: 0,
    modifiedRows: 0,
    fieldChanges: 0,
  };

  for (const assessment of list) {
    const findings = assessment.findings;
    if (findings.good) summary.good += 1;
    if (findings.uploaderAsArtist) summary.probableUploaderAsArtist += 1;
    if (findings.noisyTitle) summary.noisyTitle += 1;
    if (findings.missingLanguage) summary.missingLanguage += 1;
    if (findings.missingRegion) summary.missingRegion += 1;
    if (findings.placeholderLyrics) summary.placeholderLyrics += 1;
    if (findings.nonMusic) summary.nonMusic += 1;
    if (findings.ambiguous) summary.ambiguous += 1;

    if (assessment.repair.confidence === CATALOG_REPAIR_CONFIDENCE.HIGH && assessment.repair.changes.length > 0) {
      summary.highConfidenceRepairs += assessment.repair.changes.length;
      summary.highConfidenceRows += 1;
      summary.fieldChanges += assessment.repair.changes.length;
      summary.modifiedRows += 1;
    } else {
      summary.skippedRepairs += assessment.repair.changes.length;
    }
    summary.skippedRepairs += assessment.review.length;
  }

  return summary;
}
