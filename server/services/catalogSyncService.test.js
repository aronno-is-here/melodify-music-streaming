import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createCatalogSyncService,
  CATALOG_SYNC_UPSTREAM_ERROR,
  CATALOG_SYNC_DISABLED_ERROR,
} from './catalogSyncService.js';

const API_KEY_MARKER = 'AIzaSyTEST_API_KEY_MARKER_12345';

const makeCandidate = (id, overrides = {}) => ({
  source_provider: 'youtube',
  external_id: id,
  youtube_id: id,
  title: `Title ${id}`,
  artist_candidate: `Artist ${id}`,
  catalog_eligible: true,
  ...overrides,
});

const createHarness = (behavior = {}) => {
  const state = {
    searchCalls: [],
    detailsCalls: [],
    upsertCalls: [],
    searchResponse: behavior.searchResponse,
    searchError: behavior.searchError ?? null,
    detailsError: behavior.detailsError ?? null,
    normalizeError: behavior.normalizeError ?? null,
    upsertResults: behavior.upsertResults ?? null,
    upsertError: behavior.upsertError ?? null,
    candidates: behavior.candidates ?? null,
  };

  const youtubeClient = {
    async searchMusicVideos(options) {
      state.searchCalls.push({ ...options });
      if (state.searchError) throw state.searchError;
      if (state.searchResponse === undefined) {
        return {
          items: [
            { id: { videoId: 'vidA' } },
            { id: { videoId: 'vidB' } },
            { id: { videoId: 'vidC' } },
          ],
        };
      }
      return state.searchResponse;
    },
    async getVideoDetails(videoIds) {
      state.detailsCalls.push([...videoIds]);
      if (state.detailsError) throw state.detailsError;
      return { items: videoIds.map((id) => ({ id })) };
    },
  };

  const normalizer = {
    normalizeYouTubeMusicCandidates(searchResponse, detailsResponse) {
      if (state.normalizeError) throw state.normalizeError;
      if (state.candidates !== null) return state.candidates;
      const ids = (detailsResponse.items || []).map((item) => item.id);
      return ids.map((id) => makeCandidate(id));
    },
  };

  let upsertIndex = 0;
  const catalogUpsertService = {
    async upsertYouTubeCandidate(candidate, context) {
      state.upsertCalls.push({ candidate: { ...candidate }, context: { ...context } });
      if (state.upsertError) throw state.upsertError;
      if (Array.isArray(state.upsertResults)) {
        const result = state.upsertResults[upsertIndex] ?? { status: 'skipped', reason: 'ineligible', song: null };
        upsertIndex += 1;
        return result;
      }
      return { status: 'inserted', reason: null, song: { _id: `song-${candidate.youtube_id}` } };
    },
  };

  const service = createCatalogSyncService({
    youtubeClient,
    normalizer,
    catalogUpsertService,
    catalogSyncEnabled: behavior.catalogSyncEnabled !== false,
  });

  return { state, service };
};

const defaultInput = () => ({ query: 'test song', maxResults: 5 });

test('1: one sync performs exactly one search', async () => {
  const { state, service } = createHarness();
  await service.syncCatalogSearch(defaultInput());
  assert.equal(state.searchCalls.length, 1);
});

test('2: one sync performs at most one details request', async () => {
  const { state, service } = createHarness();
  await service.syncCatalogSearch(defaultInput());
  assert.equal(state.detailsCalls.length, 1);
});

test('3: zero search results skips details request', async () => {
  const { state, service } = createHarness({ searchResponse: { items: [] } });
  const summary = await service.syncCatalogSearch(defaultInput());
  assert.equal(state.detailsCalls.length, 0);
  assert.equal(state.upsertCalls.length, 0);
  assert.equal(summary.searched, 0);
  assert.equal(summary.normalized, 0);
  assert.equal(summary.inserted, 0);
});

test('4: no pagination', async () => {
  const { state, service } = createHarness();
  await service.syncCatalogSearch(defaultInput());
  assert.equal(state.searchCalls.length, 1);
  assert.equal(state.searchCalls[0].pageToken, undefined);
  assert.equal(Object.hasOwn(state.searchCalls[0], 'pageToken'), false);
});

test('5: no retry', async () => {
  const { state, service } = createHarness({
    searchError: new Error(`YouTube catalog search failed key=${API_KEY_MARKER}`),
  });
  await assert.rejects(
    () => service.syncCatalogSearch(defaultInput()),
    (error) => error.code === 'CATALOG_SYNC_UPSTREAM',
  );
  assert.equal(state.searchCalls.length, 1);
  assert.equal(state.detailsCalls.length, 0);
});

