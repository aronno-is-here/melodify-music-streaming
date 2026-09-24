import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import {
  createUserPreferenceAggregationService,
  DEFAULT_LOOKBACK_DAYS, MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS,
  MAX_LISTENING_EVENTS_PER_USER,
  USER_PREFERENCE_AGGREGATION_ERROR,
  USER_PREFERENCE_INVALID_USER_ERROR,
  USER_PREFERENCE_INVALID_LOOKBACK_ERROR,
} from './userPreferenceAggregationService.js';

const id = (n) => n.toString(16).padStart(24, '0');
const USER = id(100000);
const NOW = new Date('2026-09-15T12:00:00.000Z');
const EARLY = '2026-09-01T12:00:00.000Z';
const LATE = '2026-09-02T12:00:00.000Z';
const OLD = '2020-01-01T00:00:00.000Z';
const DAY_MS = 86400000;
const event = (n = 1, fields = {}) => ({
  _id: id(1000 + n), user: USER, song: id(1), session_id: 'session-a',
  event_type: 'progress', createdAt: new Date(EARLY), ...fields,
});
const song = (n = 1, fields = {}) => ({ _id: id(n), title: `Song ${n}`, artist: 'Band', genre: 'Rock', ...fields });
const favorite = (n = 1, fields = {}) => ({ type: 'favorite', song_id: id(n), source_id: id(200 + n), occurred_at: OLD, ...fields });
const membership = (n = 1, source = 301) => ({ type: 'playlist-membership', song_id: id(n), source_id: id(source), occurred_at: null });
const evidence = (signals = [], truncated = {}) => ({
  signals, counts: { favorites: 0, playlistMemberships: 0, total: 0 },
  truncated: { favorites: false, playlists: false, memberships: false, ...truncated },
});
const canonical = (value) => value instanceof mongoose.Types.ObjectId ? value.toHexString()
  : typeof value === 'string' ? value.toLowerCase() : value?._id ? canonical(value._id) : null;

function harness(data = {}, behavior = {}) {
  const records = { events: [], songs: [song()], evidence: evidence(), ...data };
  const calls = [];
  let clockCalls = 0;
  const model = (name) => ({
    find(filter) {
      const call = { name, filter };
      calls.push(call);
      if (behavior.throwSync === name) throw new Error('secret-marker mongodb://raw-db-marker');
      return {
        select(projection) { call.projection = projection; return this; },
        sort(order) { call.order = order; return this; },
        limit(limit) { call.limit = limit; return this; },
        async lean() {
          call.lean = true;
          if (behavior.fail === name) throw new Error('secret-marker mongodb://raw-db-marker');
          if (behavior.malformed === name) return {};
          let rows = records[name].filter((row) => {
            if (behavior.bypassFilter === name) return true;
            if (name === 'songs') return filter._id.$in.includes(canonical(row?._id));
            const time = new Date(row?.createdAt).getTime();
            return canonical(row?.user) === filter.user && time >= filter.createdAt.$gte.getTime() && time <= filter.createdAt.$lte.getTime();
          });
          if (call.order) rows = [...rows].sort((a, b) => (
            (new Date(a?.createdAt).getTime() || 0) - (new Date(b?.createdAt).getTime() || 0)
            || String(canonical(a?._id)).localeCompare(String(canonical(b?._id)))
          ));
          rows = rows.slice(0, call.limit);
          if (behavior.reverse) rows.reverse();
          if (behavior.rawDocuments) return rows;
          return rows.map((row) => row == null ? row : Object.fromEntries(
            Object.keys(call.projection).filter((key) => key in row).map((key) => [key, row[key]]),
          ));
        },
      };
    },
  });
  const options = {
    ListeningEventModel: model('events'), SongModel: model('songs'),
    explicitPreferenceSignalService: {
      async getUserExplicitPreferenceSignals(input) {
        calls.push({ name: 'explicit', input });
        if (behavior.fail === 'explicit') throw new Error('secret-marker raw-explicit-marker owner@example.test');
        return records.evidence;
      },
    },
    now: () => {
      clockCalls += 1;
      if (behavior.fail === 'clock') throw new Error('secret-marker');
      return Object.hasOwn(behavior, 'now') ? behavior.now : NOW;
    },
  };
  return {
    records, calls, options, clockCalls: () => clockCalls,
    load: createUserPreferenceAggregationService(options).getUserPreferenceProfile,
  };
}

