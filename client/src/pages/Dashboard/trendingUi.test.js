import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRENDING_BASIS,
  TRENDING_MODE,
  TRENDING_REQUEST_PATH,
  TRENDING_REQUEST_LIMIT,
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

const baseSong = {
  _id: 'song-1',
  title: 'Alpha',
  artist: 'Artist A',
  genre: 'Bengali',
  youtube_id: 'yt-alpha',
};

const activityItem = {
  basis: TRENDING_BASIS.ACTIVITY,
  song: baseSong,
  score: 3.2,
  activity: {
    unique_listener_count: 2,
    play_started_count: 4,
    completed_count: 1,
    replay_started_count: 0,
    skipped_count: 0,
    listened_seconds: 90,
  },
};

test('constants remain stable for trending request and messaging', () => {
  assert.equal(TRENDING_REQUEST_LIMIT, 10);
  assert.equal(TRENDING_REQUEST_PATH, '/api/trending?limit=10');
  assert.equal(TRENDING_LOADING_MESSAGE, 'Loading...');
  assert.equal(TRENDING_EMPTY_MESSAGE, 'No trending songs available yet.');
  assert.equal(TRENDING_ERROR_MESSAGE, 'Trending is unavailable right now.');
  assert.deepEqual(Object.values(TRENDING_BASIS).sort(), ['activity', 'catalog-fallback']);
  assert.deepEqual(Object.values(TRENDING_MODE).sort(), [
    'activity',
    'activity-plus-fallback',
    'catalog-fallback',
  ]);
});

test('request path encodes a fixed bounded limit and no identity query parameters', () => {
  assert.equal(TRENDING_REQUEST_PATH.includes('limit=10'), true);
  assert.equal(TRENDING_REQUEST_PATH.includes('user='), false);
  assert.equal(TRENDING_REQUEST_PATH.includes('userId='), false);
  assert.equal(TRENDING_REQUEST_PATH.includes('email='), false);
});

test('normalizeTrendingItem accepts valid playable activity items', () => {
  const normalized = normalizeTrendingItem(activityItem);
  assert.ok(normalized);
  assert.equal(normalized.song._id, 'song-1');
  assert.equal(normalized.basis, TRENDING_BASIS.ACTIVITY);
  assert.equal(normalized.score, 3.2);
  assert.deepEqual(normalized.activity, activityItem.activity);
});

test('normalizeTrendingItem accepts valid catalog-fallback items without score fabrication', () => {
  const normalized = normalizeTrendingItem({
    basis: TRENDING_BASIS.CATALOG_FALLBACK,
    score: 9.99,
    activity: { unique_listener_count: 999 },
    song: { ...baseSong, _id: 'song-fallback' },
  });
  assert.ok(normalized);
  assert.equal(normalized.basis, TRENDING_BASIS.CATALOG_FALLBACK);
  assert.equal(Object.hasOwn(normalized, 'score'), false);
  assert.equal(Object.hasOwn(normalized, 'activity'), false);
});

const invalidItemCases = [
  { label: 'null item', item: null },
  { label: 'non-object item', item: 7 },
  { label: 'invalid basis', item: { basis: 'ai', song: baseSong } },
  { label: 'missing song', item: { basis: TRENDING_BASIS.ACTIVITY } },
  { label: 'non-object song', item: { basis: TRENDING_BASIS.ACTIVITY, song: 'x' } },
  { label: 'blank song id', item: { basis: TRENDING_BASIS.ACTIVITY, song: { ...baseSong, _id: '' } } },
  { label: 'blank title', item: { basis: TRENDING_BASIS.ACTIVITY, song: { ...baseSong, title: ' ' } } },
  { label: 'blank artist', item: { basis: TRENDING_BASIS.ACTIVITY, song: { ...baseSong, artist: '' } } },
  {
    label: 'missing playback source',
    item: { basis: TRENDING_BASIS.ACTIVITY, song: { ...baseSong, youtube_id: '', file_path: '' } },
  },
];

for (const testCase of invalidItemCases) {
  test(`normalizeTrendingItem rejects malformed entry: ${testCase.label}`, () => {
    assert.equal(normalizeTrendingItem(testCase.item), null);
  });
}

test('normalizeTrendingItem preserves public song projection only', () => {
  const normalized = normalizeTrendingItem({
    basis: TRENDING_BASIS.ACTIVITY,
    song: {
      ...baseSong,
      internal_score: 123,
      _private: true,
      __v: 1,
    },
  });
  assert.ok(normalized);
  assert.equal(Object.hasOwn(normalized.song, 'internal_score'), false);
  assert.equal(Object.hasOwn(normalized.song, '_private'), false);
  assert.equal(Object.hasOwn(normalized.song, '__v'), false);
});

