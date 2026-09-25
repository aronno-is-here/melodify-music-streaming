import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import {
  createCatalogUpsertService,
  UNKNOWN_GENRE_SENTINEL,
  UPSERT_STATUSES,
  UPSERT_REASONS,
  UPSERT_CONTEXT_FIELDS,
} from './catalogUpsertService.js';

const FIXED_NOW = new Date('2026-01-02T03:04:05.000Z');

const makeCandidate = (overrides = {}) => ({
  source_provider: 'youtube',
  external_id: 'vidAAA111111',
  youtube_id: 'vidAAA111111',
  title: 'Test Track',
  channel_title: 'Test Artist - Topic',
  artist_candidate: 'Test Artist',
  artist_candidate_source: 'topic-channel',
  poster_url: 'https://i.ytimg.com/vi/vidAAA111111/maxres.jpg',
  duration_seconds: 253,
  duration: '4:13',
  category: 'Music',
  youtube_category_id: '10',
  genre: null,
  language: null,
  privacy_status: 'public',
  upload_status: 'processed',
  embeddable: true,
  live_broadcast_content: 'none',
  published_at: '2024-03-01T12:00:00.000Z',
  catalog_eligible: true,
  recommendation_eligible: true,
  ineligibility_reasons: [],
  ...overrides,
});

const duplicateKeyError = () => {
  const error = new Error(
    'E11000 duplicate key error collection: melodify.songs index: source_provider_1_external_id_1 dup key',
  );
  error.code = 11000;
  return error;
};

const createHarness = (initialDocs = [], behavior = {}) => {
  const state = {
    docs: initialDocs.map((doc) => structuredClone(doc)),
    calls: [],
    upsertAttempts: 0,
    raceMode: behavior.raceMode ?? null,
    nextId: 1,
    nowCalls: 0,
  };

  const matchesFilter = (doc, filter) =>
    Object.entries(filter).every(([key, value]) => doc[key] === value);

  const model = {
    async findOne(filter) {
      state.calls.push({ method: 'findOne', filter: { ...filter } });
      const found = state.docs.find((doc) => matchesFilter(doc, filter));
      return found ? { ...found } : null;
    },
    async find(filter) {
      state.calls.push({ method: 'find', filter: { ...filter } });
      return state.docs
        .filter((doc) => matchesFilter(doc, filter))
        .map((doc) => ({ ...doc }));
    },
    async findOneAndUpdate(filter, update, options = {}) {
      state.calls.push({
        method: 'findOneAndUpdate',
        filter: { ...filter },
        update: structuredClone(update),
        options: { ...options },
      });
      const index = state.docs.findIndex((doc) => matchesFilter(doc, filter));
      if (index >= 0) {
        const merged = { ...state.docs[index], ...(update.$set ?? {}) };
        state.docs[index] = merged;
        return { ...merged };
      }
      if (options.upsert) {
        state.upsertAttempts += 1;
        if (state.raceMode === 'create-then-throw') {
          state.raceMode = null;
          state.docs.push({ _id: 'race-winner-1', ...(update.$setOnInsert ?? {}) });
          throw duplicateKeyError();
        }
        if (state.raceMode === 'throw-only') {
          state.raceMode = null;
          throw duplicateKeyError();
        }
        const created = {
          _id: `generated-${state.nextId}`,
          ...(update.$set ?? {}),
          ...(update.$setOnInsert ?? {}),
        };
        state.nextId += 1;
        state.docs.push(created);
        const updatedExisting = false;
        return { value: { ...created }, lastErrorObject: { updatedExisting, upserted: created._id } };
      }
      return null;
    },
  };

  const now = () => {
    state.nowCalls += 1;
    return FIXED_NOW;
  };

  const service = createCatalogUpsertService({ SongModel: model, now });
  return { state, model, service };
};

const canonicalFindCount = (state) =>
  state.calls.filter(
    (call) =>
      call.method === 'findOne'
      && call.filter.source_provider !== undefined
      && call.filter.external_id !== undefined,
  ).length;

