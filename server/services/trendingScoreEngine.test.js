import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scoreTrendingSongs,
  trendingDecay,
  TRENDING_WINDOW_HOURS,
  TRENDING_HALF_LIFE_HOURS,
  MAX_TRENDING_EVENT_INPUTS,
  DEFAULT_TRENDING_LIMIT,
  MAX_TRENDING_LIMIT,
  PLAY_STARTED_WEIGHT,
  COMPLETED_WEIGHT,
  REPLAY_STARTED_WEIGHT,
  SKIPPED_WEIGHT,
  LISTENED_MINUTE_WEIGHT,
  UNIQUE_LISTENER_WEIGHT,
  MIN_USER_SONG_CONTRIBUTION,
  MAX_USER_SONG_CONTRIBUTION,
  TRENDING_EVENT_INPUT_EXCEEDED_ERROR,
  TRENDING_INVALID_EVENTS_ERROR,
  TRENDING_INVALID_NOW_ERROR,
  TRENDING_INVALID_LIMIT_ERROR,
} from './trendingScoreEngine.js';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const HOUR = 3600000;
const id = (n) => n.toString(16).padStart(24, '0');
const USER_A = id(0xa);
const USER_B = id(0xb);
const USER_C = id(0xc);
const SONG_1 = id(1);
const SONG_2 = id(2);
const SONG_3 = id(3);

const hoursAgo = (hours) => new Date(NOW.getTime() - hours * HOUR);

const row = (fields = {}) => ({
  user: USER_A,
  song: SONG_1,
  event_type: 'progress',
  listened_seconds_delta: 0,
  createdAt: NOW,
  ...fields,
});

