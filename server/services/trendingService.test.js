import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTrendingService,
  TRENDING_SERVICE_ERROR,
} from './trendingService.js';
import {
  scoreTrendingSongs,
  TRENDING_WINDOW_HOURS,
  MAX_TRENDING_EVENT_INPUTS,
  MAX_TRENDING_LIMIT,
} from './trendingScoreEngine.js';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const HOUR_MS = 3600000;
const id = (n) => n.toString(16).padStart(24, '0');
const USER_A = id(0xa);
const USER_B = id(0xb);
const SONG_1 = id(1);
const SONG_2 = id(2);
const SONG_3 = id(3);

const eventRow = (fields = {}) => ({
  _id: id(0x1000),
  user: USER_A,
  song: SONG_1,
  event_type: 'play-started',
  listened_seconds_delta: 0,
  createdAt: NOW,
  ...fields,
});

const songDoc = (fields = {}) => ({
  _id: SONG_1,
  title: 'Title One',
  artist: 'Artist One',
  genre: 'Pop',
  youtube_id: 'yt1',
  file_path: '',
  poster_url: 'https://img.example/1.jpg',
  duration: '3:00',
  duration_seconds: 180,
  release_date: new Date('2024-01-01T00:00:00.000Z'),
  language: 'English',
  category: 'music',
  recommendation_eligible: true,
  ...fields,
});

const rankRow = (songId, fields = {}) => ({
  song_id: songId,
  score: 1.5,
  unique_listener_count: 1,
  play_started_count: 1,
  completed_count: 0,
  replay_started_count: 0,
  skipped_count: 0,
  listened_seconds: 0,
  last_activity_at: NOW.toISOString(),
  ...fields,
});

const createQueryChain = (capture, rowsFactory) => {
  const chain = {
    sort(spec) {
      capture.sort = spec;
      return chain;
    },
    limit(n) {
      capture.limit = n;
      return chain;
    },
    select(spec) {
      capture.select = spec;
      return chain;
    },
    lean() {
      capture.lean = true;
      return Promise.resolve(typeof rowsFactory === 'function' ? rowsFactory(capture) : rowsFactory);
    },
    then(resolve, reject) {
      return chain.lean().then(resolve, reject);
    },
  };
  return chain;
};

