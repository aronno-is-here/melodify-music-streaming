import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTrendingService,
  TRENDING_SERVICE_ERROR,
  TRENDING_ITEM_BASIS,
  TRENDING_MODE,
  FALLBACK_CANDIDATE_MULTIPLIER,
  MAX_FALLBACK_CANDIDATES,
  MAX_FALLBACK_EXCLUSIONS,
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
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
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

const isFallbackQuery = (filter, sort) =>
  Boolean(filter?._id?.$nin) || (sort && sort._id === 1);

function createHarness({
  events = [],
  songs = [],
  ranked = null,
  failEvents = false,
  failSongs = false,
  failFallbackSongs = false,
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
      const fallback = isFallbackQuery(filter, undefined);
      // sort/limit applied later via chain; classify on $nin vs $in at lean time
      if (failSongs === true || failSongs === 'songs') {
        throw new Error('secret-marker mongodb://raw-song-db');
      }
      return createQueryChain(capture, () => {
        const isFallback = isFallbackQuery(capture.filter, capture.sort)
          || (!capture.filter?._id?.$in && capture.sort?._id === 1);
        if (failFallbackSongs && isFallback) {
          throw new Error('secret-marker mongodb://raw-fallback-db');
        }
        if (!Array.isArray(songs)) return songs;
        let rows = [...songs];
        if (capture.filter?._id?.$in) {
          const wantedSet = new Set(
            capture.filter._id.$in.map((value) => String(value).toLowerCase()),
          );
          rows = rows.filter((song) => wantedSet.has(String(song._id).toLowerCase()));
        }
        if (capture.filter?._id?.$nin) {
          const excluded = new Set(
            capture.filter._id.$nin.map((value) => String(value).toLowerCase()),
          );
          rows = rows.filter((song) => !excluded.has(String(song._id).toLowerCase()));
        }
        if (capture.sort) {
          const createdAtDir = capture.sort.createdAt;
          const idDir = capture.sort._id;
          rows.sort((a, b) => {
            const at = new Date(a.createdAt ?? 0).getTime() || 0;
            const bt = new Date(b.createdAt ?? 0).getTime() || 0;
            if (createdAtDir === -1 && bt !== at) return bt - at;
            if (createdAtDir === 1 && at !== bt) return at - bt;
            const cmp = String(a._id).localeCompare(String(b._id));
            if (idDir === -1) return -cmp;
            if (idDir === 1) return cmp;
            return 0;
          });
        }
        if (typeof capture.limit === 'number') rows = rows.slice(0, capture.limit);
        return rows;
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

  const classifySongCalls = () => {
    const rankedQueries = songCalls.filter((c) => c.filter?._id?.$in);
    const fallbackQueries = songCalls.filter(
      (c) => !c.filter?._id?.$in && (c.filter?._id?.$nin || c.sort?._id === 1 || Object.keys(c.filter || {}).length === 0),
    );
    return { rankedQueries, fallbackQueries, total: songCalls.length };
  };

  return {
    service,
    eventCalls,
    songCalls,
    engineCalls,
    getNowCalls: () => nowCalls,
    classifySongCalls,
  };
}

const run = (harness, limit = 10) => harness.service.getTrendingSongs({ limit });

const catalogSongs = (count, start = 0x50) =>
  Array.from({ length: count }, (_, i) => songDoc({
    _id: id(start + i),
    title: `Catalog ${i}`,
    artist: `Artist ${i}`,
    youtube_id: `yt${start + i}`,
    createdAt: new Date(NOW.getTime() - i * 1000),
  }));

// ---------------------------------------------------------------------------
// Existing window / event / engine pipeline (20/43 regressions)
// ---------------------------------------------------------------------------

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

test('14: empty events skip engine but run fallback Song query', async () => {
  const harness = createHarness({ events: [], ranked: [rankRow(SONG_1)] });
  const result = await run(harness);
  assert.equal(harness.engineCalls.length, 0);
  assert.equal(result.meta.event_count, 0);
  assert.equal(result.meta.candidate_count, 0);
  const { rankedQueries, fallbackQueries } = harness.classifySongCalls();
  assert.equal(rankedQueries.length, 0);
  assert.equal(fallbackQueries.length, 1);
});

test('15: empty engine ranking skips ranked Song query and runs fallback', async () => {
  const harness = createHarness({ events: [eventRow()], ranked: [] });
  const result = await run(harness);
  assert.equal(result.meta.candidate_count, 0);
  assert.equal(result.meta.event_count, 1);
  const { rankedQueries, fallbackQueries } = harness.classifySongCalls();
  assert.equal(rankedQueries.length, 0);
  assert.equal(fallbackQueries.length, 1);
});

test('16: eligible ranked songs are fetched with one $in query', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2), rankRow(SONG_3)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), songDoc({ _id: SONG_3 })],
  });
  await run(harness, 3);
  const { rankedQueries } = harness.classifySongCalls();
  assert.equal(rankedQueries.length, 1);
  assert.deepEqual(rankedQueries[0].filter._id.$in, [SONG_1, SONG_2, SONG_3]);
});

test('17: Song projection includes select:false metadata fields', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc()],
  });
  await run(harness, 1);
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
  const result = await run(harness, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, SONG_1);
});

test('19: recommendation_eligible false is excluded from activity', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [
      songDoc({ recommendation_eligible: false }),
      songDoc({ _id: SONG_2, recommendation_eligible: true }),
    ],
  });
  const result = await run(harness, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, SONG_2);
  assert.equal(result.items[0].basis, TRENDING_ITEM_BASIS.ACTIVITY);
});