test('6: maxResults forwarded correctly', async () => {
  const { state, service } = createHarness();
  await service.syncCatalogSearch({ query: 'test song', maxResults: 10 });
  assert.equal(state.searchCalls[0].maxResults, 10);
  await service.syncCatalogSearch({ query: 'test song', maxResults: 1 });
  assert.equal(state.searchCalls[1].maxResults, 1);
});

test('7: search-order IDs passed to details', async () => {
  const { state, service } = createHarness({
    searchResponse: {
      items: [
        { id: { videoId: 'vidZ' } },
        { id: { videoId: 'vidA' } },
        { id: { videoId: 'vidM' } },
      ],
    },
  });
  await service.syncCatalogSearch(defaultInput());
  assert.deepEqual(state.detailsCalls[0], ['vidZ', 'vidA', 'vidM']);
});

test('8: normalized candidates passed to upsert', async () => {
  const candidates = [makeCandidate('vidA'), makeCandidate('vidB')];
  const { state, service } = createHarness({ candidates });
  await service.syncCatalogSearch(defaultInput());
  assert.equal(state.upsertCalls.length, 2);
  assert.equal(state.upsertCalls[0].candidate.youtube_id, 'vidA');
  assert.equal(state.upsertCalls[1].candidate.youtube_id, 'vidB');
});

test('9: genre context forwarded explicitly', async () => {
  const { state, service } = createHarness();
  await service.syncCatalogSearch({ query: 'test song', maxResults: 5, genre: 'Pop' });
  for (const call of state.upsertCalls) {
    assert.equal(call.context.genre, 'Pop');
  }
});

test('10: language context forwarded explicitly', async () => {
  const { state, service } = createHarness();
  await service.syncCatalogSearch({ query: 'test song', maxResults: 5, language: 'bn' });
  for (const call of state.upsertCalls) {
    assert.equal(call.context.language, 'bn');
  }
});

test('11: omitted genre/language stay absent', async () => {
  const { state, service } = createHarness();
  await service.syncCatalogSearch(defaultInput());
  for (const call of state.upsertCalls) {
    assert.equal(Object.hasOwn(call.context, 'genre'), false);
    assert.equal(Object.hasOwn(call.context, 'language'), false);
  }
});

test('12: upserts occur at most maxResults times', async () => {
  const candidates = Array.from({ length: 15 }, (_, i) => makeCandidate(`vid${i}`));
  const { state, service } = createHarness({ candidates });
  await service.syncCatalogSearch({ query: 'test song', maxResults: 10 });
  assert.equal(state.upsertCalls.length, 10);

  const small = createHarness({ candidates });
  await small.service.syncCatalogSearch({ query: 'test song', maxResults: 3 });
  assert.equal(small.state.upsertCalls.length, 3);
});

test('13: processing is deterministic', async () => {
  const candidates = [makeCandidate('vidA'), makeCandidate('vidB')];
  const first = createHarness({ candidates: candidates.map((c) => ({ ...c })) });
  const second = createHarness({ candidates: candidates.map((c) => ({ ...c })) });
  const a = await first.service.syncCatalogSearch(defaultInput());
  const b = await second.service.syncCatalogSearch(defaultInput());
  assert.deepEqual(a, b);
});

test('14: inserted count correct', async () => {
  const { service } = createHarness({
    candidates: [makeCandidate('vidA'), makeCandidate('vidB')],
    upsertResults: [
      { status: 'inserted', reason: null, song: { _id: '1' } },
      { status: 'inserted', reason: null, song: { _id: '2' } },
    ],
  });
  const summary = await service.syncCatalogSearch(defaultInput());
  assert.equal(summary.inserted, 2);
  assert.equal(summary.updated, 0);
});

test('15: updated count correct', async () => {
  const { service } = createHarness({
    candidates: [makeCandidate('vidA')],
    upsertResults: [{ status: 'updated', reason: null, song: { _id: '1' } }],
  });
  const summary = await service.syncCatalogSearch(defaultInput());
  assert.equal(summary.updated, 1);
  assert.equal(summary.inserted, 0);
});

test('16: adopted-legacy count correct', async () => {
  const { service } = createHarness({
    candidates: [makeCandidate('vidA')],
    upsertResults: [{ status: 'adopted-legacy', reason: null, song: { _id: 'legacy' } }],
  });
  const summary = await service.syncCatalogSearch(defaultInput());
  assert.equal(summary.adoptedLegacy, 1);
});

test('17: skipped count correct', async () => {
  const { service } = createHarness({
    candidates: [makeCandidate('vidA'), makeCandidate('vidB')],
    upsertResults: [
      { status: 'skipped', reason: 'ineligible', song: null },
      { status: 'skipped', reason: 'missing-artist', song: null },
    ],
  });
  const summary = await service.syncCatalogSearch(defaultInput());
  assert.equal(summary.skipped, 2);
  assert.equal(summary.failed, 0);
});

