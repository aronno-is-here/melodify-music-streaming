import { REGIONAL_TAGS } from '../services/regionalCatalog.js';

// Combined Bengali pool is used when the Bangladesh vs. Kolkata region cannot be
// determined reliably instead of guessing one side.
export const LYRICS_DISCOVERY_CATEGORY = Object.freeze({
  HINDI: 'HINDI',
  BENGALI_BANGLADESH: 'BENGALI_BANGLADESH',
  BENGALI_INDIA: 'BENGALI_INDIA',
  BENGALI: 'BENGALI',
  ENGLISH: 'ENGLISH',
  OTHER: 'OTHER',
});

export const LYRICS_DISCOVERY_LANGUAGES = Object.freeze({
  HINDI: 'hindi',
  BENGALI: 'bengali',
  ENGLISH: 'english',
  OTHER: 'other',
  UNKNOWN: 'unknown',
});

export const LYRICS_DISCOVERY_REGIONS = Object.freeze({
  BANGLADESH: 'bangladesh',
  INDIA: 'india',
  UNKNOWN: 'unknown',
});

const REGION_TAG_CATEGORY = Object.freeze({
  [REGIONAL_TAGS.BANGLA_BD]: LYRICS_DISCOVERY_CATEGORY.BENGALI_BANGLADESH,
  [REGIONAL_TAGS.BENGALI_IN]: LYRICS_DISCOVERY_CATEGORY.BENGALI_INDIA,
  [REGIONAL_TAGS.HINDI_IN]: LYRICS_DISCOVERY_CATEGORY.HINDI,
  [REGIONAL_TAGS.ENGLISH]: LYRICS_DISCOVERY_CATEGORY.ENGLISH,
});

const REGION_TAG_REGION = Object.freeze({
  [REGIONAL_TAGS.BANGLA_BD]: LYRICS_DISCOVERY_REGIONS.BANGLADESH,
  [REGIONAL_TAGS.BENGALI_IN]: LYRICS_DISCOVERY_REGIONS.INDIA,
});

const LANGUAGE_ALIASES = Object.freeze({
  hi: LYRICS_DISCOVERY_LANGUAGES.HINDI,
  hin: LYRICS_DISCOVERY_LANGUAGES.HINDI,
  hindi: LYRICS_DISCOVERY_LANGUAGES.HINDI,
  bn: LYRICS_DISCOVERY_LANGUAGES.BENGALI,
  ben: LYRICS_DISCOVERY_LANGUAGES.BENGALI,
  bengali: LYRICS_DISCOVERY_LANGUAGES.BENGALI,
  bangla: LYRICS_DISCOVERY_LANGUAGES.BENGALI,
  bangali: LYRICS_DISCOVERY_LANGUAGES.BENGALI,
  en: LYRICS_DISCOVERY_LANGUAGES.ENGLISH,
  eng: LYRICS_DISCOVERY_LANGUAGES.ENGLISH,
  english: LYRICS_DISCOVERY_LANGUAGES.ENGLISH,
  ta: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  tamil: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  te: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  telugu: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  mr: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  marathi: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  ur: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  urdu: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  fr: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  french: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  es: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  spanish: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  pt: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  portuguese: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  ja: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  japanese: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  ko: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  korean: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  zh: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  chinese: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  ar: LYRICS_DISCOVERY_LANGUAGES.OTHER,
  arabic: LYRICS_DISCOVERY_LANGUAGES.OTHER,
});

const BANGLADESH_REGION_PATTERN = /\b(bangladesh|bangladeshi|dhaka|ঢাকা)\b/i;
const BENGALI_INDIA_REGION_PATTERN = /\b(kolkata|calcutta|west\s+bengal|tollywood|bengali\s+india|indian\s+bengali)\b/i;
const INDIA_REGION_PATTERN = /\b(india|indian|bollywood|mumbai|delhi|tollywood|kolkata|calcutta|west\s+bengal)\b/i;

const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;
const BENGALI_SCRIPT_PATTERN = /[\u0980-\u09FF]/;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;

const isDevanagariChar = (ch) => ch >= '\u0900' && ch <= '\u097F';
const isBengaliChar = (ch) => ch >= '\u0980' && ch <= '\u09FF';