test('20: legacy missing recommendation_eligible is treated eligible', async () => {
  const doc = songDoc();
  delete doc.recommendation_eligible;
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [doc],
  });
  const result = await run(harness, 1);
  assert.equal(result.items.length, 1);
});

test('21: playable when youtube_id present even if file_path empty', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: 'abc', file_path: '' })],
  });
  assert.equal((await run(harness, 1)).items.length, 1);
});

test('22: playable when file_path present even if youtube_id empty', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: '', file_path: 'assets/songs/x.mp3' })],
  });
  assert.equal((await run(harness, 1)).items.length, 1);
});

test('23: unplayable song without youtube_id and file_path is excluded from activity', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: '', file_path: '' })],
  });
  const result = await run(harness, 1);
  assert.equal(result.meta.returned_count, 0);
  assert.equal(result.meta.candidate_count, 1);
  assert.equal(result.meta.activity_count, 0);
});

test('24: whitespace-only playability fields are not playable', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: '   ', file_path: '\t' })],
  });
  assert.equal((await run(harness, 1)).items.length, 0);
});

test('25: missing title excludes activity song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ title: '' })],
  });
  assert.equal((await run(harness, 1)).items.length, 0);
});

test('26: whitespace title excludes activity song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ title: '   ' })],
  });
  assert.equal((await run(harness, 1)).items.length, 0);
});

test('27: missing artist excludes activity song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ artist: '' })],
  });
  assert.equal((await run(harness, 1)).items.length, 0);
});

test('28: whitespace artist excludes activity song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ artist: '  ' })],
  });
  assert.equal((await run(harness, 1)).items.length, 0);
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
  const result = await run(harness, 3);
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
  const result = await run(harness, 2);
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
  assert.equal(result.meta.fallback_count, 0);
});

test('33: public limit larger than eligible activity returns activity plus fallback', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), ...catalogSongs(5)],
  });
  const result = await run(harness, 50);
  assert.ok(result.items.length >= 2);
  assert.equal(result.meta.returned_count, result.items.length);
  assert.ok(result.meta.activity_count >= 2);
});

test('34: item shape has rank, basis, score, activity, and song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc()],
  });
  const result = await run(harness, 1);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.deepEqual(
    Object.keys(item).sort(),
    ['activity', 'basis', 'rank', 'score', 'song'],
  );
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
  const { activity } = (await run(harness, 1)).items[0];
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
  const { song } = (await run(harness, 1)).items[0];
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
  assert.equal('createdAt' in song, false);
});

test('37: no user/session/event identifiers appear in service output', async () => {
  const harness = createHarness({
    events: [eventRow({ session_id: 'secret-session', event_id: 'secret-event' })],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc()],
  });
  const result = await run(harness, 1);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(USER_A), false);
  assert.equal(serialized.includes('secret-session'), false);
  assert.equal(serialized.includes('secret-event'), false);
  assert.equal(serialized.includes('session_id'), false);
  assert.equal(serialized.includes('event_id'), false);
  assert.equal(serialized.includes('@'), false);
  assert.equal(serialized.includes('token'), false);
});

test('38: empty activity plus empty catalog is HTTP-ready empty list', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ youtube_id: '', file_path: '', title: '' })],
  });
  const result = await run(harness, 1);
  assert.deepEqual(result.items, []);
  assert.equal(result.meta.returned_count, 0);
  assert.equal(result.meta.candidate_count, 1);
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
  assert.equal(result.meta.activity_count, 0);
  assert.equal(result.meta.fallback_count, 0);
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
  const result = await run(harness, 2);
  assert.equal(result.meta.returned_count, result.items.length);
  assert.equal(result.meta.returned_count, 2);
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
  const result = await run(harness, 3);
  assert.equal(result.meta.candidate_count, 3);
  assert.equal(result.items.length, 3);
});

test('45: service factory production defaults exist without arguments', async () => {
  const service = createTrendingService();
  assert.equal(typeof service.getTrendingSongs, 'function');
});

test('46: DB failure in event query throws fixed sanitized error', async () => {
  const harness = createHarness({ failEvents: true });
  await assert.rejects(() => run(harness), { message: TRENDING_SERVICE_ERROR });
});

test('47: DB failure in ranked Song query throws fixed sanitized error', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    failSongs: true,
  });
  await assert.rejects(() => run(harness, 1), { message: TRENDING_SERVICE_ERROR });
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
      return createQueryChain(capture, () => {
        if (filter?._id?.$in) {
          const wanted = new Set(filter._id.$in.map((v) => String(v).toLowerCase()));
          return songs.filter((s) => wanted.has(String(s._id).toLowerCase()));
        }
        let rows = [...songs];
        if (filter?._id?.$nin) {
          const excluded = new Set(filter._id.$nin.map((v) => String(v).toLowerCase()));
          rows = rows.filter((s) => !excluded.has(String(s._id).toLowerCase()));
        }
        return rows;
      });
    },
  };
  const service = createTrendingService({
    ListeningEventModel,
    SongModel,
    scoreTrendingSongs,
    now: () => NOW,
  });

  const first = await service.getTrendingSongs({ limit: 2 });
  const second = await service.getTrendingSongs({ limit: 2 });
  assert.deepEqual(first, second);
  assert.ok(first.items.length >= 1);
  assert.equal(first.items[0].song._id, SONG_1);
  assert.equal(first.items[0].rank, 1);
  assert.equal(first.items[0].basis, TRENDING_ITEM_BASIS.ACTIVITY);
  assert.equal(first.meta.window_hours, 168);
  assert.equal(eventCalls.length, 2);
});

