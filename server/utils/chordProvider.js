export const CHORD_STATES = Object.freeze({
  VERIFIED_DB: 'verified-db',
  PROVIDER: 'provider',
  LEGACY_UNVERIFIED: 'legacy-unverified',
  UNAVAILABLE: 'unavailable',
});

export const CHORDIFY_ALLOWED_HOSTS = Object.freeze([
  'chordify.net',
  'www.chordify.net',
]);

function normalizeUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 1024) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return parsed;
}

export function normalizeChordifyUrl(value) {
  const parsed = normalizeUrl(value);
  if (!parsed) return null;
  if (!CHORDIFY_ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) return null;
  return parsed.toString();
}

export function normalizeChordifyEmbedUrl(value) {
  const parsed = normalizeUrl(value);
  if (!parsed) return null;
  if (!CHORDIFY_ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) return null;
  if (!parsed.pathname || parsed.pathname === '/') return null;
  return parsed.toString();
}

export function normalizeChordReferenceUrl(value) {
  const parsed = normalizeUrl(value);
  if (!parsed) return null;
  return parsed.toString();
}

export function selectChordPresentation(songLike) {
  const song = songLike && typeof songLike === 'object' ? songLike : {};
  const chordText = typeof song.chords === 'string' ? song.chords : '';
  const hasChordText = chordText.trim().length > 0;
  const verified = song.chords_verified === true;
  const chordifyUrl = normalizeChordifyUrl(song.chordify_url);
  const chordifyEmbedUrl = normalizeChordifyEmbedUrl(song.chordify_embed_url);

  if (verified && hasChordText) {
    return {
      state: CHORD_STATES.VERIFIED_DB,
      source: song.chords_source || 'database',
      chords: chordText,
      chordifyUrl,
      chordifyEmbedUrl,
      chordsVerified: true,
    };
  }

  if (chordifyUrl || chordifyEmbedUrl) {
    return {
      state: CHORD_STATES.PROVIDER,
      source: song.chords_source || 'chordify',
      chords: hasChordText ? chordText : '',
      chordifyUrl,
      chordifyEmbedUrl,
      chordsVerified: false,
    };
  }

  if (hasChordText) {
    return {
      state: CHORD_STATES.LEGACY_UNVERIFIED,
      source: song.chords_source || 'legacy-unverified',
      chords: chordText,
      chordifyUrl: null,
      chordifyEmbedUrl: null,
      chordsVerified: false,
    };
  }

  return {
    state: CHORD_STATES.UNAVAILABLE,
    source: 'unavailable',
    chords: '',
    chordifyUrl: null,
    chordifyEmbedUrl: null,
    chordsVerified: false,
  };
}