test('normalizeTrendingResponse preserves order and deduplicates by song id', () => {
  const payload = {
    success: true,
    data: {
      items: [
        activityItem,
        { ...activityItem, song: { ...baseSong, _id: 'song-1', title: 'Duplicate' } },
        { ...activityItem, song: { ...baseSong, _id: 'song-2', title: 'Beta' } },
      ],
      meta: { mode: TRENDING_MODE.ACTIVITY },
    },
  };
  const normalized = normalizeTrendingResponse(payload);
  assert.deepEqual(normalized.items.map((item) => item.song._id), ['song-1', 'song-2']);
});

test('normalizeTrendingResponse deduplicates case-insensitively and keeps first seen item', () => {
  const payload = {
    success: true,
    data: {
      items: [
        { ...activityItem, song: { ...baseSong, _id: 'Song-1', title: 'First' } },
        { ...activityItem, song: { ...baseSong, _id: 'song-1', title: 'Second' } },
      ],
      meta: { mode: TRENDING_MODE.ACTIVITY },
    },
  };
  const normalized = normalizeTrendingResponse(payload);
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.items[0].song.title, 'First');
});

test('normalizeTrendingResponse filters malformed rows without failing valid rows', () => {
  const payload = {
    success: true,
    data: {
      items: [
        null,
        { basis: 'invalid', song: baseSong },
        activityItem,
      ],
      meta: { mode: TRENDING_MODE.ACTIVITY_PLUS_FALLBACK, activity_count: 2, fallback_count: 1 },
    },
  };
  const normalized = normalizeTrendingResponse(payload);
  assert.deepEqual(normalized.items.map((item) => item.song._id), ['song-1']);
  assert.equal(normalized.meta.mode, TRENDING_MODE.ACTIVITY_PLUS_FALLBACK);
  assert.equal(normalized.meta.activity_count, 2);
  assert.equal(normalized.meta.fallback_count, 1);
});

const malformedPayloads = [
  null,
  {},
  { success: false },
  { success: true },
  { success: true, data: null },
  { success: true, data: { items: 'x' } },
];

for (const raw of malformedPayloads) {
  test('normalizeTrendingResponse fail-closes malformed payload to empty list', () => {
    const normalized = normalizeTrendingResponse(raw);
    assert.deepEqual(normalized.items, []);
    assert.deepEqual(normalized.meta, {
      mode: null,
      activity_count: null,
      fallback_count: null,
    });
  });
}

test('normalizeTrendingResponse ignores invalid meta mode and non-finite counters', () => {
  const normalized = normalizeTrendingResponse({
    success: true,
    data: {
      items: [activityItem],
      meta: {
        mode: 'popular',
        activity_count: Infinity,
        fallback_count: NaN,
      },
    },
  });
  assert.equal(normalized.meta.mode, null);
  assert.equal(normalized.meta.activity_count, null);
  assert.equal(normalized.meta.fallback_count, null);
});

test('normalizeTrendingResponse accepts both mode vocabulary and basis vocabulary in meta', () => {
  const usingMode = normalizeTrendingResponse({
    success: true,
    data: {
      items: [activityItem],
      meta: { mode: TRENDING_MODE.ACTIVITY_PLUS_FALLBACK },
    },
  });
  const usingBasis = normalizeTrendingResponse({
    success: true,
    data: {
      items: [activityItem],
      meta: { mode: TRENDING_BASIS.CATALOG_FALLBACK },
    },
  });
  assert.equal(usingMode.meta.mode, TRENDING_MODE.ACTIVITY_PLUS_FALLBACK);
  assert.equal(usingBasis.meta.mode, TRENDING_BASIS.CATALOG_FALLBACK);
});

test('normalization is deterministic and does not mutate caller payload', () => {
  const payload = {
    success: true,
    data: {
      items: [activityItem, { ...activityItem, song: { ...baseSong, _id: 'song-2' } }],
      meta: { mode: TRENDING_MODE.ACTIVITY, activity_count: 2, fallback_count: 0 },
    },
  };
  const snapshot = JSON.stringify(payload);
  const first = normalizeTrendingResponse(payload);
  const second = normalizeTrendingResponse(payload);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(payload), snapshot);
});

test('buildTrendingSongs returns song-only queue without wrapper metadata', () => {
  const normalized = normalizeTrendingResponse({
    success: true,
    data: { items: [activityItem], meta: { mode: TRENDING_MODE.ACTIVITY } },
  });
  const queue = buildTrendingSongs(normalized.items);
  assert.equal(queue.length, 1);
  assert.equal(Object.hasOwn(queue[0], 'basis'), false);
  assert.equal(Object.hasOwn(queue[0], 'score'), false);
  assert.equal(Object.hasOwn(queue[0], 'activity'), false);
});

test('buildTrendingSongs keeps normalized ordering and length', () => {
  const payload = {
    success: true,
    data: {
      items: [
        { ...activityItem, song: { ...baseSong, _id: 'song-a' } },
        { ...activityItem, song: { ...baseSong, _id: 'song-b' } },
      ],
      meta: { mode: TRENDING_MODE.ACTIVITY },
    },
  };
  const normalized = normalizeTrendingResponse(payload);
  const songs = buildTrendingSongs(normalized.items);
  assert.deepEqual(songs.map((song) => song._id), ['song-a', 'song-b']);
});

