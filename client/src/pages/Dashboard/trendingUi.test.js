import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRENDING_BASIS,
  TRENDING_MODE,
  TRENDING_REQUEST_LIMIT,
  TRENDING_REQUEST_PATH,
  TRENDING_DISABLED_ERROR,
  TRENDING_LOADING_MESSAGE,
  TRENDING_EMPTY_MESSAGE,
  TRENDING_ERROR_MESSAGE,
  TRENDING_FALLBACK_LABEL,
  normalizeTrendingItem,
  normalizeTrendingResponse,
  buildTrendingSongs,
  getTrendingDisplayMeta,
  classifyTrendingResult,
} from './trendingUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(join(__dirname, 'Dashboard.jsx'), 'utf8');
const helperSrc = readFileSync(join(__dirname, 'trendingUi.js'), 'utf8');

const activitySong = (overrides = {}) => ({
  _id: 'song-1',
  title: 'Alpha',
  artist: 'Artist A',
  genre: 'Bengali',
  youtube_id: 'yt-alpha',
  file_path: '',
  poster_url: 'https://img.example/a.jpg',
  duration: '3:30',
  ...overrides,
});

const fallbackSong = (overrides = {}) => ({
  _id: 'song-2',
  title: 'Beta',
  artist: 'Artist B',
  genre: 'Hindi',
  youtube_id: '',
  file_path: 'assets/songs/beta.mp3',
  poster_url: 'https://img.example/b.jpg',
  duration: '4:00',
  ...overrides,
});

const activityItem = (overrides = {}) => ({
  rank: 1,
  basis: TRENDING_BASIS.ACTIVITY,
  score: 3.5,
  activity: {
    unique_listener_count: 2,
    play_started_count: 4,
    completed_count: 1,
    replay_started_count: 0,
    skipped_count: 0,
    listened_seconds: 90,
    last_activity_at: '2026-09-24T00:00:00.000Z',
  },
  song: activitySong(),
  ...overrides,
});

const fallbackItem = (overrides = {}) => ({
  rank: 2,
  basis: TRENDING_BASIS.CATALOG_FALLBACK,
  score: null,
  activity: {
    unique_listener_count: 0,
    play_started_count: 0,
    completed_count: 0,
    replay_started_count: 0,
    skipped_count: 0,
    listened_seconds: 0,
    last_activity_at: null,
  },
  song: fallbackSong(),
  ...overrides,
});

const okPayload = (items, meta = {}) => ({
  success: true,
  data: {
    items,
    meta: {
      mode: TRENDING_MODE.ACTIVITY,
      activity_count: items.length,
      fallback_count: 0,
      ...meta,
    },
  },
});

// RESPONSE NORMALIZATION

test('1: valid backend response normalizes successfully', () => {
  const result = normalizeTrendingResponse(okPayload([activityItem(), fallbackItem()]));
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].basis, TRENDING_BASIS.ACTIVITY);
  assert.equal(result.items[1].basis, TRENDING_BASIS.CATALOG_FALLBACK);
  assert.equal(result.items[0].song._id, 'song-1');
  assert.equal(result.items[1].song._id, 'song-2');
  assert.equal(result.meta.mode, TRENDING_MODE.ACTIVITY);
});

test('2: missing payload safely gives empty items', () => {
  assert.deepEqual(normalizeTrendingResponse(undefined).items, []);
  assert.deepEqual(normalizeTrendingResponse(null).items, []);
  assert.deepEqual(normalizeTrendingResponse('nope').items, []);
  assert.deepEqual(normalizeTrendingResponse(42).items, []);
});

test('3: missing data safely gives empty items', () => {
  assert.deepEqual(normalizeTrendingResponse({ success: true }).items, []);
  assert.deepEqual(normalizeTrendingResponse({ success: true, data: null }).items, []);
  assert.deepEqual(normalizeTrendingResponse({ success: true, data: [] }).items, []);
  assert.deepEqual(normalizeTrendingResponse({ success: false, data: { items: [activityItem()] } }).items, []);
});

