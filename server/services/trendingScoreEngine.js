export const TRENDING_WINDOW_HOURS = 168;
export const TRENDING_HALF_LIFE_HOURS = 24;
export const MAX_TRENDING_EVENT_INPUTS = 50000;
export const DEFAULT_TRENDING_LIMIT = 20;
export const MAX_TRENDING_LIMIT = 100;
export const PLAY_STARTED_WEIGHT = 1.0;
export const COMPLETED_WEIGHT = 2.0;
export const REPLAY_STARTED_WEIGHT = 1.5;
export const SKIPPED_WEIGHT = -0.75;
export const LISTENED_MINUTE_WEIGHT = 0.25;
export const UNIQUE_LISTENER_WEIGHT = 0.5;
export const MIN_USER_SONG_CONTRIBUTION = -3;
export const MAX_USER_SONG_CONTRIBUTION = 8;

export const TRENDING_EVENT_INPUT_EXCEEDED_ERROR = 'Trending event input exceeds limit';
export const TRENDING_INVALID_EVENTS_ERROR = 'Invalid trending events';
export const TRENDING_INVALID_NOW_ERROR = 'Invalid trending now';
export const TRENDING_INVALID_LIMIT_ERROR = 'Invalid trending limit';

const HOUR_MS = 3600000;
const WINDOW_MS = TRENDING_WINDOW_HOURS * HOUR_MS;
const MAX_LISTENED_DELTA_SECONDS = 120;
const HEX_PATTERN = /^[a-f\d]{24}$/i;

const TRENDING_EVENT_TYPES = Object.freeze([
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

const EVENT_TYPE_WEIGHTS = Object.freeze({
  'play-started': PLAY_STARTED_WEIGHT,
  completed: COMPLETED_WEIGHT,
  'replay-started': REPLAY_STARTED_WEIGHT,
  skipped: SKIPPED_WEIGHT,
});

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const roundTo6 = (value) => Math.round(value * 1e6) / 1e6;

export const trendingDecay = (ageHours) => 0.5 ** (ageHours / TRENDING_HALF_LIFE_HOURS);

const canonicalEntityId = (value) => {
  if (typeof value === 'string') return HEX_PATTERN.test(value) ? value.toLowerCase() : null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.toHexString === 'function') {
    try {
      const hex = value.toHexString();
      return typeof hex === 'string' && HEX_PATTERN.test(hex) ? hex.toLowerCase() : null;
    } catch {
      return null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, '_id')) return canonicalEntityId(value._id);
  return null;
};

const parseTime = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
};

const validListenedDelta = (value) =>
  typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= MAX_LISTENED_DELTA_SECONDS;

/**
 * Pure, deterministic global Trending ranking from recent ListeningEvent activity.
 * Transparent coefficients only — not ML, not personalization, not AI recommendations.
 * Server `createdAt` controls recency; tests/callers inject `now`.
 */