test('52: identical inputs and injected clock produce deep-equal outputs', async () => {
  const build = () => createHarness({
    events: [
      eventRow({ song: SONG_1, user: USER_A }),
      eventRow({ _id: id(0x1001), song: SONG_2, user: USER_B, createdAt: new Date(NOW.getTime() - 5000) }),
    ],
    ranked: [rankRow(SONG_1, { score: 2.25 }), rankRow(SONG_2, { score: 1.25 })],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), ...catalogSongs(4)],
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
  const result = await run(harness, 1);
  assert.equal(result.items[0].score, 3.141592);
});

test('54: genre is returned as persisted with no inference', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ genre: 'Bengali Folk' })],
  });
  const result = await run(harness, 1);
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
  const { song } = (await run(harness, 1)).items[0];
  assert.equal(song.language, 'Hindi');
  assert.equal(song.category, 'film');
  assert.equal(song.duration_seconds, 240);
  assert.equal(new Date(song.release_date).getTime(), release.getTime());
});

test('56: empty ranking tops up from catalog rather than inventing activity scores', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [],
    songs: [songDoc(), songDoc({ _id: SONG_2 })],
  });
  const result = await run(harness, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.meta.activity_count, 0);
  assert.equal(result.meta.fallback_count, 2);
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
  assert.equal(result.items[0].score, null);
  assert.equal(result.items[0].basis, TRENDING_ITEM_BASIS.CATALOG_FALLBACK);
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
  assert.equal(source.includes('Math.random'), false);
  assert.equal(source.includes('$sample'), false);
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
  await harness.service.getTrendingSongs({ limit: 1 });
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
  assert.equal(fifty.meta.fallback_count, 0);
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
  await run(harness, 1);
  const { rankedQueries } = harness.classifySongCalls();
  const ids = rankedQueries[0].filter._id.$in;
  assert.equal(rankedQueries.length, 1);
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
  const result = await run(harness, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].song._id, SONG_1);
});

test('65: populated {_id} song references from engine are canonicalized', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow({ _id: SONG_1 })],
    songs: [songDoc()],
  });
  const result = await run(harness, 1);
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

test('67: all activity filtered still returns shaped payload with fallback meta', async () => {
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
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
  assert.equal(result.meta.activity_count, 0);
  assert.equal(result.meta.fallback_count, 0);
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

// ---------------------------------------------------------------------------
// 21/43 — catalog fallback and ranking hardening
// ---------------------------------------------------------------------------

test('69: full activity satisfaction skips fallback query', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2), rankRow(SONG_3)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), songDoc({ _id: SONG_3 }), ...catalogSongs(5)],
  });
  const result = await run(harness, 3);
  assert.equal(result.meta.activity_count, 3);
  assert.equal(result.meta.fallback_count, 0);
  assert.equal(result.meta.mode, TRENDING_MODE.ACTIVITY);
  const { fallbackQueries, rankedQueries } = harness.classifySongCalls();
  assert.equal(rankedQueries.length, 1);
  assert.equal(fallbackQueries.length, 0);
});

test('70: zero events triggers fallback', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(5) });
  const result = await run(harness, 3);
  assert.equal(result.meta.event_count, 0);
  assert.equal(result.meta.activity_count, 0);
  assert.equal(result.meta.fallback_count, 3);
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
  assert.equal(harness.engineCalls.length, 0);
  const { fallbackQueries } = harness.classifySongCalls();
  assert.equal(fallbackQueries.length, 1);
});

test('71: engine [] triggers fallback', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [],
    songs: catalogSongs(4),
  });
  const result = await run(harness, 2);
  assert.equal(result.meta.candidate_count, 0);
  assert.equal(result.meta.fallback_count, 2);
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
  const { rankedQueries, fallbackQueries } = harness.classifySongCalls();
  assert.equal(rankedQueries.length, 0);
  assert.equal(fallbackQueries.length, 1);
});

test('72: all activity Songs filtered triggers fallback', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [
      songDoc({ recommendation_eligible: false }),
      songDoc({ _id: SONG_2, youtube_id: '', file_path: '' }),
      ...catalogSongs(3),
    ],
  });
  const result = await run(harness, 3);
  assert.equal(result.meta.activity_count, 0);
  assert.equal(result.meta.fallback_count, 3);
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
  const { rankedQueries, fallbackQueries } = harness.classifySongCalls();
  assert.equal(rankedQueries.length, 1);
  assert.equal(fallbackQueries.length, 1);
});

test('73: partial activity triggers top-up', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2), rankRow(SONG_3), rankRow(id(4)), rankRow(id(5))],
    songs: [
      songDoc(),
      songDoc({ _id: SONG_2 }),
      songDoc({ _id: SONG_3, youtube_id: '', file_path: '' }),
      songDoc({ _id: id(4), recommendation_eligible: false }),
      songDoc({ _id: id(5), title: '' }),
      ...catalogSongs(6),
    ],
  });
  const result = await run(harness, 10);
  assert.equal(result.meta.activity_count, 2);
  assert.ok(result.meta.fallback_count >= 1);
  assert.equal(result.meta.mode, TRENDING_MODE.ACTIVITY_PLUS_FALLBACK);
  assert.ok(result.items.length <= 10);
});

test('74: exact activity limit does not top-up', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), ...catalogSongs(4)],
  });
  const result = await run(harness, 2);
  assert.equal(result.meta.activity_count, 2);
  assert.equal(result.meta.fallback_count, 0);
  assert.equal(result.meta.mode, TRENDING_MODE.ACTIVITY);
  assert.equal(harness.classifySongCalls().fallbackQueries.length, 0);
});