test('18: conflict count correct', async () => {
  const { service } = createHarness({
    candidates: [makeCandidate('vidA')],
    upsertResults: [{ status: 'conflict', reason: 'ambiguous-legacy-match', song: null }],
  });
  const summary = await service.syncCatalogSearch(defaultInput());
  assert.equal(summary.conflicts, 1);
});

test('19: persistence-failed count correct', async () => {
  const { service } = createHarness({
    candidates: [makeCandidate('vidA'), makeCandidate('vidB')],
    upsertResults: [
      { status: 'skipped', reason: 'persistence-failed', song: null },
      { status: 'skipped', reason: 'persistence-failed', song: null },
    ],
  });
  const summary = await service.syncCatalogSearch(defaultInput());
  assert.equal(summary.failed, 2);
  assert.equal(summary.skipped, 0);
});

test('20: mixed outcomes produce correct summary', async () => {
  const { service } = createHarness({
    candidates: [
      makeCandidate('vidA'),
      makeCandidate('vidB'),
      makeCandidate('vidC'),
      makeCandidate('vidD'),
      makeCandidate('vidE'),
      makeCandidate('vidF'),
      makeCandidate('vidG'),
    ],
    upsertResults: [
      { status: 'inserted', reason: null, song: { _id: '1' } },
      { status: 'updated', reason: null, song: { _id: '2' } },
      { status: 'adopted-legacy', reason: null, song: { _id: '3' } },
      { status: 'skipped', reason: 'ineligible', song: null },
      { status: 'conflict', reason: 'ambiguous-legacy-match', song: null },
      { status: 'skipped', reason: 'persistence-failed', song: null },
      { status: 'skipped', reason: 'invalid-identity', song: null },
    ],
  });
  const summary = await service.syncCatalogSearch({ query: 'test song', maxResults: 10 });
  assert.equal(summary.inserted, 1);
  assert.equal(summary.updated, 1);
  assert.equal(summary.adoptedLegacy, 1);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.normalized, 7);
  assert.equal(summary.results.length, 7);
  assert.equal(summary.results[0].status, 'inserted');
  assert.equal(summary.results[3].reason, 'ineligible');
});

test('21: empty result produces stable summary', async () => {
  const { service } = createHarness({ searchResponse: { items: [] } });
  const summary = await service.syncCatalogSearch({ query: 'nothing here', maxResults: 5 });
  assert.deepEqual(summary, {
    query: 'nothing here',
    requested: 5,
    searched: 0,
    normalized: 0,
    inserted: 0,
    updated: 0,
    adoptedLegacy: 0,
    skipped: 0,
    conflicts: 0,
    failed: 0,
    results: [],
  });
});

test('22: upstream search failure is sanitized', async () => {
  const { service } = createHarness({
    searchError: new Error(`YouTube catalog search failed (HTTP 500) key=${API_KEY_MARKER} url=https://example.com/?key=${API_KEY_MARKER}`),
  });
  await assert.rejects(
    () => service.syncCatalogSearch(defaultInput()),
    (error) => {
      assert.equal(error.code, 'CATALOG_SYNC_UPSTREAM');
      assert.equal(error.message, CATALOG_SYNC_UPSTREAM_ERROR);
      return true;
    },
  );
});

test('23: details failure is sanitized', async () => {
  const { service } = createHarness({
    detailsError: new Error(`YouTube video metadata request failed key=${API_KEY_MARKER}`),
  });
  await assert.rejects(
    () => service.syncCatalogSearch(defaultInput()),
    (error) => {
      assert.equal(error.code, 'CATALOG_SYNC_UPSTREAM');
      assert.equal(error.message, CATALOG_SYNC_UPSTREAM_ERROR);
      return true;
    },
  );
});

test('24: malformed upstream normalization failure sanitized', async () => {
  const { service } = createHarness({
    normalizeError: new Error(`Invalid YouTube search response details=${API_KEY_MARKER}`),
  });
  await assert.rejects(
    () => service.syncCatalogSearch(defaultInput()),
    (error) => {
      assert.equal(error.code, 'CATALOG_SYNC_UPSTREAM');
      assert.equal(error.message, CATALOG_SYNC_UPSTREAM_ERROR);
      return true;
    },
  );

  const malformed = createHarness({ searchResponse: { notItems: true } });
  await assert.rejects(
    () => malformed.service.syncCatalogSearch(defaultInput()),
    (error) => error.code === 'CATALOG_SYNC_UPSTREAM',
  );
});

