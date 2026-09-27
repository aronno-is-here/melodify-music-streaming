import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MISSING_LYRICS_LIMIT,
  MAX_MISSING_LYRICS_LIMIT,
  MISSING_LYRICS_LANGUAGE_FILTERS,
  MISSING_LYRICS_LANGUAGE_VALUES,
  MISSING_LYRICS_QUERY_ERROR_MESSAGES,
  buildMissingLyricsFilter,
  parseMissingLyricsQuery,
  selectMissingLyricsRow,
} from './missingLyricsQuery.js';

test('defaults to a missing-only queue on page 1 with 20 rows', () => {
  const parsed = parseMissingLyricsQuery({});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.q, null);
  assert.equal(parsed.language, null);
  assert.equal(parsed.missing, true);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, DEFAULT_MISSING_LYRICS_LIMIT);
});

test('search, language, missing flag and pagination parse together', () => {
  const parsed = parseMissingLyricsQuery({ q: '  tum  ', language: 'hindi', missing: '1', page: '3', limit: '10' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.q, 'tum');
  assert.equal(parsed.language, 'hindi');
  assert.equal(parsed.missing, true);
  assert.equal(parsed.page, 3);
  assert.equal(parsed.limit, 10);
});

test('unknown query keys are rejected', () => {
  for (const query of [{ userId: '1' }, { debug: 'true' }, { sort: 'title' }, { email: 'a@b.c' }]) {
    const parsed = parseMissingLyricsQuery(query);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY);
  }
});

test('unknown language values are rejected', () => {
  for (const language of ['korean', 'HINDI', ' bn-bd', 'bn-bd ']) {
    const parsed = parseMissingLyricsQuery({ language });
    assert.equal(parsed.ok, false);
  }
});

test('bad pagination values are rejected without silent clamping', () => {
  for (const limit of ['0', '51', '-1', '1.5', 'abc', String(MAX_MISSING_LYRICS_LIMIT + 1)]) {
    const parsed = parseMissingLyricsQuery({ limit });
    assert.equal(parsed.ok, false, `limit ${limit} should be rejected`);
  }
  assert.equal(parseMissingLyricsQuery({ page: '0' }).ok, false);
  assert.equal(parseMissingLyricsQuery({ page: '1e3' }).ok, false);
  assert.equal(parseMissingLyricsQuery({ limit: '50' }).ok, true);
  assert.equal(parseMissingLyricsQuery({ page: '99999' }).ok, true);
});

test('language filter labels cover Hindi and both Bengali regions plus English', () => {
  assert.deepEqual(
    MISSING_LYRICS_LANGUAGE_VALUES,
    ['hindi', 'bn-bd', 'bn-in', 'english'],
  );
  assert.deepEqual(
    MISSING_LYRICS_LANGUAGE_FILTERS.map((f) => f.label),
    ['Hindi', 'Bangladeshi Bengali', 'Kolkata/Indian Bengali', 'English'],
  );
});

test('missing-only filter keeps songs without usable verified lyrics', () => {
  const filter = buildMissingLyricsFilter({ missing: true });
  assert.ok(Array.isArray(filter.$or));
  assert.deepEqual(filter.$or[0], { lyrics_verified: { $ne: true } });
  assert.ok(filter.$or.some((clause) => clause.lyrics === ''));
});

test('missing=false selects only usable verified lyrics', () => {
  const filter = buildMissingLyricsFilter({ missing: false });
  assert.deepEqual(filter.$and[0], { lyrics_verified: true });
  assert.deepEqual(filter.$and[1], { lyrics: { $exists: true, $nin: ['', null] } });
});

test('search terms are escaped and applied to title, artist and album', () => {
  const filter = buildMissingLyricsFilter({ q: 'a+b(c)', missing: false });
  const searchClauses = filter.$and[1].$or;
  const pattern = searchClauses[0].title;
  assert.ok(pattern instanceof RegExp);
  assert.equal(pattern.source, 'a\\+b\\(c\\)');
  assert.equal(pattern.flags, 'i');
  assert.deepEqual(
    searchClauses.map((clause) => Object.keys(clause)[0]),
    ['title', 'artist', 'album'],
  );
});

test('Hindi filter matches language aliases, lyrics language and the regional tag', () => {
  const filter = buildMissingLyricsFilter({ language: 'hindi', missing: false });
  const clauses = filter.$and[1].$or;
  const languageClause = clauses.find((clause) => clause.language);
  assert.deepEqual(languageClause.language.$in, ['hi', 'hin', 'hindi']);
  assert.ok(clauses.some((clause) => clause.regional_tag === 'hi-in'));
});

test('Bangladeshi Bengali excludes songs already tagged as Indian Bengali', () => {
  const filter = buildMissingLyricsFilter({ language: 'bn-bd', missing: false });
  const languageClause = filter.$and[1];
  assert.deepEqual(languageClause.$and[0], { regional_tag: { $ne: 'bn-in' } });
  const bengali = languageClause.$and[1].$or.find((clause) => clause.language);
  assert.deepEqual(bengali.language.$in, ['bn', 'ben', 'bengali', 'bangla']);
});

test('Indian Bengali filter keys off the regional tag only', () => {
  const filter = buildMissingLyricsFilter({ language: 'bn-in', missing: false });
  assert.deepEqual(filter.$and[1], { regional_tag: 'bn-in' });
});

test('search and language combine with the missing filter', () => {
  const filter = buildMissingLyricsFilter({ q: 'x', language: 'english', missing: true });
  assert.equal(filter.$and.length, 3);
});

test('queue row projection reports status, LRCLIB state and no lyric body', () => {
  const row = selectMissingLyricsRow({
    _id: '64b64b64b64b64b64b64b641',
    title: 'Tum Hi Ho',
    artist: 'Arijit Singh',
    album: 'Hamari Adhuri Kahani',
    duration: '4:05',
    language: 'hi',
    lyrics_language: 'hindi',
    regional_tag: 'hi-in',
    lyrics: '',
    lyrics_verified: false,
    lyrics_source: 'none',
    lyrics_source_url: 'https://example.com/source',
  });
  assert.equal(row.songId, '64b64b64b64b64b64b64b641');
  assert.equal(row.lyricsStatus, 'missing');
  assert.equal(row.lrclibStatus, 'not-stored');
  assert.equal(row.source, 'none');
  assert.equal(row.sourceUrl, 'https://example.com/source');
  assert.equal(row.lyricsLength, 0);
  assert.equal('lyrics' in row, false);
});

test('queue row projection marks legacy and verified lyrics distinctly', () => {
  const legacy = selectMissingLyricsRow({
    _id: '64b64b64b64b64b64b64b642',
    title: 'Legacy',
    artist: 'A',
    lyrics: 'old words',
    lyrics_verified: false,
    lyrics_source: 'legacy_unverified',
  });
  assert.equal(legacy.lyricsStatus, 'legacy');

  const verified = selectMissingLyricsRow({
    _id: '64b64b64b64b64b64b64b643',
    title: 'Verified',
    artist: 'A',
    lyrics: 'fresh words',
    lyrics_verified: true,
    lyrics_source: 'lrclib-exact',
  });
  assert.equal(verified.lyricsStatus, 'verified');
  assert.equal(verified.lrclibStatus, 'stored');
});

test('queue row projection tolerates missing fields without throwing', () => {
  const row = selectMissingLyricsRow({ _id: '64b64b64b64b64b64b64b644' });
  assert.equal(row.title, '');
  assert.equal(row.duration, '');
  assert.equal(row.lyricsStatus, 'missing');
  assert.equal(selectMissingLyricsRow(null), null);
});
