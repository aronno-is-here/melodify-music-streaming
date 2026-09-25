import mongoose from 'mongoose';
import ListeningEvent, {
  LISTENING_EVENT_TYPES,
  LISTENING_TRANSITION_REASONS,
  LISTENING_PLAYBACK_SOURCES,
  MAX_LISTENED_DELTA_SECONDS,
  MAX_SEQUENCE,
  MAX_SESSION_ID_LENGTH,
  MAX_EVENT_ID_LENGTH,
} from '../models/ListeningEvent.js';
import Song from '../models/Song.js';

export const LISTENING_EVENT_STATUSES = Object.freeze([
  'recorded',
  'duplicate',
  'rejected',
  'conflict',
  'failed',
]);

export const LISTENING_EVENT_REASONS = Object.freeze([
  null,
  'invalid-event',
  'song-not-found',
  'duplicate-event',
  'event-id-conflict',
  'sequence-conflict',
  'invalid-session-start',
  'out-of-order-sequence',
  'invalid-transition',
  'invalid-client-time',
  'client-time-regression',
  'invalid-playback-position',
  'invalid-seek',
  'invalid-listened-delta',
  'non-listening-transition-delta',
  'persistence-failed',
]);

export const LISTENING_EVENT_PAYLOAD_FIELDS = Object.freeze([
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

export const POSITION_DURATION_TOLERANCE_SECONDS = 2;
export const LISTENED_DELTA_TOLERANCE_SECONDS = 2;
export const MAX_CLIENT_FUTURE_SKEW_SECONDS = 300;
export const MAX_CLIENT_EVENT_AGE_SECONDS = 86400;

const TERMINAL_EVENT_TYPES = Object.freeze(['completed', 'skipped', 'stopped']);
const NON_LISTENING_EVENT_TYPES = Object.freeze([
  'play-started',
  'resumed',
  'seeked',
  'replay-started',
]);

const MAX_PLAYBACK_SECONDS = 86400;

const isPlainObjectLike = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const recorded = (event) => ({ status: 'recorded', reason: null, event });
const duplicate = (event) => ({ status: 'duplicate', reason: 'duplicate-event', event });
const rejected = (reason) => ({ status: 'rejected', reason, event: null });
const conflict = (reason) => ({ status: 'conflict', reason, event: null });
const failed = () => ({ status: 'failed', reason: 'persistence-failed', event: null });

const isBoundedFiniteNumber = (value, { min, max, exclusiveMin = false }) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (exclusiveMin ? value <= min : value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
};

const pickPayload = (event) => {
  const payload = {};
  for (const key of LISTENING_EVENT_PAYLOAD_FIELDS) {
    if (event[key] !== undefined) payload[key] = event[key];
  }
  if (typeof payload.session_id === 'string') payload.session_id = payload.session_id.trim();
  if (typeof payload.event_id === 'string') payload.event_id = payload.event_id.trim();
  return payload;
};

const parseClientDate = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const validateBasic = (userId, payload) => {
  if (!mongoose.isValidObjectId(userId)) return 'invalid-event';
  if (!mongoose.isValidObjectId(payload.song)) return 'invalid-event';
  if (
    typeof payload.session_id !== 'string' ||
    payload.session_id.length === 0 ||
    payload.session_id.length > MAX_SESSION_ID_LENGTH
  ) {
    return 'invalid-event';
  }
  if (
    typeof payload.event_id !== 'string' ||
    payload.event_id.length === 0 ||
    payload.event_id.length > MAX_EVENT_ID_LENGTH
  ) {
    return 'invalid-event';
  }
  if (
    !Number.isInteger(payload.sequence) ||
    payload.sequence < 0 ||
    payload.sequence > MAX_SEQUENCE
  ) {
    return 'invalid-event';
  }
  if (!LISTENING_EVENT_TYPES.includes(payload.event_type)) return 'invalid-event';

  if (
    payload.position_seconds !== undefined &&
    !isBoundedFiniteNumber(payload.position_seconds, { min: 0, max: MAX_PLAYBACK_SECONDS })
  ) {
    return 'invalid-event';
  }
  if (
    payload.duration_seconds !== undefined &&
    !isBoundedFiniteNumber(payload.duration_seconds, {
      min: 0,
      max: MAX_PLAYBACK_SECONDS,
      exclusiveMin: true,
    })
  ) {
    return 'invalid-event';
  }
  if (
    payload.listened_seconds_delta !== undefined &&
    !isBoundedFiniteNumber(payload.listened_seconds_delta, {
      min: 0,
      max: MAX_LISTENED_DELTA_SECONDS,
    })
  ) {
    return 'invalid-event';
  }
  if (
    payload.seek_from_seconds !== undefined &&
    !isBoundedFiniteNumber(payload.seek_from_seconds, { min: 0, max: MAX_PLAYBACK_SECONDS })
  ) {
    return 'invalid-event';
  }
  if (
    payload.seek_to_seconds !== undefined &&
    !isBoundedFiniteNumber(payload.seek_to_seconds, { min: 0, max: MAX_PLAYBACK_SECONDS })
  ) {
    return 'invalid-event';
  }
  if (
    payload.transition_reason !== undefined &&
    !LISTENING_TRANSITION_REASONS.includes(payload.transition_reason)
  ) {
    return 'invalid-event';
  }
  if (
    payload.playback_source !== undefined &&
    !LISTENING_PLAYBACK_SOURCES.includes(payload.playback_source)
  ) {
    return 'invalid-event';
  }
  return null;
};

const coreIdentityMatches = (existing, payload) =>
  existing != null &&
  String(existing.song) === String(payload.song) &&
  existing.session_id === payload.session_id &&
  existing.sequence === payload.sequence &&
  existing.event_type === payload.event_type;

const checkTransition = (latest, payload) => {
  const type = payload.event_type;
  if (type === 'play-started') return 'invalid-transition';
  const latestTerminal = TERMINAL_EVENT_TYPES.includes(latest.event_type);
  if (latestTerminal && type !== 'replay-started') return 'invalid-transition';
  if (type === 'replay-started' && !latestTerminal) return 'invalid-transition';
  if (type === 'resumed' && latest.event_type !== 'paused') return 'invalid-transition';
  return null;
};

const checkClientTimeBounds = (clientTime, currentTime) => {
  if (!clientTime) return null;
  const futureLimitMs = MAX_CLIENT_FUTURE_SKEW_SECONDS * 1000;
  const ageLimitMs = MAX_CLIENT_EVENT_AGE_SECONDS * 1000;
  if (clientTime.getTime() - currentTime.getTime() > futureLimitMs) {
    return 'invalid-client-time';
  }
  if (currentTime.getTime() - clientTime.getTime() > ageLimitMs) {
    return 'invalid-client-time';
  }
  return null;
};

const checkClientTimeRegression = (latest, payload) => {
  const clientTime = payload.client_occurred_at;
  if (!clientTime || !latest || !latest.client_occurred_at) return null;
  const previous = parseClientDate(latest.client_occurred_at);
  if (previous && clientTime.getTime() < previous.getTime()) {
    return 'client-time-regression';
  }
  return null;
};

const checkPlaybackPosition = (payload) => {
  const { position_seconds, duration_seconds, seek_from_seconds, seek_to_seconds } = payload;
  if (
    position_seconds !== undefined &&
    duration_seconds !== undefined &&
    position_seconds > duration_seconds + POSITION_DURATION_TOLERANCE_SECONDS
  ) {
    return 'invalid-playback-position';
  }
  if (duration_seconds !== undefined) {
    if (
      seek_from_seconds !== undefined &&
      seek_from_seconds > duration_seconds + POSITION_DURATION_TOLERANCE_SECONDS
    ) {
      return 'invalid-playback-position';
    }
    if (
      seek_to_seconds !== undefined &&
      seek_to_seconds > duration_seconds + POSITION_DURATION_TOLERANCE_SECONDS
    ) {
      return 'invalid-playback-position';
    }
  }
  return null;
};

const checkSeek = (payload) => {
  const hasFrom = payload.seek_from_seconds !== undefined;
  const hasTo = payload.seek_to_seconds !== undefined;
  if (payload.event_type === 'seeked') {
    if (!hasFrom || !hasTo) return 'invalid-seek';
    if (payload.listened_seconds_delta !== undefined && payload.listened_seconds_delta !== 0) {
      return 'invalid-seek';
    }
    return null;
  }
  if (hasFrom || hasTo) return 'invalid-seek';
  return null;
};

const checkListenedDelta = (latest, payload) => {
  const delta = payload.listened_seconds_delta;
  if (delta === undefined || delta === null) return null;
  if (
    typeof delta !== 'number' ||
    !Number.isFinite(delta) ||
    delta < 0 ||
    delta > MAX_LISTENED_DELTA_SECONDS
  ) {
    return 'invalid-listened-delta';
  }
  if (delta === 0) return null;
  if (
    NON_LISTENING_EVENT_TYPES.includes(payload.event_type) &&
    payload.event_type !== 'seeked'
  ) {
    return 'non-listening-transition-delta';
  }
  if (latest && latest.event_type === 'paused') return 'invalid-listened-delta';

  const previousPosition =
    latest && typeof latest.position_seconds === 'number' ? latest.position_seconds : undefined;
  const currentPosition =
    typeof payload.position_seconds === 'number' ? payload.position_seconds : undefined;
  if (previousPosition !== undefined && currentPosition !== undefined) {
    if (currentPosition < previousPosition) return 'invalid-listened-delta';
    const advance = currentPosition - previousPosition;
    if (delta > advance + LISTENED_DELTA_TOLERANCE_SECONDS) return 'invalid-listened-delta';
  }

  if (latest && latest.client_occurred_at && payload.client_occurred_at) {
    const previousTime = parseClientDate(latest.client_occurred_at);
    if (previousTime) {
      const elapsedSeconds =
        (payload.client_occurred_at.getTime() - previousTime.getTime()) / 1000;
      if (delta > elapsedSeconds + LISTENED_DELTA_TOLERANCE_SECONDS) {
        return 'invalid-listened-delta';
      }
    }
  }
  return null;
};

const isDuplicateKeyError = (error) => {
  if (!error) return false;
  if (error.code === 11000 || error.code === 'E11000') return true;
  if (typeof error.message === 'string') {
    return error.message.includes('E11000') || /duplicate key/i.test(error.message);
  }
  return false;
};

export const createListeningEventService = ({
  ListeningEventModel = ListeningEvent,
  SongModel = Song,
  now = () => new Date(),
} = {}) => {
  const recordListeningEvent = async ({ userId, event }) => {
    if (!isPlainObjectLike(event)) return rejected('invalid-event');

    const payload = pickPayload(event);
    const basicError = validateBasic(userId, payload);
    if (basicError) return rejected(basicError);

    if (payload.client_occurred_at !== undefined) {
      const parsed = parseClientDate(payload.client_occurred_at);
      if (!parsed) return rejected('invalid-client-time');
      payload.client_occurred_at = parsed;
      const boundError = checkClientTimeBounds(parsed, now());
      if (boundError) return rejected(boundError);
    }

    const positionError = checkPlaybackPosition(payload);
    if (positionError) return rejected(positionError);

    const seekError = checkSeek(payload);
    if (seekError) return rejected(seekError);

    const earlyDeltaError = checkListenedDelta(null, payload);
    if (earlyDeltaError) return rejected(earlyDeltaError);

    const existingByEventId = await ListeningEventModel.findOne({
      user: userId,
      event_id: payload.event_id,
    });
    if (existingByEventId) {
      if (coreIdentityMatches(existingByEventId, payload)) {
        return duplicate(existingByEventId);
      }
      return conflict('event-id-conflict');
    }

    const song = await SongModel.findOne({ _id: payload.song });
    if (!song) return rejected('song-not-found');

    const sequenceSlot = await ListeningEventModel.findOne({
      user: userId,
      session_id: payload.session_id,
      sequence: payload.sequence,
    });
    if (sequenceSlot) {
      if (sequenceSlot.event_id === payload.event_id) {
        if (coreIdentityMatches(sequenceSlot, payload)) return duplicate(sequenceSlot);
        return conflict('sequence-conflict');
      }
      return conflict('sequence-conflict');
    }

    const latest = await ListeningEventModel.findOne({
      user: userId,
      session_id: payload.session_id,
    }).sort({ sequence: -1 });

    if (!latest) {
      if (payload.sequence !== 0 || payload.event_type !== 'play-started') {
        return rejected('invalid-session-start');
      }
    } else {
      if (payload.sequence <= latest.sequence) return rejected('out-of-order-sequence');
      const transitionError = checkTransition(latest, payload);
      if (transitionError) return rejected(transitionError);
      const regressionError = checkClientTimeRegression(latest, payload);
      if (regressionError) return rejected(regressionError);
    }

    const deltaError = checkListenedDelta(latest, payload);
    if (deltaError) return rejected(deltaError);

    const documentToCreate = { user: userId };
    for (const key of LISTENING_EVENT_PAYLOAD_FIELDS) {
      if (payload[key] !== undefined) documentToCreate[key] = payload[key];
    }

    try {
      const created = await ListeningEventModel.create(documentToCreate);
      return recorded(created);
    } catch (error) {
      if (!isDuplicateKeyError(error)) return failed();

      const recoveredByEventId = await ListeningEventModel.findOne({
        user: userId,
        event_id: payload.event_id,
      });
      if (recoveredByEventId) {
        if (coreIdentityMatches(recoveredByEventId, payload)) {
          return duplicate(recoveredByEventId);
        }
        return conflict('event-id-conflict');
      }

      const recoveredBySequence = await ListeningEventModel.findOne({
        user: userId,
        session_id: payload.session_id,
        sequence: payload.sequence,
      });
      if (recoveredBySequence) return conflict('sequence-conflict');
      return conflict('event-id-conflict');
    }
  };

  return { recordListeningEvent };
};

export default createListeningEventService;
