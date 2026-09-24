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
  DASHBOARD_RECOMMENDATION_MODES,
  DASHBOARD_RECOMMENDATION_LOADING_MESSAGE,
  selectDashboardRecommendationPresentation,
} from './recommendationUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiSrc = readFileSync(join(__dirname, 'recommendationUi.js'), 'utf8');
const serviceSrc = readFileSync(
  join(__dirname, '..', '..', 'services', 'personalizedRecommendations.js'),
  'utf8',
);

const song = (id, title = id) => ({ _id: id, title, artist: 'Artist' });
const PERSONALIZED = [song('p1'), song('p2'), song('p3')];
const LEGACY = [song('l1'), song('l2')];

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

test('9: presentation mode vocabulary is exactly loading, personalized, legacy', () => {
  assert.deepEqual(Object.values(DASHBOARD_RECOMMENDATION_MODES).sort(), [
    'legacy',
    'loading',
    'personalized',
  ]);
  assert.equal(DASHBOARD_RECOMMENDATION_LOADING_MESSAGE, 'Loading...');
});

test('10: idle maps to loading presentation with no playable songs', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'idle',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.mode, 'loading');
  assert.deepEqual(result.songs, []);
  assert.equal(result.isFallback, false);
  assert.equal(result.state, 'idle');
});

test('11: loading maps to loading presentation with no playable songs', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'loading',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.mode, 'loading');
  assert.deepEqual(result.songs, []);
  assert.equal(result.isFallback, false);
});

test('12: ready maps to personalized and returns personalized songs unchanged', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.mode, 'personalized');
  assert.equal(result.songs, PERSONALIZED);
  assert.equal(result.isFallback, false);
});

test('13: no-snapshot maps to legacy with legacy songs', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'no-snapshot',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.mode, 'legacy');
  assert.equal(result.songs, LEGACY);
  assert.equal(result.isFallback, true);
});

test('14: empty maps to legacy with legacy songs', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'empty',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.mode, 'legacy');
  assert.equal(result.songs, LEGACY);
  assert.equal(result.isFallback, true);
});

test('15: disabled maps to legacy with legacy songs', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'disabled',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.mode, 'legacy');
  assert.equal(result.songs, LEGACY);
});

test('16: error maps to legacy with legacy songs', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'error',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.mode, 'legacy');
  assert.equal(result.songs, LEGACY);
});

test('17: unknown state fails closed with a thrown validation error', () => {
  for (const state of ['stale', 'READY', '', null, undefined, 42, {}]) {
    assert.throws(
      () => selectDashboardRecommendationPresentation({
        state,
        personalizedSongs: PERSONALIZED,
        legacySongs: LEGACY,
      }),
      /invalid recommendation state/,
      String(state),
    );
  }
});

test('18: ready does not append, interleave, or copy legacy songs', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.songs.length, PERSONALIZED.length);
  assert.equal(result.songs.some((s) => String(s._id).startsWith('l')), false);
  assert.notEqual(result.songs, LEGACY);
});

test('19: fallback does not append personalized songs', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'no-snapshot',
    personalizedSongs: PERSONALIZED,
    legacySongs: LEGACY,
  });
  assert.equal(result.songs.length, LEGACY.length);
  assert.equal(result.songs.some((s) => String(s._id).startsWith('p')), false);
});

test('20: helper does not mutate, sort, or reverse source arrays', () => {
  const personalized = [song('p3'), song('p1'), song('p2')];
  const legacy = [song('l2'), song('l1')];
  const personalizedCopy = [...personalized];
  const legacyCopy = [...legacy];

  const ready = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.deepEqual(ready.songs.map((s) => s._id), ['p3', 'p1', 'p2']);

  const fallback = selectDashboardRecommendationPresentation({
    state: 'error',
    personalizedSongs: personalized,
    legacySongs: legacy,
  });
  assert.deepEqual(fallback.songs.map((s) => s._id), ['l2', 'l1']);

  assert.deepEqual(personalized, personalizedCopy);
  assert.deepEqual(legacy, legacyCopy);
  assert.equal(personalized.includes, personalized.includes);
});

test('21: personalized order is authoritative with no local rerank', () => {
  const ordered = [song('z'), song('a'), song('m')];
  const result = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: ordered,
    legacySongs: LEGACY,
  });
  assert.deepEqual(result.songs.map((s) => s._id), ['z', 'a', 'm']);
  assert.equal(uiSrc.includes('.sort('), false);
  assert.equal(uiSrc.includes('.reverse('), false);
  assert.equal(uiSrc.includes('.splice('), false);
});

test('22: legacy order is preserved for fallback modes', () => {
  const orderedLegacy = [song('zz'), song('aa')];
  for (const state of ['no-snapshot', 'empty', 'disabled', 'error']) {
    const result = selectDashboardRecommendationPresentation({
      state,
      personalizedSongs: PERSONALIZED,
      legacySongs: orderedLegacy,
    });
    assert.deepEqual(result.songs.map((s) => s._id), ['zz', 'aa'], state);
  }
});

test('23: non-array song inputs fail closed to empty arrays', () => {
  const ready = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: null,
    legacySongs: LEGACY,
  });
  assert.deepEqual(ready.songs, []);

  const legacy = selectDashboardRecommendationPresentation({
    state: 'disabled',
    personalizedSongs: PERSONALIZED,
    legacySongs: undefined,
  });
  assert.deepEqual(legacy.songs, []);
});

test('24: helper does not fetch data or call player side effects', () => {
  assert.equal(uiSrc.includes('fetch('), false);
  assert.equal(uiSrc.includes('api.get'), false);
  assert.equal(uiSrc.includes('playSong'), false);
  assert.equal(uiSrc.includes('PlayerContext'), false);
  assert.equal(uiSrc.includes('/api/recommendations'), false);
  assert.equal(uiSrc.includes('setInterval'), false);
  assert.equal(uiSrc.includes('Math.random'), false);
});

test('25: static: recommendationUi re-exports service helpers and defines presentation selector', () => {
  assert.equal(
    uiSrc.includes("from '../../services/personalizedRecommendations.js'"),
    true,
  );
  assert.equal(
    uiSrc.includes('export function selectDashboardRecommendationPresentation'),
    true,
  );
  assert.equal(uiSrc.toLowerCase().includes('trending'), false);
  assert.equal(serviceSrc.includes('export function shouldUseLegacyRecommendationFallback'), true);
  assert.equal(serviceSrc.includes('export function getPersonalizedRecommendationEmptyReason'), true);
  assert.equal(serviceSrc.includes('export function classifyPersonalizedRecommendationPayload'), true);
});