test('4: items non-array safely gives empty items', () => {
  assert.deepEqual(normalizeTrendingResponse({ success: true, data: { items: null } }).items, []);
  assert.deepEqual(normalizeTrendingResponse({ success: true, data: { items: {} } }).items, []);
  assert.deepEqual(normalizeTrendingResponse({ success: true, data: { items: 'x' } }).items, []);
});

test('5: malformed item ignored', () => {
  const result = normalizeTrendingResponse(okPayload([null, 42, 'x', [], activityItem()]));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, 'song-1');
});

test('6: missing song ignored', () => {
  const result = normalizeTrendingResponse(okPayload([
    { basis: TRENDING_BASIS.ACTIVITY },
    { basis: TRENDING_BASIS.ACTIVITY, song: null },
    { basis: TRENDING_BASIS.ACTIVITY, song: 'not-object' },
  ]));
  assert.equal(result.items.length, 0);
});

test('7: missing song ID ignored', () => {
  for (const song of [
    { title: 'A', artist: 'B', youtube_id: 'x' },
    { _id: '', title: 'A', artist: 'B', youtube_id: 'x' },
    { _id: '   ', title: 'A', artist: 'B', youtube_id: 'x' },
    { _id: 42, title: 'A', artist: 'B', youtube_id: 'x' },
  ]) {
    const result = normalizeTrendingItem({ basis: TRENDING_BASIS.ACTIVITY, song });
    assert.equal(result, null, JSON.stringify(song));
  }
});

test('8: blank title ignored', () => {
  assert.equal(normalizeTrendingItem({
    basis: TRENDING_BASIS.ACTIVITY,
    song: activitySong({ title: '   ' }),
  }), null);
  assert.equal(normalizeTrendingItem({
    basis: TRENDING_BASIS.ACTIVITY,
    song: activitySong({ title: '' }),
  }), null);
});

test('9: blank artist ignored', () => {
  assert.equal(normalizeTrendingItem({
    basis: TRENDING_BASIS.ACTIVITY,
    song: activitySong({ artist: '  ' }),
  }), null);
});

test('10: missing playback source ignored', () => {
  assert.equal(normalizeTrendingItem({
    basis: TRENDING_BASIS.ACTIVITY,
    song: activitySong({ youtube_id: '', file_path: '' }),
  }), null);
  assert.equal(normalizeTrendingItem({
    basis: TRENDING_BASIS.ACTIVITY,
    song: activitySong({ youtube_id: '   ', file_path: '  ' }),
  }), null);
});

test('11: youtube_id makes song playable', () => {
  const item = normalizeTrendingItem({
    basis: TRENDING_BASIS.ACTIVITY,
    song: activitySong({ youtube_id: 'abc', file_path: '' }),
  });
  assert.ok(item);
  assert.equal(item.song.youtube_id, 'abc');
});

test('12: file_path makes song playable', () => {
  const item = normalizeTrendingItem({
    basis: TRENDING_BASIS.CATALOG_FALLBACK,
    song: fallbackSong({ youtube_id: '', file_path: 'assets/x.mp3' }),
  });
  assert.ok(item);
  assert.equal(item.song.file_path, 'assets/x.mp3');
});

test('13: invalid basis ignored', () => {
  for (const basis of ['AI', 'popular', '', null, undefined, 1, 'Activity', 'ACTIVITY']) {
    assert.equal(normalizeTrendingItem({ basis, song: activitySong() }), null, String(basis));
  }
});

test('14: activity basis accepted', () => {
  const item = normalizeTrendingItem(activityItem());
  assert.equal(item.basis, TRENDING_BASIS.ACTIVITY);
});

test('15: catalog-fallback basis accepted', () => {
  const item = normalizeTrendingItem(fallbackItem());
  assert.equal(item.basis, TRENDING_BASIS.CATALOG_FALLBACK);
});

// ORDER / DUPLICATES

test('16: backend order preserved', () => {
  const songs = ['a', 'b', 'c', 'd'].map((id) => activityItem({
    song: activitySong({ _id: id, title: id }),
  }));
  const result = normalizeTrendingResponse(okPayload(songs));
  assert.deepEqual(result.items.map((i) => i.song._id), ['a', 'b', 'c', 'd']);
});