test('25: raw upstream error contents are not returned', async () => {
  const secrets = [
    `raw-body-${API_KEY_MARKER}`,
    'E11000 duplicate key error collection: melodify.songs',
    'at Object.<anonymous> (internal/stack.js:1:1)',
    'Authorization: Bearer secret-token',
  ];
  for (const secret of secrets) {
    const { service } = createHarness({ searchError: new Error(secret) });
    try {
      await service.syncCatalogSearch(defaultInput());
      assert.fail('expected throw');
    } catch (error) {
      assert.equal(error.message.includes(secret), false, secret);
      assert.equal(String(error.stack || '').includes(secret), false, secret);
      assert.equal(error.message, CATALOG_SYNC_UPSTREAM_ERROR);
    }
  }
});

test('26: API key-like marker not leaked', async () => {
  const { service } = createHarness({
    searchError: new Error(`failed url=https://www.googleapis.com/youtube/v3/search?key=${API_KEY_MARKER}`),
  });
  try {
    await service.syncCatalogSearch(defaultInput());
    assert.fail('expected throw');
  } catch (error) {
    assert.equal(error.message.includes(API_KEY_MARKER), false);
    assert.equal(error.message.includes('AIza'), false);
    assert.equal(error.message.includes('key='), false);
    assert.equal(error.message, CATALOG_SYNC_UPSTREAM_ERROR);
  }
});

test('27: input object not mutated', async () => {
  const { service } = createHarness();
  const input = { query: '  test song  ', genre: 'Pop', language: 'en', maxResults: 5 };
  const before = structuredClone(input);
  await service.syncCatalogSearch(input);
  assert.deepEqual(input, before);
});

test('feature disabled: zero search, details, and upsert calls', async () => {
  const { state, service } = createHarness({ catalogSyncEnabled: false });
  await assert.rejects(
    () => service.syncCatalogSearch(defaultInput()),
    (error) => {
      assert.equal(error.code, 'CATALOG_SYNC_DISABLED');
      assert.equal(error.message, CATALOG_SYNC_DISABLED_ERROR);
      return true;
    },
  );
  assert.equal(state.searchCalls.length, 0);
  assert.equal(state.detailsCalls.length, 0);
  assert.equal(state.upsertCalls.length, 0);
});

test('one skipped/conflict result does not abort the batch', async () => {
  const { state, service } = createHarness({
    candidates: [makeCandidate('vidA'), makeCandidate('vidB'), makeCandidate('vidC')],
    upsertResults: [
      { status: 'skipped', reason: 'ineligible', song: null },
      { status: 'conflict', reason: 'ambiguous-legacy-match', song: null },
      { status: 'inserted', reason: null, song: { _id: 'late' } },
    ],
  });
  const summary = await service.syncCatalogSearch({ query: 'test song', maxResults: 5 });
  assert.equal(state.upsertCalls.length, 3);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.inserted, 1);
});

test('per-item results are bounded and safe', async () => {
  const candidates = Array.from({ length: 12 }, (_, i) => makeCandidate(`vid${String(i).padStart(2, '0')}`));
  const { service } = createHarness({ candidates });
  const summary = await service.syncCatalogSearch({ query: 'test song', maxResults: 10 });
  assert.equal(summary.results.length, 10);
  for (const item of summary.results) {
    assert.deepEqual(Object.keys(item).sort(), ['reason', 'songId', 'status', 'videoId']);
    assert.equal(typeof item.videoId, 'string');
    assert.equal(typeof item.status, 'string');
    assert.equal(typeof item.songId, 'string');
  }
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(API_KEY_MARKER), false);
  assert.equal(serialized.includes('stack'), false);
});

test('route security: catalog-sync is registered after protect and adminOnly', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../routes/adminRoutes.js', import.meta.url)),
    'utf8',
  );
  const middlewareIndex = source.indexOf('router.use(protect, adminOnly)');
  const routeIndex = source.indexOf("router.post('/catalog-sync'");
  assert.notEqual(middlewareIndex, -1);
  assert.notEqual(routeIndex, -1);
  assert.ok(middlewareIndex < routeIndex, 'router.use(protect, adminOnly) must appear before catalog-sync');
  assert.ok(source.includes('recommendationConfig.catalogSyncEnabled'));
  assert.ok(source.includes('parseCatalogSyncRequest'));
});

test('factory validates injected dependencies', () => {
  assert.throws(() => createCatalogSyncService({}), /YouTube client/);
  assert.throws(
    () => createCatalogSyncService({ youtubeClient: { searchMusicVideos() {}, getVideoDetails() {} } }),
    /upsert service/,
  );
  assert.throws(
    () => createCatalogSyncService({
      youtubeClient: { searchMusicVideos() {}, getVideoDetails() {} },
      normalizer: { normalizeYouTubeMusicCandidates() {} },
      catalogUpsertService: {},
    }),
    /upsert service/,
  );
});