function createHarness({
  events = [],
  songs = [],
  ranked = null,
  failEvents = false,
  failSongs = false,
  malformedEvents = false,
  now = NOW,
  engine = null,
} = {}) {
  const eventCalls = [];
  const songCalls = [];
  const engineCalls = [];
  let nowCalls = 0;

  const ListeningEventModel = {
    find(filter) {
      const capture = { filter, name: 'events' };
      eventCalls.push(capture);
      if (failEvents === true || failEvents === 'events') {
        throw new Error('secret-marker mongodb://raw-event-db');
      }
      return createQueryChain(capture, () => {
        if (malformedEvents) return {};
        let rows = [...events];
        rows.sort((a, b) => (
          (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          || String(a._id).localeCompare(String(b._id))
        ));
        if (typeof capture.limit === 'number') rows = rows.slice(0, capture.limit);
        return rows;
      });
    },
  };

  const SongModel = {
    find(filter) {
      const capture = { filter, name: 'songs' };
      songCalls.push(capture);
      if (failSongs === true || failSongs === 'songs') {
        throw new Error('secret-marker mongodb://raw-song-db');
      }
      return createQueryChain(capture, () => {
        if (!Array.isArray(songs)) return songs;
        const wanted = filter?._id?.$in || [];
        const wantedSet = new Set(wanted.map((value) => String(value).toLowerCase()));
        return songs.filter((song) => wantedSet.has(String(song._id).toLowerCase()));
      });
    },
  };

  const scoreImpl = (rows, options) => {
    engineCalls.push({ rows, options });
    if (engine) return engine(rows, options);
    if (ranked !== null) return ranked;
    return scoreTrendingSongs(rows, options);
  };

  const service = createTrendingService({
    ListeningEventModel,
    SongModel,
    scoreTrendingSongs: scoreImpl,
    now: () => {
      nowCalls += 1;
      return now;
    },
  });

  return {
    service,
    eventCalls,
    songCalls,
    engineCalls,
    getNowCalls: () => nowCalls,
  };
}

const run = (harness, limit = 10) => harness.service.getTrendingSongs({ limit });

test('1: window until equals injected now', async () => {
  const harness = createHarness({ events: [] });
  await run(harness);
  assert.equal(harness.eventCalls[0].filter.createdAt.$lte.getTime(), NOW.getTime());
});

test('2: window since equals now minus 168 hours', async () => {
  const harness = createHarness({ events: [] });
  await run(harness);
  const expected = NOW.getTime() - TRENDING_WINDOW_HOURS * HOUR_MS;
  assert.equal(TRENDING_WINDOW_HOURS, 168);
  assert.equal(harness.eventCalls[0].filter.createdAt.$gte.getTime(), expected);
});

test('3: event filter uses only createdAt bounds (no user/client_occurred_at)', async () => {
  const harness = createHarness({ events: [] });
  await run(harness);
  const filter = harness.eventCalls[0].filter;
  assert.deepEqual(Object.keys(filter), ['createdAt']);
  assert.deepEqual(Object.keys(filter.createdAt).sort(), ['$gte', '$lte']);
  assert.equal('client_occurred_at' in filter, false);
  assert.equal('user' in filter, false);
  assert.equal('song' in filter, false);
});

test('4: event sort is createdAt desc then _id desc', async () => {
  const harness = createHarness({ events: [] });
  await run(harness);
  assert.deepEqual(harness.eventCalls[0].sort, { createdAt: -1, _id: -1 });
});

test('5: event lookahead limit is MAX+1', async () => {
  const harness = createHarness({ events: [] });
  await run(harness);
  assert.equal(harness.eventCalls[0].limit, MAX_TRENDING_EVENT_INPUTS + 1);
  assert.equal(harness.eventCalls[0].limit, 50001);
});

test('6: event projection is the six bounded fields', async () => {
  const harness = createHarness({ events: [] });
  await run(harness);
  const fields = harness.eventCalls[0].select.split(/\s+/).filter(Boolean);
  assert.deepEqual(fields.sort(), [
    '_id', 'createdAt', 'event_type', 'listened_seconds_delta', 'song', 'user',
  ].sort());
  assert.equal(fields.includes('session_id'), false);
  assert.equal(fields.includes('event_id'), false);
  assert.equal(fields.includes('position_seconds'), false);
  assert.equal(fields.includes('client_occurred_at'), false);
});

test('7: single event query per request', async () => {
  const harness = createHarness({ events: [eventRow()] });
  await run(harness);
  assert.equal(harness.eventCalls.length, 1);
});

test('8: exactly 50000 retained rows are not truncated', async () => {
  const events = Array.from({ length: MAX_TRENDING_EVENT_INPUTS }, (_, i) => eventRow({
    _id: id(0x2000 + i),
    createdAt: new Date(NOW.getTime() - i * 1000),
    user: id(0x10000 + (i % 50)),
    song: id(1 + (i % 5)),
  }));
  const harness = createHarness({ events, ranked: [] });
  const result = await run(harness);
  assert.equal(result.meta.event_count, MAX_TRENDING_EVENT_INPUTS);
  assert.equal(result.meta.event_input_truncated, false);
});

test('9: 50001th row triggers truncation and drops the oldest lookahead row', async () => {
  const newest = eventRow({ _id: id(0x9000), createdAt: NOW, song: SONG_1 });
  const oldest = eventRow({
    _id: id(0x9001),
    createdAt: new Date(NOW.getTime() - 999999),
    song: SONG_3,
  });
  const middle = Array.from({ length: MAX_TRENDING_EVENT_INPUTS - 1 }, (_, i) => eventRow({
    _id: id(0x10000 + i),
    createdAt: new Date(NOW.getTime() - 1000 - i),
    song: SONG_2,
  }));
  const events = [newest, ...middle, oldest];
  assert.equal(events.length, MAX_TRENDING_EVENT_INPUTS + 1);

  let received = null;
  const harness = createHarness({
    events,
    engine: (rows) => {
      received = rows;
      return [];
    },
  });
  const result = await run(harness);

  assert.equal(result.meta.event_input_truncated, true);
  assert.equal(result.meta.event_count, MAX_TRENDING_EVENT_INPUTS);
  assert.equal(received.length, MAX_TRENDING_EVENT_INPUTS);
  assert.equal(received.some((row) => String(row._id) === String(oldest._id)), false);
  assert.equal(received[0]._id, newest._id);
});

test('10: truncated meta flag false when under cap', async () => {
  const harness = createHarness({ events: [eventRow()], ranked: [] });
  const result = await run(harness);
  assert.equal(result.meta.event_input_truncated, false);
  assert.equal(result.meta.event_count, 1);
});

test('11: engine receives retained events only (never 50001)', async () => {
  const events = Array.from({ length: MAX_TRENDING_EVENT_INPUTS + 1 }, (_, i) => eventRow({
    _id: id(0x30000 + i),
    createdAt: new Date(NOW.getTime() - i),
    song: id(1 + (i % 7)),
    user: id(0x20000 + (i % 40)),
  }));
  let receivedLength = null;
  const harness = createHarness({
    events,
    engine: (rows) => {
      receivedLength = rows.length;
      return [];
    },
  });
  await run(harness);
  assert.equal(receivedLength, MAX_TRENDING_EVENT_INPUTS);
});

test('12: engine called exactly once when events exist', async () => {
  const harness = createHarness({
    events: [eventRow()],
    engine: () => [],
  });
  await run(harness);
  assert.equal(harness.engineCalls.length, 1);
});

test('13: engine is invoked with injected now and MAX_TRENDING_LIMIT', async () => {
  const harness = createHarness({
    events: [eventRow()],
    engine: () => [],
  });
  await run(harness);
  assert.equal(harness.engineCalls.length, 1);
  assert.equal(harness.engineCalls[0].options.now.getTime(), NOW.getTime());
  assert.equal(harness.engineCalls[0].options.limit, MAX_TRENDING_LIMIT);
  assert.equal(harness.engineCalls[0].options.limit, 100);
  assert.equal(harness.engineCalls[0].rows.length, 1);
  assert.equal(harness.getNowCalls(), 1);
});

test('14: empty events skip engine and Song query', async () => {
  const harness = createHarness({ events: [], ranked: [rankRow(SONG_1)] });
  const result = await run(harness);
  assert.deepEqual(result.items, []);
  assert.equal(harness.engineCalls.length, 0);
  assert.equal(harness.songCalls.length, 0);
  assert.equal(result.meta.event_count, 0);
  assert.equal(result.meta.candidate_count, 0);
});

test('15: empty engine ranking skips Song query and returns empty items', async () => {
  const harness = createHarness({ events: [eventRow()], ranked: [] });
  const result = await run(harness);
  assert.deepEqual(result.items, []);
  assert.equal(harness.songCalls.length, 0);
  assert.equal(result.meta.candidate_count, 0);
  assert.equal(result.meta.event_count, 1);
});

test('16: eligible ranked songs are fetched with one $in query', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2), rankRow(SONG_3)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), songDoc({ _id: SONG_3 })],
  });
  await run(harness);
  assert.equal(harness.songCalls.length, 1);
  assert.deepEqual(harness.songCalls[0].filter._id.$in, [SONG_1, SONG_2, SONG_3]);
});

