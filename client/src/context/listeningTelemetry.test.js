import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createListeningTelemetryController,
  PROGRESS_EMIT_INTERVAL_SECONDS,
  MAX_LISTENED_DELTA_SECONDS,
  LISTENING_TELEMETRY_DISABLED_MESSAGE,
  TELEMETRY_EVENT_FIELDS,
} from './listeningTelemetry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALLOWED = new Set(TELEMETRY_EVENT_FIELDS);

const FIXED_DATE = new Date('2026-09-15T12:00:00.000Z');

function createHarness(overrides = {}) {
  const sent = [];
  const historyCalls = [];
  let idCounter = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const options = {
    sendEvent: async (payload) => {
      concurrent += 1;
      if (concurrent > maxConcurrent) maxConcurrent = concurrent;
      sent.push(payload);
      concurrent -= 1;
      return { success: true };
    },
    recordHistory: (songId) => {
      historyCalls.push(songId);
      return Promise.resolve();
    },
    makeId: () => {
      idCounter += 1;
      return `id-${idCounter}`;
    },
    now: () => FIXED_DATE,
    progressIntervalSeconds: PROGRESS_EMIT_INTERVAL_SECONDS,
    hasAuthToken: () => true,
    ...overrides,
  };
  const controller = createListeningTelemetryController(options);
  return { controller, sent, historyCalls, options, getMaxConcurrent: () => maxConcurrent };
}

async function startPlayback(h, song = 'song-1', position = 0, duration = 200) {
  h.controller.prepare(song);
  h.controller.confirmedPlay({ position, duration });
  await h.controller.whenIdle();
}

test('1: prepare sends nothing', async () => {
  const h = createHarness();
  h.controller.prepare('song-1');
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 0);
});

test('2: confirmed first playback emits play-started', async () => {
  const h = createHarness();
  await startPlayback(h);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].event_type, 'play-started');
  assert.equal(h.sent[0].song, 'song-1');
});

test('3: first sequence is 0', async () => {
  const h = createHarness();
  await startPlayback(h);
  assert.equal(h.sent[0].sequence, 0);
});

test('4: play-started once only', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.filter((e) => e.event_type === 'play-started').length, 1);
});

test('5: repeated playing after start emits no duplicate play-started', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.confirmedPlay({ position: 5, duration: 200 });
  h.controller.confirmedPlay({ position: 6, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 1);
});

test('6: new track creates a new session id', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1');
  await startPlayback(h, 'song-2');
  assert.equal(h.sent.length, 2);
  assert.notEqual(h.sent[0].session_id, h.sent[1].session_id);
  assert.equal(h.sent[1].song, 'song-2');
});

test('7: event ids are unique', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  const ids = h.sent.map((e) => e.event_id);
  assert.equal(new Set(ids).size, ids.length);
});

test('8: payloads never include user or userId', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  h.controller.seek({ from: 10, to: 40, duration: 200 });
  h.controller.progress({ position: 60, duration: 200 });
  h.controller.complete({ position: 200, duration: 200 });
  await h.controller.whenIdle();
  for (const payload of h.sent) {
    assert.equal('user' in payload, false);
    assert.equal('userId' in payload, false);
    assert.equal('token' in payload, false);
  }
});

test('9: events are serialized (no concurrent sends)', async () => {
  let active = 0;
  let maxActive = 0;
  const h = createHarness({
    sendEvent: async (payload) => {
      active += 1;
      if (active > maxActive) maxActive = active;
      await new Promise((r) => setTimeout(r, 5));
      h.sent.push(payload);
      active -= 1;
      return { success: true };
    },
  });
  h.sent = h.sent;
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  h.controller.seek({ from: 10, to: 30, duration: 200 });
  h.controller.complete({ position: 200, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(maxActive, 1);
});

test('10: sequences strictly increase per session', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 20, duration: 200 });
  h.controller.confirmedPlay({ position: 20, duration: 200 });
  h.controller.seek({ from: 20, to: 50, duration: 200 });
  h.controller.complete({ position: 200, duration: 200 });
  await h.controller.whenIdle();
  const sequences = h.sent.map((e) => e.sequence);
  for (let i = 1; i < sequences.length; i += 1) {
    assert.ok(sequences[i] > sequences[i - 1], `sequence ${sequences[i]} !> ${sequences[i - 1]}`);
  }
  assert.equal(sequences[0], 0);
});

test('11: rejected send does not break the queue', async () => {
  const h = createHarness({
    sendEvent: async (payload) => {
      h.sent.push(payload);
      if (h.sent.length === 1) throw new Error('network down');
      return { success: true };
    },
  });
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 4);
  assert.equal(h.sent[0].event_type, 'play-started');
  assert.equal(h.sent[1].event_type, 'progress');
  assert.equal(h.sent[2].event_type, 'paused');
  assert.equal(h.sent[3].event_type, 'resumed');
});

test('12: no retry after failed send', async () => {
  let calls = 0;
  const h = createHarness({
    sendEvent: async () => {
      calls += 1;
      throw new Error('fail');
    },
  });
  await startPlayback(h);
  await h.controller.whenIdle();
  assert.equal(calls, 1);
});