const asText = (value) => (typeof value === 'string' ? value : '');

const normalizeLanguageToken = (value) => {
  const trimmed = asText(value).trim().toLowerCase();
  if (!trimmed) return null;
  const base = trimmed.split(/[-_]/)[0];
  if (LANGUAGE_ALIASES[trimmed]) return LANGUAGE_ALIASES[trimmed];
  if (LANGUAGE_ALIASES[base]) return LANGUAGE_ALIASES[base];
  return null;
};

function detectScript(text) {
  let devanagari = 0;
  let bengali = 0;
  let latin = 0;
  for (const ch of text) {
    if (isDevanagariChar(ch)) devanagari += 1;
    else if (isBengaliChar(ch)) bengali += 1;
    else if (LATIN_LETTER_PATTERN.test(ch)) latin += 1;
  }
  if (devanagari === 0 && bengali === 0) {
    return latin > 0 ? 'latin' : 'unknown';
  }
  if (devanagari >= bengali) return 'devanagari';
  return 'bengali';
}

function detectRegionFromText(values) {
  const haystack = values.filter(Boolean).join(' ');
  if (!haystack) return null;
  if (BANGLADESH_REGION_PATTERN.test(haystack)) return LYRICS_DISCOVERY_REGIONS.BANGLADESH;
  if (BENGALI_INDIA_REGION_PATTERN.test(haystack)) return LYRICS_DISCOVERY_REGIONS.INDIA;
  return null;
}

function bengaliCategoryForRegion(region) {
  if (region === LYRICS_DISCOVERY_REGIONS.BANGLADESH) return LYRICS_DISCOVERY_CATEGORY.BENGALI_BANGLADESH;
  if (region === LYRICS_DISCOVERY_REGIONS.INDIA) return LYRICS_DISCOVERY_CATEGORY.BENGALI_INDIA;
  return LYRICS_DISCOVERY_CATEGORY.BENGALI;
}

const result = (category, language, region, confidence, reasons) => ({
  category,
  language,
  region,
  combinedBengali: category === LYRICS_DISCOVERY_CATEGORY.BENGALI,
  confidence,
  reasons,
});

/**
 * Classify a track into a lyrics source discovery category using only available
 * metadata. Never guesses the Bengali region: uncertainty keeps the combined pool.
 */