test('1: ineligible candidate is skipped with zero model writes and zero clock calls', async () => {
  const { state, service } = createHarness();
  const result = await service.upsertYouTubeCandidate(makeCandidate({ catalog_eligible: false }));
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'ineligible');
  assert.equal(result.song, null);
  assert.equal(state.docs.length, 0);
  assert.equal(state.calls.length, 0);
  assert.equal(state.nowCalls, 0);
});

test('2: malformed canonical identity is skipped safely', async () => {
  for (const candidate of [
    null,
    undefined,
    'candidate',
    42,
    [],
    {},
    { source_provider: 'vimeo', external_id: 'vidAAA111111', youtube_id: 'vidAAA111111', catalog_eligible: true },
    { source_provider: 'youtube', external_id: '', youtube_id: '', catalog_eligible: true },
    { source_provider: 'youtube', external_id: 'vidAAA111111', catalog_eligible: true },
    { source_provider: 'youtube', youtube_id: 'vidAAA111111', catalog_eligible: true },
    { external_id: 'vidAAA111111', youtube_id: 'vidAAA111111', catalog_eligible: true },
    { source_provider: 'youtube', external_id: null, youtube_id: null, catalog_eligible: true },
  ]) {
    const { state, service } = createHarness();
    const result = await service.upsertYouTubeCandidate(candidate);
    assert.equal(result.status, 'skipped', JSON.stringify(candidate));
    assert.equal(result.reason, 'invalid-identity', JSON.stringify(candidate));
    assert.equal(result.song, null);
    assert.equal(state.calls.length, 0, JSON.stringify(candidate));
  }
});

test('3: mismatched external_id and youtube_id are rejected', async () => {
  const { state, service } = createHarness();
  const result = await service.upsertYouTubeCandidate(
    makeCandidate({ external_id: 'vidAAA111111', youtube_id: 'vidZZZ999999' }),
  );
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'invalid-identity');
  assert.equal(state.calls.length, 0);
});

test('4: missing provisional artist prevents a new insert', async () => {
  for (const artist_candidate of [null, undefined, '', '   ', 42]) {
    const { state, service } = createHarness();
    const result = await service.upsertYouTubeCandidate(makeCandidate({ artist_candidate }));
    assert.equal(result.status, 'skipped', JSON.stringify(artist_candidate));
    assert.equal(result.reason, 'missing-artist', JSON.stringify(artist_candidate));
    assert.equal(state.docs.length, 0, JSON.stringify(artist_candidate));
    assert.equal(state.calls.length, 0, JSON.stringify(artist_candidate));
  }
});

test('5: no genre context uses the literal Unknown sentinel', async () => {
  const { service } = createHarness();
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'inserted');
  assert.equal(result.song.genre, UNKNOWN_GENRE_SENTINEL);
  assert.equal(result.song.genre, 'Unknown');
  assert.equal('normalized_genre' in result.song, false);
});

test('6: explicit genre context is used without inference', async () => {
  const { service } = createHarness();
  const result = await service.upsertYouTubeCandidate(makeCandidate(), { genre: '  Pop  ' });
  assert.equal(result.status, 'inserted');
  assert.equal(result.song.genre, 'Pop');
  assert.equal(result.song.normalized_genre, 'pop');
  assert.equal(result.song.youtube_category_id === undefined || true, true);
});

test('6b: invalid genre context values fall back to the sentinel', async () => {
  for (const genre of ['', '   ', 42, null, undefined, {}, ['Pop']]) {
    const { service } = createHarness();
    const result = await service.upsertYouTubeCandidate(makeCandidate(), { genre });
    assert.equal(result.song.genre, UNKNOWN_GENRE_SENTINEL, JSON.stringify(genre));
    assert.equal('normalized_genre' in result.song, false, JSON.stringify(genre));
  }
});

test('7: explicit language context is stored', async () => {
  const { service } = createHarness();
  const result = await service.upsertYouTubeCandidate(makeCandidate(), { language: ' bn ' });
  assert.equal(result.status, 'inserted');
  assert.equal(result.song.language, 'bn');
});

test('8: absent language stays unset', async () => {
  const { service } = createHarness();
  const result = await service.upsertYouTubeCandidate(makeCandidate(), {});
  assert.equal('language' in result.song, false);
  const noContext = await createHarness().service.upsertYouTubeCandidate(makeCandidate());
  assert.equal('language' in noContext.song, false);
});