test('75: fallback filters recommendation_eligible false', async () => {
  const harness = createHarness({
    events: [],
    songs: [
      songDoc({ _id: id(0x60), recommendation_eligible: false, createdAt: new Date(NOW.getTime() - 100) }),
      songDoc({ _id: id(0x61), recommendation_eligible: true, createdAt: new Date(NOW.getTime() - 200) }),
    ],
  });
  const result = await run(harness, 5);
  assert.equal(result.meta.fallback_count, 1);
  assert.equal(result.items[0].song._id, id(0x61));
});

test('76: fallback accepts legacy undefined eligibility', async () => {
  const legacy = songDoc({ _id: id(0x62) });
  delete legacy.recommendation_eligible;
  const harness = createHarness({ events: [], songs: [legacy] });
  const result = await run(harness, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].basis, TRENDING_ITEM_BASIS.CATALOG_FALLBACK);
});

test('77: fallback filters blank title', async () => {
  const harness = createHarness({
    events: [],
    songs: [songDoc({ _id: id(0x63), title: '   ' }), songDoc({ _id: id(0x64), title: 'Ok' })],
  });
  const result = await run(harness, 5);
  assert.equal(result.meta.fallback_count, 1);
  assert.equal(result.items[0].song.title, 'Ok');
});

test('78: fallback filters blank artist', async () => {
  const harness = createHarness({
    events: [],
    songs: [songDoc({ _id: id(0x65), artist: '' }), songDoc({ _id: id(0x66), artist: 'Ok' })],
  });
  const result = await run(harness, 5);
  assert.equal(result.meta.fallback_count, 1);
  assert.equal(result.items[0].song.artist, 'Ok');
});

test('79: fallback filters missing playback source', async () => {
  const harness = createHarness({
    events: [],
    songs: [songDoc({ _id: id(0x67), youtube_id: '', file_path: '' })],
  });
  const result = await run(harness, 5);
  assert.equal(result.meta.fallback_count, 0);
  assert.deepEqual(result.items, []);
});

test('80: fallback accepts youtube_id', async () => {
  const harness = createHarness({
    events: [],
    songs: [songDoc({ _id: id(0x68), youtube_id: 'ytX', file_path: '' })],
  });
  const result = await run(harness, 1);
  assert.equal(result.items[0].song.youtube_id, 'ytX');
});

test('81: fallback accepts file_path', async () => {
  const harness = createHarness({
    events: [],
    songs: [songDoc({ _id: id(0x69), youtube_id: '', file_path: 'a.mp3' })],
  });
  const result = await run(harness, 1);
  assert.equal(result.items[0].song.file_path, 'a.mp3');
});

test('82: fallback sorted createdAt DESC', async () => {
  const harness = createHarness({
    events: [],
    songs: [
      songDoc({ _id: id(0x70), createdAt: new Date(NOW.getTime() - 3000) }),
      songDoc({ _id: id(0x71), createdAt: new Date(NOW.getTime() - 1000) }),
      songDoc({ _id: id(0x72), createdAt: new Date(NOW.getTime() - 2000) }),
    ],
  });
  const result = await run(harness, 3);
  assert.deepEqual(
    result.items.map((i) => i.song._id),
    [id(0x71), id(0x72), id(0x70)],
  );
  const fallbackCall = harness.classifySongCalls().fallbackQueries[0];
  assert.deepEqual(fallbackCall.sort, { createdAt: -1, _id: 1 });
});

test('83: _id ASC breaks equal-createdAt ties', async () => {
  const same = new Date(NOW.getTime() - 5000);
  const harness = createHarness({
    events: [],
    songs: [
      songDoc({ _id: id(0x74), createdAt: same }),
      songDoc({ _id: id(0x73), createdAt: same }),
      songDoc({ _id: id(0x75), createdAt: same }),
    ],
  });
  const result = await run(harness, 3);
  assert.deepEqual(
    result.items.map((i) => i.song._id),
    [id(0x73), id(0x74), id(0x75)],
  );
});

test('84: query excludes existing activity IDs via $nin', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ _id: SONG_1 }), ...catalogSongs(4)],
  });
  await run(harness, 3);
  const { fallbackQueries, rankedQueries } = harness.classifySongCalls();
  assert.equal(rankedQueries.length, 1);
  assert.equal(fallbackQueries.length, 1);
  assert.ok(Array.isArray(fallbackQueries[0].filter._id.$nin));
  assert.ok(fallbackQueries[0].filter._id.$nin.includes(SONG_1));
});

test('85: preferably excludes all ranked candidate IDs including filtered ones', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2), rankRow(SONG_3)],
    songs: [
      songDoc({ _id: SONG_1 }),
      songDoc({ _id: SONG_2, youtube_id: '', file_path: '' }),
      songDoc({ _id: SONG_3, recommendation_eligible: false }),
      ...catalogSongs(3),
    ],
  });
  await run(harness, 3);
  const fallbackCall = harness.classifySongCalls().fallbackQueries[0];
  assert.deepEqual(
    [...fallbackCall.filter._id.$nin].sort(),
    [SONG_1, SONG_2, SONG_3].sort(),
  );
});

test('86: fallback query uses bounded projection without createdAt exposure', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(2) });
  await run(harness, 1);
  const fallbackCall = harness.classifySongCalls().fallbackQueries[0];
  const fields = fallbackCall.select.split(/\s+/).filter(Boolean);
  assert.ok(fields.includes('title'));
  assert.ok(fields.includes('recommendation_eligible'));
  assert.equal(fields.includes('lyrics'), false);
  assert.equal(fields.includes('createdAt'), false);
  assert.equal(fallbackCall.limit <= MAX_FALLBACK_CANDIDATES, true);
});

test('87: only one fallback query maximum', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(20) });
  await run(harness, 10);
  assert.equal(harness.classifySongCalls().fallbackQueries.length, 1);
});

