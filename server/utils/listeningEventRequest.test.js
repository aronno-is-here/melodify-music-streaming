import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseListeningEventRequest,
  mapListeningEventResult,
  LISTENING_EVENT_REQUEST_FIELDS,
  LISTENING_EVENT_HTTP_MESSAGES,
} from './listeningEventRequest.js';

const minimalEvent = () => ({
  song: '64b000000000000000000002',
  session_id: 'session-1',
  event_id: 'evt-1',
  sequence: 0,
  event_type: 'play-started',
});

test('1: valid minimal object accepted', () => {
  const result = parseListeningEventRequest(minimalEvent());
  assert.equal(result.ok, true);
  assert.equal(result.value.event_id, 'evt-1');
});

test('2: all 13 allowed fields can pass through', () => {
  const body = {
    song: '64b000000000000000000002',
    session_id: 's',
    event_id: 'e',
    sequence: 1,
    event_type: 'progress',
    position_seconds: 10,
    duration_seconds: 100,
    listened_seconds_delta: 5,
    client_occurred_at: '2026-03-01T12:00:00.000Z',
    transition_reason: 'unknown',
    seek_from_seconds: 1,
    seek_to_seconds: 2,
    playback_source: 'dashboard',
  };
  assert.equal(LISTENING_EVENT_REQUEST_FIELDS.length, 13);
  const result = parseListeningEventRequest(body);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), [...LISTENING_EVENT_REQUEST_FIELDS].sort());
});

test('3: null rejected', () => {
  const result = parseListeningEventRequest(null);
  assert.equal(result.ok, false);
  assert.equal(result.error, LISTENING_EVENT_HTTP_MESSAGES.invalidBody);
});

test('4: array rejected', () => {
  const result = parseListeningEventRequest([minimalEvent()]);
  assert.equal(result.ok, false);
});

test('5: string rejected', () => {
  assert.equal(parseListeningEventRequest('nope').ok, false);
});

test('6: number rejected', () => {
  assert.equal(parseListeningEventRequest(42).ok, false);
});

test('7: boolean rejected', () => {
  assert.equal(parseListeningEventRequest(true).ok, false);
});

test('8: unknown field rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), extra: 1 });
  assert.equal(result.ok, false);
});

test('9: user rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), user: 'x' });
  assert.equal(result.ok, false);
});

test('10: userId rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), userId: 'x' });
  assert.equal(result.ok, false);
});

test('11: createdAt rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), createdAt: 'x' });
  assert.equal(result.ok, false);
});

test('12: updatedAt rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), updatedAt: 'x' });
  assert.equal(result.ok, false);
});

test('13: score rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), score: 1 });
  assert.equal(result.ok, false);
});

test('14: weight rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), weight: 1 });
  assert.equal(result.ok, false);
});

test('15: preference_score rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), preference_score: 1 });
  assert.equal(result.ok, false);
});

test('16: recommendation_score rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), recommendation_score: 0.9 });
  assert.equal(result.ok, false);
});

test('17: completion_percentage rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), completion_percentage: 80 });
  assert.equal(result.ok, false);
});

test('18: early_skip rejected', () => {
  const result = parseListeningEventRequest({ ...minimalEvent(), early_skip: true });
  assert.equal(result.ok, false);
});

test('19: token/JWT-style field rejected', () => {
  for (const key of ['token', 'jwt', 'Authorization', 'api_key']) {
    const result = parseListeningEventRequest({ ...minimalEvent(), [key]: 'secret' });
    assert.equal(result.ok, false, key);
  }
});

test('20: nested arbitrary metadata rejected', () => {
  const result = parseListeningEventRequest({
    ...minimalEvent(),
    metadata: { nested: true },
  });
  assert.equal(result.ok, false);
  const rawEvent = parseListeningEventRequest({ ...minimalEvent(), raw_event: { a: 1 } });
  assert.equal(rawEvent.ok, false);
});

test('21: input object not mutated', () => {
  const body = minimalEvent();
  const snapshot = structuredClone(body);
  Object.freeze(body);
  const result = parseListeningEventRequest(body);
  assert.equal(result.ok, true);
  assert.deepEqual(body, snapshot);
  assert.notEqual(result.value, body);
});

test('22: output contains only allowed keys', () => {
  const result = parseListeningEventRequest(minimalEvent());
  assert.equal(result.ok, true);
  for (const key of Object.keys(result.value)) {
    assert.ok(LISTENING_EVENT_REQUEST_FIELDS.includes(key), key);
  }
});

test('23: recorded → 201', () => {
  const mapped = mapListeningEventResult({
    status: 'recorded',
    reason: null,
    event: { event_id: 'e', session_id: 's', sequence: 0, song: 'x' },
  });
  assert.equal(mapped.httpStatus, 201);
  assert.equal(mapped.body.success, true);
  assert.equal(mapped.body.data.status, 'recorded');
});

