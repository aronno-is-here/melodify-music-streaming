import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRICFIND_PROVIDER_ID,
  LYRICS_DISCOVERY_PROVIDER_LISTS,
  MAX_DISCOVERY_SOURCES,
  MAX_QUERY_VARIANTS,
  buildLyricsSourceQueries,
  deriveSourceCandidate,
  getLyricsSourceProvider,
  isSearchResultUrl,
  listLyricsSourceProviders,
  selectLyricsDiscoveryProviders,
} from './lyricsSourceProviders.js';

const ids = (list) => [...list];

test('hindi provider list matches the required discovery order set', () => {
  assert.deepEqual(ids(LYRICS_DISCOVERY_PROVIDER_LISTS.HINDI), ['azlyrics', 'genius', 'smule', 'gaana', 'lyricsmode']);
  assert.equal(LYRICS_DISCOVERY_PROVIDER_LISTS.HINDI.length, MAX_DISCOVERY_SOURCES);
});

test('kolkata bengali provider list uses the indian bengali sources', () => {
  assert.deepEqual(ids(LYRICS_DISCOVERY_PROVIDER_LISTS.BENGALI_INDIA), [
    'smule',
    'amarkobita4u',
    'banglaganlyrics',
    'gdn8',
    'scribd',
    'ilyricshub',
  ]);
});

test('bangladeshi bengali provider list uses the bangladeshi sources', () => {
  assert.deepEqual(ids(LYRICS_DISCOVERY_PROVIDER_LISTS.BENGALI_BANGLADESH), [
    'musixmatch',
    'genius',
    'smule',
    'starmakerstudios',
  ]);
});

test('combined bengali pool merges both regions without duplicates', () => {
  const combined = ids(LYRICS_DISCOVERY_PROVIDER_LISTS.BENGALI);
  const expected = [...new Set([
    ...LYRICS_DISCOVERY_PROVIDER_LISTS.BENGALI_INDIA,
    ...LYRICS_DISCOVERY_PROVIDER_LISTS.BENGALI_BANGLADESH,
  ])];
  assert.deepEqual([...new Set(combined)].sort(), [...expected].sort());
  assert.equal(combined.length, new Set(combined).size);
  assert.ok(combined.includes('amarkobita4u'));
  assert.ok(combined.includes('musixmatch'));
});

test('english provider list matches the required discovery sources', () => {
  assert.deepEqual(ids(LYRICS_DISCOVERY_PROVIDER_LISTS.ENGLISH), ['azlyrics', 'genius', 'gaana', 'letras', 'kkbox', 'musixmatch']);
});

test('other category has no regional provider list', () => {
  assert.deepEqual(ids(LYRICS_DISCOVERY_PROVIDER_LISTS.OTHER), []);
  assert.deepEqual(selectLyricsDiscoveryProviders('OTHER'), []);
});

test('every discovered provider resolves to a bounded registry entry', () => {
  const allIds = new Set(Object.values(LYRICS_DISCOVERY_PROVIDER_LISTS).flat());
  allIds.add(LYRICFIND_PROVIDER_ID);
  for (const providerId of allIds) {
    const provider = getLyricsSourceProvider(providerId);
    assert.ok(provider, `missing provider ${providerId}`);
    assert.ok(provider.label);
    assert.ok(Array.isArray(provider.hosts) && provider.hosts.length > 0);
    assert.equal(typeof provider.searchUrl, 'function');
    const url = new URL(provider.searchUrl('sample query'));
    assert.equal(url.protocol, 'https:');
    assert.ok(provider.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)));
  }
});

test('lyricfind is the dedicated last-resort discovery source', () => {
  const provider = getLyricsSourceProvider(LYRICFIND_PROVIDER_ID);
  assert.equal(provider.id, 'lyricfind');
  assert.equal(provider.label, 'LyricFind');
  assert.ok(provider.hosts.includes('lyrics.lyricfind.com'));
  assert.ok(provider.searchUrl('query').startsWith('https://lyrics.lyricfind.com/'));
  for (const list of Object.values(LYRICS_DISCOVERY_PROVIDER_LISTS)) {
    assert.equal(list.includes(LYRICFIND_PROVIDER_ID), false);
  }
});

test('discovery caps category sources at five and query variants at three', () => {
  assert.equal(MAX_DISCOVERY_SOURCES, 5);
  assert.equal(MAX_QUERY_VARIANTS, 3);
  for (const [category, list] of Object.entries(LYRICS_DISCOVERY_PROVIDER_LISTS)) {
    if (category === 'OTHER') {
      assert.deepEqual([...list], []);
      continue;
    }
    assert.ok(list.length >= 1, `${category} list must not be empty`);
    assert.ok(list.length <= 10, `${category} list must stay small`);
  }
});

test('registry lists only expected provider hosts', () => {
  const expectedHosts = new Set([
    'azlyrics.com',
    'genius.com',
    'smule.com',
    'gaana.com',
    'lyricsmode.com',
    'amarkobita4u.com',
    'banglaganlyrics.wordpress.com',
    'gdn8.com',
    'scribd.com',
    'ilyricshub.com',
    'musixmatch.com',
    'starmakerstudios.com',
    'letras.com',
    'kkbox.com',
    'lyrics.lyricfind.com',
    'lyricfind.com',
  ]);
  for (const provider of listLyricsSourceProviders()) {
    for (const host of provider.hosts) {
      assert.ok(expectedHosts.has(host), `unexpected host ${host}`);
    }
  }
});

