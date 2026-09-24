import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRecommendationTrainingInputService,
  MAX_RAW_EVENTS,
  MAX_UNIQUE_SONGS,
  MAX_UNIQUE_USERS,
  RETRAIN_INPUT_SCHEMA_VERSION,
} from './recommendationTrainingInputService.js';

const oid = (hex) => hex;

const makeModel = (docs, { sortKey = '_id' } = {}) => ({
  find(filter) {
    const state = {
      filter,
      sort: null,
      limit: null,
      projection: null,
    };
    const chain = {
      select(projection) {
        state.projection = projection;
        return chain;
      },
      sort(spec) {
        state.sort = spec;
        return chain;
      },
      limit(n) {
        state.limit = n;
        return chain;
      },
      async lean() {
        let out = [...docs];
        if (state.sort) {
          const [[key, dir]] = Object.entries(state.sort);
          out.sort((a, b) => {
            const av = a[key];
            const bv = b[key];
            if (av < bv) return dir === -1 ? 1 : -1;
            if (av > bv) return dir === -1 ? -1 : 1;
            return 0;
          });
        }
        if (state.limit != null) out = out.slice(0, state.limit);
        return out;
      },
    };
    return chain;
  },
});

const songDocs = [
  {
    _id: oid('a'.repeat(24)),
    artist: 'Artist A',
    genre: 'Rock',
    language: 'English',
    category: 'music',
    recommendation_eligible: true,
  },
  {
    _id: oid('b'.repeat(24)),
    artist: 'Artist B',
    genre: 'Pop',
    language: null,
    category: null,
    recommendation_eligible: false,
  },
  {
    _id: oid('c'.repeat(24)),
    artist: 'Artist C',
    genre: 'Jazz',
    language: 'English',
    category: 'music',
    recommendation_eligible: true,
  },
];

const userDocs = [
  { _id: oid('1'.repeat(24)), email: 'one@example.com' },
  { _id: oid('2'.repeat(24)), email: 'two@example.com' },
];

const eventDocs = [
  {
    _id: oid('e'.repeat(24)),
    user: oid('1'.repeat(24)),
    song: oid('a'.repeat(24)),
    session_id: 's1',
    sequence: 0,
    event_type: 'play-started',
    createdAt: new Date('2026-09-15T12:00:00.000Z'),
  },
  {
    _id: oid('f'.repeat(24)),
    user: oid('1'.repeat(24)),
    song: oid('a'.repeat(24)),
    session_id: 's1',
    sequence: 1,
    event_type: 'completed',
    listened_seconds_delta: 30,
    createdAt: new Date('2026-09-15T12:01:00.000Z'),
  },
  {
    _id: oid('d'.repeat(24)),
    user: oid('2'.repeat(24)),
    song: oid('c'.repeat(24)),
    session_id: 's2',
    sequence: 0,
    event_type: 'play-started',
    createdAt: new Date('2026-09-15T13:00:00.000Z'),
  },
];

const favoriteDocs = [
  { user: oid('1'.repeat(24)), song: oid('a'.repeat(24)) },
];

const playlistDocs = [
  {
    user_email: 'one@example.com',
    items: [{ songId: oid('a'.repeat(24)) }, { songId: oid('c'.repeat(24)) }],
  },
];

const createService = (overrides = {}) =>
  createRecommendationTrainingInputService({
    SongModel: makeModel(songDocs),
    UserModel: makeModel(userDocs),
    ListeningEventModel: makeModel(eventDocs),
    FavoriteModel: makeModel(favoriteDocs),
    PlaylistModel: makeModel(playlistDocs),
    ...overrides,
  });

test('input: exports bounds and schema version', () => {
  assert.equal(RETRAIN_INPUT_SCHEMA_VERSION, 1);
  assert.equal(MAX_RAW_EVENTS, 250000);
  assert.equal(MAX_UNIQUE_USERS, 50000);
  assert.equal(MAX_UNIQUE_SONGS, 25000);
});