const profile = (data, behavior, input = {}) => harness(data, behavior).load({ userId: USER, ...input });
const callsFor = (h, name) => h.calls.filter((call) => call.name === name);
const zeroListening = {
  session_count: 0, play_started_count: 0, replay_count: 0, completed_count: 0,
  skipped_count: 0, stopped_count: 0, progress_event_count: 0, listened_seconds: 0, last_event_at: null,
};

test('valid user produces a factual profile with a stable empty shape', async () => {
  const result = await profile();
  assert.deepEqual(result, {
    window: { lookback_days: 90, since: '2026-06-17T12:00:00.000Z', until: NOW.toISOString() },
    songs: [], genres: [], artists: [], languages: [],
    counts: { listening_event_count: 0, song_count: 0, active_favorite_count: 0, playlist_membership_count: 0,
      total_listened_seconds: 0, completed_count: 0, skipped_count: 0, replay_count: 0 },
    truncated: { listeningEvents: false, explicitFavorites: false, explicitPlaylists: false, explicitMemberships: false },
  });
});

for (const userId of [undefined, null, '', 'invalid', 'a'.repeat(23), 'g'.repeat(24), 123, {}, [], { _id: USER }]) {
  test(`invalid trusted user rejected before reads: ${JSON.stringify(userId)}`, async () => {
    const h = harness();
    await assert.rejects(h.load({ userId }), { message: USER_PREFERENCE_INVALID_USER_ERROR });
    assert.deepEqual(h.calls, []);
    assert.equal(h.clockCalls(), 0);
  });
}

test('missing/null inputs and nested alternate users cannot authorize reads', async () => {
  const h = harness();
  for (const input of [undefined, null, { user: { _id: USER } }, { options: { userId: USER } }]) {
    await assert.rejects(h.load(input), { message: USER_PREFERENCE_INVALID_USER_ERROR });
  }
  assert.deepEqual(h.calls, []);
});

for (const lookbackDays of [1, 365]) {
  test(`lookback boundary ${lookbackDays} is accepted`, async () => {
    const result = await profile(undefined, undefined, { lookbackDays });
    assert.equal(result.window.lookback_days, lookbackDays);
    assert.equal(new Date(result.window.until) - new Date(result.window.since), lookbackDays * DAY_MS);
  });
}
for (const lookbackDays of [0, -1, 366, 1.5, '90', null, NaN, Infinity, {}, true]) {
  test(`invalid lookback rejected before reads: ${String(lookbackDays)}`, async () => {
    const h = harness();
    await assert.rejects(h.load({ userId: USER, lookbackDays }), { message: USER_PREFERENCE_INVALID_LOOKBACK_ERROR });
    assert.deepEqual(h.calls, []);
    assert.equal(h.clockCalls(), 0);
  });
}

test('injected clock is read once and controls both inclusive query bounds', async () => {
  const clock = new Date('2026-08-01T00:00:00.000Z');
  const h = harness({}, { now: clock });
  const result = await h.load({ userId: new mongoose.Types.ObjectId(USER), lookbackDays: 1 });
  assert.equal(h.clockCalls(), 1);
  assert.deepEqual(callsFor(h, 'events')[0].filter, {
    user: USER, createdAt: { $gte: new Date('2026-07-31T00:00:00.000Z'), $lte: clock },
  });
  assert.equal(result.window.since, '2026-07-31T00:00:00.000Z');
  assert.equal(clock.toISOString(), '2026-08-01T00:00:00.000Z');
});

test('trusted canonical user scopes events and explicit service, ignoring alternate options', async () => {
  const h = harness({ events: [event(), event(2, { user: id(99999), listened_seconds_delta: 99 })] });
  const result = await h.load({ userId: USER.toUpperCase(), email: 'ignored@example.test', options: { userId: id(99999) } });
  assert.equal(result.counts.listening_event_count, 1);
  assert.deepEqual(callsFor(h, 'explicit'), [{ name: 'explicit', input: { userId: USER } }]);
  assert.equal(callsFor(h, 'events')[0].filter.user, USER);
});

test('listening query is lean, projected, sorted by server time/ID and capped at MAX+1', async () => {
  const h = harness();
  await h.load({ userId: USER });
  const query = callsFor(h, 'events')[0];
  assert.deepEqual(query.order, { createdAt: 1, _id: 1 });
  assert.equal(query.limit, MAX_LISTENING_EVENTS_PER_USER + 1);
  assert.equal(query.lean, true);
  assert.deepEqual(Object.keys(query.projection).sort(), [
    '_id', 'song', 'session_id', 'event_type', 'position_seconds', 'duration_seconds', 'listened_seconds_delta', 'createdAt',
  ].sort());
  assert.equal('client_occurred_at' in query.projection, false);
  assert.equal('user' in query.projection, false);
});