test('13: failed event leaves a sequence gap', async () => {
  const h = createHarness({
    sendEvent: async (payload) => {
      if (payload.sequence === 0) {
        throw new Error('fail first');
      }
      h.sent.push(payload);
      return { success: true };
    },
  });
  await startPlayback(h);
  h.controller.pause({ position: 0, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].event_type, 'paused');
  assert.equal(h.sent[0].sequence, 1);
});

test('14: progress before confirmed start is ignored', async () => {
  const h = createHarness();
  h.controller.prepare('song-1');
  h.controller.progress({ position: 0, duration: 200 });
  h.controller.progress({ position: 20, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 0);
});

test('15: progress below threshold emits nothing', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 200);
  h.controller.progress({ position: PROGRESS_EMIT_INTERVAL_SECONDS - 1, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 1);
});

test('16: progress at threshold emits', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 200);
  h.controller.progress({ position: PROGRESS_EMIT_INTERVAL_SECONDS, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].event_type, 'progress');
  assert.equal(h.sent[1].listened_seconds_delta, PROGRESS_EMIT_INTERVAL_SECONDS);
});

test('17: progress delta equals forward position advance', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 10, 200);
  h.controller.progress({ position: 40, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent[1].listened_seconds_delta, 30);
});

test('18: listened delta never exceeds 120 seconds', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 86400);
  h.controller.progress({ position: 5000, duration: 86400 });
  await h.controller.whenIdle();
  assert.equal(h.sent[1].listened_seconds_delta, MAX_LISTENED_DELTA_SECONDS);
});

test('19: backward movement is not counted as positive listening', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 50, 200);
  h.controller.progress({ position: 20, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 1);
});

test('20: repeated progress ticks do not spam under threshold', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 200);
  for (let t = 1; t < PROGRESS_EMIT_INTERVAL_SECONDS; t += 1) {
    h.controller.progress({ position: t, duration: 200 });
  }
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 1);
});

test('21: pause emits paused', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.at(-1).event_type, 'paused');
});

test('22: duplicate pause callbacks do not emit twice', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.pause({ position: 11, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.filter((e) => e.event_type === 'paused').length, 1);
});

test('23: paused payload has no positive listened delta', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 200);
  h.controller.progress({ position: 16, duration: 200 });
  h.controller.pause({ position: 16, duration: 200 });
  await h.controller.whenIdle();
  const paused = h.sent.find((e) => e.event_type === 'paused');
  assert.equal(paused.listened_seconds_delta, undefined);
});

test('24: playing after pause emits resumed', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.at(-1).event_type, 'resumed');
});

test('25: resume does not emit a second play-started', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 12, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.filter((e) => e.event_type === 'play-started').length, 1);
});

test('26: resumed payload has zero/omitted listened delta', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  const resumed = h.sent.find((e) => e.event_type === 'resumed');
  assert.equal(resumed.listened_seconds_delta, undefined);
});

test('27: paused wall-clock time is not listened time', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 10, 200);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  h.controller.progress({ position: 25, duration: 200 });
  await h.controller.whenIdle();
  const progressEvents = h.sent.filter((e) => e.event_type === 'progress');
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0].listened_seconds_delta, 15);
});

test('28: seek emits seeked with from/to', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 10, 200);
  h.controller.seek({ from: 10, to: 80, duration: 200 });
  await h.controller.whenIdle();
  const seeked = h.sent.find((e) => e.event_type === 'seeked');
  assert.ok(seeked);
  assert.equal(seeked.seek_from_seconds, 10);
  assert.equal(seeked.seek_to_seconds, 80);
});

test('29: seek event has no positive listened delta', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 10, 200);
  h.controller.seek({ from: 10, to: 80, duration: 200 });
  await h.controller.whenIdle();
  const seeked = h.sent.find((e) => e.event_type === 'seeked');
  assert.equal(seeked.listened_seconds_delta, undefined);
});

test('30: forward seek distance is never listened progress', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 10, 200);
  h.controller.seek({ from: 10, to: 100, duration: 200 });
  h.controller.progress({ position: 110, duration: 200 });
  await h.controller.whenIdle();
  const progressEvents = h.sent.filter((e) => e.event_type === 'progress');
  assert.equal(progressEvents.length, 0);
  h.controller.progress({ position: 115, duration: 200 });
  await h.controller.whenIdle();
  const after = h.sent.filter((e) => e.event_type === 'progress');
  assert.equal(after.length, 1);
  assert.equal(after[0].listened_seconds_delta, 15);
  assert.equal(after[0].position_seconds, 115);
  const seeked = h.sent.find((e) => e.event_type === 'seeked');
  assert.equal(seeked.seek_to_seconds, 100);
});

test('31: backward seek resets the baseline', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 50, 200);
  h.controller.seek({ from: 50, to: 5, duration: 200 });
  h.controller.progress({ position: 20, duration: 200 });
  await h.controller.whenIdle();
  const progressEvents = h.sent.filter((e) => e.event_type === 'progress');
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0].listened_seconds_delta, 15);
});

test('32: forward seek resets the baseline', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 200);
  h.controller.seek({ from: 0, to: 100, duration: 200 });
  h.controller.progress({ position: 110, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.filter((e) => e.event_type === 'progress').length, 0);
});