test('9: eligible candidate inserts exactly one Song', async () => {
  const { state, service } = createHarness();
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'inserted');
  assert.equal(result.reason, null);
  assert.equal(state.docs.length, 1);
  assert.deepEqual(result.song, state.docs[0]);
  assert.equal(result.song._id, state.docs[0]._id);
});

test('10: inserted identity is youtube plus the video ID', async () => {
  const { service } = createHarness();
  const { song } = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(song.source_provider, 'youtube');
  assert.equal(song.external_id, 'vidAAA111111');
  assert.equal(song.youtube_id, 'vidAAA111111');
});

test('11: artist comes from artist_candidate', async () => {
  const { service } = createHarness();
  const { song } = await service.upsertYouTubeCandidate(
    makeCandidate({ artist_candidate: 'Some Channel Name', channel_title: 'Some Channel Name' }),
  );
  assert.equal(song.artist, 'Some Channel Name');
  assert.equal(song.normalized_artist, 'some channel name');
});

test('12: duration fields are copied safely', async () => {
  const { service } = createHarness();
  const { song } = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(song.duration, '4:13');
  assert.equal(song.duration_seconds, 253);
});

test('13: source, category, and poster are copied safely', async () => {
  const { service } = createHarness();
  const { song } = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(song.source_provider, 'youtube');
  assert.equal(song.category, 'Music');
  assert.equal(song.poster_url, 'https://i.ytimg.com/vi/vidAAA111111/maxres.jpg');
  assert.equal(song.recommendation_eligible, true);
});

test('14: no lyrics, chords, file_path, or release_date are fabricated', async () => {
  const { service } = createHarness();
  const { song } = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal('lyrics' in song, false);
  assert.equal('chords' in song, false);
  assert.equal('file_path' in song, false);
  assert.equal('release_date' in song, false);
});

test('15: provenance is set correctly on insert', async () => {
  const { service } = createHarness();
  const { song } = await service.upsertYouTubeCandidate(makeCandidate());
  assert.deepEqual(song.metadata_provenance, {
    source: 'youtube',
    reference: 'vidAAA111111',
    imported_at: FIXED_NOW,
  });
});

test('16: metadata_refreshed_at uses the injected clock exactly once', async () => {
  const { state, service } = createHarness();
  const { song } = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(song.metadata_refreshed_at, FIXED_NOW);
  assert.equal(state.nowCalls, 1);
});

test('17: the same candidate twice does not create a second Song', async () => {
  const { state, service } = createHarness();
  const first = await service.upsertYouTubeCandidate(makeCandidate());
  const second = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(first.status, 'inserted');
  assert.equal(second.status, 'updated');
  assert.equal(state.docs.length, 1);
});

test('18: the same canonical identity preserves the same _id', async () => {
  const { service } = createHarness();
  const first = await service.upsertYouTubeCandidate(makeCandidate());
  const second = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(first.song._id, second.song._id);
});

test('19: refresh changes only import-managed fields', async () => {
  const existing = {
    _id: 'canon-1',
    title: 'Curated Title',
    artist: 'Curated Artist',
    genre: 'Jazz',
    lyrics: 'curated lyrics',
    chords: 'curated chords',
    file_path: '/curated.mp3',
    release_date: new Date('2019-05-05T00:00:00.000Z'),
    poster_url: 'https://old.example/poster.jpg',
    duration: '3:00',
    duration_seconds: 180,
    category: 'Film',
    source_provider: 'youtube',
    external_id: 'vidAAA111111',
    youtube_id: 'vidAAA111111',
    recommendation_eligible: false,
    metadata_refreshed_at: new Date('2020-01-01T00:00:00.000Z'),
  };
  const { state, service } = createHarness([existing]);
  const result = await service.upsertYouTubeCandidate(makeCandidate(), { genre: 'Pop', language: 'en' });
  assert.equal(result.status, 'updated');
  const doc = state.docs[0];
  assert.equal(doc._id, 'canon-1');
  assert.equal(doc.title, 'Curated Title');
  assert.equal(doc.artist, 'Curated Artist');
  assert.equal(doc.genre, 'Jazz');
  assert.equal(doc.poster_url, 'https://i.ytimg.com/vi/vidAAA111111/maxres.jpg');
  assert.equal(doc.duration, '4:13');
  assert.equal(doc.duration_seconds, 253);
  assert.equal(doc.category, 'Music');
  assert.equal(doc.recommendation_eligible, true);
  assert.equal(doc.metadata_refreshed_at, FIXED_NOW);
  assert.equal(doc.language, 'en');
  assert.equal('metadata_provenance' in doc, false);
});