test('window includes both exact boundaries and excludes old/future server events', async () => {
  const since = new Date(NOW.getTime() - DAY_MS);
  const result = await profile({ events: [
    event(1, { createdAt: since }), event(2, { createdAt: NOW }),
    event(3, { createdAt: new Date(since.getTime() - 1) }), event(4, { createdAt: new Date(NOW.getTime() + 1) }),
  ] }, undefined, { lookbackDays: 1 });
  assert.equal(result.counts.listening_event_count, 2);
  assert.equal(result.songs[0].listening.last_event_at, NOW.toISOString());
});

const lifecycle = () => [
  ['play-started', 0, 'a'], ['progress', 10, 'a'], ['paused', 2, 'a'], ['resumed', 0, 'a'],
  ['seeked', 0, 'a'], ['progress', 4, 'a'], ['completed', 1, 'a'], ['replay-started', 0, 'a'],
  ['progress', 3, 'a'], ['skipped', 0, 'a'], ['play-started', 0, 'b'], ['stopped', 2, 'b'],
].map(([event_type, listened_seconds_delta, session_id], i) => event(i + 1, {
  event_type, listened_seconds_delta, session_id, createdAt: new Date(new Date(EARLY).getTime() + i * 1000),
}));

for (const [field, expected] of Object.entries({
  play_started_count: 2, replay_count: 1, completed_count: 1, skipped_count: 1,
  stopped_count: 1, progress_event_count: 3, session_count: 2, listened_seconds: 22,
})) {
  test(`per-song ${field} counts stored factual evidence`, async () => {
    const result = await profile({ events: lifecycle() });
    assert.equal(result.songs[0].listening[field], expected);
    assert.equal(result.counts.listening_event_count, 12);
  });
}

test('replay in one session does not add starts or sessions across repeat cycles', async () => {
  const result = await profile({ events: ['play-started', 'completed', 'replay-started', 'completed', 'replay-started']
    .map((event_type, i) => event(i + 1, { event_type })) });
  assert.equal(result.songs[0].listening.session_count, 1);
  assert.equal(result.songs[0].listening.play_started_count, 1);
  assert.equal(result.songs[0].listening.replay_count, 2);
});

test('window beginning mid-session still counts observed sessions without inventing starts', async () => {
  const result = await profile({ events: [event(1), event(2, { event_type: 'completed' })] });
  assert.equal(result.songs[0].listening.session_count, 1);
  assert.equal(result.songs[0].listening.play_started_count, 0);
});

test('repeated songs, near-end positions and missing completion never infer replay/completion/skip', async () => {
  const result = await profile({ events: [
    event(1, { position_seconds: 199, duration_seconds: 200 }),
    event(2, { session_id: 'session-b', position_seconds: 200, duration_seconds: 200 }),
  ] });
  const listening = result.songs[0].listening;
  assert.equal(listening.replay_count, 0);
  assert.equal(listening.completed_count, 0);
  assert.equal(listening.skipped_count, 0);
  assert.equal(listening.listened_seconds, 0);
});

test('listened seconds never reconstruct positions, seek jumps or server/client time gaps', async () => {
  const result = await profile({ events: [
    event(1, { event_type: 'play-started', position_seconds: 0, client_occurred_at: OLD }),
    event(2, { event_type: 'seeked', position_seconds: 1000, client_occurred_at: NOW }),
    event(3, { position_seconds: 1100, listened_seconds_delta: 1.5, createdAt: new Date(LATE) }),
    event(4, { event_type: 'paused', position_seconds: 1200 }),
    event(5, { event_type: 'resumed', position_seconds: 1400 }),
  ] });
  assert.equal(result.songs[0].listening.listened_seconds, 1.5);
});

for (const delta of [-1, NaN, Infinity, -Infinity, 121, '20', {}, null, undefined]) {
  test(`malformed delta ${String(delta)} adds no seconds but preserves the event fact`, async () => {
    const result = await profile({ events: [event(1, { listened_seconds_delta: delta })] });
    assert.equal(result.songs[0].listening.listened_seconds, 0);
    assert.equal(result.songs[0].listening.progress_event_count, 1);
  });
}

test('valid 0 and 120 second delta boundaries are retained', async () => {
  const result = await profile({ events: [event(1, { listened_seconds_delta: 0 }), event(2, { listened_seconds_delta: 120 })] });
  assert.equal(result.counts.total_listened_seconds, 120);
});