test('33: invalid seek values do not emit seeked', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.seek({ from: NaN, to: 40, duration: 200 });
  h.controller.seek({ from: 10, to: Infinity, duration: 200 });
  h.controller.seek({ from: undefined, to: 40, duration: 200 });
  h.controller.seek({ from: 10, to: 'x', duration: 200 });
  h.controller.seek({ from: -5, to: 40, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.filter((e) => e.event_type === 'seeked').length, 0);
});

test('34: natural end emits completed', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 100);
  h.controller.complete({ position: 100, duration: 100 });
  await h.controller.whenIdle();
  assert.equal(h.sent.at(-1).event_type, 'completed');
});

test('35: completed is emitted once only', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 100);
  h.controller.complete({ position: 100, duration: 100 });
  h.controller.complete({ position: 100, duration: 100 });
  await h.controller.whenIdle();
  assert.equal(h.sent.filter((e) => e.event_type === 'completed').length, 1);
});

test('36: remaining progress is flushed before completed', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 100);
  h.controller.progress({ position: 5, duration: 100 });
  h.controller.complete({ position: 100, duration: 100 });
  await h.controller.whenIdle();
  const types = h.sent.map((e) => e.event_type);
  const progressIdx = types.lastIndexOf('progress');
  const completedIdx = types.indexOf('completed');
  assert.ok(progressIdx >= 0);
  assert.ok(progressIdx < completedIdx);
  const flushed = h.sent[progressIdx];
  assert.equal(flushed.listened_seconds_delta, 100);
});

test('37: no completion_percentage field', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 100);
  h.controller.complete({ position: 100, duration: 100 });
  await h.controller.whenIdle();
  for (const payload of h.sent) {
    assert.equal('completion_percentage' in payload, false);
  }
});

test('38: terminal session emits no further progress/pause/seek', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 100);
  h.controller.complete({ position: 100, duration: 100 });
  h.controller.progress({ position: 50, duration: 100 });
  h.controller.pause({ position: 50, duration: 100 });
  h.controller.seek({ from: 10, to: 20, duration: 100 });
  await h.controller.whenIdle();
  const after = h.sent.slice(h.sent.findIndex((e) => e.event_type === 'completed') + 1);
  assert.equal(after.length, 0);
});

test('39: disabled result stops subsequent sends', async () => {
  const h = createHarness({
    sendEvent: async (payload) => {
      h.sent.push(payload);
      return { success: false, error: LISTENING_TELEMETRY_DISABLED_MESSAGE };
    },
  });
  await startPlayback(h);
  assert.equal(h.controller.isDisabled(), true);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.length, 1);
});

test('40: disabled result does not throw to the caller', async () => {
  const h = createHarness({
    sendEvent: async () => ({ disabled: true }),
  });
  await startPlayback(h);
  h.controller.pause({ position: 5, duration: 100 });
  assert.equal(h.controller.isDisabled(), true);
});

test('41: non-503 failure does not disable telemetry', async () => {
  const h = createHarness({
    sendEvent: async () => {
      throw new Error('network hiccup');
    },
  });
  await startPlayback(h);
  assert.equal(h.controller.isDisabled(), false);
  h.controller.pause({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.controller.isDisabled(), false);
});

test('42: no automatic retry after failure', async () => {
  let calls = 0;
  const h = createHarness({
    sendEvent: async () => {
      calls += 1;
      throw new Error('boom');
    },
  });
  await startPlayback(h);
  h.controller.pause({ position: 0, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(calls, 2);
});

test('43: raw error text is not written into later payloads', async () => {
  const h = createHarness({
    sendEvent: async (payload) => {
      h.sent.push(payload);
      if (h.sent.length === 1) throw new Error('secret-stack-trace-xyz');
      return { success: true };
    },
  });
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  for (const payload of h.sent) {
    assert.equal(JSON.stringify(payload).includes('secret-stack-trace-xyz'), false);
  }
});

test('44: input song objects are not mutated', async () => {
  const h = createHarness();
  const song = { _id: 'abc123', title: 'Test' };
  const snapshot = JSON.stringify(song);
  h.controller.prepare(song);
  h.controller.confirmedPlay({ position: 0, duration: 100 });
  await h.controller.whenIdle();
  assert.equal(JSON.stringify(song), snapshot);
});

test('45: only allowed telemetry fields appear in payloads', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  h.controller.confirmedPlay({ position: 10, duration: 200 });
  h.controller.seek({ from: 10, to: 40, duration: 200 });
  h.controller.complete({ position: 200, duration: 200 });
  await h.controller.whenIdle();
  for (const payload of h.sent) {
    for (const key of Object.keys(payload)) {
      assert.ok(ALLOWED.has(key), `unexpected field: ${key}`);
    }
  }
});

test('46: no score or weight fields in payloads', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 10, duration: 200 });
  await h.controller.whenIdle();
  for (const payload of h.sent) {
    assert.equal('score' in payload, false);
    assert.equal('weight' in payload, false);
    assert.equal('confidence' in payload, false);
  }
});

test('47: no auth token fields in payloads', async () => {
  const h = createHarness();
  await startPlayback(h);
  await h.controller.whenIdle();
  const raw = JSON.stringify(h.sent);
  assert.equal(raw.includes('melodify_token'), false);
  assert.equal(raw.includes('Authorization'), false);
  assert.equal(raw.includes('jwt'), false);
});