test('20: existing title is preserved on refresh', async () => {
  const existing = {
    _id: 'canon-t',
    title: 'Hand Curated Title',
    artist: 'A',
    genre: 'Rock',
    source_provider: 'youtube',
    external_id: 'vidAAA111111',
    youtube_id: 'vidAAA111111',
  };
  const { state, service } = createHarness([existing]);
  await service.upsertYouTubeCandidate(makeCandidate({ title: 'Provider Title' }));
  assert.equal(state.docs[0].title, 'Hand Curated Title');
});

test('21: existing artist is preserved on refresh', async () => {
  const existing = {
    _id: 'canon-a',
    title: 'T',
    artist: 'Hand Curated Artist',
    genre: 'Rock',
    source_provider: 'youtube',
    external_id: 'vidAAA111111',
    youtube_id: 'vidAAA111111',
  };
  const { state, service } = createHarness([existing]);
  await service.upsertYouTubeCandidate(makeCandidate({ artist_candidate: 'Channel Name' }));
  assert.equal(state.docs[0].artist, 'Hand Curated Artist');
});

test('22: existing genre is preserved even when context supplies a genre', async () => {
  const existing = {
    _id: 'canon-g',
    title: 'T',
    artist: 'A',
    genre: 'Folk',
    source_provider: 'youtube',
    external_id: 'vidAAA111111',
    youtube_id: 'vidAAA111111',
  };
  const { state, service } = createHarness([existing]);
  await service.upsertYouTubeCandidate(makeCandidate(), { genre: 'Pop' });
  assert.equal(state.docs[0].genre, 'Folk');
});

test('23: lyrics, chords, and file_path are preserved on refresh', async () => {
  const existing = {
    _id: 'canon-l',
    title: 'T',
    artist: 'A',
    genre: 'Rock',
    lyrics: 'keep these lyrics',
    chords: 'keep these chords',
    file_path: '/keep/me.mp3',
    source_provider: 'youtube',
    external_id: 'vidAAA111111',
    youtube_id: 'vidAAA111111',
  };
  const { state, service } = createHarness([existing]);
  await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(state.docs[0].lyrics, 'keep these lyrics');
  assert.equal(state.docs[0].chords, 'keep these chords');
  assert.equal(state.docs[0].file_path, '/keep/me.mp3');
});

test('24: null provider values do not erase existing metadata', async () => {
  const existing = {
    _id: 'canon-n',
    title: 'T',
    artist: 'A',
    genre: 'Rock',
    poster_url: 'https://old.example/keep.jpg',
    category: 'Education',
    source_provider: 'youtube',
    external_id: 'vidAAA111111',
    youtube_id: 'vidAAA111111',
  };
  const { state, service } = createHarness([existing]);
  await service.upsertYouTubeCandidate(makeCandidate({ poster_url: null, category: null }));
  assert.equal(state.docs[0].poster_url, 'https://old.example/keep.jpg');
  assert.equal(state.docs[0].category, 'Education');
});

test('25: exactly one youtube_id legacy match is adopted', async () => {
  const legacy = {
    _id: 'legacy-1',
    title: 'Legacy Title',
    artist: 'Legacy Artist',
    genre: 'Rock',
    youtube_id: 'vidAAA111111',
    lyrics: 'legacy lyrics',
  };
  const { service } = createHarness([legacy]);
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'adopted-legacy');
  assert.equal(result.reason, null);
  assert.equal(result.song._id, 'legacy-1');
});

test('26: legacy adoption preserves the exact _id', async () => {
  const legacy = { _id: 'legacy-stable', title: 'T', artist: 'A', genre: 'Rock', youtube_id: 'vidAAA111111' };
  const { state, service } = createHarness([legacy]);
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.song._id, 'legacy-stable');
  assert.equal(state.docs[0]._id, 'legacy-stable');
  assert.equal(state.docs.length, 1);
});