for (const event_type of ['play-started', 'resumed', 'seeked', 'replay-started']) {
  test(`unexpected positive ${event_type} delta is not listening`, async () => {
    const result = await profile({ events: [event(1, { event_type, listened_seconds_delta: 20 })] });
    assert.equal(result.counts.total_listened_seconds, 0);
    assert.equal(result.counts.listening_event_count, 1);
  });
}

for (const [label, fields] of [
  ['invalid song', { song: 'bad' }], ['null song', { song: null }], ['nested song', { song: { _id: { _id: id(1) } } }],
  ['blank session', { session_id: '  ' }], ['long session', { session_id: 'x'.repeat(129) }],
  ['object session', { session_id: {} }], ['unsupported type', { event_type: 'liked' }],
  ['invalid row ID', { _id: 'bad' }], ['negative position', { position_seconds: -1 }],
  ['NaN position', { position_seconds: NaN }], ['infinite position', { position_seconds: Infinity }],
  ['over-cap position', { position_seconds: 86401 }], ['string position', { position_seconds: '2' }],
  ['zero duration', { duration_seconds: 0 }], ['negative duration', { duration_seconds: -1 }],
  ['infinite duration', { duration_seconds: Infinity }], ['over-cap duration', { duration_seconds: 86401 }],
  ['position beyond tolerance', { position_seconds: 103, duration_seconds: 100 }],
  ['invalid server timestamp', { createdAt: 'invalid' }], ['absent server timestamp', { createdAt: undefined }],
  ['old server timestamp', { createdAt: OLD }], ['future server timestamp', { createdAt: '2027-01-01' }],
]) {
  test(`malformed/out-of-window event ignored safely: ${label}`, async () => {
    const h = harness({ events: [event(1, fields)] }, { bypassFilter: 'events' });
    const result = await h.load({ userId: USER });
    assert.deepEqual(result.songs, []);
    assert.equal(result.counts.listening_event_count, 0);
    assert.equal(callsFor(h, 'songs').length, 0);
  });
}

test('null rows and non-coercible song objects do not crash the profile', async () => {
  const h = harness({ events: [null, event(1, { song: { toString() { throw new Error('must not coerce'); } } })] }, { bypassFilter: 'events' });
  assert.deepEqual((await h.load({ userId: USER })).songs, []);
});

test('ObjectId/populated song references canonicalize and session whitespace is normalized', async () => {
  const result = await profile({ events: [
    event(1, { song: new mongoose.Types.ObjectId(id(1)), session_id: ' a ' }),
    event(2, { song: { _id: new mongoose.Types.ObjectId(id(1)) }, session_id: 'a' }),
  ] });
  assert.equal(result.songs[0].song_id, id(1));
  assert.equal(result.songs[0].listening.session_count, 1);
});

test('latest valid server createdAt wins regardless of client timestamps and query return order', async () => {
  const result = await profile({ events: [
    event(1, { createdAt: new Date(LATE), client_occurred_at: OLD }),
    event(2, { createdAt: new Date(EARLY), client_occurred_at: '2099-01-01' }),
  ] }, { reverse: true, rawDocuments: true });
  assert.equal(result.songs[0].listening.last_event_at, LATE);
});

test('exactly one explicit call preserves active Favorite source and old factual time', async () => {
  const h = harness({ evidence: evidence([favorite()]) });
  const result = await h.load({ userId: USER, lookbackDays: 1 });
  assert.deepEqual(callsFor(h, 'explicit'), [{ name: 'explicit', input: { userId: USER } }]);
  assert.deepEqual(result.songs[0].explicit, {
    favorite: true, favorite_source_id: id(201), favorite_occurred_at: OLD,
    playlist_membership_count: 0, playlist_source_ids: [],
  });
  assert.deepEqual(result.songs[0].listening, zeroListening);
});

test('listening-only song gets false/null Favorite and zero membership state', async () => {
  const result = await profile({ events: [event()] });
  assert.deepEqual(result.songs[0].explicit, {
    favorite: false, favorite_source_id: null, favorite_occurred_at: null,
    playlist_membership_count: 0, playlist_source_ids: [],
  });
});

test('current distinct playlist sources are unique/sorted even if adapter repeats evidence', async () => {
  const result = await profile({ evidence: evidence([membership(1, 303), membership(1, 301), membership(1, 303)]) });
  assert.equal(result.songs[0].explicit.playlist_membership_count, 2);
  assert.deepEqual(result.songs[0].explicit.playlist_source_ids, [id(301), id(303)]);
  assert.deepEqual(result.songs[0].listening, zeroListening);
});