test('88: no pagination on fallback', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(10) });
  await run(harness, 5);
  assert.equal(harness.classifySongCalls().fallbackQueries.length, 1);
  assert.equal(harness.eventCalls.length, 1);
});

test('89: remaining 1 => candidate limit 3', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(10)],
  });
  await run(harness, 2);
  const fallbackCall = harness.classifySongCalls().fallbackQueries[0];
  assert.equal(fallbackCall.limit, 1 * FALLBACK_CANDIDATE_MULTIPLIER);
  assert.equal(fallbackCall.limit, 3);
});

test('90: remaining 10 => candidate limit 30', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(40) });
  await run(harness, 10);
  const fallbackCall = harness.classifySongCalls().fallbackQueries[0];
  assert.equal(fallbackCall.limit, 10 * FALLBACK_CANDIDATE_MULTIPLIER);
  assert.equal(fallbackCall.limit, 30);
});

test('91: remaining 50 => candidate cap 150', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(5) });
  await run(harness, 50);
  const fallbackCall = harness.classifySongCalls().fallbackQueries[0];
  assert.equal(fallbackCall.limit, MAX_FALLBACK_CANDIDATES);
  assert.equal(fallbackCall.limit, 150);
  assert.equal(fallbackCall.limit, Math.min(50 * FALLBACK_CANDIDATE_MULTIPLIER, MAX_FALLBACK_CANDIDATES));
});

test('92: candidate read never exceeds 150', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(5) });
  await run(harness, 50);
  for (const call of harness.songCalls) {
    assert.ok(call.limit === undefined || call.limit <= MAX_FALLBACK_CANDIDATES
      || call.filter?._id?.$in, 'ranked query has no fallback cap');
  }
  const fallbackCall = harness.classifySongCalls().fallbackQueries[0];
  assert.ok(fallbackCall.limit <= 150);
});

test('93: insufficient bounded candidates may return fewer than requested', async () => {
  const harness = createHarness({
    events: [],
    songs: [
      songDoc({ _id: id(0x80), youtube_id: '', file_path: '', title: 'bad' }),
      songDoc({ _id: id(0x81), youtube_id: '', file_path: '' }),
      songDoc({ _id: id(0x82) }),
    ],
  });
  const result = await run(harness, 10);
  assert.ok(result.items.length < 10);
  assert.equal(result.meta.returned_count, result.items.length);
});

test('94: activity items precede fallback', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), ...catalogSongs(5, 0x90)],
  });
  const result = await run(harness, 5);
  const bases = result.items.map((i) => i.basis);
  assert.equal(bases[0], TRENDING_ITEM_BASIS.ACTIVITY);
  assert.equal(bases[1], TRENDING_ITEM_BASIS.ACTIVITY);
  const firstFallback = bases.indexOf(TRENDING_ITEM_BASIS.CATALOG_FALLBACK);
  assert.ok(firstFallback > 1);
  for (let i = 0; i < firstFallback; i += 1) {
    assert.equal(bases[i], TRENDING_ITEM_BASIS.ACTIVITY);
  }
  for (let i = firstFallback; i < bases.length; i += 1) {
    assert.equal(bases[i], TRENDING_ITEM_BASIS.CATALOG_FALLBACK);
  }
});

test('95: fallback cannot duplicate activity Song', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc({ _id: SONG_1 }), songDoc({ _id: SONG_1 }), ...catalogSongs(3)],
  });
  const result = await run(harness, 5);
  const ids = result.items.map((i) => i.song._id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((x) => x === SONG_1).length, 1);
});

test('96: duplicate fallback Song IDs collapse safely if fake input malformed', async () => {
  const dupe = songDoc({ _id: id(0x91) });
  const harness = createHarness({
    events: [],
    songs: [dupe, { ...dupe }, { ...dupe }, songDoc({ _id: id(0x92) })],
  });
  const result = await run(harness, 5);
  const ids = result.items.map((i) => i.song._id);
  assert.equal(new Set(ids).size, ids.length);
});

test('97: activity order remains engine order', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [
      rankRow(id(0xa1), { score: 9 }),
      rankRow(id(0xa2), { score: 8 }),
      rankRow(id(0xa3), { score: 7 }),
    ],
    songs: [
      songDoc({ _id: id(0xa1) }),
      songDoc({ _id: id(0xa2) }),
      songDoc({ _id: id(0xa3) }),
      ...catalogSongs(4, 0xb0),
    ],
  });
  const result = await run(harness, 6);
  assert.deepEqual(
    result.items.slice(0, 3).map((i) => i.song._id),
    [id(0xa1), id(0xa2), id(0xa3)],
  );
  assert.deepEqual(result.items.slice(0, 3).map((i) => i.score), [9, 8, 7]);
});

test('98: fallback order deterministic across identical catalogs', async () => {
  const build = () => createHarness({
    events: [],
    songs: [
      songDoc({ _id: id(0xc1), createdAt: new Date(NOW.getTime() - 1000) }),
      songDoc({ _id: id(0xc0), createdAt: new Date(NOW.getTime() - 1000) }),
      songDoc({ _id: id(0xc2), createdAt: new Date(NOW.getTime() - 500) }),
    ],
  });
  const a = await build().service.getTrendingSongs({ limit: 3 });
  const b = await build().service.getTrendingSongs({ limit: 3 });
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.items.map((i) => i.song._id),
    [id(0xc2), id(0xc0), id(0xc1)],
  );
});

test('99: final ranks contiguous across activity and fallback', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(4)],
  });
  const result = await run(harness, 5);
  assert.deepEqual(result.items.map((i) => i.rank), [1, 2, 3, 4, 5]);
});