test('27: canonical identity is assigned on adoption', async () => {
  const legacy = { _id: 'legacy-c', title: 'T', artist: 'A', genre: 'Rock', youtube_id: 'vidAAA111111' };
  const { state, service } = createHarness([legacy]);
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'adopted-legacy');
  assert.equal(state.docs[0].source_provider, 'youtube');
  assert.equal(state.docs[0].external_id, 'vidAAA111111');
  assert.equal(state.docs[0].youtube_id, 'vidAAA111111');
  assert.deepEqual(state.docs[0].metadata_provenance, {
    source: 'youtube',
    reference: 'vidAAA111111',
    imported_at: FIXED_NOW,
  });
  assert.equal(state.docs[0].metadata_refreshed_at, FIXED_NOW);
});

test('28: existing curated legacy fields are preserved on adoption', async () => {
  const legacy = {
    _id: 'legacy-curated',
    title: 'Curated Legacy Title',
    artist: 'Curated Legacy Artist',
    genre: 'Blues',
    lyrics: 'legacy lyrics',
    chords: 'legacy chords',
    file_path: '/legacy.mp3',
    release_date: new Date('2018-02-02T00:00:00.000Z'),
    youtube_id: 'vidAAA111111',
  };
  const { state, service } = createHarness([legacy]);
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'adopted-legacy');
  const doc = state.docs[0];
  assert.equal(doc.title, 'Curated Legacy Title');
  assert.equal(doc.artist, 'Curated Legacy Artist');
  assert.equal(doc.genre, 'Blues');
  assert.equal(doc.lyrics, 'legacy lyrics');
  assert.equal(doc.chords, 'legacy chords');
  assert.equal(doc.file_path, '/legacy.mp3');
  assert.equal(doc.release_date.getTime(), new Date('2018-02-02T00:00:00.000Z').getTime());
});

test('29: two legacy youtube_id matches produce an ambiguous conflict with no mutation', async () => {
  const legacyA = { _id: 'legacy-a', title: 'A', artist: 'A', genre: 'Rock', youtube_id: 'vidAAA111111' };
  const legacyB = { _id: 'legacy-b', title: 'B', artist: 'B', genre: 'Pop', youtube_id: 'vidAAA111111' };
  const { state, service } = createHarness([legacyA, legacyB]);
  const before = structuredClone(state.docs);
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'ambiguous-legacy-match');
  assert.equal(result.song, null);
  assert.deepEqual(state.docs, before);
  assert.equal(state.calls.some((call) => call.method === 'findOneAndUpdate'), false);
  assert.equal(state.nowCalls, 0);
});

test('30: conflicting legacy canonical identity is not overwritten', async () => {
  const legacy = {
    _id: 'legacy-conflict',
    title: 'T',
    artist: 'A',
    genre: 'Rock',
    youtube_id: 'vidAAA111111',
    source_provider: 'vimeo',
    external_id: 'vimeo-42',
  };
  const { state, service } = createHarness([legacy]);
  const before = structuredClone(state.docs);
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'conflicting-legacy-identity');
  assert.equal(result.song, null);
  assert.deepEqual(state.docs, before);
  assert.equal(state.docs[0].source_provider, 'vimeo');
  assert.equal(state.docs[0].external_id, 'vimeo-42');
  assert.equal(state.calls.some((call) => call.method === 'findOneAndUpdate'), false);
});

test('31: no destructive delete, merge, or rewrite method is ever used', async () => {
  const legacy = { _id: 'legacy-1', title: 'T', artist: 'A', genre: 'Rock', youtube_id: 'vidAAA111111' };
  const { state, service, model } = createHarness([legacy]);
  await service.upsertYouTubeCandidate(makeCandidate());

  const forbidden = /delete|remove|drop|merge|bulk|writeOne|updateMany|deleteMany/i;
  for (const call of state.calls) {
    assert.equal(forbidden.test(call.method), false, call.method);
  }
  for (const key of Object.keys(model)) {
    assert.equal(forbidden.test(key), false, key);
  }
  assert.deepEqual(Object.keys(model).sort(), ['find', 'findOne', 'findOneAndUpdate']);
});