test('24: duplicate → 200', () => {
  const mapped = mapListeningEventResult({
    status: 'duplicate',
    reason: 'duplicate-event',
    event: { event_id: 'e', session_id: 's', sequence: 0, song: 'x' },
  });
  assert.equal(mapped.httpStatus, 200);
  assert.equal(mapped.body.success, true);
  assert.equal(mapped.body.data.status, 'duplicate');
});

test('25: rejected invalid-event → 400', () => {
  const mapped = mapListeningEventResult({
    status: 'rejected',
    reason: 'invalid-event',
    event: null,
  });
  assert.equal(mapped.httpStatus, 400);
  assert.equal(mapped.body.success, false);
  assert.equal(mapped.body.error, LISTENING_EVENT_HTTP_MESSAGES.rejected);
});

test('26: song-not-found → 404', () => {
  const mapped = mapListeningEventResult({
    status: 'rejected',
    reason: 'song-not-found',
    event: null,
  });
  assert.equal(mapped.httpStatus, 404);
  assert.equal(mapped.body.success, false);
  assert.equal(mapped.body.error, LISTENING_EVENT_HTTP_MESSAGES.songNotFound);
});

test('27: conflict → 409', () => {
  const mapped = mapListeningEventResult({
    status: 'conflict',
    reason: 'event-id-conflict',
    event: null,
  });
  assert.equal(mapped.httpStatus, 409);
  assert.equal(mapped.body.success, false);
  assert.equal(mapped.body.error, LISTENING_EVENT_HTTP_MESSAGES.conflict);
});

test('28: failed → 500', () => {
  const mapped = mapListeningEventResult({
    status: 'failed',
    reason: 'persistence-failed',
    event: null,
  });
  assert.equal(mapped.httpStatus, 500);
  assert.equal(mapped.body.success, false);
  assert.equal(mapped.body.error, LISTENING_EVENT_HTTP_MESSAGES.failed);
});

test('29: unknown service status → safe 500', () => {
  const mapped = mapListeningEventResult({ status: 'exploded', reason: 'x', event: null });
  assert.equal(mapped.httpStatus, 500);
  assert.equal(mapped.body.success, false);
  assert.equal(mapped.body.data.status, 'failed');
  assert.equal(mapped.body.data.reason, 'persistence-failed');
  const malformed = mapListeningEventResult(null);
  assert.equal(malformed.httpStatus, 500);
  assert.equal(malformed.body.success, false);
});

test('30: success true only for recorded/duplicate', () => {
  for (const status of ['recorded', 'duplicate']) {
    const mapped = mapListeningEventResult({ status, reason: null, event: null });
    assert.equal(mapped.body.success, true, status);
  }
  for (const status of ['rejected', 'conflict', 'failed', 'unknown-status']) {
    const mapped = mapListeningEventResult({ status, reason: null, event: null });
    assert.equal(mapped.body.success, false, status);
  }
});

test('31: raw event document fields not leaked', () => {
  const mapped = mapListeningEventResult({
    status: 'recorded',
    reason: null,
    event: {
      _id: 'internal-id',
      user: 'user-object-id',
      __v: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      email: 'user@example.com',
      event_id: 'evt-1',
      session_id: 'session-1',
      sequence: 0,
      song: 'song-1',
    },
  });
  const serialized = JSON.stringify(mapped.body);
  assert.equal(serialized.includes('user@example.com'), false);
  assert.equal(serialized.includes('internal-id'), false);
  assert.equal(mapped.body.data.event_id, 'evt-1');
  assert.equal(mapped.body.data.session_id, 'session-1');
  assert.equal(mapped.body.data.sequence, 0);
  assert.equal(mapped.body.data.song, 'song-1');
  assert.equal(mapped.body.data._id, undefined);
  assert.equal(mapped.body.data.user, undefined);
  assert.equal(mapped.body.data.createdAt, undefined);
  assert.equal(mapped.body.data.email, undefined);
});

test('32: raw database/error marker not leaked', () => {
  const mapped = mapListeningEventResult({
    status: 'failed',
    reason: 'persistence-failed',
    event: null,
    message: 'MongoServerError: boom',
  });
  const serialized = JSON.stringify(mapped.body);
  assert.equal(serialized.includes('MongoServerError'), false);
  assert.equal(serialized.includes('boom'), false);
});

test('33: secret-like marker not leaked', () => {
  const mapped = mapListeningEventResult({
    status: 'failed',
    reason: 'DB_SECRET_MARKER_XYZ',
    event: { email: 'secret@example.com' },
  });
  const serialized = JSON.stringify(mapped.body);
  assert.equal(serialized.includes('DB_SECRET_MARKER_XYZ'), false);
  assert.equal(serialized.includes('secret@example.com'), false);
  assert.equal(mapped.body.data.reason, 'persistence-failed');
});