test('buildTrendingSongs fail-closes malformed wrappers', () => {
  const songs = buildTrendingSongs([
    { song: { ...baseSong, _id: 'ok' } },
    null,
    { notSong: true },
  ]);
  assert.deepEqual(songs.map((song) => song._id), ['ok']);
});

test('buildTrendingSongs returns [] for non-array input', () => {
  assert.deepEqual(buildTrendingSongs(null), []);
  assert.deepEqual(buildTrendingSongs({}), []);
});

test('fallback display label is only shown for catalog-fallback basis', () => {
  assert.equal(getTrendingDisplayMeta({ basis: TRENDING_BASIS.CATALOG_FALLBACK }), TRENDING_FALLBACK_LABEL);
  assert.equal(getTrendingDisplayMeta({ basis: TRENDING_BASIS.ACTIVITY }), null);
  assert.equal(getTrendingDisplayMeta(null), null);
});

test('classifyTrendingResult maps disabled and malformed payloads safely', () => {
  assert.equal(classifyTrendingResult({ success: true, data: { items: [] } }), 'ok');
  assert.equal(classifyTrendingResult({ success: false, error: TRENDING_DISABLED_ERROR }), 'disabled');
  assert.equal(classifyTrendingResult({ success: false, error: 'x' }), 'error');
  assert.equal(classifyTrendingResult(null), 'error');
});

test('classifyTrendingResult treats success without object data as error', () => {
  assert.equal(classifyTrendingResult({ success: true, data: null }), 'error');
  assert.equal(classifyTrendingResult({ success: true, data: [] }), 'error');
});

test('Dashboard integration preserves trending request contract and section ordering', () => {
  assert.match(dashboardSrc, /api\.get\(TRENDING_REQUEST_PATH\)/);
  assert.match(dashboardSrc, /normalizeTrendingResponse\(/);
  assert.match(dashboardSrc, /buildTrendingSongs\(trendingItems\)/);
  assert.equal(dashboardSrc.includes('/api/trending?limit=10'), false);
  const continueAt = dashboardSrc.indexOf('Continue Listening');
  const trendingAt = dashboardSrc.indexOf('Trending Now');
  const recommendedAt = dashboardSrc.indexOf('Recommended For You');
  assert.ok(continueAt >= 0);
  assert.ok(trendingAt > continueAt);
  assert.ok(recommendedAt > trendingAt);
});

test('Dashboard maps loading/empty/error/disabled status through trendingStatus state machine', () => {
  assert.match(dashboardSrc, /useState\('loading'\)/);
  assert.match(dashboardSrc, /setTrendingStatus\('disabled'\)/);
  assert.match(dashboardSrc, /setTrendingStatus\('error'\)/);
  assert.match(dashboardSrc, /setTrendingStatus\(items\.length > 0 \? 'ready' : 'empty'\)/);
  assert.match(dashboardSrc, /trendingStatus !== 'disabled'/);
});

test('Dashboard renders section-local fixed trending messages only', () => {
  assert.match(dashboardSrc, /TRENDING_LOADING_MESSAGE/);
  assert.match(dashboardSrc, /TRENDING_EMPTY_MESSAGE/);
  assert.match(dashboardSrc, /TRENDING_ERROR_MESSAGE/);
  assert.equal(dashboardSrc.includes('Trending score'), false);
  assert.equal(dashboardSrc.includes('popular'), false);
  assert.equal(dashboardSrc.includes('viral'), false);
});

test('Dashboard trending integration avoids telemetry/history side effects', () => {
  assert.equal(dashboardSrc.includes("api.post('/api/history'"), false);
  assert.equal(dashboardSrc.includes('/api/listening-events'), false);
  assert.equal(dashboardSrc.includes('recordPlay'), false);
});

test('Dashboard trending integration avoids direct endpoint literals and extra fetch paths', () => {
  assert.equal(dashboardSrc.includes('/api/trending?limit=10'), false);
  assert.equal(dashboardSrc.includes('/api/trending'), false);
  assert.equal(dashboardSrc.includes('fetch('), false);
});

test('Dashboard trending playback uses the full normalized queue via playSongQueue', () => {
  assert.match(dashboardSrc, /const trendingSongs = useMemo\(\(\) => buildTrendingSongs\(trendingItems\), \[trendingItems\]\)/);
  assert.match(dashboardSrc, /renderSongRow\(trendingSongs\)/);
  assert.match(dashboardSrc, /player\.playSong\(queue, index\)/);
});

test('trending helper and dashboard include no randomness or reranking paths', () => {
  assert.equal(dashboardSrc.includes('Math.random'), false);
  assert.equal(dashboardSrc.includes('.sort('), false);
  const helperSrc = readFileSync(join(__dirname, 'trendingUi.js'), 'utf8');
  assert.equal(helperSrc.includes('Math.random'), false);
  assert.equal(helperSrc.includes('.sort('), false);
  assert.equal(helperSrc.includes('setInterval('), false);
});