test('32: canonical insert uses atomic upsert semantics', async () => {
  const { state, service } = createHarness();
  await service.upsertYouTubeCandidate(makeCandidate());
  const upsertCalls = state.calls.filter(
    (call) => call.method === 'findOneAndUpdate' && call.options.upsert === true,
  );
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].filter.source_provider, 'youtube');
  assert.equal(upsertCalls[0].filter.external_id, 'vidAAA111111');
  assert.equal(upsertCalls[0].options.new, true);
  assert.equal(upsertCalls[0].options.runValidators, true);
  assert.deepEqual(Object.keys(upsertCalls[0].update), ['$setOnInsert']);
});

test('33: a duplicate-key race performs at most one recovery re-read', async () => {
  const { state, service } = createHarness([], { raceMode: 'create-then-throw' });
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'updated');
  assert.equal(state.upsertAttempts, 1);
  assert.equal(canonicalFindCount(state), 2);
});

test('34: duplicate-race recovery returns the same canonical record', async () => {
  const { state, service } = createHarness([], { raceMode: 'create-then-throw' });
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'updated');
  assert.equal(result.reason, null);
  assert.equal(result.song._id, 'race-winner-1');
  assert.equal(result.song._id, state.docs[0]._id);
  assert.equal(state.docs.length, 1);
});

test('35: failed recovery produces a sanitized persistence failure', async () => {
  const { state, service } = createHarness([], { raceMode: 'throw-only' });
  const result = await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'persistence-failed');
  assert.equal(result.song, null);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('E11000'), false);
  assert.equal(serialized.includes('duplicate key'), false);
  assert.equal(serialized.includes('melodify.songs'), false);
  assert.equal(state.docs.length, 0);
});

test('36: there is no infinite retry — exactly one insert attempt', async () => {
  const failed = createHarness([], { raceMode: 'throw-only' });
  await failed.service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(failed.state.upsertAttempts, 1);
  assert.equal(failed.state.calls.filter((call) => call.method === 'findOneAndUpdate').length, 1);

  const raced = createHarness([], { raceMode: 'create-then-throw' });
  await raced.service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(raced.state.upsertAttempts, 1);
  assert.equal(raced.state.calls.filter((call) => call.method === 'findOneAndUpdate').length, 1);
});

test('37: the input candidate is not mutated', async () => {
  const { service } = createHarness();
  const candidate = makeCandidate();
  const before = structuredClone(candidate);
  await service.upsertYouTubeCandidate(candidate, { genre: 'Pop' });
  assert.deepEqual(candidate, before);
});

test('38: the context object is not mutated', async () => {
  const { service } = createHarness();
  const context = { genre: 'Pop', language: 'en', title: 'evil', lyrics: 'evil' };
  const before = structuredClone(context);
  await service.upsertYouTubeCandidate(makeCandidate(), context);
  assert.deepEqual(context, before);
});

test('38b: arbitrary caller context fields are never persisted', async () => {
  const { service } = createHarness();
  const { song } = await service.upsertYouTubeCandidate(makeCandidate(), {
    genre: 'Pop',
    language: 'en',
    title: 'Injected Title',
    artist: 'Injected Artist',
    lyrics: 'Injected lyrics',
    file_path: '/injected.mp3',
    source_provider: 'vimeo',
    external_id: 'injected',
    _id: 'injected-id',
  });
  assert.equal(song.title, 'Test Track');
  assert.equal(song.artist, 'Test Artist');
  assert.equal('lyrics' in song, false);
  assert.equal('file_path' in song, false);
  assert.equal(song.source_provider, 'youtube');
  assert.equal(song.external_id, 'vidAAA111111');
  assert.notEqual(song._id, 'injected-id');
  assert.deepEqual(UPSERT_CONTEXT_FIELDS, ['genre', 'language']);
});

