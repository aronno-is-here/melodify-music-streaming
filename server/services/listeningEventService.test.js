import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import mongoose from 'mongoose';
import {
  createListeningEventService,
  LISTENING_EVENT_STATUSES,
  LISTENING_EVENT_REASONS,
  LISTENING_EVENT_PAYLOAD_FIELDS,
  POSITION_DURATION_TOLERANCE_SECONDS,
  LISTENED_DELTA_TOLERANCE_SECONDS,
  MAX_CLIENT_FUTURE_SKEW_SECONDS,
  MAX_CLIENT_EVENT_AGE_SECONDS,
} from './listeningEventService.js';
import { MAX_LISTENED_DELTA_SECONDS } from '../models/ListeningEvent.js';

const FIXED_NOW = new Date('2026-03-01T12:00:00.000Z');
const USER_ID = '64b000000000000000000001';
const OTHER_USER_ID = '64b000000000000000000009';
const SONG_ID = '64b000000000000000000002';
const OTHER_SONG_ID = '64b000000000000000000003';

const duplicateKeyError = () => {
  const error = new Error(
    'E11000 duplicate key error collection: melodify.listeningevents index: dup key',
  );
  error.code = 11000;
  return error;
};

const makeEvent = (overrides = {}) => ({
  song: SONG_ID,
  session_id: 'session-1',
  event_id: 'evt-1',
  sequence: 0,
  event_type: 'play-started',
  ...overrides,
});

const seedEvent = (overrides = {}) => ({
  user: USER_ID,
  song: SONG_ID,
  session_id: 'session-1',
  event_id: 'evt-0',
  sequence: 0,
  event_type: 'play-started',
  ...overrides,
});

const valuesEqual = (a, b) => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return String(a) === String(b);
};

const matchesFilter = (doc, filter) =>
  Object.entries(filter).every(([key, value]) => valuesEqual(doc[key], value));

const createFakeListeningEventModel = (seedDocs = [], behavior = {}) => {
  const state = {
    docs: seedDocs.map((doc) => ({ ...doc })),
    createAttempts: 0,
    findOnesAfterCreate: 0,
    createdPayloads: [],
    raceMode: behavior.raceMode ?? null,
  };

  const findOneInternal = (filter, sortSpec) => {
    if (state.createAttempts > 0) state.findOnesAfterCreate += 1;
    let found = state.docs.filter((doc) => matchesFilter(doc, filter));
    if (sortSpec) {
      const entries = Object.entries(sortSpec);
      found = [...found].sort((a, b) => {
        for (const [key, dir] of entries) {
          if (a[key] < b[key]) return -1 * dir;
          if (a[key] > b[key]) return 1 * dir;
        }
        return 0;
      });
    }
    return found[0] ? { ...found[0] } : null;
  };

  const model = {
    findOne(filter) {
      const query = {
        sort(sortSpec) {
          return Promise.resolve(findOneInternal(filter, sortSpec));
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(findOneInternal(filter)).then(onFulfilled, onRejected);
        },
      };
      return query;
    },
    async create(doc) {
      state.createAttempts += 1;
      state.createdPayloads.push({ ...doc });

      if (state.raceMode === 'e11000-same') {
        state.docs.push({ ...doc, _id: 'race-same' });
        throw duplicateKeyError();
      }
      if (state.raceMode === 'e11000-event-conflict') {
        state.docs.push({
          ...doc,
          _id: 'race-conflict',
          event_id: doc.event_id,
          song: OTHER_SONG_ID,
          event_type: 'progress',
        });
        throw duplicateKeyError();
      }
      if (state.raceMode === 'e11000-sequence') {
        state.docs.push({
          ...doc,
          _id: 'race-sequence',
          event_id: 'racer-other-event',
        });
        throw duplicateKeyError();
      }
      if (state.raceMode === 'db-error') {
        throw new Error('MongoServerError: internal failure marker DB_SECRET_SHOULD_NOT_LEAK');
      }

      const saved = {
        _id: `created-${state.createAttempts}`,
        ...doc,
        createdAt: new Date(FIXED_NOW),
        updatedAt: new Date(FIXED_NOW),
      };
      state.docs.push(saved);
      return { ...saved };
    },
    state,
  };
  return model;
};