test('48: deterministic with injected clock and ids', async () => {
  const h1 = createHarness();
  const h2 = createHarness();
  await startPlayback(h1);
  await startPlayback(h2);
  h1.controller.pause({ position: 10, duration: 200 });
  h2.controller.pause({ position: 10, duration: 200 });
  await Promise.all([h1.controller.whenIdle(), h2.controller.whenIdle()]);
  assert.deepEqual(h1.sent, h2.sent);
});

test('static: PlayerContext owns one telemetry controller', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  assert.match(src, /createListeningTelemetryController/);
  const matches = src.match(/createListeningTelemetryController\(/g) || [];
  assert.equal(matches.length, 1);
  assert.match(src, /telemetryRef/);
});

test('static: play-started only from confirmed media playback', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  assert.match(src, /confirmedPlay\(/);
  assert.match(src, /PlayerState\.PLAYING/);
  assert.match(src, /addEventListener\('play'/);
  const playSongBlock = src.slice(src.indexOf('const switchTrack'), src.indexOf('playSongRef.current = switchTrack'));
  assert.equal(playSongBlock.includes('confirmedPlay'), false);
  assert.equal(playSongBlock.includes("emit('play-started'"), false);
});

test('static: forwards pause, seek, completion, progress', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  assert.match(src, /\.pause\(\{/);
  assert.match(src, /\.seek\(\{/);
  assert.match(src, /\.complete\(\{/);
  assert.match(src, /\.progress\(\{/);
  assert.match(src, /PlayerState\.PAUSED/);
  assert.match(src, /PlayerState\.ENDED/);
});

test('static: no client secret keys or ML score fields', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  assert.equal(src.includes('YOUTUBE_API_KEY'), false);
  assert.equal(src.includes('API_KEY'), false);
  assert.equal(src.includes('relevance_score'), false);
  assert.equal(src.includes('confidence_score'), false);
  assert.equal(src.includes('user_score'), false);
});

test('static: Dashboard click history write removed', () => {
  const src = readFileSync(
    join(__dirname, '..', 'pages', 'Dashboard', 'Dashboard.jsx'),
    'utf8',
  );
  assert.equal(src.includes("api.post('/api/history'"), false);
  assert.equal(src.includes('recordPlay'), false);
  assert.match(src, /api\.get\('\/api\/history'\)/);
});

const eventTypes = (h) => h.sent.map((event) => event.event_type);

for (const reason of ['manual-next', 'manual-previous', 'new-selection']) {
  test(`16/43: ${reason} flushes final progress then closes the started session once`, async () => {
    const h = createHarness();
    await startPlayback(h);
    const sessionId = h.sent[0].session_id;
    h.controller.progress({ position: 15, duration: 200 });
    h.controller.skip({ reason, position: 22, duration: 200 });
    h.controller.skip({ reason, position: 22, duration: 200 });
    h.controller.progress({ position: 40, duration: 200 });
    h.controller.pause({ position: 22, duration: 200 });
    h.controller.seek({ from: 22, to: 0, duration: 200 });
    h.controller.complete({ position: 200, duration: 200 });
    h.controller.confirmedPlay({ position: 0, duration: 200 });
    await h.controller.whenIdle();
    assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'progress', 'skipped']);
    assert.equal(h.sent[2].listened_seconds_delta, 7);
    assert.deepEqual(h.sent.map((event) => event.sequence), [0, 1, 2, 3]);
    assert.ok(h.sent.every((event) => event.session_id === sessionId));
    const skipped = h.sent.at(-1);
    assert.equal(skipped.transition_reason, reason);
    assert.equal(skipped.position_seconds, 22);
    assert.equal(skipped.duration_seconds, 200);
    assert.equal(skipped.listened_seconds_delta, undefined);
    assert.equal(h.controller.getSessionSnapshot().terminal, true);
    assert.equal(h.controller.getSessionSnapshot().terminalType, 'skipped');
    assert.deepEqual(h.historyCalls, ['song-1']);
  });

  test(`16/43: ${reason} discards unstarted selection without invalid terminal events`, async () => {
    const h = createHarness();
    h.controller.prepare('song-1');
    const unstartedId = h.controller.getSessionSnapshot().sessionId;
    h.controller.skip({ reason, position: 0, duration: 200 });
    h.controller.prepare('song-2');
    await h.controller.whenIdle();
    assert.deepEqual(h.sent, []);
    assert.deepEqual(h.historyCalls, []);
    assert.notEqual(h.controller.getSessionSnapshot().sessionId, unstartedId);
    h.controller.confirmedPlay({ position: 0, duration: 200 });
    await h.controller.whenIdle();
    assert.deepEqual(eventTypes(h), ['play-started']);
    assert.equal(h.sent[0].song, 'song-2');
    assert.equal(h.sent[0].sequence, 0);
  });
}

test('16/43: direct different-song selection waits for confirmation and records history once', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.skip({ reason: 'new-selection', position: 5, duration: 200 });
  h.controller.prepare({ _id: 'song-2' });
  const nextSession = h.controller.getSessionSnapshot();
  assert.equal(nextSession.started, false);
  assert.notEqual(nextSession.sessionId, h.sent[0].session_id);
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'skipped']);
  assert.deepEqual(h.historyCalls, ['song-1']);
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  h.controller.confirmedPlay({ position: 1, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.at(-1).event_type, 'play-started');
  assert.equal(h.sent.at(-1).song, 'song-2');
  assert.equal(h.sent.at(-1).sequence, 0);
  assert.deepEqual(h.historyCalls, ['song-1', 'song-2']);
});

test('16/43: paused abandonment emits skip without counting paused position advance', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.pause({ position: 5, duration: 200 });
  h.controller.skip({ reason: 'new-selection', position: 25, duration: 200 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'paused', 'skipped']);
  assert.equal(h.sent[1].listened_seconds_delta, 5);
  assert.equal(h.sent.at(-1).listened_seconds_delta, undefined);
});

test('16/43: skip accepts only manual transition reasons', async () => {
  const h = createHarness();
  await startPlayback(h);
  for (const reason of [undefined, null, 'track-ended', 'repeat', 'player-error', 'unknown', 'next']) {
    h.controller.skip({ reason, position: 10, duration: 200 });
  }
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started']);
  assert.equal(h.controller.getSessionSnapshot().terminal, false);
});

test('16/43: natural completion and automatic next song never emit a manual skip', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 30);
  h.controller.complete({ position: 30, duration: 30 });
  // Even a manual selection after completion cannot abandon a terminal session.
  h.controller.skip({ reason: 'manual-next', position: 30, duration: 30 });
  h.controller.prepare('song-2');
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'completed']);
  h.controller.confirmedPlay({ position: 0, duration: 30 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'completed', 'play-started']);
  assert.notEqual(h.sent[0].session_id, h.sent.at(-1).session_id);
  assert.equal(h.sent.at(-1).sequence, 0);
  assert.ok(h.sent.every((event) => event.transition_reason === undefined));
});

