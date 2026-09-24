import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_RECOMMENDATION_MODES,
  selectDashboardRecommendationPresentation,
} from './recommendationUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(join(__dirname, 'Dashboard.jsx'), 'utf8');
const uiSrc = readFileSync(join(__dirname, 'recommendationUi.js'), 'utf8');
const hookSrc = readFileSync(
  join(__dirname, '..', '..', 'hooks', 'usePersonalizedRecommendations.js'),
  'utf8',
);
const serviceSrc = readFileSync(
  join(__dirname, '..', '..', 'services', 'personalizedRecommendations.js'),
  'utf8',
);

const personal = [{ _id: 'p1' }, { _id: 'p2' }];
const legacy = [{ _id: 'l1' }, { _id: 'l2' }, { _id: 'l3' }];

test('1: Dashboard imports usePersonalizedRecommendations hook', () => {
  assert.equal(
    dashboardSrc.includes("from '../../hooks/usePersonalizedRecommendations.js'"),
    true,
  );
  assert.equal(dashboardSrc.includes('usePersonalizedRecommendations('), true);
});

test('2: Dashboard does not import the raw personalized fetcher', () => {
  assert.equal(dashboardSrc.includes('fetchPersonalizedRecommendations'), false);
  assert.equal(dashboardSrc.includes('classifyPersonalizedRecommendationPayload'), false);
});

test('3: Dashboard contains no direct /api/recommendations request', () => {
  assert.equal(dashboardSrc.includes('/api/recommendations'), false);
  assert.equal(dashboardSrc.includes('api.get("/api/recommendations'), false);
  assert.equal(dashboardSrc.includes("api.get('/api/recommendations"), false);
  assert.equal(dashboardSrc.includes('fetch("/api/recommendations'), false);
  assert.equal(dashboardSrc.includes("fetch('/api/recommendations"), false);
});

test('4: hook is configured with bounded limit 10', () => {
  assert.equal(dashboardSrc.includes('PERSONALIZED_RECOMMENDATION_LIMIT = 10'), true);
  assert.equal(
    dashboardSrc.includes('limit: PERSONALIZED_RECOMMENDATION_LIMIT'),
    true,
  );
});

test('5: Dashboard uses the presentation selector helper', () => {
  assert.equal(dashboardSrc.includes('selectDashboardRecommendationPresentation'), true);
  assert.equal(
    dashboardSrc.includes("from './recommendationUi.js'"),
    true,
  );
});

test('6: visible section title is Recommended For You', () => {
  assert.equal(dashboardSrc.includes('<h2>Recommended For You</h2>'), true);
});

test('7: old Recommended Songs title is removed from Dashboard', () => {
  assert.equal(dashboardSrc.includes('Recommended Songs'), false);
});

test('8: principal content row order is Recently Played, Trending Now, Recommended For You', () => {
  const recently = dashboardSrc.indexOf('Recently Played');
  const trending = dashboardSrc.indexOf('Trending Now');
  const recommended = dashboardSrc.indexOf('Recommended For You');
  assert.ok(recently >= 0, 'Recently Played present');
  assert.ok(trending >= 0, 'Trending Now present');
  assert.ok(recommended >= 0, 'Recommended For You present');
  assert.ok(recently < trending, 'Recently Played before Trending Now');
  assert.ok(trending < recommended, 'Trending Now before Recommended For You');
});

test('9: search controls remain between Trending Now and Recommended For You', () => {
  const trending = dashboardSrc.indexOf('Trending Now');
  const searchContainer = dashboardSrc.indexOf('search-container');
  const recommended = dashboardSrc.indexOf('Recommended For You');
  assert.ok(trending < searchContainer, 'search after Trending');
  assert.ok(searchContainer < recommended, 'search before Recommended For You');
});

test('10: personalized mode renders hook songs via presentation helper', () => {
  assert.equal(dashboardSrc.includes('personalizedSongs: personalizedRecommendations.songs'), true);
  assert.equal(dashboardSrc.includes('recommendationPresentation.songs.map'), true);
});

test('11: fallback uses existing legacy filteredSongs source', () => {
  assert.equal(dashboardSrc.includes('const legacyRecommendedSongs = filteredSongs;'), true);
  assert.equal(dashboardSrc.includes('legacySongs: legacyRecommendedSongs'), true);
});

test('12: loading/idle render a status placeholder instead of legacy cards', () => {
  assert.equal(
    dashboardSrc.includes(
      'recommendationPresentation.mode === DASHBOARD_RECOMMENDATION_MODES.LOADING',
    ),
    true,
  );
  assert.equal(dashboardSrc.includes('DASHBOARD_RECOMMENDATION_LOADING_MESSAGE'), true);
  assert.equal(dashboardSrc.includes('role="status"'), true);
});