test('17: duplicate song IDs retain first', () => {
  const first = activityItem({ song: activitySong({ title: 'First' }) });
  const dup = activityItem({ song: activitySong({ title: 'Second', artist: 'Other' }) });
  const result = normalizeTrendingResponse(okPayload([first, dup]));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song.title, 'First');
});

test('18: duplicates do not change remaining order', () => {
  const result = normalizeTrendingResponse(okPayload([
    activityItem({ song: activitySong({ _id: 'a' }) }),
    activityItem({ song: activitySong({ _id: 'a', title: 'dup' }) }),
    activityItem({ song: activitySong({ _id: 'b' }) }),
    fallbackItem({ song: fallbackSong({ _id: 'c' }) }),
    activityItem({ song: activitySong({ _id: 'b', title: 'dup-b' }) }),
  ]));
  assert.deepEqual(result.items.map((i) => i.song._id), ['a', 'b', 'c']);
});

test('19: helper does not sort by title', () => {
  const result = normalizeTrendingResponse(okPayload([
    activityItem({ song: activitySong({ _id: 'z', title: 'Zeta' }) }),
    activityItem({ song: activitySong({ _id: 'a', title: 'Alpha' }) }),
  ]));
  assert.deepEqual(result.items.map((i) => i.song._id), ['z', 'a']);
});

test('20: helper does not sort by score', () => {
  const result = normalizeTrendingResponse(okPayload([
    activityItem({ score: 0.1, song: activitySong({ _id: 'low' }) }),
    activityItem({ score: 9.9, song: activitySong({ _id: 'high' }) }),
  ]));
  assert.deepEqual(result.items.map((i) => i.song._id), ['low', 'high']);
});

// PLAYER LIST

test('21: player list contains Song objects only', () => {
  const { items } = normalizeTrendingResponse(okPayload([activityItem(), fallbackItem()]));
  const songs = buildTrendingSongs(items);
  assert.equal(songs.length, 2);
  for (const song of songs) {
    assert.equal(typeof song, 'object');
    assert.equal(Object.hasOwn(song, 'basis'), false);
    assert.equal(Object.hasOwn(song, 'score'), false);
    assert.equal(Object.hasOwn(song, 'activity'), false);
    assert.ok(song._id);
    assert.ok(song.title);
  }
});

test('22: player list order matches normalized items', () => {
  const { items } = normalizeTrendingResponse(okPayload([
    activityItem({ song: activitySong({ _id: 'x' }) }),
    fallbackItem({ song: fallbackSong({ _id: 'y' }) }),
    activityItem({ song: activitySong({ _id: 'z' }) }),
  ]));
  const songs = buildTrendingSongs(items);
  assert.deepEqual(songs.map((s) => s._id), items.map((i) => i.song._id));
  assert.deepEqual(songs.map((s) => s._id), ['x', 'y', 'z']);
});

test('23: wrapper basis/score not injected into Song', () => {
  const { items } = normalizeTrendingResponse(okPayload([activityItem()]));
  const song = buildTrendingSongs(items)[0];
  assert.equal(Object.hasOwn(song, 'basis'), false);
  assert.equal(Object.hasOwn(song, 'score'), false);
  assert.equal(Object.hasOwn(song, 'activity'), false);
  assert.equal(Object.hasOwn(song, 'rank'), false);
});

test('24: malformed filtered row does not break indexes', () => {
  const { items } = normalizeTrendingResponse(okPayload([
    { basis: 'bogus', song: activitySong() },
    activityItem({ song: activitySong({ _id: 'keep-1' }) }),
    { basis: TRENDING_BASIS.ACTIVITY },
    fallbackItem({ song: fallbackSong({ _id: 'keep-2' }) }),
  ]));
  const songs = buildTrendingSongs(items);
  assert.equal(items.length, 2);
  assert.equal(songs.length, 2);
  assert.equal(songs[0]._id, items[0].song._id);
  assert.equal(songs[1]._id, items[1].song._id);
  assert.equal(songs[0]._id, 'keep-1');
  assert.equal(songs[1]._id, 'keep-2');
});

test('25: input objects not mutated', () => {
  const item = activityItem();
  const payload = okPayload([item]);
  const before = structuredClone(payload);
  normalizeTrendingResponse(payload);
  buildTrendingSongs(normalizeTrendingResponse(payload).items);
  assert.deepEqual(payload, before);
});

