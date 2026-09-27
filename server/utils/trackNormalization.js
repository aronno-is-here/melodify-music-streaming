const BRACKET_NOISE_WORDS = new Set([
  'official',
  'video',
  'audio',
  'music',
  'lyrics',
  'lyric',
  'visualizer',
  'hd',
  '4k',
  'hq',
  'mv',
  'vevo',
  'topic',
  'channel',
]);

const TRAILING_NOISE_WORDS = new Set(['lyrics', 'lyric', 'visualizer', 'hd', '4k', 'hq']);

const TRAILING_NOISE_PHRASES = [
  'official music video',
  'official video',
  'official audio',
  'official lyrics',
  'lyric video',
  'lyrics video',
  'music video',
];

const FEATURED_BRACKET = /\s*\((?:feat(?:uring)?|ft)\.?\s+[^)]*\)/gi;
const FEATURED_SUFFIX = /\s+(?:feat(?:uring)?|ft)\.?\s+.*$/i;
const NOISE_BRACKET = /[\([{]([^)\]}]*)[\])}]/g;
const TOPIC_SUFFIX = /\s*-\s*topic$/i;
const VEVO_SUFFIX = /\s+vevo$/i;

const collapse = (value) => String(value)
  .replace(/\s+/g, ' ')
  .replace(/\s+([),])/g, '$1')
  .replace(/([(\[])\s+/g, '$1')
  .trim();

const tokenizeWords = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .split(/[^\p{L}\p{N}]+/u)
  .filter(Boolean);

const isNoiseOnly = (value, allowedWords) => {
  const words = tokenizeWords(value);
  if (words.length === 0) return false;
  return words.every((word) => allowedWords.has(word));
};

function removeNoiseBrackets(value, allowedWords) {
  let result = value;
  for (let guard = 0; guard < 6; guard += 1) {
    const next = result.replace(NOISE_BRACKET, (match, inner) => {
      if (String(inner).trim() && isNoiseOnly(inner, allowedWords)) return ' ';
      return match;
    });
    if (next === result) return result;
    result = next;
  }
  return result;
}

function removeFeatured(value) {
  let result = value.replace(FEATURED_BRACKET, ' ');
  result = result.replace(FEATURED_SUFFIX, '');
  return result;
}

function removeTrailingNoise(value) {
  let result = value;
  const phrasePattern = new RegExp(
    `\\s*(?:[-\u2013\u2014]\\s*)?(?:${TRAILING_NOISE_PHRASES.join('|')})\\s*$`,
    'i',
  );
  const singlePattern = new RegExp(
    `\\s*(?:[-\u2013\u2014]\\s*)?(?:${[...TRAILING_NOISE_WORDS].join('|')})\\s*$`,
    'i',
  );
  for (let guard = 0; guard < 6; guard += 1) {
    const next = result.replace(phrasePattern, '').replace(singlePattern, '');
    if (next === result) return result;
    result = next;
  }
  return result;
}

function trimNoiseWords(value) {
  let result = value;
  const leadingPhrase = new RegExp(
    '^(?:official(?:\\s+music)?\\s+video|official\\s+audio)\\s*(?:[-\u2013\u2014]\\s*)?',
    'i',
  );
  for (let guard = 0; guard < 4; guard += 1) {
    const next = result.replace(leadingPhrase, '');
    if (next === result) return result;
    result = next;
  }
  return result;
}

export function normalizeTrackTitle(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let value = raw.normalize('NFKC');
  value = removeFeatured(value);
  value = removeNoiseBrackets(value, BRACKET_NOISE_WORDS);
  value = removeTrailingNoise(value);
  value = trimNoiseWords(value);
  return collapse(value);
}

export function normalizeTrackArtist(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let value = raw.normalize('NFKC');
  value = removeFeatured(value);
  value = value.replace(TOPIC_SUFFIX, '');
  value = value.replace(VEVO_SUFFIX, '');
  value = removeNoiseBrackets(value, BRACKET_NOISE_WORDS);
  return collapse(value);
}

export function normalizeTrackAlbum(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let value = raw.normalize('NFKC');
  value = removeFeatured(value);
  value = removeNoiseBrackets(value, BRACKET_NOISE_WORDS);
  return collapse(value);
}

const ARTIST_PREFIX_SEPARATOR = /\s+[-\u2013\u2014]\s+/;

const tokenSimilarity = (left, right) => {
  const setA = new Set(tokenizeWords(left));
  const setB = new Set(tokenizeWords(right));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
};

export function prepareTrackForProvider({ title, artist, album, duration } = {}) {
  let normalizedArtist = normalizeTrackArtist(artist);
  let normalizedTitle = normalizeTrackTitle(title);

  if (ARTIST_PREFIX_SEPARATOR.test(normalizedTitle)) {
    const separatorIndex = normalizedTitle.search(ARTIST_PREFIX_SEPARATOR);
    const prefix = normalizedTitle.slice(0, separatorIndex).trim();
    const remainder = normalizeTrackTitle(normalizedTitle.slice(separatorIndex).replace(ARTIST_PREFIX_SEPARATOR, ' '));
    const artistMissing = !normalizedArtist;
    const prefixMatchesArtist = normalizedArtist
      && (prefix.toLowerCase() === normalizedArtist.toLowerCase() || tokenSimilarity(prefix, normalizedArtist) >= 0.6);
    if (prefix && remainder && !isNoiseOnly(remainder, BRACKET_NOISE_WORDS) && (artistMissing || prefixMatchesArtist)) {
      normalizedTitle = remainder;
      if (artistMissing) normalizedArtist = prefix;
    } else if (prefix && remainder && !artistMissing && remainder.toLowerCase() === normalizedArtist.toLowerCase()) {
      normalizedTitle = prefix;
    }
  }

  return {
    title: normalizedTitle,
    artist: normalizedArtist,
    album: normalizeTrackAlbum(album),
    duration,
  };
}