export function classifyLyricsSource(metadata = {}) {
  const title = asText(metadata.title);
  const artist = asText(metadata.artist);
  const album = asText(metadata.album);
  const genre = asText(metadata.genre);

  const regionTag = asText(metadata.regionalTag || metadata.regional_tag).trim().toLowerCase();
  const explicitLanguage = normalizeLanguageToken(
    metadata.language ?? metadata.lyricsLanguage ?? metadata.lyrics_language,
  );

  const regionFromTag = REGION_TAG_REGION[regionTag] || null;
  const regionFromText = detectRegionFromText([
    metadata.region,
    metadata.catalogSource,
    metadata.sourceProvider,
    metadata.source_provider,
    metadata.category,
  ]);
  const region = regionFromTag || regionFromText;

  if (regionTag && REGION_TAG_CATEGORY[regionTag]) {
    const category = REGION_TAG_CATEGORY[regionTag];
    const language = category === LYRICS_DISCOVERY_CATEGORY.HINDI
      ? LYRICS_DISCOVERY_LANGUAGES.HINDI
      : category === LYRICS_DISCOVERY_CATEGORY.ENGLISH
        ? LYRICS_DISCOVERY_LANGUAGES.ENGLISH
        : LYRICS_DISCOVERY_LANGUAGES.BENGALI;
    return result(
      category,
      language,
      REGION_TAG_REGION[regionTag] || LYRICS_DISCOVERY_REGIONS.UNKNOWN,
      'high',
      ['regional-tag'],
    );
  }

  if (explicitLanguage === LYRICS_DISCOVERY_LANGUAGES.HINDI) {
    return result(LYRICS_DISCOVERY_CATEGORY.HINDI, LYRICS_DISCOVERY_LANGUAGES.HINDI, LYRICS_DISCOVERY_REGIONS.UNKNOWN, 'high', ['explicit-language']);
  }
  if (explicitLanguage === LYRICS_DISCOVERY_LANGUAGES.ENGLISH) {
    return result(LYRICS_DISCOVERY_CATEGORY.ENGLISH, LYRICS_DISCOVERY_LANGUAGES.ENGLISH, LYRICS_DISCOVERY_REGIONS.UNKNOWN, 'high', ['explicit-language']);
  }
  if (explicitLanguage === LYRICS_DISCOVERY_LANGUAGES.BENGALI) {
    return result(
      bengaliCategoryForRegion(region),
      LYRICS_DISCOVERY_LANGUAGES.BENGALI,
      region || LYRICS_DISCOVERY_REGIONS.UNKNOWN,
      region ? 'high' : 'medium',
      region ? ['explicit-language', 'region-metadata'] : ['explicit-language', 'combined-bengali'],
    );
  }
  if (explicitLanguage === LYRICS_DISCOVERY_LANGUAGES.OTHER) {
    return result(LYRICS_DISCOVERY_CATEGORY.OTHER, LYRICS_DISCOVERY_LANGUAGES.OTHER, LYRICS_DISCOVERY_REGIONS.UNKNOWN, 'high', ['explicit-language']);
  }

  const scriptSample = [title, artist, album].filter(Boolean).join(' ');
  const script = detectScript(scriptSample);

  if (script === 'devanagari') {
    return result(LYRICS_DISCOVERY_CATEGORY.HINDI, LYRICS_DISCOVERY_LANGUAGES.HINDI, LYRICS_DISCOVERY_REGIONS.UNKNOWN, 'high', ['devanagari-script']);
  }
  if (script === 'bengali') {
    return result(
      bengaliCategoryForRegion(region),
      LYRICS_DISCOVERY_LANGUAGES.BENGALI,
      region || LYRICS_DISCOVERY_REGIONS.UNKNOWN,
      region ? 'high' : 'medium',
      region ? ['bengali-script', 'region-metadata'] : ['bengali-script', 'combined-bengali'],
    );
  }

  if (region === LYRICS_DISCOVERY_REGIONS.BANGLADESH) {
    return result(LYRICS_DISCOVERY_CATEGORY.BENGALI_BANGLADESH, LYRICS_DISCOVERY_LANGUAGES.BENGALI, LYRICS_DISCOVERY_REGIONS.BANGLADESH, 'medium', ['region-metadata']);
  }

  const genreHint = genre.toLowerCase();
  if (/\bhindi\b/.test(genreHint)) {
    return result(LYRICS_DISCOVERY_CATEGORY.HINDI, LYRICS_DISCOVERY_LANGUAGES.HINDI, LYRICS_DISCOVERY_REGIONS.UNKNOWN, 'low', ['genre-hint']);
  }
  if (/\b(bengali|bangla)\b/.test(genreHint)) {
    return result(
      bengaliCategoryForRegion(region),
      LYRICS_DISCOVERY_LANGUAGES.BENGALI,
      region || LYRICS_DISCOVERY_REGIONS.UNKNOWN,
      'low',
      ['genre-hint', 'combined-bengali'],
    );
  }

  if (script === 'latin') {
    return result(LYRICS_DISCOVERY_CATEGORY.ENGLISH, LYRICS_DISCOVERY_LANGUAGES.ENGLISH, LYRICS_DISCOVERY_REGIONS.UNKNOWN, 'low', ['latin-script-default']);
  }

  return result(LYRICS_DISCOVERY_CATEGORY.OTHER, LYRICS_DISCOVERY_LANGUAGES.UNKNOWN, LYRICS_DISCOVERY_REGIONS.UNKNOWN, 'low', ['unclassified']);
}

export function buildLyricsSourceClassificationInput(song) {
  if (!song || typeof song !== 'object') return {};
  return {
    title: song.title,
    artist: song.artist,
    album: song.album,
    language: song.language,
    lyricsLanguage: song.lyrics_language,
    regionalTag: song.regional_tag,
    genre: song.genre,
    region: song.region,
    catalogSource: song.source_provider,
  };
}
