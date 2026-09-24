import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERSONALIZED_RECOMMENDATION_STATES,
  PERSONALIZED_RECOMMENDATION_EMPTY_REASONS,
  PERSONALIZED_RECOMMENDATION_ERROR_CODES,
  PERSONALIZED_RECOMMENDATION_SOURCE,
  PERSONALIZED_RECOMMENDATION_PATH,
  DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT,
  PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
  classifyPersonalizedRecommendationPayload,
  shouldUseLegacyRecommendationFallback,
  getPersonalizedRecommendationEmptyReason,
} from './recommendationUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiSrc = readFileSync(join(__dirname, 'recommendationUi.js'), 'utf8');
const dashboardSrc = readFileSync(join(__dirname, 'Dashboard.jsx'), 'utf8');
const serviceSrc = readFileSync(
  join(__dirname, '..', '..', 'services', 'personalizedRecommendations.js'),
  'utf8',
);

test('1: recommendationUi re-exports the seven-state vocabulary', () => {
  assert.deepEqual(Object.values(PERSONALIZED_RECOMMENDATION_STATES).sort(), [
    'disabled',
    'empty',
    'error',
    'idle',
    'loading',
    'no-snapshot',
    'ready',
  ]);
});

test('2: recommendationUi re-exports empty reason identifiers', () => {
  assert.deepEqual(Object.values(PERSONALIZED_RECOMMENDATION_EMPTY_REASONS).sort(), [
    'empty-snapshot',
    'feature-disabled',
    'no-snapshot',
    'none',
    'request-error',
  ]);
});

test('3: recommendationUi re-exports error codes, source, path, default limit, disabled message', () => {
  assert.deepEqual(Object.values(PERSONALIZED_RECOMMENDATION_ERROR_CODES).sort(), [
    'RECOMMENDATION_PAYLOAD_INVALID',
    'RECOMMENDATION_REQUEST_FAILED',
  ]);
  assert.equal(PERSONALIZED_RECOMMENDATION_SOURCE, 'personalized-snapshot');
  assert.equal(PERSONALIZED_RECOMMENDATION_PATH, '/api/recommendations');
  assert.equal(DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT, 10);
  assert.equal(
    PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
    'Personalized recommendations are currently unavailable.',
  );
});

test('4: classify ready payload through UI re-export', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'ready',
      source: PERSONALIZED_RECOMMENDATION_SOURCE,
      items: [{
        rank: 1,
        song: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: 'A', artist: 'B' },
      }],
      snapshot: {
        snapshot_version: 'v1',
        generated_at: '2026-09-15T12:00:00.000Z',
        item_count: 1,
        available_count: 1,
        unavailable_count: 0,
      },
    },
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.songs.length, 1);
});

test('5: classify disabled via UI re-export', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: false,
    error: PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
  });
  assert.equal(result.state, 'disabled');
});

test('6: fallback helper matches service semantics for all seven states', () => {
  const expectations = {
    idle: false,
    loading: false,
    ready: false,
    'no-snapshot': true,
    empty: true,
    disabled: true,
    error: true,
  };
  for (const [state, expected] of Object.entries(expectations)) {
    assert.equal(shouldUseLegacyRecommendationFallback(state), expected, state);
  }
});

test('7: empty reason helper covers all seven states', () => {
  assert.equal(getPersonalizedRecommendationEmptyReason('idle'), 'none');
  assert.equal(getPersonalizedRecommendationEmptyReason('loading'), 'none');
  assert.equal(getPersonalizedRecommendationEmptyReason('ready'), 'none');
  assert.equal(getPersonalizedRecommendationEmptyReason('no-snapshot'), 'no-snapshot');
  assert.equal(getPersonalizedRecommendationEmptyReason('empty'), 'empty-snapshot');
  assert.equal(getPersonalizedRecommendationEmptyReason('disabled'), 'feature-disabled');
  assert.equal(getPersonalizedRecommendationEmptyReason('error'), 'request-error');
});

test('8: empty reason values are identifiers, not prose', () => {
  const reasons = Object.values(PERSONALIZED_RECOMMENDATION_EMPTY_REASONS);
  for (const reason of reasons) {
    assert.match(reason, /^[a-z]+(-[a-z]+)*$/);
    assert.equal(reason.includes(' '), false);
  }
});

test('9: static: recommendationUi only re-exports from recommendation service', () => {
  assert.equal(
    uiSrc.includes("from '../../services/personalizedRecommendations.js'"),
    true,
  );
  assert.equal(uiSrc.includes('export function'), false);
  assert.equal(uiSrc.includes('Math.random'), false);
  assert.equal(uiSrc.includes('setInterval'), false);
  assert.equal(uiSrc.toLowerCase().includes('trending'), false);
  assert.equal(uiSrc.includes('PlayerContext'), false);
  assert.equal(uiSrc.includes('playSong'), false);
});

test('10: static: Dashboard is unchanged and still owns Recommended Songs fallback section', () => {
  assert.equal(dashboardSrc.includes('Recommended Songs'), true);
  assert.equal(dashboardSrc.includes('Recommended For You'), false);
  assert.equal(dashboardSrc.includes('from \'./trendingUi.js\''), true);
  assert.equal(dashboardSrc.includes('recommendationUi'), false);
  assert.equal(dashboardSrc.includes('usePersonalizedRecommendations'), false);
  assert.equal(dashboardSrc.includes('/api/recommendations'), false);
});

test('11: static: service helper names stay aligned with UI exports', () => {
  assert.equal(
    serviceSrc.includes('export function shouldUseLegacyRecommendationFallback'),
    true,
  );
  assert.equal(
    serviceSrc.includes('export function getPersonalizedRecommendationEmptyReason'),
    true,
  );
  assert.equal(
    serviceSrc.includes('export function classifyPersonalizedRecommendationPayload'),
    true,
  );
});

test('12: static: no legacy fallback is implied as Trending or catalog scoring', () => {
  assert.equal(serviceSrc.includes('catalog-fallback'), false);
  assert.equal(serviceSrc.includes('activity'), false);
  assert.equal(uiSrc.includes('catalog-fallback'), false);
  assert.equal(getPersonalizedRecommendationEmptyReason('disabled'), 'feature-disabled');
});

test('13: static: fallback helper does not mention random, popularity, or exploration', () => {
  assert.equal(serviceSrc.includes('Math.random'), false);
  assert.equal(serviceSrc.includes('exploration'), false);
  assert.equal(serviceSrc.includes('popularity'), false);
  assert.equal(uiSrc.includes('exploration'), false);
});