test('16/43: completed same track replays only on confirmation, in the same session and sequence', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 30);
  h.controller.complete({ position: 30, duration: 30 });
  const terminal = h.controller.getSessionSnapshot();
  // Reload/seek intent alone is not confirmed playback (also covers one-song list wrap).
  assert.equal(h.controller.prepare({ _id: 'song-1' }), false);
  h.controller.seek({ from: 30, to: 0, duration: 30 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'completed']);
  assert.deepEqual(h.controller.getSessionSnapshot(), terminal);
  h.controller.confirmedPlay({ position: 2, duration: 30 });
  h.controller.confirmedPlay({ position: 3, duration: 30 });
  await h.controller.whenIdle();
  const replay = h.sent.at(-1);
  assert.equal(replay.event_type, 'replay-started');
  assert.equal(replay.session_id, terminal.sessionId);
  assert.equal(replay.sequence, terminal.nextSequence);
  assert.equal(replay.transition_reason, 'repeat');
  assert.equal(replay.position_seconds, 2);
  assert.equal(replay.duration_seconds, 30);
  assert.equal(replay.client_occurred_at, FIXED_DATE.toISOString());
  assert.equal(replay.listened_seconds_delta, undefined);
  assert.equal(h.sent.filter((event) => event.event_type === 'play-started').length, 1);
  assert.equal(h.sent.filter((event) => event.event_type === 'replay-started').length, 1);
  assert.equal(h.controller.getSessionSnapshot().terminal, false);
  assert.equal(h.controller.getSessionSnapshot().paused, false);
  assert.equal(h.controller.getSessionSnapshot().baselinePosition, 2);
  assert.deepEqual(h.historyCalls, ['song-1']);
});

test('16/43: multiple replay cycles support fresh progress, pause, resume, seek and completion', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 100);
  h.controller.complete({ position: 100, duration: 100 });
  for (let cycle = 0; cycle < 2; cycle += 1) {
    h.controller.confirmedPlay({ position: 2, duration: 100 });
    h.controller.progress({ position: 16, duration: 100 }); // below reset threshold
    h.controller.progress({ position: 17, duration: 100 });
    h.controller.pause({ position: 20, duration: 100 });
    h.controller.confirmedPlay({ position: 20, duration: 100 });
    h.controller.seek({ from: 20, to: 80, duration: 100 });
    h.controller.progress({ position: 95, duration: 100 });
    h.controller.complete({ position: 100, duration: 100 });
  }
  await h.controller.whenIdle();
  const cycleTypes = ['replay-started', 'progress', 'progress', 'paused', 'resumed', 'seeked', 'progress', 'progress', 'completed'];
  assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'completed', ...cycleTypes, ...cycleTypes]);
  assert.deepEqual(h.sent.filter((event) => event.event_type === 'progress').map((event) => event.listened_seconds_delta),
    [100, 15, 3, 15, 5, 15, 3, 15, 5]);
  assert.deepEqual(h.sent.map((event) => event.sequence), h.sent.map((_, i) => i));
  assert.equal(new Set(h.sent.map((event) => event.session_id)).size, 1);
  assert.equal(new Set(h.sent.map((event) => event.event_id)).size, h.sent.length);
  assert.equal(h.controller.getSessionSnapshot().terminalType, 'completed');
  assert.deepEqual(h.historyCalls, ['song-1']);
});

test('16/43: skipped track reselected later gets a fresh confirmed start, never replay', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.skip({ reason: 'manual-next', position: 0, duration: 200 });
  h.controller.confirmedPlay({ position: 0, duration: 200 }); // stale callback is ignored
  h.controller.prepare('song-1');
  assert.equal(h.controller.getSessionSnapshot().started, false);
  assert.notEqual(h.controller.getSessionSnapshot().sessionId, h.sent[0].session_id);
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'skipped', 'play-started']);
  assert.equal(h.sent.at(-1).sequence, 0);
  assert.deepEqual(h.historyCalls, ['song-1', 'song-1']);
});

