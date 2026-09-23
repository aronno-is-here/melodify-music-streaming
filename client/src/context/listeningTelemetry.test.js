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
  const playSongBlock = src.slice(src.indexOf('const playSong'), src.indexOf('playSongRef.current = playSong'));
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