const createFakeSongModel = (songIds = [SONG_ID]) => {
  const docs = songIds.map((id) => ({ _id: id, title: 'Seed Song' }));
  return {
    docs,
    async findOne(filter) {
      const found = docs.find((doc) => valuesEqual(doc._id, filter._id));
      return found ? { ...found } : null;
    },
  };
};

const createHarness = ({
  seedEvents = [],
  songIds = [SONG_ID],
  behavior = {},
  now = () => FIXED_NOW,
} = {}) => {
  const ListeningEventModel = createFakeListeningEventModel(seedEvents, behavior);
  const SongModel = createFakeSongModel(songIds);
  const service = createListeningEventService({ ListeningEventModel, SongModel, now });
  return { service, ListeningEventModel, SongModel };
};

test('1: valid first play-started event records', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(result.status, 'recorded');
  assert.equal(result.reason, null);
  assert.ok(result.event);
});

test('2: trusted userId is persisted', async () => {
  const { service, ListeningEventModel } = createHarness();
  await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(ListeningEventModel.state.createdPayloads[0].user, USER_ID);
});

test('3: payload user cannot override trusted user', async () => {
  const { service, ListeningEventModel } = createHarness();
  await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ user: OTHER_USER_ID }),
  });
  assert.equal(ListeningEventModel.state.createdPayloads[0].user, USER_ID);
  assert.equal(ListeningEventModel.state.createdPayloads[0].user !== OTHER_USER_ID, true);
});

test('4: arbitrary payload fields are not persisted', async () => {
  const { service, ListeningEventModel } = createHarness();
  await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      user: OTHER_USER_ID,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      email: 'leak@example.com',
      jwt: 'token',
      ip: '1.2.3.4',
      api_key: 'key',
      arbitrary_route: '/x',
    }),
  });
  const persisted = ListeningEventModel.state.createdPayloads[0];
  assert.equal(persisted.user, USER_ID);
  assert.equal(persisted.email, undefined);
  assert.equal(persisted.jwt, undefined);
  assert.equal(persisted.ip, undefined);
  assert.equal(persisted.api_key, undefined);
  assert.equal(persisted.createdAt, undefined);
  assert.equal(persisted.updatedAt, undefined);
  assert.equal(persisted.arbitrary_route, undefined);
});

test('5: derived score/weight fields are not persisted', async () => {
  const { service, ListeningEventModel } = createHarness();
  await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      score: 1,
      weight: 2,
      reward: 3,
      preference: 4,
      recommendation_score: 0.9,
      completion_percentage: 80,
      early_skip: true,
    }),
  });
  const persisted = ListeningEventModel.state.createdPayloads[0];
  for (const field of [
    'score',
    'weight',
    'reward',
    'preference',
    'recommendation_score',
    'completion_percentage',
    'early_skip',
  ]) {
    assert.equal(persisted[field], undefined, field);
  }
});

test('6: malformed userId rejected safely', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: 'not-an-object-id',
    event: makeEvent(),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-event');
});

test('7: malformed song ID rejected safely', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ song: 'nope' }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-event');
});

test('8: missing Song returns song-not-found', async () => {
  const { service } = createHarness({ songIds: [] });
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'song-not-found');
});

test('9: Song is never mutated', async () => {
  const { service, SongModel } = createHarness();
  const before = structuredClone(SongModel.docs[0]);
  await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.deepEqual(SongModel.docs[0], before);
});

test('10: same user + event_id + same core identity returns duplicate', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ event_id: 'evt-dup' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-dup' }),
  });
  assert.equal(result.status, 'duplicate');
  assert.equal(result.reason, 'duplicate-event');
  assert.ok(result.event);
});

test('11: duplicate performs zero second create', async () => {
  const { service, ListeningEventModel } = createHarness({
    seedEvents: [seedEvent({ event_id: 'evt-dup' })],
  });
  await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-dup' }),
  });
  assert.equal(ListeningEventModel.state.createAttempts, 0);
});

test('12: same event_id with different song conflicts', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ event_id: 'evt-c', song: SONG_ID })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-c', song: OTHER_SONG_ID, sequence: 1, event_type: 'progress' }),
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'event-id-conflict');
});