for (const signals of [[favorite()], [membership()], [favorite(), membership()]]) {
  test(`listening plus ${signals.map((s) => s.type).join('/')} merges into one song row`, async () => {
    const result = await profile({ events: [event(), event(2)], evidence: evidence(signals) });
    assert.equal(result.songs.length, 1);
    assert.equal(result.counts.listening_event_count, 2);
    assert.equal(result.songs[0].explicit.favorite, signals.some((s) => s.type === 'favorite'));
    assert.equal(result.songs[0].explicit.playlist_membership_count, signals.some((s) => s.type === 'playlist-membership') ? 1 : 0);
  });
}

test('malformed explicit entries are ignored without manufacturing source state', async () => {
  const result = await profile({ evidence: evidence([
    null, {}, favorite(1, { type: 'post-like' }), favorite(1, { song_id: 'bad' }), favorite(1, { source_id: {} }),
  ]) });
  assert.deepEqual(result.songs, []);
});

test('unexpected duplicate Favorites retain deterministic earliest known source evidence', async () => {
  const signals = [favorite(1, { source_id: id(201), occurred_at: null }),
    favorite(1, { source_id: id(203) }), favorite(1, { source_id: id(202) })];
  const a = await profile({ evidence: evidence(signals) });
  const b = await profile({ evidence: evidence([...signals].reverse()) });
  assert.deepEqual(a, b);
  assert.equal(a.songs[0].explicit.favorite_source_id, id(202));
  assert.equal(a.counts.active_favorite_count, 1);
});

test('missing Favorite timestamp stays null without a clock fallback', async () => {
  const result = await profile({ evidence: evidence([favorite(1, { occurred_at: undefined })]) });
  assert.equal(result.songs[0].explicit.favorite_occurred_at, null);
});

for (const data of [
  { events: [event()] }, { evidence: evidence([favorite()]) },
  { evidence: evidence([membership()]) }, { events: [event()], evidence: evidence([favorite(), membership()]) },
]) {
  test(`deleted Song evidence is excluded from songs/groups/totals: ${JSON.stringify(Object.keys(data))}`, async () => {
    const result = await profile({ ...data, songs: [] });
    assert.deepEqual(result.songs, []);
    assert.deepEqual(result.genres, []);
    assert.deepEqual(result.artists, []);
    assert.ok(Object.values(result.counts).every((value) => value === 0));
  });
}

test('metadata lookup uses one bounded unique-ID query with explicit select-false metadata projection', async () => {
  const h = harness({ events: [event(), event(2)], evidence: evidence([favorite(), membership(2)]), songs: [song(), song(2)] });
  const result = await h.load({ userId: USER });
  assert.equal(callsFor(h, 'songs').length, 1);
  const query = callsFor(h, 'songs')[0];
  assert.deepEqual(query.filter, { _id: { $in: [id(1), id(2)] } });
  assert.equal(query.limit, 2);
  assert.equal(query.lean, true);
  assert.deepEqual(query.projection, { _id: 1, title: 1, artist: 1, genre: 1, language: 1, category: 1,
    normalized_artist: 1, normalized_genre: 1, recommendation_eligible: 1 });
  assert.equal(result.songs.length, 2);
});

test('empty evidence skips Song query but still calls explicit service once', async () => {
  const h = harness();
  await h.load({ userId: USER });
  assert.deepEqual(h.calls.map((call) => call.name), ['events', 'explicit']);
});

test('unrelated returned Songs never become profile rows', async () => {
  const result = await profile({ events: [event()], songs: [song(2)] }, { bypassFilter: 'songs' });
  assert.deepEqual(result.songs, []);
});

test('persisted text metadata is preserved, including eligibility=false', async () => {
  const metadata = { title: '  Song title  ', artist: ' Artist  Name ', genre: ' Raw Genre ',
    normalized_artist: 'canonical artist', normalized_genre: 'canonical genre', language: 'English',
    category: 'Music', recommendation_eligible: false };
  const result = await profile({ events: [event()], songs: [song(1, metadata)] });
  assert.deepEqual(result.songs[0].metadata, metadata);
  assert.equal(result.artists[0].key, 'canonical artist');
  assert.equal(result.genres[0].key, 'canonical genre');
  assert.equal(result.languages[0].key, 'english');
});