test('17: Song projection includes select:false metadata fields', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc()],
  });
  await run(harness);
  const fields = harness.songCalls[0].select.split(/\s+/).filter(Boolean);
  for (const required of [
    '_id', 'title', 'artist', 'genre', 'youtube_id', 'file_path', 'poster_url',
    'duration', 'duration_seconds', 'release_date', 'language', 'category',
    'recommendation_eligible',
  ]) {
    assert.ok(fields.includes(required), required);
  }
  assert.equal(fields.includes('lyrics'), false);
  assert.equal(fields.includes('chords'), false);
  assert.equal(fields.includes('description'), false);
  assert.equal(fields.includes('normalized_artist'), false);
});

test('18: missing Song document is omitted without throwing', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc({ _id: SONG_1 })],
  });
  const result = await run(harness);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, SONG_1);
});

test('19: recommendation_eligible false is excluded', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [
      songDoc({ recommendation_eligible: false }),
      songDoc({ _id: SONG_2, recommendation_eligible: true }),
    ],
  });
  const result = await run(harness);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, SONG_2);
});

test('20: legacy missing recommendation_eligible is treated eligible', async () => {
  const doc = songDoc();
  delete doc.recommendation_eligible;
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [doc],
  });
  const result = await run(harness);
  assert.equal(result.items.length, 1);
});

