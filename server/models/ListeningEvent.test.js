import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import ListeningEvent, {
  LISTENING_EVENT_TYPES,
  LISTENING_TRANSITION_REASONS,
  LISTENING_PLAYBACK_SOURCES,
  MAX_PLAYBACK_SECONDS,
  MAX_LISTENED_DELTA_SECONDS,
  MAX_SEQUENCE,
  MAX_SESSION_ID_LENGTH,
  MAX_EVENT_ID_LENGTH,
} from './ListeningEvent.js';

const objectId = () => new mongoose.Types.ObjectId();

const minimalEvent = () => ({
  user: objectId(),
  song: objectId(),
  session_id: 'session-abc',
  event_id: 'event-1',
  sequence: 0,
  event_type: 'play-started',
});

const validate = (overrides = {}) => {
  const doc = new ListeningEvent({ ...minimalEvent(), ...overrides });
  return { doc, error: doc.validateSync() };
};

const expectInvalid = (overrides, match) => {
  const { error } = validate(overrides);
  assert.ok(error, `expected validation error for ${JSON.stringify(overrides)}`);
  if (match) assert.match(String(error.message), match);
};

test('1: minimal valid event validates', () => {
  const { doc, error } = validate();
  assert.equal(error, undefined);
  assert.equal(doc.event_type, 'play-started');
  assert.equal(doc.sequence, 0);
});

test('2: user required', () => {
  const doc = new ListeningEvent({ ...minimalEvent(), user: undefined });
  assert.ok(doc.validateSync());
  const blank = new ListeningEvent({ ...minimalEvent(), user: null });
  assert.ok(blank.validateSync());
});

test('3: song required', () => {
  const doc = new ListeningEvent({ ...minimalEvent(), song: undefined });
  assert.ok(doc.validateSync());
});

test('4: session_id required', () => {
  expectInvalid({ session_id: undefined });
  expectInvalid({ session_id: null });
});

test('5: event_id required', () => {
  expectInvalid({ event_id: undefined });
  expectInvalid({ event_id: null });
});

test('6: event_type required', () => {
  expectInvalid({ event_type: undefined });
  expectInvalid({ event_type: null });
});

test('7: sequence required', () => {
  expectInvalid({ sequence: undefined });
  expectInvalid({ sequence: null });
});

test('8: session_id trims', () => {
  const { doc, error } = validate({ session_id: '  session-abc  ' });
  assert.equal(error, undefined);
  assert.equal(doc.session_id, 'session-abc');
});

test('9: blank session_id rejected', () => {
  expectInvalid({ session_id: '' });
  expectInvalid({ session_id: '   ' });
  expectInvalid({ session_id: '\t\n' });
});

test('10: overlong session_id rejected', () => {
  expectInvalid({ session_id: 's'.repeat(MAX_SESSION_ID_LENGTH + 1) });
  const atLimit = validate({ session_id: 's'.repeat(MAX_SESSION_ID_LENGTH) });
  assert.equal(atLimit.error, undefined);
});

test('11: event_id trims', () => {
  const { doc, error } = validate({ event_id: '  event-1  ' });
  assert.equal(error, undefined);
  assert.equal(doc.event_id, 'event-1');
});

test('12: blank event_id rejected', () => {
  expectInvalid({ event_id: '' });
  expectInvalid({ event_id: '   ' });
});

test('13: overlong event_id rejected', () => {
  expectInvalid({ event_id: 'e'.repeat(MAX_EVENT_ID_LENGTH + 1) });
  const atLimit = validate({ event_id: 'e'.repeat(MAX_EVENT_ID_LENGTH) });
  assert.equal(atLimit.error, undefined);
});

test('14: every supported event type validates', () => {
  assert.equal(LISTENING_EVENT_TYPES.length, 9);
  assert.deepEqual([...LISTENING_EVENT_TYPES], [
    'play-started',
    'progress',
    'paused',
    'resumed',
    'seeked',
    'completed',
    'skipped',
    'stopped',
    'replay-started',
  ]);
  for (const event_type of LISTENING_EVENT_TYPES) {
    const { error } = validate({ event_type });
    assert.equal(error, undefined, event_type);
  }
});