test('fallback grouping normalizes persisted raw artist/genre whitespace and case only', async () => {
  const result = await profile({ events: [event()], songs: [song(1, { artist: '  The\t BAND ', genre: ' ALT   Rock ', normalized_artist: ' ', normalized_genre: null })] });
  assert.equal(result.artists[0].key, 'the band');
  assert.equal(result.artists[0].label, 'The BAND');
  assert.equal(result.genres[0].key, 'alt rock');
});

test('missing artist/genre/language are not inferred from title or category', async () => {
  const result = await profile({ evidence: evidence([favorite()]), songs: [song(1, {
    title: 'Artist - Bengali rock song', category: 'Music', artist: null, genre: '', language: undefined,
  })] });
  assert.equal(result.songs[0].metadata.artist, null);
  assert.equal(result.songs[0].metadata.genre, null);
  assert.equal(result.songs[0].metadata.language, null);
  assert.deepEqual(result.artists, []);
  assert.deepEqual(result.genres, []);
  assert.deepEqual(result.languages, []);
});

test('normalized keys can group songs lacking raw labels, without changing metadata', async () => {
  const result = await profile({ evidence: evidence([favorite()]), songs: [song(1, {
    artist: null, genre: null, normalized_artist: 'Normalized Artist', normalized_genre: 'Normalized Genre',
  })] });
  assert.equal(result.artists[0].key, 'normalized artist');
  assert.equal(result.artists[0].label, 'Normalized Artist');
  assert.equal(result.songs[0].metadata.artist, null);
});

const combinedData = () => ({
  events: [
    event(1, { listened_seconds_delta: 10 }), event(2, { event_type: 'completed' }),
    event(3, { event_type: 'replay-started' }), event(4, { event_type: 'skipped' }),
    event(5, { song: id(2), session_id: 'b', event_type: 'play-started' }),
    event(6, { song: id(2), session_id: 'b', listened_seconds_delta: 20 }),
    event(7, { song: id(2), session_id: 'c', listened_seconds_delta: 5 }),
    event(8, { song: id(2), session_id: 'c', event_type: 'completed', createdAt: new Date(LATE) }),
  ],
  evidence: evidence([favorite(1), favorite(3), membership(1, 301), membership(1, 302), membership(2, 301), membership(3, 303)]),
  songs: [song(3, { artist: 'BAND' }), song(2, { artist: ' Band ', genre: ' rock ', language: 'English' }), song(1, { language: 'English' })],
});

for (const dimension of ['genres', 'artists']) {
  for (const [field, expected] of Object.entries({
    song_count: 3, listened_seconds: 35, session_count: 3, completed_count: 2, skipped_count: 1,
    replay_count: 1, favorite_song_count: 2, playlist_membership_count: 4, last_event_at: LATE,
  })) {
    test(`${dimension} ${field} sums factual contributions including explicit-only song`, async () => {
      const result = await profile(combinedData());
      assert.equal(result[dimension].length, 1);
      assert.equal(result[dimension][0][field], expected);
    });
  }
}

test('group labels use lowest contributing song ID independent of database result order', async () => {
  const result = await profile(combinedData(), { reverse: true });
  assert.equal(result.artists[0].label, 'Band');
  assert.equal(result.genres[0].label, 'Rock');
});

test('language totals use only persisted nonempty language, not category/title', async () => {
  const result = await profile(combinedData());
  assert.deepEqual(result.languages, [{ key: 'english', label: 'English', song_count: 2,
    listened_seconds: 35, session_count: 3, completed_count: 2, skipped_count: 1, replay_count: 1,
    favorite_song_count: 1, playlist_membership_count: 3, last_event_at: LATE }]);
});

test('explicit-only artist/genre/language summaries have zero listening and null last-event time', async () => {
  const result = await profile({ evidence: evidence([favorite()]), songs: [song(1, { language: 'Bengali' })] });
  for (const dimension of ['genres', 'artists', 'languages']) {
    assert.equal(result[dimension][0].song_count, 1);
    assert.equal(result[dimension][0].favorite_song_count, 1);
    assert.equal(result[dimension][0].listened_seconds, 0);
    assert.equal(result[dimension][0].last_event_at, null);
  }
});

for (const [field, expected] of Object.entries({
  listening_event_count: 8, song_count: 3, active_favorite_count: 2, playlist_membership_count: 4,
  total_listened_seconds: 35, completed_count: 2, skipped_count: 1, replay_count: 1,
})) {
  test(`profile-level ${field} equals factual surviving totals`, async () => {
    assert.equal((await profile(combinedData())).counts[field], expected);
  });
}