test('21: playable when youtube_id present even if file_path empty', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: 'abc', file_path: '' })],
  });
  assert.equal((await run(harness)).items.length, 1);
});

test('22: playable when file_path present even if youtube_id empty', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: '', file_path: 'assets/songs/x.mp3' })],
  });
  assert.equal((await run(harness)).items.length, 1);
});

test('23: unplayable song without youtube_id and file_path is excluded', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: '', file_path: '' })],
  });
  const result = await run(harness);
  assert.deepEqual(result.items, []);
  assert.equal(result.meta.returned_count, 0);
  assert.equal(result.meta.candidate_count, 1);
});

test('24: whitespace-only playability fields are not playable', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: '   ', file_path: '\t' })],
  });
  assert.equal((await run(harness)).items.length, 0);
});

test('25: missing title excludes song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ title: '' })],
  });
  assert.equal((await run(harness)).items.length, 0);
});

test('26: whitespace title excludes song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ title: '   ' })],
  });
  assert.equal((await run(harness)).items.length, 0);
});

test('27: missing artist excludes song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ artist: '' })],
  });
  assert.equal((await run(harness)).items.length, 0);
});

test('28: whitespace artist excludes song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ artist: '  ' })],
  });
  assert.equal((await run(harness)).items.length, 0);
});

test('29: engine rank order is preserved regardless of Mongo return order', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_3, { score: 3 }), rankRow(SONG_1, { score: 2 }), rankRow(SONG_2, { score: 1 })],
    songs: [
      songDoc({ _id: SONG_1 }),
      songDoc({ _id: SONG_2 }),
      songDoc({ _id: SONG_3 }),
    ],
  });
  const result = await run(harness);
  assert.deepEqual(result.items.map((item) => item.song._id), [SONG_3, SONG_1, SONG_2]);
  assert.deepEqual(result.items.map((item) => item.score), [3, 2, 1]);
});

test('30: ranks renumber 1..N after filtering with no gaps', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [
      rankRow(SONG_1, { score: 9 }),
      rankRow(SONG_2, { score: 8 }),
      rankRow(SONG_3, { score: 7 }),
    ],
    songs: [
      songDoc({ _id: SONG_1, youtube_id: '', file_path: '' }),
      songDoc({ _id: SONG_2 }),
      songDoc({ _id: SONG_3 }),
    ],
  });
  const result = await run(harness);
  assert.deepEqual(result.items.map((item) => item.rank), [1, 2]);
  assert.deepEqual(result.items.map((item) => item.song._id), [SONG_2, SONG_3]);
});

test('31: public limit applied after filtering', async () => {
  const ranked = [
    rankRow(SONG_1, { score: 9 }),
    rankRow(id(4), { score: 8 }),
    rankRow(id(5), { score: 7 }),
    rankRow(id(6), { score: 6 }),
  ];
  const songs = [
    songDoc({ _id: SONG_1 }),
    songDoc({ _id: id(4), youtube_id: '', file_path: '' }),
    songDoc({ _id: id(5), youtube_id: '', file_path: '' }),
    songDoc({ _id: id(6) }),
  ];
  const harness = createHarness({ events: [eventRow()], ranked, songs });
  const result = await run(harness, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, SONG_1);
  assert.equal(result.meta.returned_count, 1);
  assert.equal(result.meta.requested_limit, 1);
});

test('32: public limit 50 returns up to 50 eligible songs', async () => {
  const ranked = Array.from({ length: 60 }, (_, i) => rankRow(id(100 + i), { score: 100 - i }));
  const songs = Array.from({ length: 60 }, (_, i) => songDoc({ _id: id(100 + i) }));
  const harness = createHarness({ events: [eventRow()], ranked, songs });
  const result = await run(harness, 50);
  assert.equal(result.items.length, 50);
  assert.equal(result.meta.requested_limit, 50);
  assert.equal(result.meta.returned_count, 50);
  assert.equal(result.items[49].rank, 50);
});

