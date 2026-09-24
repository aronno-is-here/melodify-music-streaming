export const LISTENING_EVENT_REQUEST_FIELDS = Object.freeze([
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

export const LISTENING_EVENT_HTTP_MESSAGES = Object.freeze({
  invalidBody: 'invalid request body',
  rejected: 'listening event rejected',
  songNotFound: 'song not found',
  conflict: 'listening event conflict',
  failed: 'listening event recording failed',
  disabled: 'Listening event recording is disabled',
});

const isPlainObjectLike = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseListeningEventRequest(body) {
  if (!isPlainObjectLike(body)) {
    return { ok: false, error: LISTENING_EVENT_HTTP_MESSAGES.invalidBody };
  }

  for (const key of Object.keys(body)) {
    if (!LISTENING_EVENT_REQUEST_FIELDS.includes(key)) {
      return { ok: false, error: LISTENING_EVENT_HTTP_MESSAGES.invalidBody };
    }
  }

  const value = {};
  for (const key of LISTENING_EVENT_REQUEST_FIELDS) {
    if (body[key] !== undefined) value[key] = body[key];
  }

  return { ok: true, value };
}

const extractSafeEventFields = (event) => {
  if (!isPlainObjectLike(event)) return {};
  const safe = {};
  if (event.event_id !== undefined) safe.event_id = String(event.event_id);
  if (event.session_id !== undefined) safe.session_id = String(event.session_id);
  if (event.sequence !== undefined && Number.isFinite(event.sequence)) {
    safe.sequence = event.sequence;
  }
  if (event.song !== undefined) safe.song = String(event.song);
  return safe;
};

const failedBody = (data) => ({
  httpStatus: 500,
  body: {
    success: false,
    error: LISTENING_EVENT_HTTP_MESSAGES.failed,
    data,
  },
});

export function mapListeningEventResult(result) {
  if (!isPlainObjectLike(result) || typeof result.status !== 'string') {
    return failedBody({ status: 'failed', reason: 'persistence-failed' });
  }

  const status = result.status;
  const reason =
    result.reason === undefined || result.reason === null ? null : String(result.reason);
  const eventFields = extractSafeEventFields(result.event);
  const data = { status, reason, ...eventFields };

  if (status === 'recorded') {
    return { httpStatus: 201, body: { success: true, data } };
  }
  if (status === 'duplicate') {
    return { httpStatus: 200, body: { success: true, data } };
  }
  if (status === 'rejected') {
    const songMissing = reason === 'song-not-found';
    return {
      httpStatus: songMissing ? 404 : 400,
      body: {
        success: false,
        error: songMissing
          ? LISTENING_EVENT_HTTP_MESSAGES.songNotFound
          : LISTENING_EVENT_HTTP_MESSAGES.rejected,
        data,
      },
    };
  }
  if (status === 'conflict') {
    return {
      httpStatus: 409,
      body: {
        success: false,
        error: LISTENING_EVENT_HTTP_MESSAGES.conflict,
        data,
      },
    };
  }
  if (status === 'failed') {
    return failedBody({ status: 'failed', reason: 'persistence-failed' });
  }
  return failedBody({ status: 'failed', reason: 'persistence-failed' });
}