const rank = (events, options = {}) => scoreTrendingSongs(events, { now: NOW, ...options });
const first = (events, options) => rank(events, options)[0];
const round6 = (value) => Math.round(value * 1e6) / 1e6;
const approx = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !~ ${expected}`);

test('1 empty events returns []', () => {
  assert.deepEqual(rank([]), []);
});

test('2 non-array events rejected safely', () => {
  for (const events of [null, undefined, 'events', 42, {}, true]) {
    assert.throws(() => rank(events), { message: TRENDING_INVALID_EVENTS_ERROR });
  }
});

test('3 over-cap event input rejected without slicing', () => {
  const tooMany = Array(MAX_TRENDING_EVENT_INPUTS + 1).fill(null);
  assert.throws(() => rank(tooMany), { message: TRENDING_EVENT_INPUT_EXCEEDED_ERROR });
  const atCap = Array(MAX_TRENDING_EVENT_INPUTS).fill(null);
  assert.deepEqual(rank(atCap), []);
});

test('4 default limit is 20', () => {
  assert.equal(DEFAULT_TRENDING_LIMIT, 20);
  const events = Array.from({ length: 30 }, (_, i) => row({
    song: id(100 + i),
    event_type: 'completed',
    user: id(0x1000 + i),
  }));
  assert.equal(rank(events).length, 20);
});

test('5 limit 1 accepted', () => {
  const events = [row({ song: SONG_1, event_type: 'completed' }), row({ song: SONG_2, event_type: 'completed', user: USER_B })];
  assert.equal(rank(events, { limit: 1 }).length, 1);
});

test('6 limit 100 accepted', () => {
  assert.equal(MAX_TRENDING_LIMIT, 100);
  const events = Array.from({ length: 5 }, (_, i) => row({ song: id(10 + i), event_type: 'completed', user: id(0x100 + i) }));
  assert.equal(rank(events, { limit: 100 }).length, 5);
});

for (const limit of [0, 101, 1.5, '20', null, NaN, Infinity, {}, [], -1]) {
  test(`7-10 limit ${String(limit)} rejected`, () => {
    assert.throws(() => rank([], { limit }), { message: TRENDING_INVALID_LIMIT_ERROR });
  });
}

test('11 invalid now rejected safely', () => {
  for (const now of [null, undefined, 'invalid', {}, NaN, new Date(NaN), 0, true]) {
    assert.throws(() => scoreTrendingSongs([], { now }), { message: TRENDING_INVALID_NOW_ERROR });
  }
  assert.throws(() => scoreTrendingSongs([], {}), { message: TRENDING_INVALID_NOW_ERROR });
});

test('12 current event decay is exactly 1', () => {
  assert.equal(trendingDecay(0), 1);
  assert.equal(first([row({ event_type: 'completed' })]).score, COMPLETED_WEIGHT + 0);
});

test('13 24h decay is 0.5', () => {
  assert.equal(trendingDecay(24), 0.5);
  approx(first([row({ event_type: 'completed', createdAt: hoursAgo(24) })]).score, 1);
});

test('14 48h decay is 0.25', () => {
  assert.equal(trendingDecay(48), 0.25);
  approx(first([row({ event_type: 'completed', createdAt: hoursAgo(48) })]).score, 0.5);
});

test('15 event exactly at 7-day lower boundary is included', () => {
  const boundary = new Date(NOW.getTime() - TRENDING_WINDOW_HOURS * HOUR);
  const result = first([row({ event_type: 'completed', createdAt: boundary })]);
  assert.equal(result.completed_count, 1);
  approx(result.score, 2 * trendingDecay(TRENDING_WINDOW_HOURS));
});

test('16 event older than 7 days ignored', () => {
  const justOld = new Date(NOW.getTime() - TRENDING_WINDOW_HOURS * HOUR - 1);
  assert.deepEqual(rank([row({ event_type: 'completed', createdAt: justOld })]), []);
});

test('17 future event ignored', () => {
  const future = new Date(NOW.getTime() + 1);
  assert.deepEqual(rank([row({ event_type: 'completed', createdAt: future })]), []);
});

test('18 client_occurred_at does not control recency', () => {
  const staleServer = row({
    event_type: 'completed',
    createdAt: hoursAgo(TRENDING_WINDOW_HOURS + 5),
    client_occurred_at: NOW,
  });
  assert.deepEqual(rank([staleServer]), []);
  const freshServer = row({
    event_type: 'completed',
    createdAt: NOW,
    client_occurred_at: hoursAgo(500),
  });
  assert.equal(first([freshServer]).completed_count, 1);
  approx(first([freshServer]).score, 2);
});

test('19 play-started contributes +1 base before decay', () => {
  approx(trendingDecay(0) * PLAY_STARTED_WEIGHT, 1);
  const result = first([row({ event_type: 'play-started' })]);
  approx(result.score, PLAY_STARTED_WEIGHT + UNIQUE_LISTENER_WEIGHT);
});

test('20 completed contributes +2', () => {
  approx(trendingDecay(0) * COMPLETED_WEIGHT, 2);
  approx(first([row({ event_type: 'completed' })]).score, 2);
});

test('21 replay-started contributes +1.5', () => {
  approx(trendingDecay(0) * REPLAY_STARTED_WEIGHT, 1.5);
  const result = first([row({ event_type: 'replay-started' })]);
  approx(result.score, REPLAY_STARTED_WEIGHT + UNIQUE_LISTENER_WEIGHT);
});

test('22 skipped contributes -0.75', () => {
  approx(trendingDecay(0) * SKIPPED_WEIGHT, -0.75);
  const result = first([
    row({ event_type: 'skipped', user: USER_A, song: SONG_1 }),
    row({ event_type: 'play-started', user: USER_B, song: SONG_1 }),
  ]);
  approx(result.score, 1 + UNIQUE_LISTENER_WEIGHT + SKIPPED_WEIGHT);
});

for (const event_type of ['paused', 'resumed', 'seeked', 'stopped']) {
  test(`23-26 ${event_type} gets no base weight`, () => {
    assert.deepEqual(rank([row({ event_type })]), []);
    const withDelta = first([row({ event_type, listened_seconds_delta: 60 })]);
    assert.equal(withDelta.play_started_count, 0);
    assert.equal(withDelta.completed_count, 0);
    assert.equal(withDelta.replay_started_count, 0);
    assert.equal(withDelta.skipped_count, 0);
    approx(withDelta.score, LISTENED_MINUTE_WEIGHT);
  });
}

test('27 valid listened delta contributes 0.25 per listened minute', () => {
  approx(first([row({ event_type: 'progress', listened_seconds_delta: 60 })]).score, 0.25);
});

test('28 60 sec => 0.25 before decay', () => {
  approx(first([row({ event_type: 'progress', listened_seconds_delta: 60 })]).score, 0.25);
});

test('29 120 sec => 0.5 before decay', () => {
  approx(first([row({ event_type: 'progress', listened_seconds_delta: 120 })]).score, 0.5);
});

test('30 negative delta ignored', () => {
  assert.deepEqual(rank([row({ event_type: 'progress', listened_seconds_delta: -30 })]), []);
  const withPositive = first([
    row({ event_type: 'completed' }),
    row({ user: USER_B, event_type: 'progress', listened_seconds_delta: -30 }),
  ]);
  assert.equal(withPositive.listened_seconds, 0);
  approx(withPositive.score, 2);
});

test('31 >120 legacy delta ignored, not clamped', () => {
  assert.deepEqual(rank([row({ event_type: 'progress', listened_seconds_delta: 121 })]), []);
  assert.deepEqual(rank([row({ event_type: 'progress', listened_seconds_delta: 100000 })]), []);
  const withPositive = first([
    row({ event_type: 'completed' }),
    row({ user: USER_B, event_type: 'progress', listened_seconds_delta: 121 }),
  ]);
  assert.equal(withPositive.listened_seconds, 0);
  approx(withPositive.score, 2);
});

test('32 NaN delta ignored', () => {
  assert.deepEqual(rank([row({ event_type: 'progress', listened_seconds_delta: NaN })]), []);
});

test('33 Infinity delta ignored', () => {
  assert.deepEqual(rank([row({ event_type: 'progress', listened_seconds_delta: Infinity })]), []);
  assert.deepEqual(rank([row({ event_type: 'progress', listened_seconds_delta: -Infinity })]), []);
});

test('34 listened_seconds output sums factual valid deltas', () => {
  const result = first([
    row({ event_type: 'progress', listened_seconds_delta: 60, createdAt: hoursAgo(48) }),
    row({ event_type: 'progress', listened_seconds_delta: 60, createdAt: NOW }),
    row({ event_type: 'progress', listened_seconds_delta: 121, createdAt: NOW, user: USER_B }),
  ]);
  assert.equal(result.listened_seconds, 120);
});

test('35 displayed listened_seconds is NOT time-decayed', () => {
  const result = first([
    row({ event_type: 'progress', listened_seconds_delta: 120, createdAt: hoursAgo(120) }),
  ]);
  assert.equal(result.listened_seconds, 120);
  assert.ok(result.score < 0.5);
  approx(result.score, (120 / 60) * LISTENED_MINUTE_WEIGHT * trendingDecay(120));
});

test('36 position difference never contributes', () => {
  assert.deepEqual(rank([row({ position_seconds: 100, duration_seconds: 200 })]), []);
  assert.deepEqual(rank([row({
    event_type: 'progress',
    listened_seconds_delta: 0,
    position_seconds: 0,
  })]), []);
  const withPositive = first([
    row({ event_type: 'completed' }),
    row({
      user: USER_B,
      event_type: 'progress',
      listened_seconds_delta: 0,
      position_seconds: 0,
      duration_seconds: 200,
    }),
  ]);
  assert.equal(withPositive.listened_seconds, 0);
  approx(withPositive.score, 2);
});

test('37 seek distance never contributes', () => {
  assert.deepEqual(rank([row({
    event_type: 'seeked',
    seek_from_seconds: 0,
    seek_to_seconds: 180,
    listened_seconds_delta: 0,
  })]), []);
  const seekWithValidDelta = first([row({
    event_type: 'seeked',
    seek_from_seconds: 10,
    seek_to_seconds: 100,
    listened_seconds_delta: 60,
  })]);
  assert.equal(seekWithValidDelta.listened_seconds, 60);
  approx(seekWithValidDelta.score, 0.25);
});

test('38 wall-clock gap never contributes', () => {
  const gaps = [
    row({ event_type: 'progress', listened_seconds_delta: 0, createdAt: hoursAgo(3) }),
    row({ event_type: 'progress', listened_seconds_delta: 0, createdAt: NOW }),
  ];
  assert.deepEqual(rank(gaps), []);
  const withPositive = first([...gaps, row({ user: USER_B, event_type: 'completed' })]);
  assert.equal(withPositive.listened_seconds, 0);
  approx(withPositive.score, 2);
});

test('39 play-start signal decays by age', () => {
  approx(first([row({ event_type: 'play-started', createdAt: hoursAgo(24) })]).score,
    (PLAY_STARTED_WEIGHT + UNIQUE_LISTENER_WEIGHT) * 0.5);
});

test('40 completion signal decays by age', () => {
  approx(first([row({ event_type: 'completed', createdAt: hoursAgo(24) })]).score, 1);
});

test('41 replay signal decays by age', () => {
  approx(first([row({ event_type: 'replay-started', createdAt: hoursAgo(24) })]).score,
    (REPLAY_STARTED_WEIGHT + UNIQUE_LISTENER_WEIGHT) * 0.5);
});

test('42 skip penalty decays by age', () => {
  const result = first([
    row({ event_type: 'skipped', createdAt: hoursAgo(24) }),
    row({ event_type: 'play-started', user: USER_B }),
  ]);
  approx(result.score, 1 + UNIQUE_LISTENER_WEIGHT - 0.75 * 0.5);
});

test('43 listened-minute contribution decays by event age', () => {
  approx(first([row({ event_type: 'progress', listened_seconds_delta: 60, createdAt: hoursAgo(24) })]).score, 0.125);
});

test('44 one user produces unique_listener_count 1', () => {
  assert.equal(first([row({ event_type: 'play-started' })]).unique_listener_count, 1);
});

test('45 repeated starts by same user still count 1', () => {
  const events = Array.from({ length: 20 }, (_, i) => row({
    event_type: i % 2 === 0 ? 'play-started' : 'replay-started',
    createdAt: hoursAgo(i * 0.01),
  }));
  assert.equal(first(events).unique_listener_count, 1);
});

test('46 two users count 2', () => {
  const result = first([
    row({ event_type: 'play-started', user: USER_A }),
    row({ event_type: 'play-started', user: USER_B }),
  ]);
  assert.equal(result.unique_listener_count, 2);
});

test('47 most recent start/replay controls listener decay', () => {
  const recentWins = first([
    row({ event_type: 'play-started', createdAt: hoursAgo(48) }),
    row({ event_type: 'play-started', createdAt: hoursAgo(24) }),
  ]);
  const expectedEvent = 1 * 0.25 + 1 * 0.5;
  const expectedUnique = UNIQUE_LISTENER_WEIGHT * 0.5;
  approx(recentWins.score, expectedEvent + expectedUnique);
  const onlyOldest = first([row({ event_type: 'play-started', createdAt: hoursAgo(48) })]);
  approx(onlyOldest.score, 1 * 0.25 + UNIQUE_LISTENER_WEIGHT * 0.25);
});

test('48 completion without start/replay does not create unique listener term', () => {
  const result = first([row({ event_type: 'completed' })]);
  assert.equal(result.unique_listener_count, 0);
  approx(result.score, 2);
});

test('49 listener IDs never appear in output', () => {
  const result = first([
    row({ event_type: 'play-started', user: USER_A }),
    row({ event_type: 'play-started', user: USER_B }),
  ]);
  const raw = JSON.stringify(result);
  assert.equal(raw.includes(USER_A), false);
  assert.equal(raw.includes(USER_B), false);
  assert.equal('user' in result, false);
});

test('50 repeated positive activity from one user capped at +8 event contribution', () => {
  const events = Array.from({ length: 30 }, (_, i) => row({
    event_type: 'completed',
    createdAt: hoursAgo(i * 0.001),
  }));
  const result = first(events);
  approx(result.score, MAX_USER_SONG_CONTRIBUTION);
  assert.equal(result.completed_count, 30);
});

test('51 strong negative activity capped at -3', () => {
  const skips = Array.from({ length: 20 }, (_, i) => row({
    event_type: 'skipped',
    user: USER_A,
    song: SONG_1,
    createdAt: hoursAgo(i * 0.001),
  }));
  const result = first([
    ...skips,
    row({ event_type: 'completed', user: USER_B, song: SONG_1 }),
    row({ event_type: 'completed', user: USER_B, song: SONG_1, createdAt: hoursAgo(1) }),
    row({ event_type: 'completed', user: USER_B, song: SONG_1, createdAt: hoursAgo(2) }),
  ]);
  assert.ok(-0.75 * 20 < MIN_USER_SONG_CONTRIBUTION);
  const userB = 2 + 2 * trendingDecay(1) + 2 * trendingDecay(2);
  approx(result.score, round6(MIN_USER_SONG_CONTRIBUTION + userB), 1e-12);
});

test('52 unique listener term is added after event cap', () => {
  const spam = Array.from({ length: 50 }, (_, i) => row({
    event_type: 'completed',
    createdAt: hoursAgo(i * 0.001),
  }));
  const withStart = [
    ...spam,
    row({ event_type: 'play-started', createdAt: NOW }),
  ];
  const result = first(withStart);
  approx(result.score, MAX_USER_SONG_CONTRIBUTION + UNIQUE_LISTENER_WEIGHT);
});

test('53 another user contribution remains independent', () => {
  const spamA = Array.from({ length: 40 }, (_, i) => row({
    event_type: i === 0 ? 'play-started' : 'completed',
    user: USER_A,
    song: SONG_1,
    createdAt: hoursAgo(i * 0.001),
  }));
  const result = first([
    ...spamA,
    row({ event_type: 'play-started', user: USER_B, song: SONG_1 }),
  ]);
  approx(result.score, MAX_USER_SONG_CONTRIBUTION + UNIQUE_LISTENER_WEIGHT + 1 + UNIQUE_LISTENER_WEIGHT);
  assert.equal(result.unique_listener_count, 2);
});

test('54 one spammy listener cannot grow score without bound', () => {
  const spam = Array.from({ length: 100 }, (_, i) => row({
    event_type: 'completed',
    createdAt: hoursAgo(i * 0.001),
  }));
  const spamScore = first(spam).score;
  assert.ok(spamScore <= MAX_USER_SONG_CONTRIBUTION + UNIQUE_LISTENER_WEIGHT + 1e-9);
  assert.ok(spamScore < 9);
});

test('55 cap is scoped per user+song', () => {
  const spam = Array.from({ length: 30 }, (_, i) => row({
    event_type: 'completed',
    user: USER_A,
    song: SONG_1,
    createdAt: hoursAgo(i * 0.001),
  }));
  const otherSong = row({ event_type: 'play-started', user: USER_A, song: SONG_2 });
  const results = rank([...spam, otherSong]);
  assert.equal(results.length, 2);
  const song1 = results.find((r) => r.song_id === SONG_1);
  const song2 = results.find((r) => r.song_id === SONG_2);
  approx(song1.score, MAX_USER_SONG_CONTRIBUTION);
  approx(song2.score, 1 + UNIQUE_LISTENER_WEIGHT);
});

test('56 same user activity on different songs has separate cap', () => {
  const forOne = Array.from({ length: 25 }, (_, i) => row({
    event_type: 'completed',
    user: USER_A,
    song: SONG_1,
    createdAt: hoursAgo(i * 0.001),
  }));
  const forTwo = Array.from({ length: 25 }, (_, i) => row({
    event_type: 'completed',
    user: USER_A,
    song: SONG_2,
    createdAt: hoursAgo(i * 0.001),
  }));
  const results = rank([...forOne, ...forTwo]);
  assert.equal(results.length, 2);
  for (const result of results) approx(result.score, MAX_USER_SONG_CONTRIBUTION);
});

test('57 play_started_count factual', () => {
  const result = first([
    row({ event_type: 'play-started' }),
    row({ event_type: 'play-started', createdAt: hoursAgo(1) }),
    row({ event_type: 'replay-started' }),
  ]);
  assert.equal(result.play_started_count, 2);
});

test('58 completed_count factual', () => {
  const result = first([
    row({ event_type: 'completed' }),
    row({ event_type: 'completed', createdAt: hoursAgo(2) }),
    row({ event_type: 'progress' }),
  ]);
  assert.equal(result.completed_count, 2);
});

test('59 replay_started_count factual', () => {
  const result = first([
    row({ event_type: 'replay-started' }),
    row({ event_type: 'replay-started', createdAt: hoursAgo(1) }),
    row({ event_type: 'play-started' }),
  ]);
  assert.equal(result.replay_started_count, 2);
});

test('60 skipped_count factual', () => {
  const result = first([
    row({ event_type: 'skipped' }),
    row({ event_type: 'play-started', user: USER_B }),
  ]);
  assert.equal(result.skipped_count, 1);
});

test('61 counts are not time-decayed', () => {
  const result = first([
    row({ event_type: 'completed', createdAt: hoursAgo(100) }),
    row({ event_type: 'completed', createdAt: hoursAgo(50) }),
  ]);
  assert.equal(result.completed_count, 2);
  assert.ok(result.score < 2);
});

test('62 unsupported event types do not create these counts', () => {
  const result = first([
    row({ event_type: 'liked', user: USER_B }),
    row({ event_type: 'play-started' }),
  ]);
  assert.equal(result.play_started_count, 1);
  assert.equal(result.completed_count, 0);
  assert.equal(result.replay_started_count, 0);
  assert.equal(result.skipped_count, 0);
});

test('63 latest server createdAt becomes last_activity_at', () => {
  const result = first([
    row({ event_type: 'completed', createdAt: hoursAgo(5) }),
    row({ event_type: 'progress', createdAt: hoursAgo(1) }),
  ]);
  assert.equal(result.last_activity_at, hoursAgo(1).toISOString());
});

test('64 older input ordering does not affect last_activity_at', () => {
  const a = row({ event_type: 'completed', createdAt: hoursAgo(5) });
  const b = row({ event_type: 'progress', createdAt: hoursAgo(1) });
  assert.equal(first([a, b]).last_activity_at, first([b, a]).last_activity_at);
  assert.equal(first([b, a]).last_activity_at, hoursAgo(1).toISOString());
});

test('65 client timestamp does not override last_activity_at', () => {
  const result = first([
    row({
      event_type: 'completed',
      createdAt: hoursAgo(2),
      client_occurred_at: new Date('2099-01-01T00:00:00.000Z'),
    }),
    row({
      event_type: 'progress',
      createdAt: hoursAgo(4),
      client_occurred_at: NOW,
    }),
  ]);
  assert.equal(result.last_activity_at, hoursAgo(2).toISOString());
});

test('66 malformed event ignored', () => {
  assert.deepEqual(rank([null, undefined, 42, 'event', []]), []);
  assert.deepEqual(rank([row(), null, { broken: true }]), []);
});

test('67 malformed user ignored', () => {
  for (const user of [null, undefined, '', 'nope', 'short', { name: 'x' }, [], 123, { toString: () => 'a'.repeat(24) }]) {
    assert.deepEqual(rank([row({ user })]), []);
  }
});

test('68 malformed song ignored', () => {
  for (const song of [null, undefined, '', 'xyz', { foo: 1 }, 99]) {
    assert.deepEqual(rank([row({ song })]), []);
  }
});

test('69 invalid createdAt ignored', () => {
  for (const createdAt of [null, undefined, 'invalid', '', {}, new Date(NaN)]) {
    assert.deepEqual(rank([row({ createdAt })]), []);
  }
});

test('70 unsupported event type with no valid delta contributes nothing', () => {
  assert.deepEqual(rank([row({ event_type: 'liked', listened_seconds_delta: 0 })]), []);
  assert.deepEqual(rank([row({ event_type: 'garbage', listened_seconds_delta: 60 })]), []);
  assert.deepEqual(rank([row({ event_type: 42 })]), []);
  assert.deepEqual(rank([row({})]), []);
});

test('71 bad row does not fail valid rows', () => {
  const result = rank([
    { junk: true },
    null,
    row({ event_type: 'completed' }),
    row({ user: 'bad', event_type: 'completed' }),
    row({ event_type: 'unknown-type' }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].completed_count, 1);
});

test('72 arbitrary object is not stringified into an ID', () => {
  const evil = { toString: () => 'ffffffffffffffffffffffff', valueOf: () => 1 };
  assert.deepEqual(rank([row({ user: evil })]), []);
  assert.deepEqual(rank([row({ song: evil })]), []);
  assert.deepEqual(rank([row({ song: { _id: evil } })]), []);
  assert.deepEqual(rank([row({ user: { _id: { nested: true } } })]), []);
});

test('73 negative raw song score clamps to zero', () => {
  assert.deepEqual(rank([row({ event_type: 'skipped' })]), []);
  const withOther = first([
    row({ event_type: 'skipped', user: USER_A }),
    row({ event_type: 'play-started', user: USER_B }),
  ]);
  approx(withOther.score, 1 + 0.5 - 0.75);
  assert.ok(withOther.score > 0);
});

test('74 zero-score song omitted', () => {
  assert.deepEqual(rank([row({ event_type: 'progress', listened_seconds_delta: 0 })]), []);
  assert.deepEqual(rank([row({ event_type: 'stopped' })]), []);
  const skippedOnly = rank([row({ event_type: 'skipped' })]);
  assert.deepEqual(skippedOnly, []);
});

test('75 positive song retained', () => {
  const result = first([row({ event_type: 'completed' })]);
  assert.ok(result.score > 0);
  assert.equal(result.song_id, SONG_1);
});

test('76 higher full score ranks first', () => {
  const results = rank([
    row({ song: SONG_1, event_type: 'play-started', user: USER_A }),
    row({ song: SONG_2, event_type: 'completed', user: USER_B }),
    row({ song: SONG_3, event_type: 'completed', user: USER_C }),
    row({ song: SONG_3, event_type: 'completed', user: USER_A }),
  ]);
  assert.equal(results[0].song_id, SONG_3);
  assert.ok(results[0].score > results[1].score);
  assert.ok(results[1].score > results[2].score);
});

test('77 score tie uses unique_listener_count', () => {
  const oneListener = [
    row({ song: SONG_2, user: USER_A, event_type: 'play-started' }),
    row({ song: SONG_2, user: USER_A, event_type: 'completed' }),
  ];
  const twoListeners = [
    row({ song: SONG_1, user: USER_A, event_type: 'play-started' }),
    row({ song: SONG_1, user: USER_B, event_type: 'play-started' }),
    row({ song: SONG_1, user: USER_A, event_type: 'progress', listened_seconds_delta: 120 }),
  ];
  const results = rank([...oneListener, ...twoListeners]);
  const song1 = results.find((r) => r.song_id === SONG_1);
  const song2 = results.find((r) => r.song_id === SONG_2);
  approx(song1.score, song2.score);
  assert.equal(song1.score, 3.5);
  assert.equal(song2.score, 3.5);
  assert.equal(song1.unique_listener_count, 2);
  assert.equal(song2.unique_listener_count, 1);
  assert.ok(results.indexOf(song1) < results.indexOf(song2));
});

test('78 score+listener tie uses newer last_activity_at', () => {
  const older = [
    row({ song: SONG_1, user: USER_A, event_type: 'completed', createdAt: hoursAgo(24) }),
    row({ song: SONG_1, user: USER_A, event_type: 'completed', createdAt: hoursAgo(24) }),
  ];
  const newer = [
    row({ song: SONG_2, user: USER_B, event_type: 'completed', createdAt: NOW }),
  ];
  const results = rank([...older, ...newer]);
  assert.equal(results[0].score, results[1].score);
  assert.equal(results[0].score, 2);
  assert.equal(results[0].unique_listener_count, results[1].unique_listener_count);
  assert.equal(results[0].song_id, SONG_2);
  assert.equal(results[0].last_activity_at, NOW.toISOString());
});

test('79 remaining tie uses song_id ascending', () => {
  const highId = id(0x22);
  const lowId = id(0x11);
  const build = (song) => [
    row({ song, event_type: 'play-started', user: USER_A, createdAt: hoursAgo(10) }),
    row({ song, event_type: 'completed', user: USER_A, createdAt: hoursAgo(10) }),
  ];
  const results = rank([...build(highId), ...build(lowId)]);
  approx(results[0].score, results[1].score);
  assert.equal(results[0].unique_listener_count, results[1].unique_listener_count);
  assert.equal(results[0].last_activity_at, results[1].last_activity_at);
  assert.equal(results[0].song_id, lowId);
  assert.equal(results[1].song_id, highId);
});

test('80 limit applied after deterministic ranking', () => {
  const events = Array.from({ length: 10 }, (_, i) => row({
    song: id(0x50 + i),
    user: id(0x200 + i),
    event_type: 'completed',
    createdAt: hoursAgo(i),
  }));
  const all = rank(events, { limit: 100 });
  const limited = rank(events, { limit: 3 });
  assert.equal(all.length, 10);
  assert.equal(limited.length, 3);
  assert.deepEqual(limited, all.slice(0, 3));
});

test('81 score returned at six-decimal precision', () => {
  const result = first([
    row({ event_type: 'play-started', createdAt: hoursAgo(12) }),
  ]);
  const expected = (PLAY_STARTED_WEIGHT + UNIQUE_LISTENER_WEIGHT) * trendingDecay(12);
  assert.equal(result.score, Math.round(expected * 1e6) / 1e6);
  const decimals = String(result.score).split('.')[1] ?? '';
  assert.ok(decimals.length <= 6);
});

test('82 ranking uses full precision before output rounding', () => {
  const songA = id(0xffff);
  const songB = id(0x0001);
  const events = [
    row({ song: songA, user: USER_A, event_type: 'play-started', createdAt: NOW }),
    row({ song: songA, user: USER_A, event_type: 'completed', createdAt: NOW }),
    row({ song: songB, user: USER_A, event_type: 'play-started', createdAt: NOW }),
    row({ song: songB, user: USER_B, event_type: 'play-started', createdAt: NOW }),
    row({
      song: songB,
      user: USER_A,
      event_type: 'progress',
      listened_seconds_delta: 120,
      createdAt: hoursAgo(0.001 / 3600),
    }),
  ];
  const results = rank(events);
  assert.equal(results.length, 2);
  assert.equal(results[0].score, results[1].score);
  assert.equal(results[0].song_id, songA);
  assert.equal(results[1].song_id, songB);
  assert.equal(results[1].unique_listener_count, 2);
  assert.equal(results[0].unique_listener_count, 1);
  assert.equal(results[0].score, 3.5);
  assert.equal(results[1].score, 3.5);
});

test('83 multiple songs aggregate independently', () => {
  const results = rank([
    row({ song: SONG_1, event_type: 'completed', user: USER_A }),
    row({ song: SONG_2, event_type: 'play-started', user: USER_B }),
    row({ song: SONG_2, event_type: 'skipped', user: USER_C }),
  ]);
  assert.equal(results.length, 2);
  const s1 = results.find((r) => r.song_id === SONG_1);
  const s2 = results.find((r) => r.song_id === SONG_2);
  approx(s1.score, 2);
  approx(s2.score, 1 + 0.5 - 0.75);
  assert.equal(s1.completed_count, 1);
  assert.equal(s2.play_started_count, 1);
  assert.equal(s2.skipped_count, 1);
});

test('84 same input in different event order yields same ranking', () => {
  const events = [
    row({ song: SONG_1, event_type: 'completed', user: USER_A, createdAt: hoursAgo(3) }),
    row({ song: SONG_1, event_type: 'progress', listened_seconds_delta: 60, user: USER_B, createdAt: hoursAgo(1) }),
    row({ song: SONG_2, event_type: 'play-started', user: USER_A, createdAt: hoursAgo(2) }),
    row({ song: SONG_3, event_type: 'replay-started', user: USER_B, createdAt: hoursAgo(5) }),
    row({ song: SONG_3, event_type: 'completed', user: USER_C, createdAt: hoursAgo(4) }),
    null,
    row({ song: SONG_2, event_type: 'skipped', user: USER_C, createdAt: hoursAgo(6) }),
  ];
  const forward = rank(events);
  const reversed = rank([...events].reverse());
  assert.deepEqual(forward.map((r) => r.song_id), reversed.map((r) => r.song_id));
  assert.deepEqual(forward, reversed);
});

test('85 input events not mutated', () => {
  const events = [
    row({ event_type: 'completed', listened_seconds_delta: 30 }),
    row({ user: USER_B, event_type: 'play-started' }),
    { junk: 1 },
    null,
  ];
  const snapshot = JSON.parse(JSON.stringify(events));
  rank(events);
  assert.deepEqual(JSON.parse(JSON.stringify(events)), snapshot);
});

test('86 identical input + now => deep-equal output', () => {
  const events = Array.from({ length: 12 }, (_, i) => row({
    song: id(0x70 + (i % 4)),
    user: id(0x300 + (i % 3)),
    event_type: ['play-started', 'completed', 'progress', 'skipped'][i % 4],
    listened_seconds_delta: i % 4 === 2 ? 30 * i : 0,
    createdAt: hoursAgo(i * 0.5),
  }));
  const a = rank(events);
  const b = rank(events);
  assert.deepEqual(a, b);
});

test('87 no Date.now dependency in source or scoring', () => {
  const src = readFileSync(new URL('./trendingScoreEngine.js', import.meta.url), 'utf8');
  assert.equal(src.includes('Date.now('), false);
  const early = scoreTrendingSongs([row({ event_type: 'completed' })], {
    now: new Date(NOW.getTime() - 1000),
  });
  assert.deepEqual(early, []);
});

test('88 no Math.random dependency', () => {
  const src = readFileSync(new URL('./trendingScoreEngine.js', import.meta.url), 'utf8');
  assert.equal(src.includes('Math.random('), false);
  const events = [row({ event_type: 'completed' }), row({ song: SONG_2, user: USER_B, event_type: 'completed' })];
  assert.deepEqual(rank(events), rank(events));
});

test('89 output has no user field', () => {
  for (const result of rank([row({ event_type: 'completed' })])) {
    assert.equal('user' in result, false);
    assert.equal('userId' in result, false);
  }
});

test('90 output has no session_id', () => {
  const withSession = rank([row({ event_type: 'completed', session_id: 'session-abc' })]);
  for (const result of withSession) assert.equal('session_id' in result, false);
  assert.equal(JSON.stringify(withSession).includes('session'), false);
});

test('91 output has no event_id', () => {
  const result = rank([row({ event_type: 'completed', event_id: 'evt-1', _id: SONG_1 })]);
  assert.equal(JSON.stringify(result).includes('event_id'), false);
  assert.equal('event_id' in result[0], false);
});

test('92 output has no email/token/JWT', () => {
  const result = rank([row({
    event_type: 'completed',
    email: 'user@example.test',
    token: 'secret',
    jwt: 'secret',
    password: 'secret',
  })]);
  const raw = JSON.stringify(result);
  for (const forbidden of ['user@example.test', 'secret', 'token', 'jwt', 'password', 'email']) {
    assert.equal(raw.includes(forbidden), false);
  }
});

test('93 output does not return raw source event', () => {
  const source = row({
    event_type: 'completed',
    position_seconds: 10,
    duration_seconds: 100,
    seek_from_seconds: 1,
    seek_to_seconds: 2,
    playback_source: 'dashboard',
    client_occurred_at: NOW,
    session_id: 's',
    sequence: 3,
  });
  const result = first([source]);
  assert.deepEqual(Object.keys(result).sort(), [
    'completed_count',
    'last_activity_at',
    'listened_seconds',
    'play_started_count',
    'replay_started_count',
    'score',
    'skipped_count',
    'song_id',
    'unique_listener_count',
  ]);
  assert.equal('position_seconds' in result, false);
  assert.equal('createdAt' in result, false);
  assert.equal('playback_source' in result, false);
  assert.equal('sequence' in result, false);
});

test('94 no recommendation_score field', () => {
  const result = first([row({ event_type: 'completed', recommendation_score: 99 })]);
  assert.equal('recommendation_score' in result, false);
  assert.equal(JSON.stringify(result).includes('recommendation_score'), false);
});

test('95 no preference_score field', () => {
  const result = first([row({ event_type: 'completed', preference_score: 99, affinity: 1 })]);
  assert.equal('preference_score' in result, false);
  assert.equal('affinity' in result, false);
});

test('96 no ML-related field', () => {
  const result = first([row({
    event_type: 'completed',
    embedding: [1, 2],
    prediction: 0.5,
    probability: 0.9,
    weight: 3,
  })]);
  const keys = Object.keys(result);
  for (const forbidden of ['embedding', 'prediction', 'probability', 'weight', 'ml', 'model']) {
    assert.equal(keys.includes(forbidden), false);
  }
});

test('static: coefficients match the documented transparent formula', () => {
  assert.equal(PLAY_STARTED_WEIGHT, 1.0);
  assert.equal(COMPLETED_WEIGHT, 2.0);
  assert.equal(REPLAY_STARTED_WEIGHT, 1.5);
  assert.equal(SKIPPED_WEIGHT, -0.75);
  assert.equal(LISTENED_MINUTE_WEIGHT, 0.25);
  assert.equal(UNIQUE_LISTENER_WEIGHT, 0.5);
  assert.equal(MIN_USER_SONG_CONTRIBUTION, -3);
  assert.equal(MAX_USER_SONG_CONTRIBUTION, 8);
  assert.equal(TRENDING_WINDOW_HOURS, 168);
  assert.equal(TRENDING_HALF_LIFE_HOURS, 24);
  assert.equal(MAX_TRENDING_EVENT_INPUTS, 50000);
  assert.equal(DEFAULT_TRENDING_LIMIT, 20);
  assert.equal(MAX_TRENDING_LIMIT, 100);
  assert.equal(TRENDING_EVENT_INPUT_EXCEEDED_ERROR, 'Trending event input exceeds limit');
});

test('static: engine has no personalization, Favorite/Playlist, Song query, router, or ML imports', () => {
  const src = readFileSync(new URL('./trendingScoreEngine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /explicitPreferenceSignalService|userPreferenceAggregationService/);
  assert.doesNotMatch(src, /\bFavorite\b|\bPlaylist\b/);
  assert.doesNotMatch(src, /SongModel|mongoose|Router\(|express/i);
  assert.doesNotMatch(src, /python|numpy|scipy|scikit|child_process|spawn\(/i);
  assert.doesNotMatch(src, /recommendation_score|preference_score|affinity_score|collaborative|embedding/i);
  assert.doesNotMatch(src, /Date\.now\(|Math\.random\(/);
  assert.doesNotMatch(src, /opts\.userId|options\.userId|input\.userId|genre_preference|artist_preference|userProfile/i);
  assert.doesNotMatch(src, /\.find\(|\.aggregate\(|\.lean\(/);
  assert.doesNotMatch(src, /require\(|import\s+.*from\s+['"]/);
  assert.doesNotMatch(src, /setInterval|setTimeout|\bwhile\s*\(/);
  assert.match(src, /PLAY_STARTED_WEIGHT = 1\.0/);
  assert.match(src, /COMPLETED_WEIGHT = 2\.0/);
  assert.match(src, /REPLAY_STARTED_WEIGHT = 1\.5/);
  assert.match(src, /SKIPPED_WEIGHT = -0\.75/);
  assert.match(src, /LISTENED_MINUTE_WEIGHT = 0\.25/);
  assert.match(src, /UNIQUE_LISTENER_WEIGHT = 0\.5/);
  assert.match(src, /MIN_USER_SONG_CONTRIBUTION = -3/);
  assert.match(src, /MAX_USER_SONG_CONTRIBUTION = 8/);
  assert.match(src, /0\.5 \*\* \(ageHours \/ TRENDING_HALF_LIFE_HOURS\)/);
});

test('static: no fallback, newest-song, or random ranking paths', () => {
  const src = readFileSync(new URL('./trendingScoreEngine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fallback|newest|random|seedSongs/i);
});