test('100: final public limit respected with mixed bases', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), ...catalogSongs(10)],
  });
  const result = await run(harness, 4);
  assert.equal(result.items.length, 4);
  assert.equal(result.meta.returned_count, 4);
  assert.equal(result.meta.activity_count, 2);
  assert.equal(result.meta.fallback_count, 2);
});

test('101: activity item basis = activity', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc()],
  });
  const result = await run(harness, 1);
  assert.equal(result.items[0].basis, 'activity');
  assert.equal(result.items[0].basis, TRENDING_ITEM_BASIS.ACTIVITY);
});

test('102: fallback basis = catalog-fallback', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(1) });
  const result = await run(harness, 1);
  assert.equal(result.items[0].basis, 'catalog-fallback');
  assert.equal(result.items[0].basis, TRENDING_ITEM_BASIS.CATALOG_FALLBACK);
});

test('103: activity score preserved and not recalculated', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1, { score: 7.25 })],
    songs: [songDoc(), ...catalogSongs(3)],
  });
  const result = await run(harness, 3);
  assert.equal(result.items[0].score, 7.25);
  assert.equal(result.items[0].basis, TRENDING_ITEM_BASIS.ACTIVITY);
});

test('104: fallback score = null', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(3)],
  });
  const result = await run(harness, 3);
  const fallbackItem = result.items.find((i) => i.basis === TRENDING_ITEM_BASIS.CATALOG_FALLBACK);
  assert.ok(fallbackItem);
  assert.equal(fallbackItem.score, null);
});

test('105: fallback activity metrics all zero/null', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(1) });
  const { activity } = (await run(harness, 1)).items[0];
  assert.deepEqual(activity, {
    unique_listener_count: 0,
    play_started_count: 0,
    completed_count: 0,
    replay_started_count: 0,
    skipped_count: 0,
    listened_seconds: 0,
    last_activity_at: null,
  });
});

test('106: fallback Song shape matches activity Song shape', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(1, 0xd0)],
  });
  const result = await run(harness, 2);
  const activityKeys = Object.keys(result.items[0].song).sort();
  const fallbackKeys = Object.keys(result.items[1].song).sort();
  assert.deepEqual(activityKeys, fallbackKeys);
  assert.equal(result.items[1].basis, TRENDING_ITEM_BASIS.CATALOG_FALLBACK);
});

test('107: activity-only mode correct', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 })],
  });
  const result = await run(harness, 2);
  assert.equal(result.meta.mode, 'activity');
  assert.equal(result.meta.mode, TRENDING_MODE.ACTIVITY);
});

test('108: mixed mode correct', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(3)],
  });
  const result = await run(harness, 3);
  assert.equal(result.meta.mode, 'activity-plus-fallback');
  assert.equal(result.meta.mode, TRENDING_MODE.ACTIVITY_PLUS_FALLBACK);
});

test('109: fallback-only mode correct', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(3) });
  const result = await run(harness, 3);
  assert.equal(result.meta.mode, 'catalog-fallback');
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
});

test('110: activity_count correct', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), ...catalogSongs(4)],
  });
  const result = await run(harness, 5);
  assert.equal(result.meta.activity_count, 2);
  assert.equal(
    result.items.filter((i) => i.basis === TRENDING_ITEM_BASIS.ACTIVITY).length,
    2,
  );
});

test('111: fallback_count correct', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(6)],
  });
  const result = await run(harness, 5);
  assert.equal(result.meta.fallback_count, 4);
  assert.equal(
    result.items.filter((i) => i.basis === TRENDING_ITEM_BASIS.CATALOG_FALLBACK).length,
    4,
  );
});

test('112: returned_count = activity_count + fallback_count', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 }), ...catalogSongs(5)],
  });
  const result = await run(harness, 5);
  assert.equal(
    result.meta.returned_count,
    result.meta.activity_count + result.meta.fallback_count,
  );
  assert.equal(result.meta.returned_count, result.items.length);
});

test('113: empty catalog mode/counts correct', async () => {
  const harness = createHarness({ events: [], songs: [] });
  const result = await run(harness, 10);
  assert.deepEqual(result.items, []);
  assert.equal(result.meta.mode, TRENDING_MODE.CATALOG_FALLBACK);
  assert.equal(result.meta.activity_count, 0);
  assert.equal(result.meta.fallback_count, 0);
  assert.equal(result.meta.returned_count, 0);
  assert.equal(result.meta.event_count, 0);
  assert.equal(result.meta.candidate_count, 0);
});

test('114: original event_count retained', async () => {
  const harness = createHarness({
    events: [eventRow(), eventRow({ _id: id(0x1001), createdAt: new Date(NOW.getTime() - 1) })],
    ranked: [],
    songs: catalogSongs(2),
  });
  const result = await run(harness, 2);
  assert.equal(result.meta.event_count, 2);
});

test('115: original truncation meta retained', async () => {
  const events = Array.from({ length: MAX_TRENDING_EVENT_INPUTS + 1 }, (_, i) => eventRow({
    _id: id(0x50000 + i),
    createdAt: new Date(NOW.getTime() - i),
    song: id(1 + (i % 3)),
    user: id(0x30000 + (i % 20)),
  }));
  const harness = createHarness({ events, ranked: [], songs: catalogSongs(3) });
  const result = await run(harness, 3);
  assert.equal(result.meta.event_input_truncated, true);
  assert.equal(result.meta.event_count, MAX_TRENDING_EVENT_INPUTS);
});

test('116: candidate_count retains engine-candidate semantics', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2), rankRow(SONG_3)],
    songs: [songDoc(), ...catalogSongs(5)],
  });
  const result = await run(harness, 5);
  assert.equal(result.meta.candidate_count, 3);
});