test('13: same event_id with different session conflicts', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ event_id: 'evt-c', session_id: 'session-1' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-c', session_id: 'session-2' }),
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'event-id-conflict');
});

test('14: same event_id with different sequence conflicts', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ event_id: 'evt-c', sequence: 0 })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-c', sequence: 1 }),
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'event-id-conflict');
});

test('15: same event_id with different event_type conflicts', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ event_id: 'evt-c', event_type: 'play-started' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-c', sequence: 1, event_type: 'progress' }),
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'event-id-conflict');
});

test('16: same event_id for another user is independent', async () => {
  const { service, ListeningEventModel } = createHarness({
    seedEvents: [seedEvent({ event_id: 'evt-shared', user: USER_ID })],
  });
  const result = await service.recordListeningEvent({
    userId: OTHER_USER_ID,
    event: makeEvent({ event_id: 'evt-shared' }),
  });
  assert.equal(result.status, 'recorded');
  assert.equal(ListeningEventModel.state.createdPayloads[0].user, OTHER_USER_ID);
});

test('17: first event sequence 0 accepted', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ sequence: 0 }),
  });
  assert.equal(result.status, 'recorded');
});

test('18: first event sequence >0 rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ sequence: 1 }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-session-start');
});

test('19: first event not play-started rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_type: 'progress' }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-session-start');
});

test('20: later greater sequence accepted', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'play-started' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-next', sequence: 1, event_type: 'progress' }),
  });
  assert.equal(result.status, 'recorded');
});

test('21: sequence gaps accepted', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0 })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-gap', sequence: 5, event_type: 'progress' }),
  });
  assert.equal(result.status, 'recorded');
});

test('22: lower sequence rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 5, event_type: 'play-started' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-low', sequence: 3, event_type: 'progress' }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'out-of-order-sequence');
});

test('23: occupied sequence with different event_id conflicts', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 2, event_id: 'evt-occupied', event_type: 'progress' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-other', sequence: 2, event_type: 'progress' }),
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'sequence-conflict');
});

test('24: session ordering scoped by user + session_id', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ session_id: 'session-1', sequence: 3, event_type: 'progress' })],
  });
  const otherSession = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      session_id: 'session-2',
      event_id: 'evt-s2',
      sequence: 0,
      event_type: 'play-started',
    }),
  });
  assert.equal(otherSession.status, 'recorded');

  const otherUser = await service.recordListeningEvent({
    userId: OTHER_USER_ID,
    event: makeEvent({
      session_id: 'session-1',
      event_id: 'evt-u2',
      sequence: 0,
      event_type: 'play-started',
    }),
  });
  assert.equal(otherUser.status, 'recorded');
});

test('25: second play-started in same session rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'play-started' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-ps', sequence: 1, event_type: 'play-started' }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-transition');
});

test('26: completed -> replay-started accepted', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'completed' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-replay', sequence: 1, event_type: 'replay-started' }),
  });
  assert.equal(result.status, 'recorded');
});

test('27: skipped -> replay-started accepted', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'skipped' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-replay', sequence: 1, event_type: 'replay-started' }),
  });
  assert.equal(result.status, 'recorded');
});

test('28: stopped -> replay-started accepted', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'stopped' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-replay', sequence: 1, event_type: 'replay-started' }),
  });
  assert.equal(result.status, 'recorded');
});

test('29: terminal -> normal progress rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'completed' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-prog', sequence: 1, event_type: 'progress' }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-transition');
});

test('30: replay-started without prior terminal rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'play-started' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-replay', sequence: 1, event_type: 'replay-started' }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-transition');
});

test('31: paused -> resumed accepted', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'paused' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-resume', sequence: 1, event_type: 'resumed' }),
  });
  assert.equal(result.status, 'recorded');
});

test('32: clearly invalid resumed transition rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'progress' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_id: 'evt-resume', sequence: 1, event_type: 'resumed' }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-transition');
});

test('33: absent client time accepted', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(result.status, 'recorded');
});

test('34: valid current client time accepted', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ client_occurred_at: new Date(FIXED_NOW.getTime() - 10_000) }),
  });
  assert.equal(result.status, 'recorded');
});

test('35: >5 minute future time rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      client_occurred_at: new Date(
        FIXED_NOW.getTime() + (MAX_CLIENT_FUTURE_SKEW_SECONDS + 1) * 1000,
      ),
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-client-time');
});