test('13: click handler calls player.playSong with displayed list and index', () => {
  assert.equal(dashboardSrc.includes('player.playSong(displayedSongs, index)'), true);
  assert.equal(dashboardSrc.includes('const displayedSongs = recommendationPresentation.songs;'), true);
  assert.equal(dashboardSrc.includes('playRecommendation(index)'), true);
});

test('14: recommendation section does not use handleSongClick default filteredSongs queue', () => {
  const sectionStart = dashboardSrc.indexOf('Recommended For You');
  const sectionEnd = dashboardSrc.indexOf('</div>', dashboardSrc.indexOf('songs-grid', sectionStart));
  const section = dashboardSrc.slice(sectionStart, Math.max(sectionEnd, sectionStart + 800));
  assert.equal(section.includes('handleSongClick'), false);
});

test('15: no manual PlayHistory write in Dashboard recommendation integration', () => {
  assert.equal(dashboardSrc.includes('api.post(\'/api/history\''), false);
  assert.equal(dashboardSrc.includes('api.post("/api/history"'), false);
});

test('16: no ListeningEvent or telemetry write added', () => {
  assert.equal(dashboardSrc.includes('/api/listening-events'), false);
  assert.equal(dashboardSrc.includes('ListeningEvent'), false);
  assert.equal(dashboardSrc.includes('listeningTelemetry'), false);
});

test('17: no local recommendation sort, random, or score math', () => {
  assert.equal(dashboardSrc.includes('Math.random'), false);
  assert.equal(dashboardSrc.includes('.sort('), false);
  assert.equal(dashboardSrc.includes('policy_score'), false);
  assert.equal(dashboardSrc.includes('hybrid_score'), false);
  assert.equal(dashboardSrc.includes('profile_score'), false);
  assert.equal(dashboardSrc.includes('cosine'), false);
  assert.equal(dashboardSrc.includes('svd'), false);
  assert.equal(dashboardSrc.includes('SVD'), false);
});

test('18: no snapshot metadata or internal diagnostics rendered', () => {
  for (const token of [
    'snapshot_version',
    'generated_at',
    'item_count',
    'available_count',
    'unavailable_count',
    'collaborative_known',
    'payload_sha256',
    'artifact_version',
    'policy_score',
    'hybrid_score',
    'profile_score',
  ]) {
    assert.equal(dashboardSrc.includes(token), false, token);
  }
});

test('19: no AI badge or false provenance copy', () => {
  assert.equal(dashboardSrc.includes('AI-generated'), false);
  assert.equal(dashboardSrc.includes('cold-start AI'), false);
  assert.equal(dashboardSrc.includes('personalized snapshot'), false);
  assert.equal(dashboardSrc.includes('AI Picks'), false);
});

test('20: no polling, auto-retry, or second recommendation fetch pattern', () => {
  assert.equal(dashboardSrc.includes('setInterval'), false);
  const recommendationUseEffectCount = (dashboardSrc.match(/api\.get\([^)]*recommendation/gi) || []).length;
  assert.equal(recommendationUseEffectCount, 0);
  assert.equal(dashboardSrc.includes('refresh()'), false);
});

test('21: no popularity, random, or catalog fallback request for recommendations', () => {
  assert.equal(dashboardSrc.includes('/api/popular'), false);
  assert.equal(dashboardSrc.includes('randomFallback'), false);
  assert.equal(dashboardSrc.includes('popularityFallback'), false);
  assert.equal(dashboardSrc.includes('trendingFallback'), false);
});

test('22: no Trending coupling in recommendation presentation path', () => {
  assert.equal(uiSrc.toLowerCase().includes('trending'), false);
  assert.equal(
    dashboardSrc.includes('trendingSongs') && dashboardSrc.includes('recommendationPresentation'),
    true,
  );
  const playRecommendationStart = dashboardSrc.indexOf('const playRecommendation');
  const playRecommendationEnd = dashboardSrc.indexOf('};', playRecommendationStart);
  const playRecommendationSrc = dashboardSrc.slice(playRecommendationStart, playRecommendationEnd);
  assert.equal(playRecommendationSrc.includes('trending'), false);
  assert.equal(playRecommendationSrc.includes('filteredSongs'), false);
});

test('23: Recently Played and Trending Now logic remain present', () => {
  assert.equal(dashboardSrc.includes('Recently Played'), true);
  assert.equal(dashboardSrc.includes('Trending Now'), true);
  assert.equal(dashboardSrc.includes('fetchHistory'), true);
  assert.equal(dashboardSrc.includes('loadTrending'), true);
  assert.equal(dashboardSrc.includes("from './trendingUi.js'"), true);
  assert.equal(dashboardSrc.includes('playTrendingSong'), true);
  assert.equal(dashboardSrc.includes('playFromHistory'), true);
});