test('117: no engine call on zero events', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(2) });
  await run(harness, 2);
  assert.equal(harness.engineCalls.length, 0);
});

test('118: engine still called once when events exist', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(3)],
  });
  await run(harness, 3);
  assert.equal(harness.engineCalls.length, 1);
});

test('119: fallback never invokes engine again', async () => {
  const harness = createHarness({ events: [eventRow()], ranked: [], songs: catalogSongs(5) });
  await run(harness, 5);
  assert.equal(harness.engineCalls.length, 1);
  assert.equal(harness.classifySongCalls().fallbackQueries.length, 1);
});

test('120: same now semantics preserved', async () => {
  let nowCalls = 0;
  let engineNow = null;
  const service = createTrendingService({
    ListeningEventModel: {
      find(filter) {
        assert.ok(filter.createdAt.$lte instanceof Date);
        return createQueryChain({}, () => [eventRow()]);
      },
    },
    SongModel: { find: () => createQueryChain({}, () => [songDoc()]) },
    scoreTrendingSongs: (rows, options) => {
      engineNow = options.now;
      return [rankRow(SONG_1)];
    },
    now: () => {
      nowCalls += 1;
      return NOW;
    },
  });
  await service.getTrendingSongs({ limit: 1 });
  assert.equal(nowCalls, 1);
  assert.equal(engineNow.getTime(), NOW.getTime());
});

test('121: full activity path => max one Song query', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1), rankRow(SONG_2)],
    songs: [songDoc(), songDoc({ _id: SONG_2 })],
  });
  await run(harness, 2);
  assert.equal(harness.classifySongCalls().total, 1);
  assert.equal(harness.songCalls.length, 1);
});

test('122: sparse path => max two Song queries', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(5)],
  });
  await run(harness, 5);
  assert.ok(harness.songCalls.length <= 2);
  assert.equal(harness.songCalls.length, 2);
  const { rankedQueries, fallbackQueries } = harness.classifySongCalls();
  assert.equal(rankedQueries.length, 1);
  assert.equal(fallbackQueries.length, 1);
});

test('123: no Favorite query', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(fileURLToPath(new URL('./trendingService.js', import.meta.url)), 'utf8');
  assert.equal(source.includes('Favorite'), false);
  assert.equal(source.includes('favorite'), false);
});

test('124: no Playlist query', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(fileURLToPath(new URL('./trendingService.js', import.meta.url)), 'utf8');
  assert.equal(source.includes('Playlist'), false);
  assert.equal(source.includes('playlist'), false);
});

test('125: no user/profile query', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(fileURLToPath(new URL('./trendingService.js', import.meta.url)), 'utf8');
  assert.equal(source.includes('userPreference'), false);
  assert.equal(source.includes('explicitPreference'), false);
  assert.equal(source.includes('req.user'), false);
  assert.equal(source.includes('userId'), false);
});

test('126: no Math.random', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(fileURLToPath(new URL('./trendingService.js', import.meta.url)), 'utf8');
  assert.equal(source.includes('Math.random'), false);
});

test('127: no $sample', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(fileURLToPath(new URL('./trendingService.js', import.meta.url)), 'utf8');
  assert.equal(source.includes('$sample'), false);
});

test('128: identical inputs produce deep-equal output (fallback path)', async () => {
  const build = () => createHarness({
    events: [],
    songs: [
      songDoc({ _id: id(0xe1), createdAt: new Date(NOW.getTime() - 100) }),
      songDoc({ _id: id(0xe0), createdAt: new Date(NOW.getTime() - 100) }),
      songDoc({ _id: id(0xe2), createdAt: new Date(NOW.getTime() - 200) }),
    ],
  });
  const a = await build().service.getTrendingSongs({ limit: 3 });
  const b = await build().service.getTrendingSongs({ limit: 3 });
  assert.deepEqual(a, b);
});

test('129: source Song fixtures not mutated', async () => {
  const fixtures = catalogSongs(3);
  const snapshot = JSON.parse(JSON.stringify(fixtures.map((f) => ({
    ...f,
    createdAt: f.createdAt.toISOString(),
    release_date: f.release_date.toISOString(),
  }))));
  const harness = createHarness({ events: [], songs: fixtures });
  await harness.service.getTrendingSongs({ limit: 3 });
  const after = fixtures.map((f) => ({
    ...f,
    createdAt: f.createdAt.toISOString(),
    release_date: f.release_date.toISOString(),
  }));
  assert.deepEqual(after, snapshot);
});

test('130: no user IDs returned', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(2) });
  const result = await run(harness, 2);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(USER_A), false);
  assert.equal(serialized.includes(USER_B), false);
  assert.equal(serialized.includes('user'), false);
});

test('131: no raw Song docs returned', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(1) });
  const result = await run(harness, 1);
  const song = result.items[0].song;
  assert.equal('recommendation_eligible' in song, false);
  assert.equal('createdAt' in song, false);
  assert.equal('updatedAt' in song, false);
  assert.equal('lyrics' in song, false);
  assert.equal('metadata_provenance' in song, false);
});

test('132: no internal createdAt exposed if not public', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(2) });
  const result = await run(harness, 2);
  for (const item of result.items) {
    assert.equal('createdAt' in item.song, false);
    assert.equal('createdAt' in item, false);
  }
  assert.equal('createdAt' in result.meta, false);
});

test('133: no recommendation score created for fallback', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(1) });
  const result = await run(harness, 1);
  const item = result.items[0];
  assert.equal(item.score, null);
  assert.equal('recommendation_score' in item, false);
  assert.equal('preference_score' in item, false);
});