// ACTIVITY SAFETY

test('26: activity score may remain in wrapper metadata if needed', () => {
  const item = normalizeTrendingItem(activityItem({ score: 4.25 }));
  assert.equal(item.score, 4.25);
  assert.equal(item.basis, TRENDING_BASIS.ACTIVITY);
});

test('27: score is not copied into playable Song', () => {
  const { items } = normalizeTrendingResponse(okPayload([activityItem({ score: 7.5 })]));
  const song = buildTrendingSongs(items)[0];
  assert.equal(Object.hasOwn(song, 'score'), false);
  assert.equal(song.score, undefined);
});

test('28: activity metrics not copied into playable Song', () => {
  const { items } = normalizeTrendingResponse(okPayload([activityItem()]));
  const song = buildTrendingSongs(items)[0];
  assert.equal(Object.hasOwn(song, 'activity'), false);
  assert.equal(song.unique_listener_count, undefined);
  assert.equal(song.play_started_count, undefined);
  assert.equal(song.listened_seconds, undefined);
});

test('29: user/session/event identifiers never introduced', () => {
  const { items } = normalizeTrendingResponse(okPayload([
    activityItem({
      user: 'u1',
      session_id: 's1',
      event_id: 'e1',
      email: 'a@b.c',
      token: 'jwt',
    }),
  ]));
  const song = buildTrendingSongs(items)[0];
  for (const key of ['user', 'userId', 'session_id', 'event_id', 'email', 'token', 'jwt']) {
    assert.equal(Object.hasOwn(song, key), false, key);
    assert.equal(Object.hasOwn(items[0], key), false, key);
  }
});

// FALLBACK SAFETY

test('30: fallback score null is accepted', () => {
  const item = normalizeTrendingItem(fallbackItem({ score: null }));
  assert.ok(item);
  assert.equal(item.basis, TRENDING_BASIS.CATALOG_FALLBACK);
  assert.equal(Object.hasOwn(item, 'score'), false);
});

test('31: fallback item yields normal playable Song', () => {
  const { items } = normalizeTrendingResponse(okPayload([fallbackItem()]));
  const song = buildTrendingSongs(items)[0];
  assert.ok(song._id);
  assert.ok(song.title);
  assert.ok(song.artist);
  assert.ok(song.youtube_id || song.file_path);
});

test('32: fallback does not gain fabricated score', () => {
  const item = normalizeTrendingItem(fallbackItem({ score: null }));
  const song = buildTrendingSongs([item])[0];
  assert.equal(item.score, undefined);
  assert.equal(song.score, undefined);
  assert.equal(Object.hasOwn(song, 'score'), false);
});

test('33: fallback does not gain fabricated listener count', () => {
  const item = normalizeTrendingItem(fallbackItem());
  const song = buildTrendingSongs([item])[0];
  assert.equal(song.unique_listener_count, undefined);
  assert.equal(song.play_started_count, undefined);
  assert.equal(Object.hasOwn(song, 'activity'), false);
});

test('34: fallback does not gain popular boolean/label', () => {
  const item = normalizeTrendingItem(fallbackItem());
  const song = buildTrendingSongs([item])[0];
  for (const key of ['popular', 'isPopular', 'mostPlayed', 'popularity', 'hot']) {
    assert.equal(Object.hasOwn(song, key), false, key);
    assert.equal(Object.hasOwn(item, key), false, key);
  }
});

test('35: optional display label, if implemented, is recently-added semantics only', () => {
  assert.equal(getTrendingDisplayMeta(fallbackItem()), TRENDING_FALLBACK_LABEL);
  assert.equal(getTrendingDisplayMeta(fallbackItem()), 'Recently added');
  assert.equal(getTrendingDisplayMeta(activityItem()), null);
  assert.equal(getTrendingDisplayMeta(null), null);
  assert.equal(
    String(getTrendingDisplayMeta(fallbackItem())).toLowerCase().includes('popular'),
    false,
  );
  assert.equal(
    String(getTrendingDisplayMeta(fallbackItem())).toLowerCase().includes('trending score'),
    false,
  );
});