export function scoreTrendingSongs(events, options) {
  if (!Array.isArray(events)) throw new Error(TRENDING_INVALID_EVENTS_ERROR);
  if (events.length > MAX_TRENDING_EVENT_INPUTS) throw new Error(TRENDING_EVENT_INPUT_EXCEEDED_ERROR);

  const opts = options !== null && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const nowMs = parseTime(opts.now);
  if (nowMs === null) throw new Error(TRENDING_INVALID_NOW_ERROR);

  const limit = opts.limit === undefined ? DEFAULT_TRENDING_LIMIT : opts.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRENDING_LIMIT) {
    throw new Error(TRENDING_INVALID_LIMIT_ERROR);
  }

  const untilMs = nowMs;
  const sinceMs = nowMs - WINDOW_MS;

  const validEvents = [];
  for (const row of events) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const userId = canonicalEntityId(row.user);
    const songId = canonicalEntityId(row.song);
    if (!userId || !songId) continue;
    const type = row.event_type;
    if (typeof type !== 'string' || !TRENDING_EVENT_TYPES.includes(type)) continue;
    const createdMs = parseTime(row.createdAt);
    if (createdMs === null || createdMs < sinceMs || createdMs > untilMs) continue;
    const delta = validListenedDelta(row.listened_seconds_delta) ? row.listened_seconds_delta : 0;
    const ageHours = (nowMs - createdMs) / HOUR_MS;
    const decay = trendingDecay(ageHours);
    const baseWeight = EVENT_TYPE_WEIGHTS[type] ?? 0;
    const signal = baseWeight + (delta / 60) * LISTENED_MINUTE_WEIGHT;
    validEvents.push({
      userId,
      songId,
      type,
      createdMs,
      delta,
      decay,
      contribution: signal * decay,
      isListenerStart: type === 'play-started' || type === 'replay-started',
    });
  }

  validEvents.sort((a, b) => (
    a.createdMs - b.createdMs
    || compareText(a.songId, b.songId)
    || compareText(a.userId, b.userId)
    || compareText(a.type, b.type)
    || a.delta - b.delta
  ));

  const songs = new Map();
  for (const event of validEvents) {
    let song = songs.get(event.songId);
    if (!song) {
      song = {
        byUser: new Map(),
        play_started_count: 0,
        completed_count: 0,
        replay_started_count: 0,
        skipped_count: 0,
        listened_seconds: 0,
        last_activity_ms: 0,
      };
      songs.set(event.songId, song);
    }
    let user = song.byUser.get(event.userId);
    if (!user) {
      user = { eventSum: 0, latestStartMs: -1, latestStartDecay: 0 };
      song.byUser.set(event.userId, user);
    }
    user.eventSum += event.contribution;
    if (event.isListenerStart && event.createdMs > user.latestStartMs) {
      user.latestStartMs = event.createdMs;
      user.latestStartDecay = event.decay;
    }
    if (event.type === 'play-started') song.play_started_count += 1;
    else if (event.type === 'completed') song.completed_count += 1;
    else if (event.type === 'replay-started') song.replay_started_count += 1;
    else if (event.type === 'skipped') song.skipped_count += 1;
    song.listened_seconds += event.delta;
    if (event.createdMs > song.last_activity_ms) song.last_activity_ms = event.createdMs;
  }

  const ranked = [];
  for (const [songId, song] of songs) {
    let rawScore = 0;
    let uniqueListenerCount = 0;
    const userIds = [...song.byUser.keys()].sort(compareText);
    for (const userId of userIds) {
      const user = song.byUser.get(userId);
      const clampedEventSum = Math.min(
        MAX_USER_SONG_CONTRIBUTION,
        Math.max(MIN_USER_SONG_CONTRIBUTION, user.eventSum),
      );
      let userSongScore = clampedEventSum;
      if (user.latestStartMs >= 0) {
        uniqueListenerCount += 1;
        userSongScore += UNIQUE_LISTENER_WEIGHT * user.latestStartDecay;
      }
      rawScore += userSongScore;
    }
    const internalScore = Math.max(0, rawScore);
    if (internalScore === 0) continue;
    ranked.push({
      song_id: songId,
      score: roundTo6(internalScore),
      unique_listener_count: uniqueListenerCount,
      play_started_count: song.play_started_count,
      completed_count: song.completed_count,
      replay_started_count: song.replay_started_count,
      skipped_count: song.skipped_count,
      listened_seconds: song.listened_seconds,
      last_activity_at: new Date(song.last_activity_ms).toISOString(),
      internalScore,
    });
  }

  ranked.sort((a, b) => {
    if (a.internalScore !== b.internalScore) return b.internalScore - a.internalScore;
    if (a.unique_listener_count !== b.unique_listener_count) {
      return b.unique_listener_count - a.unique_listener_count;
    }
    if (a.last_activity_at !== b.last_activity_at) {
      return a.last_activity_at < b.last_activity_at ? 1 : -1;
    }
    return compareText(a.song_id, b.song_id);
  });

  return ranked.slice(0, limit).map(({ internalScore, ...row }) => row);
}

export default scoreTrendingSongs;