test('16/43: returning to a completed track after another selection is a fresh session', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.complete({ position: 200, duration: 200 });
  h.controller.prepare('song-2');
  h.controller.prepare('song-1');
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.sent.at(-1).event_type, 'play-started');
  assert.notEqual(h.sent.at(-1).session_id, h.sent[0].session_id);
  assert.equal(eventTypes(h).includes('replay-started'), false);
});

test('16/43: same active song reload uses seek without skip, replay, or a second start', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 50, 200);
  h.controller.seek({ from: 55, to: 0, duration: 200 });
  assert.equal(h.controller.prepare({ _id: 'song-1' }), false);
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  h.controller.progress({ position: 15, duration: 200 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'seeked', 'progress']);
  assert.deepEqual(h.sent.filter((event) => event.event_type === 'progress').map((event) => event.listened_seconds_delta), [5, 15]);
  assert.deepEqual(h.historyCalls, ['song-1']);
});

test('16/43: unstarted song cannot complete or replay', async () => {
  const h = createHarness();
  h.controller.skip({ reason: 'manual-next' });
  h.controller.confirmedPlay();
  h.controller.prepare('song-1');
  h.controller.complete({ position: 200, duration: 200 });
  h.controller.prepare('song-1');
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started']);
});

test('16/43: same paused song reload resumes with a reset baseline and no fabricated replay', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 50, 200);
  h.controller.pause({ position: 50, duration: 200 });
  h.controller.prepare({ _id: 'song-1' });
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  h.controller.progress({ position: 15, duration: 200 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'paused', 'resumed', 'progress']);
  assert.equal(h.sent.at(-1).listened_seconds_delta, 15);
  assert.deepEqual(h.historyCalls, ['song-1']);
});

test('16/43: active seek to zero plus confirmed playing is not replay', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 20, 200);
  h.controller.seek({ from: 20, to: 0, duration: 200 });
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'seeked']);
});