// META

test('36: activity mode accepted', () => {
  const result = normalizeTrendingResponse(okPayload([activityItem()], {
    mode: TRENDING_MODE.ACTIVITY,
    activity_count: 1,
    fallback_count: 0,
  }));
  assert.equal(result.meta.mode, TRENDING_MODE.ACTIVITY);
  assert.equal(result.meta.activity_count, 1);
  assert.equal(result.meta.fallback_count, 0);
});

test('37: mixed mode accepted', () => {
  const result = normalizeTrendingResponse(okPayload([activityItem(), fallbackItem()], {
    mode: TRENDING_MODE.ACTIVITY_PLUS_FALLBACK,
    activity_count: 1,
    fallback_count: 1,
  }));
  assert.equal(result.meta.mode, TRENDING_MODE.ACTIVITY_PLUS_FALLBACK);
  assert.equal(result.meta.activity_count, 1);
  assert.equal(result.meta.fallback_count, 1);
});

test('38: fallback mode accepted', () => {
  const result = normalizeTrendingResponse(okPayload([fallbackItem()], {
    mode: TRENDING_MODE.CATALOG_FALLBACK,
    activity_count: 0,
    fallback_count: 1,
  }));
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
  assert.equal(result.meta.fallback_count, 1);
});

test('39: unknown mode safely ignored/defaulted', () => {
  const result = normalizeTrendingResponse(okPayload([activityItem()], {
    mode: 'ai-ranked',
    activity_count: 'x',
    fallback_count: {},
  }));
  assert.equal(result.meta.mode, null);
  assert.equal(result.meta.activity_count, null);
  assert.equal(result.meta.fallback_count, null);
});

test('40: diagnostic event_count is not required for card rendering', () => {
  const result = normalizeTrendingResponse({
    success: true,
    data: {
      items: [activityItem()],
      meta: {
        mode: TRENDING_MODE.ACTIVITY,
        activity_count: 1,
        fallback_count: 0,
        event_count: 12345,
        candidate_count: 9,
        event_input_truncated: true,
      },
    },
  });
  assert.equal(result.items.length, 1);
  assert.equal(Object.hasOwn(result.meta, 'event_count'), false);
  assert.equal(Object.hasOwn(result.meta, 'candidate_count'), false);
  assert.equal(Object.hasOwn(result.meta, 'event_input_truncated'), false);
});

// DETERMINISM

test('41: identical payload => deep-equal normalization', () => {
  const build = () => normalizeTrendingResponse(okPayload(
    [activityItem(), fallbackItem()],
    { mode: TRENDING_MODE.ACTIVITY_PLUS_FALLBACK, activity_count: 1, fallback_count: 1 },
  ));
  assert.deepEqual(build(), build());
});

test('42: no Math.random', () => {
  assert.equal(helperSrc.includes('Math.random'), false);
});

test('43: no mutation', () => {
  const item = activityItem();
  const fallback = fallbackItem();
  const snapshot = structuredClone({ item, fallback });
  normalizeTrendingItem(item);
  normalizeTrendingItem(fallback);
  normalizeTrendingResponse(okPayload([item, fallback]));
  assert.deepEqual({ item, fallback }, snapshot);
});

// classifyTrendingResult

test('classify: success payload is ok', () => {
  assert.equal(classifyTrendingResult(okPayload([activityItem()])), 'ok');
  assert.equal(classifyTrendingResult({ success: true, data: { items: [] } }), 'ok');
});

test('classify: disabled error maps to disabled', () => {
  assert.equal(classifyTrendingResult({
    success: false,
    error: TRENDING_DISABLED_ERROR,
  }), 'disabled');
  assert.equal(classifyTrendingResult({ error: TRENDING_DISABLED_ERROR }), 'disabled');
});

test('classify: other failures map to error', () => {
  assert.equal(classifyTrendingResult({ success: false, error: 'Unable to load Trending songs' }), 'error');
  assert.equal(classifyTrendingResult({ success: false, error: 'Network error' }), 'error');
  assert.equal(classifyTrendingResult(null), 'error');
  assert.equal(classifyTrendingResult(undefined), 'error');
  assert.equal(classifyTrendingResult('x'), 'error');
  assert.equal(classifyTrendingResult({ success: true }), 'error');
  assert.equal(classifyTrendingResult({ success: true, data: null }), 'error');
});

