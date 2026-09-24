export const PROGRESS_EMIT_INTERVAL_SECONDS = 15;
export const MAX_LISTENED_DELTA_SECONDS = 120;
export const MAX_POSITION_SECONDS = 86400;
export const MAX_DURATION_SECONDS = 86400;
export const LISTENING_TELEMETRY_DISABLED_MESSAGE = 'Listening event recording is disabled';

export const TELEMETRY_EVENT_FIELDS = Object.freeze([
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

const normalizeSongId = (song) => {
  if (typeof song === 'string' && song.trim()) return song.trim();
  if (song && typeof song === 'object' && song._id != null) return String(song._id);
  return null;
};

const sanitizeSeconds = (value, { min = 0, max = MAX_POSITION_SECONDS, exclusiveMin = false } = {}) => {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (exclusiveMin ? value <= min : value < min) return undefined;
  if (value > max) return undefined;
  return value;
};

const sanitizeDuration = (value) =>
  sanitizeSeconds(value, { min: 0, max: MAX_DURATION_SECONDS, exclusiveMin: true });

const sanitizeDelta = (value) => {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  if (value > MAX_LISTENED_DELTA_SECONDS) return MAX_LISTENED_DELTA_SECONDS;
  return value;
};

const computeForwardDelta = (baseline, position) => {
  if (baseline == null || position == null) return 0;
  if (!Number.isFinite(baseline) || !Number.isFinite(position)) return 0;
  if (position <= baseline) return 0;
  return Math.min(position - baseline, MAX_LISTENED_DELTA_SECONDS);
};

const computeRawAdvance = (baseline, position) => {
  if (baseline == null || position == null) return 0;
  if (!Number.isFinite(baseline) || !Number.isFinite(position)) return 0;
  if (position <= baseline) return 0;
  return position - baseline;
};

const toIsoTimestamp = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  return undefined;
};

export function createBrowserIdFactory() {
  return () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {}
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      let out = '';
      for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
      return out;
    } catch {
      return `mid-${Date.now().toString(36)}`;
    }
  };
}

const isDisabledResult = (result) => {
  if (!result || typeof result !== 'object') return false;
  if (result.disabled === true) return true;
  return result.error === LISTENING_TELEMETRY_DISABLED_MESSAGE;
};