for (const excess of [0, 1, 10]) {
  test(`listening cap retains earliest MAX rows with accurate truncation at MAX + ${excess}`, async () => {
    const events = Array.from({ length: MAX_LISTENING_EVENTS_PER_USER + excess }, (_, i) => event(i + 1, {
      createdAt: new Date(new Date(EARLY).getTime() + i * 1000), listened_seconds_delta: 1,
    })).reverse();
    const h = harness({ events }, { reverse: true });
    const result = await h.load({ userId: USER });
    assert.equal(result.counts.listening_event_count, MAX_LISTENING_EVENTS_PER_USER);
    assert.equal(result.counts.total_listened_seconds, MAX_LISTENING_EVENTS_PER_USER);
    assert.equal(result.truncated.listeningEvents, excess > 0);
    assert.equal(result.songs[0].listening.last_event_at, new Date(new Date(EARLY).getTime() + (MAX_LISTENING_EVENTS_PER_USER - 1) * 1000).toISOString());
    assert.deepEqual(h.calls.map((call) => call.name), ['events', 'explicit', 'songs']);
  });
}

test('equal server timestamps truncate by ascending event ID before validity filtering', async () => {
  const events = Array.from({ length: MAX_LISTENING_EVENTS_PER_USER + 1 }, (_, i) => event(i + 1, {
    event_type: i === MAX_LISTENING_EVENTS_PER_USER ? 'completed' : 'progress',
  })).reverse();
  const result = await profile({ events });
  assert.equal(result.counts.completed_count, 0);
  assert.equal(result.truncated.listeningEvents, true);
});

for (const [source, output] of [['favorites', 'explicitFavorites'], ['playlists', 'explicitPlaylists'], ['memberships', 'explicitMemberships']]) {
  test(`propagates ${source} truncation even with no surviving songs`, async () => {
    const result = await profile({ evidence: evidence([favorite()], { [source]: true }), songs: [] });
    assert.equal(result.truncated[output], true);
    assert.equal(Object.values(result.truncated).filter(Boolean).length, 1);
  });
}

test('all final arrays and playlist IDs are sorted and repeated calls are deep-equal', async () => {
  const data = { evidence: evidence([favorite(2), membership(1, 303), membership(1, 301), favorite(1)]),
    songs: [song(2, { artist: 'Z Band', genre: 'Z Rock', language: 'Z Language' }), song(1, { artist: 'A Band', genre: 'A Rock', language: 'A Language' })] };
  const h = harness(data, { reverse: true });
  const a = await h.load({ userId: USER });
  assert.deepEqual(a, await h.load({ userId: USER }));
  assert.deepEqual(a, await profile({ ...data, evidence: evidence([...data.evidence.signals].reverse()) }));
  assert.deepEqual(a.songs.map((s) => s.song_id), [id(1), id(2)]);
  for (const dimension of ['genres', 'artists', 'languages']) {
    assert.ok(a[dimension][0].key < a[dimension][1].key);
  }
  assert.deepEqual(a.songs[0].explicit.playlist_source_ids, [id(301), id(303)]);
});

test('removal of explicit evidence clears active state without dislike or erasing listening', async () => {
  const h = harness({ events: [event()], evidence: evidence([favorite(), membership()]) });
  assert.equal((await h.load({ userId: USER })).counts.active_favorite_count, 1);
  h.records.evidence = evidence();
  const result = await h.load({ userId: USER });
  assert.equal(result.counts.song_count, 1);
  assert.equal(result.counts.active_favorite_count, 0);
  assert.equal(result.counts.playlist_membership_count, 0);
});

test('all source fixtures, input, factory options and injected clock remain unmutated', async () => {
  const freeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const data = freeze(combinedData());
  const before = JSON.stringify(data);
  const h = harness(data);
  const input = freeze({ userId: USER, lookbackDays: 90 });
  const options = { ...h.options };
  freeze(h.options);
  await h.load(input);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(input, { userId: USER, lookbackDays: 90 });
  assert.deepEqual(h.options, options);
  assert.equal(NOW.toISOString(), '2026-09-15T12:00:00.000Z');
});