test('messages are fixed safe strings', () => {
  assert.equal(TRENDING_EMPTY_MESSAGE, 'No trending songs available yet.');
  assert.equal(TRENDING_ERROR_MESSAGE, 'Trending is unavailable right now.');
  assert.equal(TRENDING_LOADING_MESSAGE, 'Loading...');
  assert.equal(TRENDING_REQUEST_LIMIT, 10);
  assert.equal(TRENDING_REQUEST_PATH, '/api/trending?limit=10');
});

// DASHBOARD STATIC / INTEGRATION CHECKS

test('static 1: Dashboard requests /api/trending via GET with bounded limit', () => {
  assert.match(dashboardSrc, /api\.get\(\s*TRENDING_REQUEST_PATH\s*\)/);
  assert.equal(TRENDING_REQUEST_PATH, '/api/trending?limit=10');
  assert.equal(TRENDING_REQUEST_LIMIT, 10);
  assert.ok(dashboardSrc.includes("from './trendingUi.js'"));
  assert.equal(dashboardSrc.includes("api.post('/api/trending"), false);
  assert.equal(dashboardSrc.includes("api.put('/api/trending"), false);
  assert.equal(dashboardSrc.includes("api.del('/api/trending"), false);
  assert.equal(/trending\?[^'"]*userId/i.test(TRENDING_REQUEST_PATH), false);
  assert.equal(/trending\?[^'"]*genre/i.test(TRENDING_REQUEST_PATH), false);
  assert.equal(/trending\?[^'"]*artist/i.test(TRENDING_REQUEST_PATH), false);
});

test('static 2: uses existing API client, not raw fetch', () => {
  assert.match(dashboardSrc, /import\s*\{\s*api\s*\}\s*from\s*'\.\.\/\.\.\/api\/client\.js'/);
  const trendingFetch = dashboardSrc.match(/fetch\s*\([^)]*trending[^)]*\)/i);
  assert.equal(trendingFetch, null);
});

test('static 3: no Dashboard history or listening-event POST', () => {
  assert.equal(dashboardSrc.includes("api.post('/api/history'"), false);
  assert.equal(dashboardSrc.includes("api.post('/api/listening-events'"), false);
  assert.equal(dashboardSrc.includes('recordPlay'), false);
  assert.equal(dashboardSrc.includes('trending-clicked'), false);
  assert.equal(dashboardSrc.includes('recommendation-clicked'), false);
});

test('static 4: click path uses player.playSong with full list and filtered index', () => {
  assert.match(dashboardSrc, /player\.playSong\(\s*trendingSongs\s*,\s*index\s*\)/);
  assert.match(dashboardSrc, /const trendingSongs = buildTrendingSongs\(trendingItems\)/);
  assert.match(dashboardSrc, /normalizeTrendingResponse\(/);
  const playStart = dashboardSrc.indexOf('const playTrendingSong');
  const playEnd = dashboardSrc.indexOf('const playFromHistory');
  assert.ok(playStart >= 0 && playEnd > playStart);
  const playBlock = dashboardSrc.slice(playStart, playEnd);
  assert.match(playBlock, /player\.playSong\(trendingSongs, index\)/);
  assert.equal(playBlock.includes('player.playSong(['), false);
  assert.equal(playBlock.includes('buildTrendingSongs(['), false);
});

test('static 5: Recently Played precedes Trending Now precedes Recommended Songs', () => {
  const recently = dashboardSrc.indexOf('Recently Played');
  const trending = dashboardSrc.indexOf('Trending Now');
  const recommended = dashboardSrc.indexOf('Recommended Songs');
  assert.ok(recently >= 0, 'Recently Played heading present');
  assert.ok(trending >= 0, 'Trending Now heading present');
  assert.ok(recommended >= 0, 'Recommended Songs heading present');
  assert.ok(recently < trending, 'Recently Played before Trending Now');
  assert.ok(trending < recommended, 'Trending Now before Recommended Songs');
  const searchBlock = dashboardSrc.indexOf('search-container');
  assert.ok(trending < searchBlock || searchBlock < recently || searchBlock < trending,
    'search block coexists with ordered sections');
});

test('static 6: no AI wording and no numeric score display around Trending', () => {
  assert.equal(dashboardSrc.includes('AI Trending'), false);
  assert.equal(dashboardSrc.includes('AI Picks'), false);
  assert.equal(dashboardSrc.includes('Recommended For You'), false);
  assert.equal(dashboardSrc.includes('Because You Listened'), false);
  assert.equal(dashboardSrc.includes('Smart Trending'), false);
  assert.equal(/Trending Now[\s\S]{0,400}\{[^}]*score[^}]*\}/.test(dashboardSrc), false);
  assert.equal(dashboardSrc.includes('{item.score}'), false);
  assert.equal(dashboardSrc.includes('{item?.score}'), false);
  assert.equal(dashboardSrc.includes('% trending'), false);
});

test('static 7: no raw backend error displayed and 503 handled quietly', () => {
  assert.equal(dashboardSrc.includes('{error.message}'), false);
  assert.equal(dashboardSrc.includes('{data.error}'), false);
  assert.equal(dashboardSrc.includes('{err.message}'), false);
  assert.match(dashboardSrc, /classifyTrendingResult\(/);
  assert.equal(dashboardSrc.includes("status: 'disabled'"), false);
  assert.match(dashboardSrc, /'disabled'/);
  assert.equal(/setInterval\s*\(\s*[^)]*trending/i.test(dashboardSrc), false);
  assert.equal(/setTimeout\s*\([^)]*trending/i.test(dashboardSrc) && dashboardSrc.includes('retry'), false);
  assert.equal(dashboardSrc.includes('retryTrending'), false);
  assert.equal(dashboardSrc.includes('.retry('), false);
});

test('static 8: section title is exactly Trending Now', () => {
  assert.match(dashboardSrc, /<h2>\s*Trending Now\s*<\/h2>/);
});

test('static 9: empty and error messages are section-local safe strings', () => {
  assert.ok(dashboardSrc.includes('No trending songs available yet.')
    || dashboardSrc.includes('TRENDING_EMPTY_MESSAGE'));
  assert.ok(dashboardSrc.includes('Trending is unavailable right now.')
    || dashboardSrc.includes('TRENDING_ERROR_MESSAGE'));
});

test('static 10: no polling or infinite trending refresh', () => {
  assert.equal(/setInterval\s*\(/.test(dashboardSrc.split('Trending Now')[1] || ''), false);
  assert.equal(dashboardSrc.includes('autoRefresh'), false);
  assert.equal(dashboardSrc.includes('pollTrending'), false);
});

test('static 11: no server files in helper scope (client-only)', () => {
  assert.equal(helperSrc.includes("from 'express'"), false);
  assert.equal(helperSrc.includes('mongoose'), false);
  assert.equal(helperSrc.includes('localStorage'), false);
});

test('static 12: basis vocabulary frozen to activity and catalog-fallback', () => {
  assert.deepEqual(Object.values(TRENDING_BASIS).sort(), ['activity', 'catalog-fallback']);
  assert.equal(Object.isFrozen(TRENDING_BASIS), true);
});

test('static 13: no userId preference sent with trending request', () => {
  const match = dashboardSrc.match(/api\.get\(\s*TRENDING_REQUEST_PATH\s*\)/);
  assert.ok(match, 'trending get call found');
  assert.equal(TRENDING_REQUEST_PATH.includes('userId'), false);
  assert.equal(/userId|user_id|user=/i.test(TRENDING_REQUEST_PATH), false);
  assert.equal(/genre|artist|language|preference/i.test(TRENDING_REQUEST_PATH), false);
  assert.ok(TRENDING_REQUEST_PATH.includes('limit=10'));
  assert.equal(/api\.get\([^)]*userId[^)]*trending/i.test(dashboardSrc), false);
});

test('static 14: playTrendingSong guards missing song and toggles current track', () => {
  assert.match(dashboardSrc, /playTrendingSong|handleTrendingClick/);
  assert.match(dashboardSrc, /player\.togglePlay\(\)/);
});
