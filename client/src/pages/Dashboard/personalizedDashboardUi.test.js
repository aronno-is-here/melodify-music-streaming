import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_RECOMMENDATION_MODES,
  PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
  PERSONALIZED_RECOMMENDATION_STATES,
  classifyPersonalizedRecommendationPayload,
  selectDashboardRecommendationPresentation,
} from './recommendationUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(join(__dirname, 'Dashboard.jsx'), 'utf8');

const baseSnapshot = Object.freeze({
  snapshot_version: 'run-1',
  generated_at: '2026-09-15T10:00:00.000Z',
  item_count: 2,
  available_count: 2,
  unavailable_count: 0,
});

const baseSongs = Object.freeze([
  { _id: 'song-1', title: 'One', artist: 'A', youtube_id: 'yt-1' },
  { _id: 'song-2', title: 'Two', artist: 'B', youtube_id: 'yt-2' },
]);

function buildReadyPayload(items = baseSongs) {
  return {
    success: true,
    data: {
      status: 'ready',
      source: 'personalized-snapshot',
      snapshot: {
        ...baseSnapshot,
        item_count: items.length,
        available_count: items.length,
      },
      items: items.map((song, index) => ({
        rank: index + 1,
        song,
      })),
    },
  };
}

test('Dashboard keeps personalized recommendation hook contract', () => {
  assert.match(dashboardSrc, /usePersonalizedRecommendations\(/);
  assert.match(dashboardSrc, /PERSONALIZED_RECOMMENDATION_LIMIT = 10/);
  assert.match(dashboardSrc, /state: personalizedRecommendations\.state/);
  assert.match(dashboardSrc, /personalizedSongs: personalizedRecommendations\.songs/);
  assert.match(dashboardSrc, /legacySongs: songs/);
});

test('Dashboard does not call recommendations API directly', () => {
  assert.equal(dashboardSrc.includes('/api/recommendations'), false);
  assert.equal(dashboardSrc.includes('fetchPersonalizedRecommendations'), false);
  assert.equal(dashboardSrc.includes('classifyPersonalizedRecommendationPayload'), false);
});

test('recommendation presentation mode vocabulary remains exactly loading, personalized, legacy', () => {
  assert.deepEqual(Object.values(DASHBOARD_RECOMMENDATION_MODES).sort(), [
    'legacy',
    'loading',
    'personalized',
  ]);
});

const loadingStates = [
  PERSONALIZED_RECOMMENDATION_STATES.IDLE,
  PERSONALIZED_RECOMMENDATION_STATES.LOADING,
];

for (const state of loadingStates) {
  test(`state mapping: ${state} -> loading with empty songs`, () => {
    const result = selectDashboardRecommendationPresentation({
      state,
      personalizedSongs: baseSongs,
      legacySongs: baseSongs,
    });
    assert.equal(result.mode, DASHBOARD_RECOMMENDATION_MODES.LOADING);
    assert.deepEqual(result.songs, []);
    assert.equal(result.isFallback, false);
  });
}

test('state mapping: ready -> personalized with unchanged ordering', () => {
  const personalized = [...baseSongs];
  const legacy = [{ _id: 'legacy-1' }];
  const result = selectDashboardRecommendationPresentation({
    state: PERSONALIZED_RECOMMENDATION_STATES.READY,
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.equal(result.mode, DASHBOARD_RECOMMENDATION_MODES.PERSONALIZED);
  assert.equal(result.songs, personalized);
  assert.equal(result.isFallback, false);
  assert.deepEqual(result.songs.map((song) => song._id), ['song-1', 'song-2']);
});

const fallbackStates = [
  PERSONALIZED_RECOMMENDATION_STATES.NO_SNAPSHOT,
  PERSONALIZED_RECOMMENDATION_STATES.EMPTY,
  PERSONALIZED_RECOMMENDATION_STATES.DISABLED,
  PERSONALIZED_RECOMMENDATION_STATES.ERROR,
];

for (const state of fallbackStates) {
  test(`state mapping: ${state} -> legacy fallback songs only`, () => {
    const personalized = [{ _id: 'personalized-only' }];
    const legacy = [{ _id: 'legacy-a' }, { _id: 'legacy-b' }];
    const result = selectDashboardRecommendationPresentation({
      state,
      personalizedSongs: personalized,
      legacySongs: legacy,
    });
    assert.equal(result.mode, DASHBOARD_RECOMMENDATION_MODES.LEGACY);
    assert.equal(result.songs, legacy);
    assert.equal(result.isFallback, true);
    assert.deepEqual(result.songs.map((song) => song._id), ['legacy-a', 'legacy-b']);
  });
}

test('presentation selector rejects unknown states', () => {
  assert.throws(() => selectDashboardRecommendationPresentation({
    state: 'unknown',
    personalizedSongs: baseSongs,
    legacySongs: baseSongs,
  }), /invalid recommendation state/);
});

test('presentation selector fail-closes non-array song inputs', () => {
  const ready = selectDashboardRecommendationPresentation({
    state: PERSONALIZED_RECOMMENDATION_STATES.READY,
    personalizedSongs: null,
    legacySongs: baseSongs,
  });
  const fallback = selectDashboardRecommendationPresentation({
    state: PERSONALIZED_RECOMMENDATION_STATES.ERROR,
    personalizedSongs: baseSongs,
    legacySongs: null,
  });
  assert.deepEqual(ready.songs, []);
  assert.deepEqual(fallback.songs, []);
});

test('recommendation presentation keeps source arrays unmutated and unsorted', () => {
  const personalized = [{ _id: 'p1' }];
  const legacy = [{ _id: 'l1' }];
  const pSnapshot = JSON.stringify(personalized);
  const lSnapshot = JSON.stringify(legacy);

  const loading = selectDashboardRecommendationPresentation({
    state: PERSONALIZED_RECOMMENDATION_STATES.LOADING,
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.equal(loading.mode, DASHBOARD_RECOMMENDATION_MODES.LOADING);
  assert.deepEqual(loading.songs, []);

  const ready = selectDashboardRecommendationPresentation({
    state: PERSONALIZED_RECOMMENDATION_STATES.READY,
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.equal(ready.mode, DASHBOARD_RECOMMENDATION_MODES.PERSONALIZED);
  assert.equal(ready.songs, personalized);

  const fallback = selectDashboardRecommendationPresentation({
    state: PERSONALIZED_RECOMMENDATION_STATES.ERROR,
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.equal(fallback.mode, DASHBOARD_RECOMMENDATION_MODES.LEGACY);
  assert.equal(fallback.songs, legacy);

  assert.equal(JSON.stringify(personalized), pSnapshot);
  assert.equal(JSON.stringify(legacy), lSnapshot);
});

test('classify: ready payload maps through recommendation contract without reranking', () => {
  const payload = buildReadyPayload(baseSongs);
  const classified = classifyPersonalizedRecommendationPayload(payload, { limit: 10 });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.READY);
  assert.deepEqual(classified.songs.map((song) => song._id), ['song-1', 'song-2']);
});

test('classify: no-snapshot maps to no-snapshot', () => {
  const classified = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'no-snapshot',
      source: 'personalized-snapshot',
      snapshot: null,
      items: [],
    },
  });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.NO_SNAPSHOT);
  assert.deepEqual(classified.songs, []);
});

test('classify: ready with empty items maps to empty state', () => {
  const classified = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'ready',
      source: 'personalized-snapshot',
      snapshot: {
        snapshot_version: 'run-empty',
        generated_at: '2026-09-15T10:00:00.000Z',
        item_count: 0,
        available_count: 0,
        unavailable_count: 0,
      },
      items: [],
    },
  });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.EMPTY);
  assert.deepEqual(classified.songs, []);
});

