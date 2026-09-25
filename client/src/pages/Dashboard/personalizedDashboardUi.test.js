import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_RECOMMENDATION_MODES,
  selectDashboardRecommendationPresentation,
} from './recommendationUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(join(__dirname, 'Dashboard.jsx'), 'utf8');

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

test('recommendation presentation state mapping remains intact', () => {
  const personalized = [{ _id: 'p1' }];
  const legacy = [{ _id: 'l1' }];

  const loading = selectDashboardRecommendationPresentation({
    state: 'loading',
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.equal(loading.mode, DASHBOARD_RECOMMENDATION_MODES.LOADING);
  assert.deepEqual(loading.songs, []);

  const ready = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.equal(ready.mode, DASHBOARD_RECOMMENDATION_MODES.PERSONALIZED);
  assert.equal(ready.songs, personalized);

  const fallback = selectDashboardRecommendationPresentation({
    state: 'error',
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.equal(fallback.mode, DASHBOARD_RECOMMENDATION_MODES.LEGACY);
  assert.equal(fallback.songs, legacy);
});

test('recommended section remains titled Recommended For You', () => {
  assert.match(dashboardSrc, /title="Recommended For You"/);
  assert.equal(dashboardSrc.includes('Recommended Songs'), false);
});

test('Dashboard keeps queue-based playback for recommendation cards', () => {
  assert.match(dashboardSrc, /player\.playSong\(queue, index\)/);
  assert.match(dashboardSrc, /renderSongRow\(recommendationPresentation\.songs\)/);
});