test('36: >24 hour stale time rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      client_occurred_at: new Date(
        FIXED_NOW.getTime() - (MAX_CLIENT_EVENT_AGE_SECONDS + 1) * 1000,
      ),
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-client-time');
});

test('37: exact configured boundary tested', async () => {
  const { service } = createHarness();
  const futureBoundary = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-future-edge',
      client_occurred_at: new Date(FIXED_NOW.getTime() + MAX_CLIENT_FUTURE_SKEW_SECONDS * 1000),
    }),
  });
  assert.equal(futureBoundary.status, 'recorded');

  const staleBoundary = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-stale-edge',
      session_id: 'session-stale',
      sequence: 0,
      event_type: 'play-started',
      client_occurred_at: new Date(FIXED_NOW.getTime() - MAX_CLIENT_EVENT_AGE_SECONDS * 1000),
    }),
  });
  assert.equal(staleBoundary.status, 'recorded');
});

test('38: previous/current client time progression accepted', async () => {
  const { service } = createHarness({
    seedEvents: [
      seedEvent({
        sequence: 0,
        event_type: 'play-started',
        client_occurred_at: new Date(FIXED_NOW.getTime() - 60_000),
      }),
    ],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-prog-time',
      sequence: 1,
      event_type: 'progress',
      client_occurred_at: new Date(FIXED_NOW.getTime() - 30_000),
    }),
  });
  assert.equal(result.status, 'recorded');
});

test('39: client time regression rejected', async () => {
  const { service } = createHarness({
    seedEvents: [
      seedEvent({
        sequence: 0,
        event_type: 'play-started',
        client_occurred_at: new Date(FIXED_NOW.getTime() - 30_000),
      }),
    ],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-regress',
      sequence: 1,
      event_type: 'progress',
      client_occurred_at: new Date(FIXED_NOW.getTime() - 60_000),
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'client-time-regression');
});

test('40: injected clock controls validation', async () => {
  const skewedNow = new Date('2026-06-01T00:00:00.000Z');
  const { service } = createHarness({ now: () => skewedNow });
  const tooFuture = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      client_occurred_at: new Date(FIXED_NOW.getTime() + 3_600_000),
    }),
  });
  assert.equal(tooFuture.status, 'rejected');
  assert.equal(tooFuture.reason, 'invalid-client-time');
});

test('41: service does not set createdAt manually', async () => {
  const { service, ListeningEventModel } = createHarness();
  await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  const payload = ListeningEventModel.state.createdPayloads[0];
  assert.equal(payload.createdAt, undefined);
  assert.equal(payload.updatedAt, undefined);
});

test('42: position within duration accepted', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ position_seconds: 10, duration_seconds: 100 }),
  });
  assert.equal(result.status, 'recorded');
});

test('43: small configured tolerance accepted', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      position_seconds: 100 + POSITION_DURATION_TOLERANCE_SECONDS,
      duration_seconds: 100,
    }),
  });
  assert.equal(result.status, 'recorded');
});

test('44: impossible position beyond duration+tolerance rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      position_seconds: 100 + POSITION_DURATION_TOLERANCE_SECONDS + 1,
      duration_seconds: 100,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-playback-position');
});

test('45: seek point beyond duration+tolerance rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_type: 'seeked',
      duration_seconds: 100,
      seek_from_seconds: 10,
      seek_to_seconds: 100 + POSITION_DURATION_TOLERANCE_SECONDS + 1,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-playback-position');
});

test('46: seeked with from/to accepted', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'play-started' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-seek-ok',
      sequence: 1,
      event_type: 'seeked',
      seek_from_seconds: 10,
      seek_to_seconds: 40,
      duration_seconds: 120,
    }),
  });
  assert.equal(result.status, 'recorded');
});

test('47: seeked missing from rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_type: 'seeked', seek_to_seconds: 40 }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-seek');
});

test('48: seeked missing to rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_type: 'seeked', seek_from_seconds: 10 }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-seek');
});

test('49: seeked non-zero listened delta rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_type: 'seeked',
      seek_from_seconds: 10,
      seek_to_seconds: 40,
      listened_seconds_delta: 5,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-seek');
});