test('33: public limit larger than eligible count returns all eligible', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 })],
  });
  const result = await run(harness, 50);
  assert.equal(result.items.length, 2);
  assert.equal(result.meta.returned_count, 2);
});

test('34: item shape has rank, score, activity, and song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc()],
  });
  const result = await run(harness);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.deepEqual(Object.keys(item).sort(), ['activity', 'rank', 'score', 'song']);
  assert.equal(item.rank, 1);
  assert.equal(typeof item.score, 'number');
});

test('35: activity block exposes the seven bounded counters/timestamp', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1, {
      unique_listener_count: 4,
      play_started_count: 5,
      completed_count: 6,
      replay_started_count: 7,
      skipped_count: 8,
      listened_seconds: 90,
      last_activity_at: '2026-09-14T00:00:00.000Z',
    })],
    songs: [songDoc()],
  });
  const { activity } = (await run(harness)).items[0];
  assert.deepEqual(Object.keys(activity).sort(), [
    'completed_count', 'last_activity_at', 'listened_seconds', 'play_started_count',
    'replay_started_count', 'skipped_count', 'unique_listener_count',
  ]);
  assert.equal(activity.unique_listener_count, 4);
  assert.equal(activity.play_started_count, 5);
  assert.equal(activity.completed_count, 6);
  assert.equal(activity.replay_started_count, 7);
  assert.equal(activity.skipped_count, 8);
  assert.equal(activity.listened_seconds, 90);
  assert.equal(activity.last_activity_at, '2026-09-14T00:00:00.000Z');
});

test('36: song block exposes the documented public fields only', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc()],
  });
  const { song } = (await run(harness)).items[0];
  assert.deepEqual(Object.keys(song).sort(), [
    '_id', 'artist', 'category', 'duration', 'duration_seconds', 'file_path',
    'genre', 'language', 'poster_url', 'release_date', 'title', 'youtube_id',
  ]);
  assert.equal(song._id, SONG_1);
  assert.equal(song.title, 'Title One');
  assert.equal(song.artist, 'Artist One');
  assert.equal(song.genre, 'Pop');
  assert.equal('recommendation_eligible' in song, false);
  assert.equal('lyrics' in song, false);
});

test('37: no user/session/event identifiers appear in service output', async () => {
  const harness = createHarness({
    events: [eventRow({ session_id: 'secret-session', event_id: 'secret-event' })],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc()],
  });
  const result = await run(harness);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(USER_A), false);
  assert.equal(serialized.includes('secret-session'), false);
  assert.equal(serialized.includes('secret-event'), false);
  assert.equal(serialized.includes('session_id'), false);
  assert.equal(serialized.includes('event_id'), false);
  assert.equal(serialized.includes('@'), false);
  assert.equal(serialized.includes('token'), false);
});

test('38: empty result after filtering is HTTP-ready empty list, not an error', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: '', file_path: '', title: '' })],
  });
  const result = await run(harness);
  assert.deepEqual(result.items, []);
  assert.equal(result.meta.returned_count, 0);
  assert.equal(result.meta.candidate_count, 1);
});

test('39: meta.window_hours is 168', async () => {
  const harness = createHarness({ events: [eventRow()], ranked: [] });
  const result = await run(harness, 7);
  assert.equal(result.meta.window_hours, 168);
  assert.equal(result.meta.window_hours, TRENDING_WINDOW_HOURS);
});

test('40: meta.requested_limit echoes the public limit', async () => {
  const harness = createHarness({ events: [eventRow()], ranked: [] });
  const result = await run(harness, 3);
  assert.equal(result.meta.requested_limit, 3);
});

test('41: meta.returned_count equals items length', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 })],
  });
  const result = await run(harness, 1);
  assert.equal(result.meta.returned_count, result.items.length);
  assert.equal(result.meta.returned_count, 1);
});

test('42: meta.event_count is retained rows passed toward scoring', async () => {
  const harness = createHarness({
    events: [eventRow(), eventRow({ _id: id(0x1001), createdAt: new Date(NOW.getTime() - 1000) })],
    ranked: [],
  });
  const result = await run(harness);
  assert.equal(result.meta.event_count, 2);
});

