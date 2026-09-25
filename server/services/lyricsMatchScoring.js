export const LYRICS_MATCH_CLASS = Object.freeze({
  EXACT: 'EXACT',
  HIGH: 'HIGH',
  AMBIGUOUS: 'AMBIGUOUS',
  NONE: 'NONE',
});

const VERSION_MARKERS = Object.freeze([
  'remix',
  'live',
  'acoustic',
  'version',
  'cover',
  'karaoke',
]);

const normalize = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[()\[\]{}]/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenize = (value) => normalize(value).split(' ').filter(Boolean);

const toSeconds = (value) => {
  if (Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const parts = value.split(':').map((part) => Number.parseInt(part, 10));
  if (!parts.every((entry) => Number.isFinite(entry) && entry >= 0)) return null;
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return null;
};

const jaccard = (a, b) => {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
};

const hasVersionMarker = (value) => {
  const normalized = normalize(value);
  return VERSION_MARKERS.some((marker) => normalized.includes(marker));
};

export function scoreLyricsMatch({ song, candidate }) {
  const songTitle = normalize(song?.title);
  const songArtist = normalize(song?.artist);
  const songAlbum = normalize(song?.album);
  const candidateTitle = normalize(candidate?.trackName || candidate?.title || candidate?.track_name);
  const candidateArtist = normalize(candidate?.artistName || candidate?.artist || candidate?.artist_name);
  const candidateAlbum = normalize(candidate?.albumName || candidate?.album || candidate?.album_name);

  if (!songTitle || !songArtist || !candidateTitle || !candidateArtist) {
    return { classification: LYRICS_MATCH_CLASS.NONE, score: 0, reasons: ['missing-required-fields'] };
  }

  const titleExact = songTitle === candidateTitle;
  const artistExact = songArtist === candidateArtist;
  const titleSimilarity = jaccard(songTitle, candidateTitle);
  const artistSimilarity = jaccard(songArtist, candidateArtist);
  const albumSimilarity = songAlbum && candidateAlbum ? jaccard(songAlbum, candidateAlbum) : 0;

  const songDuration = toSeconds(song?.duration);
  const candidateDuration = toSeconds(candidate?.duration);
  const durationDiff = (songDuration && candidateDuration)
    ? Math.abs(songDuration - candidateDuration)
    : null;

  let durationScore = 0;
  if (durationDiff !== null) {
    if (durationDiff <= 2) durationScore = 1;
    else if (durationDiff <= 6) durationScore = 0.7;
    else if (durationDiff <= 12) durationScore = 0.4;
    else durationScore = -0.8;
  }

  const versionMismatch = hasVersionMarker(song?.title) !== hasVersionMarker(candidate?.trackName || candidate?.title || candidate?.track_name);

  let score = 0;
  score += titleExact ? 1.5 : titleSimilarity;
  score += artistExact ? 1.4 : artistSimilarity;
  score += albumSimilarity * 0.3;
  score += durationScore;
  if (versionMismatch) score -= 0.8;

  if (titleExact && artistExact && (durationDiff === null || durationDiff <= 6) && !versionMismatch) {
    return { classification: LYRICS_MATCH_CLASS.EXACT, score, reasons: ['exact-title-artist'] };
  }

  if (score >= 2.1 && titleSimilarity >= 0.5 && artistSimilarity >= 0.5 && !versionMismatch) {
    return { classification: LYRICS_MATCH_CLASS.HIGH, score, reasons: ['high-confidence'] };
  }

  if (score >= 1.2 && titleSimilarity >= 0.35) {
    return { classification: LYRICS_MATCH_CLASS.AMBIGUOUS, score, reasons: ['ambiguous-match'] };
  }

  return { classification: LYRICS_MATCH_CLASS.NONE, score, reasons: ['mismatch'] };
}

export function selectBestLyricsCandidate(song, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { best: null, classification: LYRICS_MATCH_CLASS.NONE, scored: [] };
  }

  const scored = candidates.map((candidate) => {
    const result = scoreLyricsMatch({ song, candidate });
    return {
      candidate,
      classification: result.classification,
      score: result.score,
    };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0] || null;
  if (!best) {
    return { best: null, classification: LYRICS_MATCH_CLASS.NONE, scored };
  }

  return {
    best: best.candidate,
    classification: best.classification,
    scored,
  };
}