test('50: non-seek event carrying seek fields rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ event_type: 'progress', seek_from_seconds: 1, seek_to_seconds: 2 }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-seek');
});

test('51: seek distance never becomes listened delta', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_type: 'seeked',
      seek_from_seconds: 0,
      seek_to_seconds: 100,
      listened_seconds_delta: 100,
      duration_seconds: 200,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-seek');
});

test('52: play-started delta 0 accepted', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ listened_seconds_delta: 0 }),
  });
  assert.equal(result.status, 'recorded');
});

test('53: play-started positive delta rejected', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ listened_seconds_delta: 5 }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'non-listening-transition-delta');
});

test('54: resumed positive delta rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'paused' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-resume',
      sequence: 1,
      event_type: 'resumed',
      listened_seconds_delta: 3,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'non-listening-transition-delta');
});

test('55: replay-started positive delta rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'completed' })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-replay',
      sequence: 1,
      event_type: 'replay-started',
      listened_seconds_delta: 2,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'non-listening-transition-delta');
});

test('56: normal forward progress plausible delta accepted', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'play-started', position_seconds: 10 })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-prog',
      sequence: 1,
      event_type: 'progress',
      position_seconds: 20,
      listened_seconds_delta: 10 + LISTENED_DELTA_TOLERANCE_SECONDS - 1,
    }),
  });
  assert.equal(result.status, 'recorded');
});

test('57: claimed delta far above position advance rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'play-started', position_seconds: 10 })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-prog',
      sequence: 1,
      event_type: 'progress',
      position_seconds: 20,
      listened_seconds_delta: 50,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-listened-delta');
});

test('58: backward position with positive delta rejected', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'play-started', position_seconds: 50 })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-back',
      sequence: 1,
      event_type: 'progress',
      position_seconds: 20,
      listened_seconds_delta: 5,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-listened-delta');
});

test('59: claimed delta above client elapsed+tolerance rejected', async () => {
  const { service } = createHarness({
    seedEvents: [
      seedEvent({
        sequence: 0,
        event_type: 'play-started',
        position_seconds: 10,
        client_occurred_at: new Date(FIXED_NOW.getTime() - 60_000),
      }),
    ],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-wall',
      sequence: 1,
      event_type: 'progress',
      position_seconds: 70,
      listened_seconds_delta: 55,
      client_occurred_at: new Date(FIXED_NOW.getTime() - 30_000),
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-listened-delta');
});

test('60: paused interval is not counted as listening', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'paused', position_seconds: 30 })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-after-pause',
      sequence: 1,
      event_type: 'progress',
      position_seconds: 35,
      listened_seconds_delta: 5,
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-listened-delta');
});

test('61: zero listened delta remains valid', async () => {
  const { service } = createHarness({
    seedEvents: [seedEvent({ sequence: 0, event_type: 'play-started', position_seconds: 10 })],
  });
  const result = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({
      event_id: 'evt-zero',
      sequence: 1,
      event_type: 'progress',
      position_seconds: 15,
      listened_seconds_delta: 0,
    }),
  });
  assert.equal(result.status, 'recorded');
});

test('62: 12/43 absolute 120-second bound remains respected', async () => {
  const { service } = createHarness();
  const tooHigh = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ listened_seconds_delta: MAX_LISTENED_DELTA_SECONDS + 1 }),
  });
  assert.equal(tooHigh.status, 'rejected');
  assert.equal(tooHigh.reason, 'invalid-event');

  const atMaxNonListening = await service.recordListeningEvent({
    userId: USER_ID,
    event: makeEvent({ listened_seconds_delta: MAX_LISTENED_DELTA_SECONDS }),
  });
  assert.equal(atMaxNonListening.status, 'rejected');
  assert.equal(atMaxNonListening.reason, 'non-listening-transition-delta');
});

test('63: successful create returns recorded', async () => {
  const { service } = createHarness();
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(result.status, 'recorded');
  assert.equal(result.reason, null);
});

test('64: E11000 same event recovers as duplicate', async () => {
  const { service } = createHarness({ behavior: { raceMode: 'e11000-same' } });
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(result.status, 'duplicate');
  assert.equal(result.reason, 'duplicate-event');
});