test('43: meta.event_input_truncated reflects overflow', async () => {
  const under = createHarness({ events: [eventRow()], ranked: [] });
  assert.equal((await run(under)).meta.event_input_truncated, false);

  const events = Array.from({ length: MAX_TRENDING_EVENT_INPUTS + 1 }, (_, i) => eventRow({
    _id: id(0x40000 + i),
    createdAt: new Date(NOW.getTime() - i),
  }));
  const over = createHarness({ events, ranked: [] });
  assert.equal((await run(over)).meta.event_input_truncated, true);
});

test('44: meta.candidate_count is engine ranking length before public limit', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2), rankRow(SONG_3)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), songDoc({ _id: SONG_3 })],
  });
  const result = await run(harness, 2);
  assert.equal(result.meta.candidate_count, 3);
  assert.equal(result.items.length, 2);
});

test('45: service factory production defaults exist without arguments', async () => {
  const service = createTrendingService();
  assert.equal(typeof service.getTrendingSongs, 'function');
});

test('46: DB failure in event query throws fixed sanitized error', async () => {
  const harness = createHarness({ failEvents: true });
  await assert.rejects(() => run(harness), { message: TRENDING_SERVICE_ERROR });
});

test('47: DB failure in Song query throws fixed sanitized error', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    failSongs: true,
  });
  await assert.rejects(() => run(harness), { message: TRENDING_SERVICE_ERROR });
});

test('48: raw DB secret never escapes the thrown error message', async () => {
  const harness = createHarness({ failEvents: true });
  await assert.rejects(
    () => run(harness),
    (error) => {
      assert.equal(error.message, TRENDING_SERVICE_ERROR);
      assert.equal(error.message.includes('mongodb://'), false);
      assert.equal(error.message.includes('secret-marker'), false);
      return true;
    },
  );
});

test('49: engine throw is mapped to the fixed service error', async () => {
  const harness = createHarness({
    events: [eventRow()],
    engine: () => {
      throw new Error('boom-secret-internal-detail');
    },
  });
  await assert.rejects(() => run(harness), { message: TRENDING_SERVICE_ERROR });
});

test('50: malformed event query result throws fixed service error', async () => {
  const harness = createHarness({ malformedEvents: true, ranked: [] });
  await assert.rejects(() => run(harness), { message: TRENDING_SERVICE_ERROR });
});

test('51: real engine integration returns stable ranked items end-to-end', async () => {
  const events = [
    eventRow({ song: SONG_1, user: USER_A, event_type: 'play-started', listened_seconds_delta: 60, createdAt: NOW }),
    eventRow({ _id: id(0x1001), song: SONG_1, user: USER_B, event_type: 'completed', listened_seconds_delta: 120, createdAt: new Date(NOW.getTime() - HOUR_MS) }),
    eventRow({ _id: id(0x1002), song: SONG_2, user: USER_A, event_type: 'skipped', listened_seconds_delta: 0, createdAt: NOW }),
  ];
  const songs = [songDoc(), songDoc({ _id: SONG_2 })];
  const harness = createHarness({ events, songs, engine: null, ranked: null });
  // force real engine path by not short-circuiting ranked
  const realHarness = (() => {
    const eventCalls = [];
    const songCalls = [];
    const ListeningEventModel = {
      find(filter) {
        const capture = { filter };
        eventCalls.push(capture);
        return createQueryChain(capture, () => events);
      },
    };
    const SongModel = {
      find(filter) {
        const capture = { filter };
        songCalls.push(capture);
        return createQueryChain(capture, () => songs);
      },
    };
    return {
      eventCalls,
      songCalls,
      service: createTrendingService({
        ListeningEventModel,
        SongModel,
        scoreTrendingSongs,
        now: () => NOW,
      }),
    };
  })();

  const first = await realHarness.service.getTrendingSongs({ limit: 10 });
  const second = await realHarness.service.getTrendingSongs({ limit: 10 });
  assert.deepEqual(first, second);
  assert.ok(first.items.length >= 1);
  assert.equal(first.items[0].song._id, SONG_1);
  assert.equal(first.items[0].rank, 1);
  assert.equal(first.meta.window_hours, 168);
  assert.equal(realHarness.eventCalls.length, 2);
  assert.equal(realHarness.songCalls.length, 2);
});