export function createListeningTelemetryController({
  sendEvent,
  recordHistory,
  makeId,
  now,
  progressIntervalSeconds = PROGRESS_EMIT_INTERVAL_SECONDS,
  hasAuthToken,
} = {}) {
  if (typeof sendEvent !== 'function') {
    throw new TypeError('sendEvent is required');
  }
  const nextId = typeof makeId === 'function' ? makeId : createBrowserIdFactory();
  const clock = typeof now === 'function' ? now : () => new Date();
  const intervalSeconds =
    typeof progressIntervalSeconds === 'number' && progressIntervalSeconds > 0
      ? progressIntervalSeconds
      : PROGRESS_EMIT_INTERVAL_SECONDS;
  const authOk = typeof hasAuthToken === 'function' ? hasAuthToken : () => true;

  let disabled = false;
  let chain = Promise.resolve();
  let session = null;

  const enqueueSend = (payload) => {
    chain = chain.then(async () => {
      if (disabled) return;
      if (!authOk()) return;
      try {
        const result = await sendEvent(payload);
        if (isDisabledResult(result)) disabled = true;
      } catch {
        // Telemetry failures never propagate to playback.
      }
    });
    return chain;
  };

  const buildPayload = (eventType, fields = {}) => {
    const payload = {
      song: session.songId,
      session_id: session.sessionId,
      event_id: nextId(),
      sequence: session.nextSequence,
      event_type: eventType,
      client_occurred_at: toIsoTimestamp(clock()),
    };
    session.nextSequence += 1;

    const position = sanitizeSeconds(fields.position);
    if (position !== undefined) payload.position_seconds = position;

    const duration = sanitizeDuration(fields.duration);
    if (duration !== undefined) payload.duration_seconds = duration;

    if (fields.reason !== undefined) payload.transition_reason = fields.reason;

    if (fields.listenedSecondsDelta !== undefined) {
      const delta = sanitizeDelta(fields.listenedSecondsDelta);
      if (delta !== undefined && delta > 0) payload.listened_seconds_delta = delta;
    }

    if (fields.seekFrom !== undefined) {
      const from = sanitizeSeconds(fields.seekFrom);
      if (from !== undefined) payload.seek_from_seconds = from;
    }
    if (fields.seekTo !== undefined) {
      const to = sanitizeSeconds(fields.seekTo);
      if (to !== undefined) payload.seek_to_seconds = to;
    }

    return payload;
  };

  const emit = (eventType, fields = {}) => {
    if (!session || disabled) return false;
    if (eventType === 'play-started') {
      if (session.started) return false;
    } else {
      if (!session.started) return false;
      if (eventType === 'replay-started') {
        if (session.terminalType !== 'completed') return false;
      } else if (session.terminal) return false;
    }

    const payload = buildPayload(eventType, fields);
    enqueueSend(payload);
    return true;
  };

  const maybeRecordHistory = () => {
    if (!session || session.historyRecorded) return;
    session.historyRecorded = true;
    if (typeof recordHistory !== 'function') return;
    try {
      const result = recordHistory(session.songId);
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // History failure must never break playback.
    }
  };

  const prepare = (song) => {
    const songId = normalizeSongId(song);
    if (!songId) return false;
    if (session && session.songId === songId && (!session.terminal || session.terminalType === 'completed')) {
      return false;
    }
    session = {
      sessionId: nextId(),
      songId,
      nextSequence: 0,
      started: false,
      paused: false,
      terminal: false,
      terminalType: null,
      baselinePosition: null,
      historyRecorded: false,
    };
    return true;
  };

  const confirmedPlay = ({ position, duration } = {}) => {
    if (!session) return;
    const safePosition = sanitizeSeconds(position);
    const safeDuration = sanitizeDuration(duration);

    if (session.terminal) {
      // Only natural completion permits a same-session replay. A skipped track
      // must be prepared anew, not reopened by a late media callback.
      if (session.terminalType !== 'completed') return;
      emit('replay-started', { position: safePosition, duration: safeDuration, reason: 'repeat' });
      session.terminal = false;
      session.terminalType = null;
      session.paused = false;
      session.baselinePosition = safePosition ?? null;
      return;
    }

    if (!session.started) {
      emit('play-started', { position: safePosition, duration: safeDuration });
      session.started = true;
      session.paused = false;
      session.baselinePosition = safePosition ?? null;
      maybeRecordHistory();
      return;
    }

    if (session.paused) {
      session.paused = false;
      session.baselinePosition = safePosition ?? session.baselinePosition;
      emit('resumed', { position: safePosition, duration: safeDuration });
    }
  };

  const flushProgress = (position, duration) => {
    if (!session || disabled || session.terminal || !session.started || session.paused) return false;
    const safePosition = sanitizeSeconds(position);
    if (safePosition === undefined) return false;
    const raw = computeRawAdvance(session.baselinePosition, safePosition);
    if (raw <= 0) return false;
    const delta = computeForwardDelta(session.baselinePosition, safePosition);
    session.baselinePosition = safePosition;
    if (delta <= 0) return false;
    emit('progress', {
      position: safePosition,
      duration: sanitizeDuration(duration),
      listenedSecondsDelta: delta,
    });
    return true;
  };

  const progress = ({ position, duration } = {}) => {
    if (!session || disabled || session.terminal || !session.started || session.paused) return;
    const safePosition = sanitizeSeconds(position);
    if (safePosition === undefined) return;
    const raw = computeRawAdvance(session.baselinePosition, safePosition);
    if (raw < intervalSeconds) return;
    flushProgress(safePosition, duration);
  };

  const pause = ({ position, duration } = {}) => {
    if (!session || disabled || session.terminal || !session.started || session.paused) return;
    const safePosition = sanitizeSeconds(position);
    const safeDuration = sanitizeDuration(duration);
    if (safePosition !== undefined) {
      flushProgress(safePosition, safeDuration);
    }
    session.paused = true;
    emit('paused', { position: safePosition, duration: safeDuration });
  };

  const seek = ({ from, to, duration } = {}) => {
    if (!session || disabled || session.terminal || !session.started) return;
    const safeFrom = sanitizeSeconds(from);
    const safeTo = sanitizeSeconds(to);
    const safeDuration = sanitizeDuration(duration);
    if (safeFrom === undefined || safeTo === undefined) return;

    if (!session.paused) {
      const preSeekDelta = computeForwardDelta(session.baselinePosition, safeFrom);
      if (preSeekDelta > 0) {
        session.baselinePosition = safeFrom;
        emit('progress', {
          position: safeFrom,
          duration: safeDuration,
          listenedSecondsDelta: preSeekDelta,
        });
      }
    }

    emit('seeked', {
      position: safeTo,
      duration: safeDuration,
      seekFrom: safeFrom,
      seekTo: safeTo,
    });
    session.baselinePosition = safeTo;
  };

  const complete = ({ position, duration } = {}) => {
    if (!session || session.terminal || !session.started) return;
    const safeDuration = sanitizeDuration(duration);
    const safePosition = sanitizeSeconds(position) ?? safeDuration;
    if (safePosition !== undefined) {
      flushProgress(safePosition, safeDuration);
    }
    emit('completed', { position: safePosition, duration: safeDuration });
    session.terminal = true;
    session.terminalType = 'completed';
    session.paused = false;
  };

  // The player calls this only when a manual action changes logical tracks.
  const skip = ({ reason, position, duration } = {}) => {
    if (!['manual-next', 'manual-previous', 'new-selection'].includes(reason)) return;
    if (!session || session.terminal || !session.started) return;
    const safePosition = sanitizeSeconds(position);
    const safeDuration = sanitizeDuration(duration);
    flushProgress(safePosition, safeDuration);
    emit('skipped', { position: safePosition, duration: safeDuration, reason });
    session.terminal = true;
    session.terminalType = 'skipped';
    session.paused = false;
  };

  const reset = () => {
    session = null;
  };

  const isDisabled = () => disabled;

  const getSessionSnapshot = () => (session ? { ...session } : null);

  const whenIdle = () => chain;

  return {
    prepare,
    confirmedPlay,
    progress,
    pause,
    seek,
    complete,
    skip,
    reset,
    isDisabled,
    getSessionSnapshot,
    whenIdle,
  };
}