test('134: no fake activity score on fallback', async () => {
  const harness = createHarness({ events: [], songs: catalogSongs(1) });
  const result = await run(harness, 1);
  assert.equal(result.items[0].score, null);
  assert.notEqual(result.items[0].score, 0);
});

test('135: no ML/AI fields', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1)],
    songs: [songDoc(), ...catalogSongs(2)],
  });
  const result = await run(harness, 3);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('recommendation_score'), false);
  assert.equal(serialized.includes('preference_score'), false);
  assert.equal(serialized.includes('ml_'), false);
  assert.equal(serialized.includes('embedding'), false);
  assert.equal(serialized.includes('ai_score'), false);
});

test('136: fallback query failure sanitized', async () => {
  const harness = createHarness({
    events: [],
    songs: catalogSongs(2),
    failFallbackSongs: true,
  });
  await assert.rejects(() => run(harness, 2), { message: TRENDING_SERVICE_ERROR });
});

test('137: raw DB marker not leaked on fallback failure', async () => {
  const harness = createHarness({
    events: [],
    songs: catalogSongs(1),
    failFallbackSongs: true,
  });
  await assert.rejects(
    () => run(harness, 1),
    (error) => {
      assert.equal(error.message, TRENDING_SERVICE_ERROR);
      assert.equal(error.message.includes('mongodb://'), false);
      return true;
    },
  );
});

test('138: secret marker not leaked on fallback failure', async () => {
  const harness = createHarness({
    events: [],
    songs: catalogSongs(1),
    failFallbackSongs: true,
  });
  await assert.rejects(
    () => run(harness, 1),
    (error) => {
      assert.equal(error.message.includes('secret-marker'), false);
      assert.equal(error.message, TRENDING_SERVICE_ERROR);
      return true;
    },
  );
});

test('139: filtering one activity song does not promote fallback above surviving activity', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [
      rankRow(id(0xf1), { score: 10 }),
      rankRow(id(0xf2), { score: 9 }),
      rankRow(id(0xf3), { score: 8 }),
    ],
    songs: [
      songDoc({ _id: id(0xf1), youtube_id: '', file_path: '' }),
      songDoc({ _id: id(0xf2) }),
      songDoc({ _id: id(0xf3) }),
      ...catalogSongs(4, 0x100),
    ],
  });
  const result = await run(harness, 5);
  assert.equal(result.items[0].song._id, id(0xf2));
  assert.equal(result.items[0].basis, TRENDING_ITEM_BASIS.ACTIVITY);
  assert.equal(result.items[1].song._id, id(0xf3));
  assert.equal(result.items[1].basis, TRENDING_ITEM_BASIS.ACTIVITY);
  assert.equal(result.items[2].basis, TRENDING_ITEM_BASIS.CATALOG_FALLBACK);
});

test('140: fallback never changes activity scores or metrics', async () => {
  const harness = createHarness({
    events: [eventRow()],
    ranked: [rankRow(SONG_1, {
      score: 4.5,
      unique_listener_count: 3,
      play_started_count: 2,
      listened_seconds: 45,
    })],
    songs: [songDoc(), ...catalogSongs(5)],
  });
  const result = await run(harness, 4);
  const activity = result.items[0];
  assert.equal(activity.score, 4.5);
  assert.equal(activity.activity.unique_listener_count, 3);
  assert.equal(activity.activity.play_started_count, 2);
  assert.equal(activity.activity.listened_seconds, 45);
  assert.equal(result.meta.activity_count, 1);
  assert.equal(result.meta.fallback_count, 3);
});

test('141: public limit remains applied only at final output', async () => {
  const ranked = Array.from({ length: 8 }, (_, i) => rankRow(id(0x110 + i), { score: 20 - i }));
  const songs = [
    ...ranked.map((row) => songDoc({ _id: row.song_id })),
    ...catalogSongs(6, 0x120),
  ];
  const harness = createHarness({ events: [eventRow()], ranked, songs });
  const result = await run(harness, 5);
  assert.equal(result.items.length, 5);
  assert.equal(result.meta.activity_count, 5);
  assert.equal(result.meta.fallback_count, 0);
  assert.equal(result.meta.candidate_count, 8);
});

test('142: TRENDING_ITEM_BASIS vocabulary is frozen to two values', () => {
  assert.deepEqual(
    Object.values(TRENDING_ITEM_BASIS).sort(),
    ['activity', 'catalog-fallback'],
  );
  assert.equal(Object.isFrozen(TRENDING_ITEM_BASIS), true);
});

test('143: fallback constants match contract', () => {
  assert.equal(FALLBACK_CANDIDATE_MULTIPLIER, 3);
  assert.equal(MAX_FALLBACK_CANDIDATES, 150);
  assert.equal(MAX_FALLBACK_EXCLUSIONS, 100);
});

test('144: fallback exclusions bounded to max 100 ranked IDs', async () => {
  const ranked = Array.from({ length: 120 }, (_, i) => rankRow(id(0x200 + i)));
  const usableRanked = ranked.slice(0, 10);
  const harness = createHarness({
    events: [eventRow()],
    ranked,
    songs: [
      ...usableRanked.map((row) => songDoc({ _id: row.song_id })),
      ...catalogSongs(3, 0x300),
    ],
  });
  const result = await run(harness, 50);
  assert.equal(result.meta.activity_count, 10);
  assert.ok(result.meta.fallback_count > 0);
  const fallbackCall = harness.classifySongCalls().fallbackQueries[0];
  assert.ok(fallbackCall);
  assert.ok(Array.isArray(fallbackCall.filter._id.$nin));
  assert.equal(fallbackCall.filter._id.$nin.length, MAX_FALLBACK_EXCLUSIONS);
});