test('52: identical inputs and injected clock produce deep-equal outputs', async () => {
  const build = () => createHarness({
    events: [
      eventRow({ song: SONG_1, user: USER_A }),
      eventRow({ _id: id(0x1001), song: SONG_2, user: USER_B, createdAt: new Date(NOW.getTime() - 5000) }),
    ],
    ranked: [rankRow(SONG_1, { score: 2.25 }), rankRow(SONG_2, { score: 1.25 })],
    songs: [songDoc(), songDoc({ _id: SONG_2 })],
  });
  const a = await build().service.getTrendingSongs({ limit: 10 });
  const b = await build().service.getTrendingSongs({ limit: 10 });
  assert.deepEqual(a, b);
});

test('53: score values from the engine are passed through unchanged', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1, { score: 3.141592 })],
    songs: [songDoc()],
  });
  const result = await run(harness);
  assert.equal(result.items[0].score, 3.141592);
});

test('54: genre is returned as persisted with no inference', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ genre: 'Bengali Folk' })],
  });
  const result = await run(harness);
  assert.equal(result.items[0].song.genre, 'Bengali Folk');
});

test('55: language, category, duration_seconds, release_date pass through', async () => {
  const release = new Date('2020-05-05T00:00:00.000Z');
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({
      language: 'Hindi',
      category: 'film',
      duration_seconds: 240,
      release_date: release,
    })],
  });
  const { song } = (await run(harness)).items[0];
  assert.equal(song.language, 'Hindi');
  assert.equal(song.category, 'film');
  assert.equal(song.duration_seconds, 240);
  assert.equal(new Date(song.release_date).getTime(), release.getTime());
});

test('56: no fallback songs are invented when ranking is empty', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [],
    songs: [songDoc(), songDoc({ _id: SONG_2 })],
  });
  const result = await run(harness);
  assert.deepEqual(result.items, []);
  assert.equal(harness.songCalls.length, 0);
});

test('57: no Favorite, Playlist, or user preference imports in service source', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(fileURLToPath(new URL('./trendingService.js', import.meta.url)), 'utf8');
  assert.equal(source.includes('Favorite'), false);
  assert.equal(source.includes('Playlist'), false);
  assert.equal(source.includes('userPreference'), false);
  assert.equal(source.includes('explicitPreference'), false);
  assert.equal(source.includes('adminOnly'), false);
  assert.equal(source.includes('python'), false);
});

test('58: service never reads environment or performs network/filesystem work', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(fileURLToPath(new URL('./trendingService.js', import.meta.url)), 'utf8');
  assert.equal(source.includes('process.env'), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('http.'), false);
  assert.equal(source.includes('readFile'), false);
  assert.equal(source.includes('axios'), false);
});

test('59: engine is called with the same now instance used for the query window', async () => {
  const fixedNow = new Date('2026-09-20T00:00:00.000Z');
  let engineNow = null;
  let windowUntil = null;
  let engineCalls = 0;
  const harness = {
    service: createTrendingService({
      ListeningEventModel: {
        find(filter) {
          windowUntil = filter.createdAt.$lte;
          return createQueryChain({}, () => [eventRow()]);
        },
      },
      SongModel: { find: () => createQueryChain({}, () => [songDoc()]) },
      scoreTrendingSongs: (rows, options) => {
        engineCalls += 1;
        engineNow = options.now;
        return [rankRow(SONG_1)];
      },
      now: () => fixedNow,
    }),
  };
  await harness.service.getTrendingSongs({ limit: 10 });
  assert.equal(engineCalls, 1);
  assert.ok(windowUntil);
  assert.ok(engineNow);
  assert.equal(windowUntil.getTime(), fixedNow.getTime());
  assert.equal(engineNow.getTime(), fixedNow.getTime());
});

test('60: now is read once per request', async () => {
  let calls = 0;
  const service = createTrendingService({
    ListeningEventModel: { find: () => createQueryChain({}, () => []) },
    SongModel: { find: () => createQueryChain({}, () => []) },
    scoreTrendingSongs: () => [],
    now: () => {
      calls += 1;
      return NOW;
    },
  });
  await service.getTrendingSongs({ limit: 10 });
  assert.equal(calls, 1);
});