test('15: unsupported event type rejected', () => {
  for (const event_type of ['liked', 'favorite', 'playlist-add', 'LIKE', '', 'progress ', 'unknown-event']) {
    expectInvalid({ event_type });
  }
});

test('16: zero sequence accepted', () => {
  const { error } = validate({ sequence: 0 });
  assert.equal(error, undefined);
});

test('17: positive integer accepted', () => {
  for (const sequence of [1, 42, MAX_SEQUENCE]) {
    const { error } = validate({ sequence });
    assert.equal(error, undefined, String(sequence));
  }
});

test('18: negative sequence rejected', () => {
  expectInvalid({ sequence: -1 });
  expectInvalid({ sequence: -1000 });
});

test('19: fraction rejected', () => {
  expectInvalid({ sequence: 1.5 });
  expectInvalid({ sequence: 0.1 });
});

test('20: over-max sequence rejected', () => {
  expectInvalid({ sequence: MAX_SEQUENCE + 1 });
  expectInvalid({ sequence: 1000001 });
});

test('21: sequence NaN/Infinity fail safely', () => {
  expectInvalid({ sequence: NaN });
  expectInvalid({ sequence: Infinity });
  expectInvalid({ sequence: -Infinity });
});

test('22: zero position accepted', () => {
  const { error } = validate({ position_seconds: 0 });
  assert.equal(error, undefined);
});

test('23: positive position accepted', () => {
  for (const position_seconds of [1, 253.5, MAX_PLAYBACK_SECONDS]) {
    const { error } = validate({ position_seconds });
    assert.equal(error, undefined, String(position_seconds));
  }
});

test('24: negative position rejected', () => {
  expectInvalid({ position_seconds: -1 });
  expectInvalid({ position_seconds: -0.01 });
});

test('25: position above max rejected', () => {
  expectInvalid({ position_seconds: MAX_PLAYBACK_SECONDS + 1 });
  expectInvalid({ position_seconds: 86401 });
});

test('26: position NaN/Infinity rejected', () => {
  expectInvalid({ position_seconds: NaN });
  expectInvalid({ position_seconds: Infinity });
  expectInvalid({ position_seconds: -Infinity });
});

test('27: positive valid duration accepted', () => {
  for (const duration_seconds of [0.1, 1, 253, MAX_PLAYBACK_SECONDS]) {
    const { error } = validate({ duration_seconds });
    assert.equal(error, undefined, String(duration_seconds));
  }
});

test('28: zero duration rejected', () => {
  expectInvalid({ duration_seconds: 0 });
});

test('29: negative duration rejected', () => {
  expectInvalid({ duration_seconds: -1 });
});

test('30: duration above max rejected', () => {
  expectInvalid({ duration_seconds: MAX_PLAYBACK_SECONDS + 1 });
});

test('31: duration NaN/Infinity rejected', () => {
  expectInvalid({ duration_seconds: NaN });
  expectInvalid({ duration_seconds: Infinity });
  expectInvalid({ duration_seconds: -Infinity });
});

test('32: zero listened delta accepted', () => {
  const { error } = validate({ listened_seconds_delta: 0 });
  assert.equal(error, undefined);
});

test('33: bounded positive listened delta accepted', () => {
  for (const listened_seconds_delta of [0.5, 30, MAX_LISTENED_DELTA_SECONDS]) {
    const { error } = validate({ listened_seconds_delta });
    assert.equal(error, undefined, String(listened_seconds_delta));
  }
});

test('34: negative listened delta rejected', () => {
  expectInvalid({ listened_seconds_delta: -1 });
});

test('35: listened delta above per-event max rejected', () => {
  expectInvalid({ listened_seconds_delta: MAX_LISTENED_DELTA_SECONDS + 1 });
  expectInvalid({ listened_seconds_delta: 86400 });
});

test('36: listened delta NaN/Infinity rejected', () => {
  expectInvalid({ listened_seconds_delta: NaN });
  expectInvalid({ listened_seconds_delta: Infinity });
  expectInvalid({ listened_seconds_delta: -Infinity });
});