test('24: search logic remains present and separate', () => {
  assert.equal(dashboardSrc.includes('placeholder="Search by songs or artists"'), true);
  assert.equal(dashboardSrc.includes('setSearch'), true);
  assert.equal(dashboardSrc.includes('filteredSongs'), true);
  assert.equal(dashboardSrc.includes('searchActive'), true);
});

test('25: no auth, server contract, or dependency mutation in Dashboard integration', () => {
  assert.equal(dashboardSrc.includes('jwt'), false);
  assert.equal(dashboardSrc.includes('JWT'), false);
  assert.equal(dashboardSrc.includes('melodify_token'), false);
  assert.equal(dashboardSrc.includes('require('), false);
  assert.equal(dashboardSrc.includes('@testing-library'), false);
});

test('26: presentation helper still fails closed on unknown state from integration import', () => {
  assert.throws(() => selectDashboardRecommendationPresentation({ state: 'mystery' }));
  assert.deepEqual(Object.values(DASHBOARD_RECOMMENDATION_MODES).sort(), [
    'legacy',
    'loading',
    'personalized',
  ]);
});

test('27: state integration — ready selects personalized only', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: personal,
    legacySongs: legacy,
  });
  assert.equal(result.mode, 'personalized');
  assert.deepEqual(result.songs.map((s) => s._id), ['p1', 'p2']);
});

test('28: state integration — fallback states select legacy only', () => {
  for (const state of ['no-snapshot', 'empty', 'disabled', 'error']) {
    const result = selectDashboardRecommendationPresentation({
      state,
      personalizedSongs: personal,
      legacySongs: legacy,
    });
    assert.equal(result.mode, 'legacy', state);
    assert.deepEqual(result.songs.map((s) => s._id), ['l1', 'l2', 'l3'], state);
  }
});

test('29: state integration — loading and idle select zero recommendation cards', () => {
  for (const state of ['loading', 'idle']) {
    const result = selectDashboardRecommendationPresentation({
      state,
      personalizedSongs: personal,
      legacySongs: legacy,
    });
    assert.equal(result.mode, 'loading', state);
    assert.equal(result.songs.length, 0, state);
  }
});

test('30: player list — visible presentation songs are the playback queue', () => {
  const personalized = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: personal,
    legacySongs: legacy,
  });
  assert.deepEqual(personalized.songs, personal);

  const fallback = selectDashboardRecommendationPresentation({
    state: 'error',
    personalizedSongs: personal,
    legacySongs: legacy,
  });
  assert.deepEqual(fallback.songs, legacy);

  const loading = selectDashboardRecommendationPresentation({
    state: 'loading',
    personalizedSongs: personal,
    legacySongs: legacy,
  });
  assert.deepEqual(loading.songs, []);
});

test('31: no hidden songs injected — ready queue length equals personalized length', () => {
  const result = selectDashboardRecommendationPresentation({
    state: 'ready',
    personalizedSongs: personal,
    legacySongs: legacy,
  });
  assert.equal(result.songs.length, personal.length);
  assert.equal(result.songs.includes(legacy[0]), false);
});

test('32: no client AI or scoring tokens in recommendation helper + Dashboard integration', () => {
  for (const src of [dashboardSrc, uiSrc, hookSrc, serviceSrc]) {
    assert.equal(src.includes('Math.random'), false);
    assert.equal(src.includes('TruncatedSVD'), false);
    assert.equal(src.includes('exploration'), false);
    assert.equal(src.includes('COLLABORATIVE_WEIGHT'), false);
    assert.equal(src.includes('BASE_HYBRID_POLICY_WEIGHT'), false);
  }
  assert.equal(hookSrc.includes('setInterval'), false);
  assert.equal(hookSrc.includes('setTimeout'), false);
  assert.equal(serviceSrc.includes('.sort('), false);
});

test('33: no duplicated telemetry/history surface in changed recommendation path', () => {
  assert.equal(dashboardSrc.includes('createListeningTelemetryController'), false);
  assert.equal(hookSrc.includes('PlayHistory'), false);
  assert.equal(hookSrc.includes('recordHistory'), false);
  assert.equal(uiSrc.includes('PlayHistory'), false);
});

test('34: search override preserves catalog search without mixing into selector personalized mode', () => {
  assert.equal(dashboardSrc.includes('const searchActive = Boolean(search.trim());'), true);
  assert.equal(dashboardSrc.includes('songs: legacyRecommendedSongs'), true);
  const searchActiveAt = dashboardSrc.indexOf('const searchActive');
  const selectorAt = dashboardSrc.indexOf('selectDashboardRecommendationPresentation({');
  assert.ok(searchActiveAt >= 0, 'searchActive defined');
  assert.ok(selectorAt >= 0, 'selector invoked');
  assert.ok(searchActiveAt < selectorAt, 'searchActive defined before selector use');
});
