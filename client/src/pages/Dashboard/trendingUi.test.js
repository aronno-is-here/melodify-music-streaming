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
  normalizeTrendingItem,
  normalizeTrendingResponse,
  buildTrendingSongs,
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

test('normalizeTrendingItem accepts valid playable trending items', () => {
  const normalized = normalizeTrendingItem(activityItem);
  assert.ok(normalized);
  assert.equal(normalized.song._id, 'song-1');
  assert.equal(normalized.basis, TRENDING_BASIS.ACTIVITY);
});

test('normalizeTrendingItem rejects invalid items safely', () => {
  assert.equal(normalizeTrendingItem(null), null);
  assert.equal(normalizeTrendingItem({ basis: 'ai', song: baseSong }), null);
  assert.equal(normalizeTrendingItem({ basis: TRENDING_BASIS.ACTIVITY, song: { ...baseSong, _id: '' } }), null);
  assert.equal(normalizeTrendingItem({ basis: TRENDING_BASIS.ACTIVITY, song: { ...baseSong, title: '' } }), null);
  assert.equal(normalizeTrendingItem({ basis: TRENDING_BASIS.ACTIVITY, song: { ...baseSong, youtube_id: '', file_path: '' } }), null);
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

test('classifyTrendingResult maps disabled and malformed payloads safely', () => {
  assert.equal(classifyTrendingResult({ success: true, data: { items: [] } }), 'ok');
  assert.equal(classifyTrendingResult({ success: false, error: TRENDING_DISABLED_ERROR }), 'disabled');
  assert.equal(classifyTrendingResult({ success: false, error: 'x' }), 'error');
  assert.equal(classifyTrendingResult(null), 'error');
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

test('Dashboard trending integration avoids telemetry/history side effects', () => {
  assert.equal(dashboardSrc.includes("api.post('/api/history'"), false);
  assert.equal(dashboardSrc.includes('/api/listening-events'), false);
  assert.equal(dashboardSrc.includes('recordPlay'), false);
});