test('37: supported transition reasons accepted', () => {
  assert.deepEqual([...LISTENING_TRANSITION_REASONS], [
    'manual-next',
    'manual-previous',
    'new-selection',
    'track-ended',
    'repeat',
    'route-change',
    'logout',
    'player-error',
    'unknown',
  ]);
  for (const transition_reason of LISTENING_TRANSITION_REASONS) {
    const { error } = validate({ event_type: 'skipped', transition_reason });
    assert.equal(error, undefined, transition_reason);
  }
});

test('38: unsupported transition reason rejected', () => {
  for (const transition_reason of ['auto-next', 'because', '', 'MANUAL-NEXT', 'manual next']) {
    expectInvalid({ transition_reason });
  }
});

test('39: optional reason can be absent', () => {
  const { doc, error } = validate();
  assert.equal(error, undefined);
  assert.equal(doc.transition_reason, undefined);
});

test('40: valid seek fields accepted', () => {
  const { error } = validate({
    event_type: 'seeked',
    seek_from_seconds: 10,
    seek_to_seconds: 120,
  });
  assert.equal(error, undefined);
  const zero = validate({
    event_type: 'seeked',
    seek_from_seconds: 0,
    seek_to_seconds: 0,
  });
  assert.equal(zero.error, undefined);
});

test('41: negative seek fields rejected', () => {
  expectInvalid({ seek_from_seconds: -1 });
  expectInvalid({ seek_to_seconds: -0.5 });
});

test('42: above-max seek fields rejected', () => {
  expectInvalid({ seek_from_seconds: MAX_PLAYBACK_SECONDS + 1 });
  expectInvalid({ seek_to_seconds: MAX_PLAYBACK_SECONDS + 1 });
});

test('43: client_occurred_at optional', () => {
  const { doc, error } = validate();
  assert.equal(error, undefined);
  assert.equal(doc.client_occurred_at, undefined);
});

test('44: valid Date accepted for client_occurred_at', () => {
  const when = new Date('2026-01-02T03:04:05.000Z');
  const { doc, error } = validate({ client_occurred_at: when });
  assert.equal(error, undefined);
  assert.equal(doc.client_occurred_at.getTime(), when.getTime());
});

test('45: invalid Date rejected when castable to invalid date', () => {
  const invalid = new Date('not-a-date');
  assert.ok(Number.isNaN(invalid.getTime()));
  const doc = new ListeningEvent({ ...minimalEvent() });
  doc.client_occurred_at = invalid;
  const error = doc.validateSync();
  assert.ok(error);
  assert.match(String(error.message), /client_occurred_at/);
});

test('46: timestamps true exists for server createdAt/updatedAt', () => {
  assert.equal(ListeningEvent.schema.options.timestamps, true);
  assert.equal(ListeningEvent.schema.path('createdAt').instance, 'Date');
  assert.equal(ListeningEvent.schema.path('updatedAt').instance, 'Date');
});

const findIndex = (keys) => {
  const indexes = ListeningEvent.schema.indexes();
  return indexes.find(([spec]) => {
    const entries = Object.entries(spec);
    return entries.length === keys.length
      && keys.every(([key, dir]) => spec[key] === dir);
  });
};

test('47: unique user+event_id index exists', () => {
  const found = findIndex([['user', 1], ['event_id', 1]]);
  assert.ok(found, 'missing user+event_id index');
  assert.equal(found[1].unique, true);
});

test('48: unique user+session_id+sequence index exists', () => {
  const found = findIndex([['user', 1], ['session_id', 1], ['sequence', 1]]);
  assert.ok(found, 'missing user+session_id+sequence index');
  assert.equal(found[1].unique, true);
});

test('49: user+createdAt index exists', () => {
  const found = findIndex([['user', 1], ['createdAt', -1]]);
  assert.ok(found, 'missing user+createdAt index');
});

test('50: song+createdAt index exists', () => {
  const found = findIndex([['song', 1], ['createdAt', -1]]);
  assert.ok(found, 'missing song+createdAt index');
});