test('bengali queries keep the native title first and a romanized variant last', () => {
  const song = { title: 'কেন হঠাৎ তুমি এলে', artist: 'তাহসান' };
  const queries = buildLyricsSourceQueries({ song, category: 'BENGALI' });
  assert.ok(queries.length <= MAX_QUERY_VARIANTS);
  assert.ok(queries[0].includes('কেন হঠাৎ তুমি এলে'));
  assert.ok(queries[0].includes('তাহসান'));
  const romanized = queries.find((query) => !/[\u0980-\u09FF]/.test(query));
  assert.ok(romanized, 'expected a romanized query variant');
  assert.match(romanized, /\p{Script=Latin}/u);
  assert.notEqual(romanized, queries[0]);
});

test('hindi queries include original metadata and a noise-free normalized variant', () => {
  const song = { title: 'तुम ही हो (Official Video)', artist: 'Arijit Singh' };
  const queries = buildLyricsSourceQueries({ song, category: 'HINDI' });
  assert.ok(queries.length <= MAX_QUERY_VARIANTS);
  assert.ok(queries[0].includes('तुम ही हो'));
  const normalized = queries.find((query) => !query.includes('Official Video'));
  assert.ok(normalized, 'expected a normalized variant without bracket noise');
  assert.ok(normalized.includes('Arijit Singh'));
  const romanized = queries.find((query) => !/[\u0900-\u097F]/.test(query));
  assert.ok(romanized, 'expected a romanized hindi variant');
  assert.match(romanized, /arijit/i);
});

test('hindi queries for latin titles stay bounded without duplicate variants', () => {
  const song = { title: 'Khamoshiyan', artist: 'Arijit Singh' };
  const queries = buildLyricsSourceQueries({ song, category: 'HINDI' });
  assert.ok(queries.length <= MAX_QUERY_VARIANTS);
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries[0].includes('Khamoshiyan'));
});

test('english queries add the album only for disambiguation', () => {
  const withAlbum = buildLyricsSourceQueries({
    song: { title: 'Hello', artist: 'Adele', album: '25' },
    category: 'ENGLISH',
  });
  assert.ok(withAlbum.length <= MAX_QUERY_VARIANTS);
  assert.ok(withAlbum[0].includes('Hello'));
  assert.ok(withAlbum[0].includes('Adele'));
  assert.ok(withAlbum.some((query) => query.includes('25')));

  const withoutAlbum = buildLyricsSourceQueries({
    song: { title: 'Hello', artist: 'Adele' },
    category: 'ENGLISH',
  });
  assert.ok(withoutAlbum.length < withAlbum.length);
  assert.equal(withoutAlbum.some((query) => query.includes('album')), false);
});

test('query building never explodes past the bounded variant count', () => {
  const noisy = {
    title: 'Song (Live) [HQ] - Official Audio',
    artist: 'Artist Feat. Someone',
    album: 'Album',
  };
  for (const category of ['HINDI', 'BENGALI', 'BENGALI_INDIA', 'BENGALI_BANGLADESH', 'ENGLISH', 'OTHER', '']) {
    const queries = buildLyricsSourceQueries({ song: noisy, category });
    assert.ok(queries.length <= MAX_QUERY_VARIANTS, `${category} produced ${queries.length}`);
    assert.equal(new Set(queries).size, queries.length);
  }
});

test('deriveSourceCandidate parses artist-title anchor text strictly', () => {
  const song = { title: 'Khamoshiyan', artist: 'Tahsan' };
  const result = deriveSourceCandidate({
    url: 'https://genius.com/Tahsan-Khamoshiyan-lyrics',
    text: 'Khamoshiyan Lyrics - Tahsan | Genius',
    song,
  });
  assert.deepEqual(result, { trackName: 'Khamoshiyan', artistName: 'Tahsan' });
});

test('deriveSourceCandidate parses by-form anchor text', () => {
  const song = { title: 'Khamoshiyan', artist: 'Tahsan' };
  const result = deriveSourceCandidate({
    url: 'https://genius.com/Tahsan-Khamoshiyan-lyrics',
    text: 'Khamoshiyan by Tahsan',
    song,
  });
  assert.deepEqual(result, { trackName: 'Khamoshiyan', artistName: 'Tahsan' });
});

test('deriveSourceCandidate reads azlyrics path metadata', () => {
  const song = { title: 'Khamoshiyan', artist: 'Tahsan' };
  const result = deriveSourceCandidate({
    url: 'https://www.azlyrics.com/lyrics/tahsan/khamoshiyan.html',
    text: 'Tahsan - Khamoshiyan Lyrics',
    song,
  });
  assert.deepEqual(result, { trackName: 'Khamoshiyan', artistName: 'Tahsan' });
});

test('deriveSourceCandidate returns null when the artist cannot be established', () => {
  const song = { title: 'Khamoshiyan', artist: 'Tahsan' };
  const result = deriveSourceCandidate({
    url: 'https://genius.com/Some-Unrelated-Page',
    text: 'Some Lyrics Page',
    song,
  });
  assert.equal(result, null);
});

test('deriveSourceCandidate never invents fields for missing songs', () => {
  assert.equal(deriveSourceCandidate({ url: 'https://genius.com/x', text: 'x', song: null }), null);
  assert.equal(deriveSourceCandidate({ url: 'https://genius.com/x', text: 'x', song: {} }), null);
});

test('isSearchResultUrl filters provider search pages out of results', () => {
  assert.equal(isSearchResultUrl('https://genius.com/search', 'https://genius.com/search?q=a'), true);
  assert.equal(isSearchResultUrl('https://genius.com/search?q=a', 'https://genius.com/search?q=a'), true);
  assert.equal(isSearchResultUrl('https://genius.com/Tahsan-Khamoshiyan-lyrics', 'https://genius.com/search?q=a'), false);
  assert.equal(isSearchResultUrl('https://banglaganlyrics.wordpress.com/?s=query', 'x'), true);
  assert.equal(isSearchResultUrl('nonsense', 'x'), true);
});
