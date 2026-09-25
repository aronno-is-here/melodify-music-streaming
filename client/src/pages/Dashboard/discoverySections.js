const asArray = (value) => (Array.isArray(value) ? value : []);

const normText = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const dedupeSongs = (songs) => {
  const seen = new Set();
  const out = [];
  for (const song of asArray(songs)) {
    if (!song || typeof song !== 'object') continue;
    const id = String(song._id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(song);
  }
  return out;
};

export function createRecentlyAddedSongs(songs, limit = 10) {
  return dedupeSongs(asArray(songs)).slice(0, limit);
}

export function createQuickPicks({ history, favorites, songs, limit = 12 } = {}) {
  const combined = [
    ...asArray(history),
    ...asArray(favorites),
    ...asArray(songs),
  ];
  return dedupeSongs(combined).slice(0, limit);
}

function createBucketCollection(songs, key, bucketLimit, songLimit) {
  const map = new Map();
  for (const song of dedupeSongs(songs)) {
    const bucketKey = normText(song[key], key === 'genre' ? 'Unspecified Genre' : 'Unknown Artist');
    if (!map.has(bucketKey)) {
      map.set(bucketKey, []);
    }
    const bucketSongs = map.get(bucketKey);
    if (bucketSongs.length < songLimit) {
      bucketSongs.push(song);
    }
  }

  return [...map.entries()]
    .map(([label, bucketSongs]) => ({
      label,
      songs: bucketSongs,
      count: bucketSongs.length,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, bucketLimit);
}

export function createGenreBuckets(songs, { bucketLimit = 8, songLimit = 12 } = {}) {
  return createBucketCollection(songs, 'genre', bucketLimit, songLimit);
}

export function createArtistBuckets(songs, { bucketLimit = 8, songLimit = 12 } = {}) {
  return createBucketCollection(songs, 'artist', bucketLimit, songLimit);
}