test('51: no TTL index exists', () => {
  for (const [, options] of ListeningEvent.schema.indexes()) {
    assert.equal(options.expireAfterSeconds, undefined);
    assert.equal(options.ttl, undefined);
  }
});

test('52: schema has no recommendation score field', () => {
  for (const field of [
    'score',
    'recommendation_score',
    'completion_percentage',
    'completed',
    'early_skip',
    'interaction_weight',
    'preference_score',
  ]) {
    assert.equal(ListeningEvent.schema.path(field), undefined, field);
  }
});

test('53: schema has no preference/weight field', () => {
  for (const field of ['weight', 'reward', 'preference', 'preference_score']) {
    assert.equal(ListeningEvent.schema.path(field), undefined, field);
  }
});

test('54: schema has no email/JWT/token field', () => {
  for (const field of ['email', 'user_email', 'jwt', 'token', 'password', 'ip', 'ip_address', 'user_agent', 'api_key']) {
    assert.equal(ListeningEvent.schema.path(field), undefined, field);
  }
});

test('55: input object is not mutated by validation', () => {
  const input = {
    user: objectId(),
    song: objectId(),
    session_id: '  session-abc  ',
    event_id: '  event-1  ',
    sequence: 0,
    event_type: 'play-started',
    position_seconds: 12,
  };
  const before = structuredClone({ ...input, user: String(input.user), song: String(input.song) });
  const doc = new ListeningEvent(input);
  assert.equal(doc.validateSync(), undefined);
  assert.equal(input.session_id, '  session-abc  ');
  assert.equal(input.event_id, '  event-1  ');
  assert.equal(input.sequence, 0);
  assert.deepEqual(
    { ...input, user: String(input.user), song: String(input.song) },
    before,
  );
});

test('exported constants are frozen and non-empty', () => {
  assert.ok(Object.isFrozen(LISTENING_EVENT_TYPES));
  assert.ok(Object.isFrozen(LISTENING_TRANSITION_REASONS));
  assert.ok(Object.isFrozen(LISTENING_PLAYBACK_SOURCES));
  assert.equal(MAX_PLAYBACK_SECONDS, 86400);
  assert.equal(MAX_LISTENED_DELTA_SECONDS, 120);
  assert.equal(MAX_SEQUENCE, 1000000);
  assert.equal(MAX_SESSION_ID_LENGTH, 128);
  assert.equal(MAX_EVENT_ID_LENGTH, 128);
});

test('playback_source optional finite enum', () => {
  assert.deepEqual([...LISTENING_PLAYBACK_SOURCES], [
    'dashboard',
    'homepage',
    'playlist',
    'song-details',
    'user-profile',
    'unknown',
  ]);
  const absent = validate();
  assert.equal(absent.error, undefined);
  assert.equal(absent.doc.playback_source, undefined);
  const valid = validate({ playback_source: 'dashboard' });
  assert.equal(valid.error, undefined);
  expectInvalid({ playback_source: 'https://evil.example/path' });
  expectInvalid({ playback_source: 'radio' });
});

test('optional numeric fields can be absent', () => {
  const { doc, error } = validate();
  assert.equal(error, undefined);
  for (const field of [
    'position_seconds',
    'duration_seconds',
    'listened_seconds_delta',
    'seek_from_seconds',
    'seek_to_seconds',
  ]) {
    assert.equal(doc.get(field), undefined, field);
  }
});

test('strict schema rejects unknown derived score keys on validateSync path', () => {
  const doc = new ListeningEvent({
    ...minimalEvent(),
    recommendation_score: 0.9,
    preference_score: 1,
  });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.recommendation_score, undefined);
  assert.equal(doc.get('recommendation_score'), undefined);
  assert.equal(ListeningEvent.schema.path('recommendation_score'), undefined);
});

test('index set is exactly the four declared indexes', () => {
  const indexes = ListeningEvent.schema.indexes();
  assert.equal(indexes.length, 4);
  const keys = indexes.map(([spec]) => Object.keys(spec).join('+')).sort();
  assert.deepEqual(keys, [
    'song+createdAt',
    'user+createdAt',
    'user+event_id',
    'user+session_id+sequence',
  ]);
});