for (const terminalType of ['skipped', 'completed']) {
  test(`16/43: delayed ${terminalType} sends preserve queue order without blocking state`, async () => {
    let release;
    let notify;
    const entered = new Promise((resolve) => { notify = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    let active = 0;
    let maxActive = 0;
    const h = createHarness({
      sendEvent: async (payload) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        h.sent.push(payload);
        if (payload.event_type === 'progress') {
          notify();
          await gate;
        }
        active -= 1;
      },
    });
    const { controller: c, sent } = h;
    c.prepare('song-1');
    c.confirmedPlay({ position: 0, duration: 30 });
    if (terminalType === 'skipped') {
      c.skip({ reason: 'manual-next', position: 5, duration: 30 });
      c.prepare('song-2');
    } else {
      c.complete({ position: 30, duration: 30 });
    }
    c.confirmedPlay({ position: 0, duration: 30 });
    assert.equal(c.getSessionSnapshot().started, true);
    assert.equal(c.getSessionSnapshot().terminal, false);
    await entered;
    assert.deepEqual(sent.map((event) => event.event_type), ['play-started', 'progress']);
    release();
    await c.whenIdle();
    assert.equal(maxActive, 1);
    assert.deepEqual(sent.map((event) => event.event_type),
      ['play-started', 'progress', terminalType, terminalType === 'skipped' ? 'play-started' : 'replay-started']);
    assert.deepEqual(sent.slice(0, 3).map((event) => event.sequence), [0, 1, 2]);
    if (terminalType === 'completed') {
      assert.equal(sent[3].session_id, sent[2].session_id);
      assert.equal(sent[3].sequence, 3);
    }
  });
}

for (const failedType of ['skipped', 'replay-started']) {
  test(`16/43: failed ${failedType} is never retried and later queued events continue`, async () => {
    const attempts = [];
    const h = createHarness({
      sendEvent: async (payload) => {
        attempts.push(payload);
        if (payload.event_type === failedType) throw new Error('offline');
        h.sent.push(payload);
      },
    });
    await startPlayback(h, 'song-1', 0, 30);
    if (failedType === 'skipped') {
      h.controller.skip({ reason: 'manual-next', position: 5, duration: 30 });
      h.controller.prepare('song-2');
    } else {
      h.controller.complete({ position: 30, duration: 30 });
    }
    h.controller.confirmedPlay({ position: 0, duration: 30 });
    h.controller.progress({ position: 15, duration: 30 });
    await h.controller.whenIdle();
    await h.controller.whenIdle();
    assert.equal(attempts.filter((event) => event.event_type === failedType).length, 1);
    assert.equal(h.sent.at(-1).event_type, 'progress');
    assert.equal(h.controller.getSessionSnapshot().terminal, false);
    assert.equal(h.controller.isDisabled(), false);
    if (failedType === 'replay-started') {
      assert.deepEqual(h.sent.map((event) => event.sequence), [0, 1, 2, 4]);
    } else {
      assert.equal(h.sent.at(-1).song, 'song-2');
      assert.notEqual(h.sent.at(-1).session_id, h.sent[0].session_id);
    }
  });
}

test('16/43: runtime 503 blocks skip/replay sends while navigation, replay state and history continue', async () => {
  const h = createHarness({
    sendEvent: async (payload) => {
      h.sent.push(payload);
      return { error: LISTENING_TELEMETRY_DISABLED_MESSAGE };
    },
  });
  await startPlayback(h);
  h.controller.skip({ reason: 'manual-next', position: 5, duration: 200 });
  h.controller.prepare('song-2');
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  h.controller.confirmedPlay({ position: 1, duration: 200 });
  h.controller.complete({ position: 200, duration: 200 });
  const sessionId = h.controller.getSessionSnapshot().sessionId;
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  h.controller.skip({ reason: 'manual-previous', position: 5, duration: 200 });
  h.controller.prepare('song-1');
  h.controller.confirmedPlay({ position: 0, duration: 200 });
  await h.controller.whenIdle();
  assert.equal(h.controller.isDisabled(), true);
  assert.deepEqual(eventTypes(h), ['play-started']);
  assert.notEqual(h.controller.getSessionSnapshot().sessionId, sessionId);
  assert.equal(h.controller.getSessionSnapshot().started, true);
  assert.deepEqual(h.historyCalls, ['song-1', 'song-2', 'song-1']);
});

test('16/43: 503 also drops already queued skip/replay requests', async () => {
  const h = createHarness({
    sendEvent: async (payload) => {
      h.sent.push(payload);
      return { disabled: true };
    },
  });
  h.controller.prepare('song-1');
  h.controller.confirmedPlay({ position: 0, duration: 30 });
  h.controller.complete({ position: 30, duration: 30 });
  h.controller.confirmedPlay({ position: 0, duration: 30 });
  h.controller.skip({ reason: 'new-selection', position: 5, duration: 30 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started']);
  assert.deepEqual(h.historyCalls, ['song-1']);
});

test('16/43: skip/replay sends remain auth-gated', async () => {
  let authenticated = true;
  const h = createHarness({ hasAuthToken: () => authenticated });
  await startPlayback(h, 'song-1', 0, 30);
  h.controller.complete({ position: 30, duration: 30 });
  await h.controller.whenIdle();
  authenticated = false;
  h.controller.confirmedPlay({ position: 0, duration: 30 });
  h.controller.skip({ reason: 'manual-next', position: 5, duration: 30 });
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h), ['play-started', 'progress', 'completed']);
});

for (const invalid of [NaN, Infinity, -1, 86401, '10', null, undefined]) {
  test(`16/43: skip/replay reuse numeric sanitizers for ${String(invalid)}`, async () => {
    const h = createHarness();
    await startPlayback(h, 'song-1', 0, 30);
    h.controller.complete({ position: 30, duration: 30 });
    h.controller.confirmedPlay({ position: invalid, duration: invalid });
    h.controller.skip({ reason: 'manual-next', position: invalid, duration: invalid });
    await h.controller.whenIdle();
    for (const payload of h.sent.slice(-2)) {
      assert.equal(payload.position_seconds, undefined);
      assert.equal(payload.duration_seconds, undefined);
      assert.equal(payload.listened_seconds_delta, undefined);
    }
  });
}

test('16/43: skip flush stays capped and numeric boundary values remain valid', async () => {
  const h = createHarness();
  await startPlayback(h, 'song-1', 0, 86400);
  h.controller.skip({ reason: 'manual-next', position: 86400, duration: 86400 });
  h.controller.prepare('song-2');
  h.controller.confirmedPlay({ position: 0, duration: 30 });
  h.controller.complete({ position: 30, duration: 30 });
  h.controller.confirmedPlay({ position: 0, duration: 0 });
  await h.controller.whenIdle();
  assert.equal(h.sent[1].listened_seconds_delta, MAX_LISTENED_DELTA_SECONDS);
  assert.equal(h.sent[2].position_seconds, 86400);
  assert.equal(h.sent[2].duration_seconds, 86400);
  assert.equal(h.sent.at(-1).position_seconds, 0);
  assert.equal(h.sent.at(-1).duration_seconds, undefined);
});

test('16/43: skip after seek counts only listening from the destination', async () => {
  const h = createHarness();
  await startPlayback(h);
  h.controller.seek({ from: 5, to: 150, duration: 200 });
  h.controller.skip({ reason: 'manual-next', position: 155, duration: 200 });
  await h.controller.whenIdle();
  assert.deepEqual(h.sent.filter((event) => event.event_type === 'progress').map((event) => event.listened_seconds_delta), [5, 5]);
  assert.equal(h.sent.at(-1).listened_seconds_delta, undefined);
});

test('16/43: skip/replay whitelist excludes injected identity, credentials and derived fields without mutation', async () => {
  const h = createHarness();
  const song = Object.freeze({ _id: 'song-1', user: 'ignored' });
  const input = Object.freeze({
    reason: 'new-selection', position: 0, duration: 30,
    user: 'ignored', userId: 'ignored', token: 'ignored', jwt: 'ignored',
    score: 9, weight: 9, preference: 9, replay_count: 9, completion_percentage: 100,
  });
  const before = JSON.stringify({ song, input });
  await startPlayback(h, song, 0, 30);
  h.controller.complete({ position: 30, duration: 30 });
  h.controller.confirmedPlay(input);
  h.controller.skip(input);
  await h.controller.whenIdle();
  assert.deepEqual(eventTypes(h).slice(-2), ['replay-started', 'skipped']);
  for (const payload of h.sent.slice(-2)) {
    assert.ok(Object.keys(payload).every((key) => ALLOWED.has(key)));
    assert.equal(JSON.stringify(payload).includes('ignored'), false);
    assert.equal(payload.listened_seconds_delta, undefined);
  }
  assert.equal(JSON.stringify({ song, input }), before);
});

test('16/43: skip and replay remain deterministic with injected ids and clock', async () => {
  const h1 = createHarness();
  const h2 = createHarness();
  for (const h of [h1, h2]) {
    await startPlayback(h, 'song-1', 0, 30);
    h.controller.complete({ position: 30, duration: 30 });
    h.controller.confirmedPlay({ position: 0, duration: 30 });
    h.controller.skip({ reason: 'manual-next', position: 5, duration: 30 });
    await h.controller.whenIdle();
  }
  assert.deepEqual(h1.sent, h2.sent);
  assert.ok(h1.sent.every((event) => event.client_occurred_at === FIXED_DATE.toISOString()));
});

test('16/43 static: public manual actions share one skip classifier with explicit internal intent', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  const switchBlock = src.slice(src.indexOf('const switchTrack'), src.indexOf('const playSong ='));
  assert.equal((src.match(/telemetry\.skip\(/g) || []).length, 1);
  assert.match(switchBlock, /if \(!sameTrack && transitionReason\)/);
  assert.match(switchBlock, /songId === String\(song\._id\)/);
  assert.ok(switchBlock.indexOf('telemetry.skip(') < switchBlock.indexOf('telemetry.prepare(song)'));
  assert.match(src, /switchTrack\(newList, i, 'new-selection'\)/);
  assert.match(src, /const next = useCallback\(\(\) => advanceNext\('manual-next'\)/);
  assert.match(src, /playSongRef\.current\(l, n, 'manual-previous'\)/);
  assert.match(src, /playSongRef\.current = switchTrack/);
  assert.match(src, /playSongRef\.current\(l, n, transitionReason\)/);
  assert.equal(switchBlock.includes('await '), false);
  assert.match(src, /\n    playSong,\r?\n/);
  assert.match(src, /\n    next,\r?\n    prev,\r?\n/);
});

test('16/43 static: natural endings and error recovery use automatic advance without manual reasons', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  assert.match(src, /nextRef\.current = advanceNext/);
  const ytEnd = src.slice(src.indexOf('} else if (e.data === window.YT.PlayerState.ENDED)'), src.indexOf('onError:'));
  const audioEnd = src.slice(src.indexOf("audio.addEventListener('ended'"), src.indexOf("audio.addEventListener('play'"));
  for (const block of [ytEnd, audioEnd]) {
    assert.match(block, /telemetry\.complete\(/);
    assert.match(block, /nextRef\.current\(\)/);
    assert.equal(/manual-next|telemetry\.skip|confirmedPlay/.test(block), false);
  }
  const errorBlock = src.slice(src.indexOf('onError:'), src.indexOf('const loadYT'));
  assert.match(errorBlock, /nextRef\.current\(\)/);
  assert.equal(errorBlock.includes('manual-next'), false);
});

test('16/43 static: repeat requests have no emission; both media confirmations reach replay-aware controller', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  assert.match(src, /\[playMode, setPlayMode\] = useState\('list'\)/);
  assert.match(src, /\n    setPlayMode,\r?\n/);
  assert.equal((src.match(/telemetry\.confirmedPlay\(/g) || []).length, 2);
  const ytPlay = src.slice(src.indexOf('if (e.data === window.YT.PlayerState.PLAYING)'), src.indexOf('} else if (e.data === window.YT.PlayerState.PAUSED)'));
  const audioPlay = src.slice(src.indexOf("audio.addEventListener('play'"), src.indexOf("audio.addEventListener('pause'"));
  assert.match(ytPlay, /telemetry\.confirmedPlay/);
  assert.match(audioPlay, /telemetry\.confirmedPlay/);
});

test('16/43 static: previous preserves wrapping and same-track restart uses seek, not skip', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  const prev = src.slice(src.indexOf('const prev ='), src.indexOf('const setVolume ='));
  assert.match(prev, /const n = \(i - 1 \+ l\.length\) % l\.length/);
  assert.equal(prev.includes('currentTime'), false);
  assert.match(src, /else if \(sameTrack && previous\.started && !previous\.terminal && !previous\.paused\)/);
  assert.match(src, /telemetry\.seek\(\{ from: position, to: 0, duration: mediaDuration \}\)/);
});

test('16/43 static: history stays centralized and telemetry endpoint stays unchanged', () => {
  const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
  const controller = readFileSync(join(__dirname, 'listeningTelemetry.js'), 'utf8');
  assert.equal((src.match(/api\.post\('\/api\/history'/g) || []).length, 1);
  assert.equal((src.match(/api\.post\('\/api\/listening-events'/g) || []).length, 1);
  assert.equal((controller.match(/maybeRecordHistory\(\)/g) || []).length, 1);
  const skipBlock = controller.slice(controller.indexOf('const skip ='), controller.indexOf('const reset ='));
  assert.equal(skipBlock.includes('recordHistory'), false);
  assert.equal(/userId:|user:|score:|weight:|preference:/.test(controller), false);
});