test('65: E11000 event-id mismatch becomes conflict', async () => {
  const { service } = createHarness({ behavior: { raceMode: 'e11000-event-conflict' } });
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'event-id-conflict');
});

test('66: E11000 sequence collision becomes conflict', async () => {
  const { service } = createHarness({ behavior: { raceMode: 'e11000-sequence' } });
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'sequence-conflict');
});

test('67: duplicate-key recovery is bounded', async () => {
  const { service, ListeningEventModel } = createHarness({
    behavior: { raceMode: 'e11000-sequence' },
  });
  await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.ok(ListeningEventModel.state.findOnesAfterCreate <= 2);
});

test('68: create attempted at most once', async () => {
  const { service, ListeningEventModel } = createHarness({
    behavior: { raceMode: 'e11000-same' },
  });
  await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(ListeningEventModel.state.createAttempts, 1);
});

test('69: non-E11000 DB failure is sanitized', async () => {
  const { service } = createHarness({ behavior: { raceMode: 'db-error' } });
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'persistence-failed');
});

test('70: raw DB message is never returned', async () => {
  const { service } = createHarness({ behavior: { raceMode: 'db-error' } });
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(JSON.stringify(result).includes('MongoServerError'), false);
  assert.equal(JSON.stringify(result).includes('internal failure'), false);
});

test('71: secret-like marker in DB error is never leaked', async () => {
  const { service } = createHarness({ behavior: { raceMode: 'db-error' } });
  const result = await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(JSON.stringify(result).includes('DB_SECRET_SHOULD_NOT_LEAK'), false);
});

test('72: input event not mutated', async () => {
  const { service } = createHarness();
  const event = makeEvent({ session_id: '  session-raw  ', event_id: 'evt-raw' });
  const snapshot = structuredClone(event);
  Object.freeze(event);
  const result = await service.recordListeningEvent({ userId: USER_ID, event });
  assert.equal(result.status, 'recorded');
  assert.deepEqual(event, snapshot);
});

test('73: service result uses fixed status/reason vocabulary', async () => {
  const { service } = createHarness();
  const cases = [
    await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() }),
    await service.recordListeningEvent({
      userId: USER_ID,
      event: makeEvent({ event_id: 'evt-1' }),
    }),
    await service.recordListeningEvent({
      userId: 'bad',
      event: makeEvent({ event_id: 'evt-bad' }),
    }),
    await service.recordListeningEvent({
      userId: USER_ID,
      event: makeEvent({ event_id: 'evt-conflict', sequence: 0 }),
    }),
  ];
  for (const result of cases) {
    assert.ok(LISTENING_EVENT_STATUSES.includes(result.status), result.status);
    assert.ok(LISTENING_EVENT_REASONS.includes(result.reason), String(result.reason));
  }
});

test('74: no network call occurs', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('network disabled');
  };
  try {
    const { service } = createHarness();
    await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
});

test('75: no MongoDB connection occurs', async () => {
  const { service } = createHarness();
  await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(mongoose.connection.readyState, 0);
});

test('76: PlayHistory is not touched', async () => {
  const source = readFileSync(new URL('./listeningEventService.js', import.meta.url), 'utf8');
  assert.equal(source.includes('PlayHistory'), false);
  const { service } = createHarness();
  await service.recordListeningEvent({ userId: USER_ID, event: makeEvent() });
  assert.equal(source.includes('PlayHistory'), false);
});

test('payload whitelist field list is exact', () => {
  assert.deepEqual([...LISTENING_EVENT_PAYLOAD_FIELDS], [
    'song',
    'session_id',
    'event_id',
    'sequence',
    'event_type',
    'position_seconds',
    'duration_seconds',
    'listened_seconds_delta',
    'client_occurred_at',
    'transition_reason',
    'seek_from_seconds',
    'seek_to_seconds',
    'playback_source',
  ]);
});

test('service tolerances and client-time bounds are exported', () => {
  assert.equal(POSITION_DURATION_TOLERANCE_SECONDS, 2);
  assert.equal(LISTENED_DELTA_TOLERANCE_SECONDS, 2);
  assert.equal(MAX_CLIENT_FUTURE_SKEW_SECONDS, 300);
  assert.equal(MAX_CLIENT_EVENT_AGE_SECONDS, 86400);
});