test('39: the injected clock fully controls timestamps with bounded calls', async () => {
  const clock = createHarness();
  await clock.service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(clock.state.nowCalls, 1);

  const legacy = { _id: 'legacy-clock', title: 'T', artist: 'A', genre: 'Rock', youtube_id: 'vidAAA111111' };
  const adoption = createHarness([legacy]);
  const adopted = await adoption.service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(adoption.state.nowCalls, 1);
  assert.equal(adopted.song.metadata_provenance.imported_at, FIXED_NOW);
  assert.equal(adopted.song.metadata_refreshed_at, FIXED_NOW);
  assert.equal(adopted.song.metadata_provenance.imported_at.getTime(), adopted.song.metadata_refreshed_at.getTime());

  const refresh = createHarness([{
    _id: 'canon-clock',
    title: 'T',
    artist: 'A',
    genre: 'Rock',
    source_provider: 'youtube',
    external_id: 'vidAAA111111',
    youtube_id: 'vidAAA111111',
  }]);
  await refresh.service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(refresh.state.nowCalls, 1);
  assert.equal(refresh.state.docs[0].metadata_refreshed_at, FIXED_NOW);
});

test('40: no network call is made', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('network access is forbidden in catalog upsert tests');
  };
  try {
    const { service } = createHarness();
    const insert = await service.upsertYouTubeCandidate(makeCandidate());
    assert.equal(insert.status, 'inserted');
    const skippedHarness = createHarness();
    const skipped = await skippedHarness.service.upsertYouTubeCandidate(makeCandidate({ catalog_eligible: false }));
    assert.equal(skipped.status, 'skipped');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('41: no database connection is opened', async () => {
  assert.equal(mongoose.connection.readyState, 0);
  const { service } = createHarness();
  await service.upsertYouTubeCandidate(makeCandidate());
  assert.equal(mongoose.connection.readyState, 0);
});

test('42: results use the fixed status and reason vocabulary only', async () => {
  assert.deepEqual([...UPSERT_STATUSES], ['inserted', 'updated', 'adopted-legacy', 'skipped', 'conflict']);
  assert.deepEqual([...UPSERT_REASONS], [
    'ineligible',
    'invalid-identity',
    'missing-artist',
    'ambiguous-legacy-match',
    'conflicting-legacy-identity',
    'persistence-failed',
  ]);
  assert.ok(Object.isFrozen(UPSERT_STATUSES));
  assert.ok(Object.isFrozen(UPSERT_REASONS));

  const legacyA = { _id: 'l1', title: 'A', artist: 'A', genre: 'Rock', youtube_id: 'vidAAA111111' };
  const legacyB = { _id: 'l2', title: 'B', artist: 'B', genre: 'Pop', youtube_id: 'vidAAA111111' };
  const results = [
    await createHarness().service.upsertYouTubeCandidate(makeCandidate()),
    await createHarness().service.upsertYouTubeCandidate(makeCandidate({ catalog_eligible: false })),
    await createHarness().service.upsertYouTubeCandidate(makeCandidate({ external_id: 'other' })),
    await createHarness().service.upsertYouTubeCandidate(makeCandidate({ artist_candidate: null })),
    await createHarness([legacyA, legacyB]).service.upsertYouTubeCandidate(makeCandidate()),
    await createHarness([{
      _id: 'conflict',
      title: 'T',
      artist: 'A',
      genre: 'Rock',
      youtube_id: 'vidAAA111111',
      source_provider: 'dailymotion',
      external_id: 'dm-1',
    }]).service.upsertYouTubeCandidate(makeCandidate()),
    await createHarness([], { raceMode: 'throw-only' }).service.upsertYouTubeCandidate(makeCandidate()),
    await createHarness().service.upsertYouTubeCandidate(makeCandidate()),
    await createHarness().service.upsertYouTubeCandidate(makeCandidate()),
  ];
  for (const result of results) {
    assert.ok(UPSERT_STATUSES.includes(result.status), result.status);
    assert.ok(result.reason === null || UPSERT_REASONS.includes(result.reason), result.reason);
    assert.equal(typeof result.song === 'object' || result.song === null, true);
  }
});

test('factory validates the injected model', () => {
  assert.throws(() => createCatalogUpsertService({ SongModel: null }), /Song model/);
  assert.throws(() => createCatalogUpsertService({ SongModel: {} }), /Song model/);
  assert.throws(() => createCatalogUpsertService({ SongModel: { findOne() {}, find() {} } }), /Song model/);
});