test('returned fields are whitelisted facts, never raw sources, identity, secrets or scores', async () => {
  const extras = { email: 'secret-marker', jwt: 'secret-marker', token: 'secret-marker', user: USER,
    preference_score: 8, recommendation_score: 9, weight: 5, password: 'secret-marker' };
  const result = await profile({ events: [event(1, extras)], evidence: evidence([{ ...favorite(), ...extras }]),
    songs: [song(1, extras)] }, { rawDocuments: true });
  const raw = JSON.stringify(result);
  for (const forbidden of ['secret-marker', USER, 'preference_score', 'recommendation_score', 'weight', 'password', 'jwt', 'token', 'email']) {
    assert.equal(raw.includes(forbidden), false);
  }
  assert.deepEqual(Object.keys(result.songs[0]).sort(), ['explicit', 'listening', 'metadata', 'song_id']);
  assert.deepEqual(Object.keys(result.songs[0].listening).sort(), Object.keys(zeroListening).sort());
  assert.equal('session_id' in result.songs[0].listening, false);
});

for (const name of ['events', 'explicit', 'songs', 'clock']) {
  test(`${name} failure is sanitized with no cause, raw stack, partial profile or retries`, async () => {
    const h = harness({ events: [event()] }, { fail: name });
    await assert.rejects(h.load({ userId: USER }), (error) => {
      assert.equal(error.message, USER_PREFERENCE_AGGREGATION_ERROR);
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error), []);
      for (const marker of ['secret-marker', 'raw-db-marker', 'raw-explicit-marker', 'mongodb://', 'owner@example.test']) {
        assert.equal(error.stack.includes(marker), false);
      }
      return true;
    });
    assert.ok(h.calls.every((call) => callsFor(h, call.name).length === 1));
  });
}

test('synchronous model errors are sanitized', async () => {
  const h = harness({}, { throwSync: 'events' });
  await assert.rejects(h.load({ userId: USER }), { message: USER_PREFERENCE_AGGREGATION_ERROR });
});

for (const invalidClock of [null, undefined, new Date(NaN), 'invalid', {}, new Date(-8640000000000000)]) {
  test(`invalid clock/window fails before reads: ${String(invalidClock)}`, async () => {
    const h = harness({}, { now: invalidClock });
    await assert.rejects(h.load({ userId: USER }), { message: USER_PREFERENCE_AGGREGATION_ERROR });
    assert.deepEqual(h.calls, []);
  });
}

for (const name of ['events', 'songs']) {
  test(`malformed ${name} query result is sanitized`, async () => {
    const h = harness({ events: [event()] }, { malformed: name });
    await assert.rejects(h.load({ userId: USER }), { message: USER_PREFERENCE_AGGREGATION_ERROR });
  });
}

test('malformed or over-cap explicit service result fails safely instead of claiming completeness', async () => {
  for (const value of [null, {}, { signals: [] }, evidence([], { memberships: 'true' }), evidence(Array(6001).fill(favorite()))]) {
    const h = harness({ evidence: value });
    await assert.rejects(h.load({ userId: USER }), { message: USER_PREFERENCE_AGGREGATION_ERROR });
    assert.equal(callsFor(h, 'songs').length, 0);
  }
});

test('exported window and event caps match the bounded contract', () => {
  assert.equal(DEFAULT_LOOKBACK_DAYS, 90);
  assert.equal(MIN_LOOKBACK_DAYS, 1);
  assert.equal(MAX_LOOKBACK_DAYS, 365);
  assert.equal(MAX_LISTENING_EVENTS_PER_USER, 20000);
});

test('static: no scoring constants, ML invocation, persistence model, API or direct explicit-state reads', () => {
  const src = readFileSync(new URL('./userPreferenceAggregationService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /FAVORITE_WEIGHT|PLAYLIST_WEIGHT|COMPLETE_WEIGHT|SKIP_PENALTY|REPLAY_WEIGHT/);
  assert.doesNotMatch(src, /recommendation_score|preference_score|affinity_score|predicted_rating|engagement_score/);
  assert.doesNotMatch(src, /python|child_process|spawn\(|exec\(|mongoose\.model\(|new .*Schema|Router\(/i);
  assert.doesNotMatch(src, /models\/(Favorite|Playlist|Post|Like|PlayHistory)\.js/);
  assert.doesNotMatch(src, /Date\.now\(|Math\.random\(|\.(connect|save|create|updateOne|insertMany|populate|aggregate)\(/);
  assert.doesNotMatch(src, /setInterval|setTimeout|\bwhile\s*\(/);
  assert.equal((src.match(/ListeningEventModel\.find\(/g) || []).length, 1);
  assert.equal((src.match(/SongModel\.find\(/g) || []).length, 1);
  assert.equal((src.match(/\.getUserExplicitPreferenceSignals\(/g) || []).length, 1);
});