test('classify: exact disabled message maps to disabled state safely', () => {
  const classified = classifyPersonalizedRecommendationPayload({
    success: false,
    error: PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
  });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.DISABLED);
  assert.deepEqual(classified.songs, []);
});

test('classify: malformed recommendation row fails closed to error', () => {
  const payload = buildReadyPayload(baseSongs);
  payload.data.items[1] = { rank: 2, song: null };
  const classified = classifyPersonalizedRecommendationPayload(payload, { limit: 10 });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('classify: duplicate recommendation song ids fail closed to error', () => {
  const payload = buildReadyPayload([
    { ...baseSongs[0], _id: 'dup' },
    { ...baseSongs[1], _id: 'dup' },
  ]);
  const classified = classifyPersonalizedRecommendationPayload(payload, { limit: 10 });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('classify: rank gaps fail closed to error', () => {
  const payload = buildReadyPayload(baseSongs);
  payload.data.items[1] = { rank: 3, song: baseSongs[1] };
  const classified = classifyPersonalizedRecommendationPayload(payload, { limit: 10 });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('classify: items above the requested limit fail closed to error', () => {
  const payload = buildReadyPayload(baseSongs);
  const classified = classifyPersonalizedRecommendationPayload(payload, { limit: 1 });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('classify: snapshot conservation mismatch fails closed', () => {
  const payload = buildReadyPayload(baseSongs);
  payload.data.snapshot.available_count = 1;
  const classified = classifyPersonalizedRecommendationPayload(payload, { limit: 10 });
  assert.equal(classified.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('recommended section remains titled Recommended For You', () => {
  assert.match(dashboardSrc, /title="Recommended For You"/);
  assert.equal(dashboardSrc.includes('Recommended Songs'), false);
});

test('recommended section remains in discovery order with surrounding sections', () => {
  const order = [
    'Continue Listening',
    'Trending Now',
    'Recommended For You',
    'Recently Added',
    'Quick Picks',
    'Discover by Genre',
    'Discover by Artist',
    'Your Playlists / Liked Songs',
  ];
  let previous = -1;
  for (const label of order) {
    const at = dashboardSrc.indexOf(label);
    assert.ok(at > previous, `${label} order`);
    previous = at;
  }
});

test('Dashboard keeps queue-based playback for recommendation cards', () => {
  assert.match(dashboardSrc, /player\.playSong\(queue, index\)/);
  assert.match(dashboardSrc, /renderSongRow\(recommendationPresentation\.songs\)/);
  assert.match(dashboardSrc, /if \(player\.currentSong\?\._id === song\._id\) \{/);
  assert.match(dashboardSrc, /player\.togglePlay\(\)/);
});

test('recommendation actions route through shared play/favorite handlers', () => {
  assert.match(dashboardSrc, /<SongCard/);
  assert.match(dashboardSrc, /onPlay=\{\(\) => playSongQueue\(queue, index\)\}/);
  assert.match(dashboardSrc, /onToggleFavorite=\{\(\) => toggleFavorite\(song\._id\)\}/);
});

test('Dashboard recommendation rendering performs no direct recommendation request-time reranking', () => {
  assert.equal(dashboardSrc.includes('Math.random'), false);
  assert.equal(dashboardSrc.includes('recommendationPresentation.songs.sort('), false);
  assert.equal(dashboardSrc.includes('recommendationPresentation.songs.reverse('), false);
  assert.equal(dashboardSrc.includes('recommendationPresentation.songs.slice('), false);
});

test('Dashboard recommendation rendering performs no direct telemetry/history writes', () => {
  assert.equal(dashboardSrc.includes("api.post('/api/history'"), false);
  assert.equal(dashboardSrc.includes('/api/listening-events'), false);
  assert.equal(dashboardSrc.includes('recordPlay'), false);
});

test('Dashboard recommendation section has no fabricated AI score/badge presentation', () => {
  assert.equal(dashboardSrc.includes('AI'), false);
  assert.equal(dashboardSrc.includes('score'), false);
  assert.equal(dashboardSrc.includes('confidence'), false);
  assert.equal(dashboardSrc.includes('rank'), false);
});

test('Dashboard recommendation flow relies on hook + selector data path only', () => {
  assert.match(dashboardSrc, /usePersonalizedRecommendations\(/);
  assert.match(dashboardSrc, /selectDashboardRecommendationPresentation\(/);
  assert.equal(dashboardSrc.includes('/api/recommendations'), false);
  assert.equal(dashboardSrc.includes('fetchPersonalizedRecommendations'), false);
  assert.equal(dashboardSrc.includes('classifyPersonalizedRecommendationPayload'), false);
});