test('61: limit bounds use integer public values only (1 and 50)', async () => {
  const ranked = Array.from({ length: 5 }, (_, i) => rankRow(id(200 + i), { score: 10 - i }));
  const songs = ranked.map((row) => songDoc({ _id: row.song_id }));
  const harness = createHarness({ events: [eventRow()], ranked, songs });
  const one = await run(harness, 1);
  assert.equal(one.items.length, 1);
  const fifty = await run(harness, 50);
  assert.equal(fifty.items.length, 5);
});

test('62: engine receives MAX_TRENDING_LIMIT candidate pool, not public limit', async () => {
  const harness = createHarness({ events: [eventRow()], ranked: [] });
  await run(harness, 3);
  assert.equal(harness.engineCalls[0].options.limit, MAX_TRENDING_LIMIT);
  assert.equal(harness.engineCalls[0].options.limit, 100);
});

test('63: song lookup uses unique ids only', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_1)],
    songs: [songDoc()],
  });
  await run(harness);
  const ids = harness.songCalls[0].filter._id.$in;
  assert.equal(harness.songCalls.length, 1);
  assert.equal(ids.length, 1);
  assert.deepEqual(ids, [SONG_1]);
});

test('64: ObjectId-like song ids from engine match Song documents', async () => {
  const objectIdLike = {
    toHexString: () => SONG_1.toUpperCase(),
  };
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(objectIdLike)],
    songs: [songDoc({ _id: SONG_1 })],
  });
  const result = await run(harness);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, SONG_1);
});

test('65: populated {_id} song references from engine are canonicalized', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow({ _id: SONG_1 })],
    songs: [songDoc()],
  });
  const result = await run(harness);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, SONG_1);
});

test('66: invalid now from clock throws fixed service error', async () => {
  const service = createTrendingService({
    ListeningEventModel: { find: () => createQueryChain({}, () => []) },
    SongModel: { find: () => createQueryChain({}, () => []) },
    scoreTrendingSongs: () => [],
    now: () => new Date('not-a-date'),
  });
  await assert.rejects(() => service.getTrendingSongs({ limit: 10 }), {
    message: TRENDING_SERVICE_ERROR,
  });
});

test('67: all filtered songs still returns 200-shaped empty payload with meta', async () => {
  const ranked = [rankRow(SONG_1), rankRow(SONG_2)];
  const harness = createHarness({
    events: [eventRow(), eventRow({ _id: id(0x1001) })],
    ranked,
    songs: [
      songDoc({ recommendation_eligible: false }),
      songDoc({ _id: SONG_2, youtube_id: '', file_path: '' }),
    ],
  });
  const result = await run(harness, 10);
  assert.deepEqual(result.items, []);
  assert.equal(result.meta.returned_count, 0);
  assert.equal(result.meta.candidate_count, 2);
  assert.equal(result.meta.event_count, 2);
  assert.equal(result.meta.event_input_truncated, false);
  assert.equal(result.meta.window_hours, 168);
  assert.equal(result.meta.requested_limit, 10);
});

test('68: multi-song pipeline preserves relative engine order through filter and limit', async () => {
  const ranked = [
    rankRow(id(10), { score: 10 }),
    rankRow(id(11), { score: 9 }),
    rankRow(id(12), { score: 8 }),
    rankRow(id(13), { score: 7 }),
    rankRow(id(14), { score: 6 }),
  ];
  const songs = [
    songDoc({ _id: id(10) }),
    songDoc({ _id: id(11), youtube_id: '', file_path: '' }),
    songDoc({ _id: id(12) }),
    songDoc({ _id: id(13) }),
    songDoc({ _id: id(14), recommendation_eligible: false }),
  ];
  const harness = createHarness({ events: [eventRow()], ranked, songs });
  const result = await run(harness, 2);
  assert.deepEqual(result.items.map((item) => item.song._id), [id(10), id(12)]);
  assert.deepEqual(result.items.map((item) => item.rank), [1, 2]);
  assert.deepEqual(result.items.map((item) => item.score), [10, 8]);
  assert.equal(result.meta.candidate_count, 5);
  assert.equal(result.meta.returned_count, 2);
});