test('input: collects eligible songs only, sorted by id', async () => {
  const service = createService();
  const input = await service.collectRetrainingInput();
  assert.equal(input.schema_version, 1);
  assert.equal(input.songs.length, 2);
  assert.deepEqual(
    input.songs.map((s) => s._id),
    ['a'.repeat(24), 'c'.repeat(24)],
  );
  assert.equal(input.songs[0].artist, 'Artist A');
  assert.equal(input.songs[1].language, 'English');
});

test('input: song limit error when catalog exceeds bound', async () => {
  const overflow = Array.from({ length: MAX_UNIQUE_SONGS + 1 }, (_, i) => ({
    _id: i.toString(16).padStart(24, '0'),
    artist: 'A',
    genre: 'G',
    language: null,
    category: null,
    recommendation_eligible: true,
  }));
  const service = createRecommendationTrainingInputService({
    SongModel: makeModel(overflow),
    UserModel: makeModel(userDocs),
    ListeningEventModel: makeModel(eventDocs),
    FavoriteModel: makeModel(favoriteDocs),
    PlaylistModel: makeModel(playlistDocs),
  });
  await assert.rejects(
    () => service.collectRetrainingInput(),
    (error) => {
      assert.equal(error.name, 'RecommendationTrainingInputLimitError');
      assert.match(error.message, /song_count/);
      return true;
    },
  );
});

test('input: events normalized ascending by createdAt', async () => {
  const service = createService();
  const input = await service.collectRetrainingInput();
  assert.equal(input.events.length, 3);
  assert.equal(input.events[0].createdAt, '2026-09-15T12:00:00.000Z');
  assert.equal(input.events[2].createdAt, '2026-09-15T13:00:00.000Z');
  assert.equal(input.event_window_truncated, false);
  assert.equal(input.events[1].listened_seconds_delta, 30);
});

test('input: profiles built from favorites and playlists without emails', async () => {
  const service = createService();
  const input = await service.collectRetrainingInput();
  assert.equal(input.profiles[oid('1'.repeat(24))].favorite_song_ids.length, 1);
  assert.equal(
    input.profiles[oid('1'.repeat(24))].playlist_song_counts[oid('a'.repeat(24))],
    1,
  );
  assert.equal(
    input.profiles[oid('1'.repeat(24))].playlist_song_counts[oid('c'.repeat(24))],
    1,
  );
  assert.equal(input.profiles[oid('2'.repeat(24))], null);
  const serialized = JSON.stringify(input.profiles);
  assert.equal(serialized.includes('email'), false);
  assert.equal(serialized.includes('password'), false);
});

test('input: event window truncation flag when over max', async () => {
  const manyEvents = Array.from({ length: MAX_RAW_EVENTS + 1 }, (_, i) => ({
    _id: i.toString(16).padStart(24, '0'),
    user: oid('1'.repeat(24)),
    song: oid('a'.repeat(24)),
    session_id: `s${i}`,
    sequence: 0,
    event_type: 'play-started',
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
  }));
  const service = createRecommendationTrainingInputService({
    SongModel: makeModel(songDocs),
    UserModel: makeModel(userDocs),
    ListeningEventModel: makeModel(manyEvents),
    FavoriteModel: makeModel(favoriteDocs),
    PlaylistModel: makeModel(playlistDocs),
  });
  const input = await service.collectRetrainingInput();
  assert.equal(input.event_window_truncated, true);
  assert.equal(input.events.length, MAX_RAW_EVENTS);
});

test('input: read failure becomes RecommendationTrainingInputReadError', async () => {
  const service = createRecommendationTrainingInputService({
    SongModel: {
      find() {
        throw new Error('db down');
      },
    },
    UserModel: makeModel(userDocs),
    ListeningEventModel: makeModel(eventDocs),
    FavoriteModel: makeModel(favoriteDocs),
    PlaylistModel: makeModel(playlistDocs),
  });
  await assert.rejects(
    () => service.collectRetrainingInput(),
    (error) => {
      assert.equal(error.name, 'RecommendationTrainingInputReadError');
      return true;
    },
  );
});

test('input: source has no email/password/token fields in projection path', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(
    fileURLToPath(new URL('./recommendationTrainingInputService.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('password'), false);
  assert.equal(source.includes('token'), false);
  assert.equal(source.includes('jwt'), false);
  assert.equal(source.includes('child_process'), false);
  assert.equal(source.includes('spawn'), false);
});
