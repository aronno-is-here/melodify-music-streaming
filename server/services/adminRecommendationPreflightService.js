import recommendationConfig from '../config/recommendation.js';
import ListeningEvent from '../models/ListeningEvent.js';
import RecommendationEvaluationRun from '../models/RecommendationEvaluationRun.js';
import RecommendationSnapshot from '../models/RecommendationSnapshot.js';
import {
  RecommendationTrainingInputLimitError,
  createRecommendationTrainingInputService,
} from './recommendationTrainingInputService.js';

export const ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE = 'recommendation-preflight';

export const ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES = Object.freeze({
  invalidQuery: 'invalid recommendation preflight query',
  failed: 'failed to load recommendation preflight',
});

export const MIN_COLLABORATIVE_USERS = 2;
export const MIN_COLLABORATIVE_SONGS = 2;
export const MIN_COLLABORATIVE_INTERACTION_PAIRS = 2;

export const PREFLIGHT_STATE_READY = 'ready';
export const PREFLIGHT_STATE_INSUFFICIENT = 'insufficient';

export const PREFLIGHT_REASON_NO_LISTENING_EVENTS = 'NO_LISTENING_EVENTS';
export const PREFLIGHT_REASON_INSUFFICIENT_USERS = 'INSUFFICIENT_USERS';
export const PREFLIGHT_REASON_INSUFFICIENT_SONGS = 'INSUFFICIENT_SONGS';
export const PREFLIGHT_REASON_INSUFFICIENT_INTERACTIONS =
  'INSUFFICIENT_INTERACTIONS';
export const PREFLIGHT_REASON_INSUFFICIENT_TRAINING_DATA =
  'INSUFFICIENT_TRAINING_DATA';

const EMPTY_SONGS_MESSAGE = 'songs must be non-empty';

export class AdminRecommendationPreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationPreflightError';
  }
}

export class AdminRecommendationPreflightValidationError extends AdminRecommendationPreflightError {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationPreflightValidationError';
  }
}

export class AdminRecommendationPreflightReadError extends AdminRecommendationPreflightError {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationPreflightReadError';
  }
}

const toCount = (value) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;

const toBoolean = (value) =>
  value === true || value === 'true' || value === '1' || value === 1;

export function normalizePreflightFeatureFlags(value) {
  const source = value !== null && typeof value === 'object' ? value : {};
  return {
    recommendation_ai_enabled: toBoolean(source.recommendation_ai_enabled),
    listening_events_enabled: toBoolean(source.listening_events_enabled),
  };
}

export function summarizeUsableEvents(input) {
  if (input === null || typeof input !== 'object') {
    return {
      usable_events: 0,
      distinct_users: 0,
      distinct_songs: 0,
      interaction_pairs: 0,
    };
  }
  const songs = Array.isArray(input.songs) ? input.songs : [];
  const users = Array.isArray(input.users) ? input.users : [];
  const events = Array.isArray(input.events) ? input.events : [];

  const songIds = new Set();
  for (const song of songs) {
    if (song && typeof song._id === 'string') songIds.add(song._id);
  }
  const userIds = new Set();
  for (const userId of users) {
    if (typeof userId === 'string') userIds.add(userId);
  }

  let usableEvents = 0;
  const distinctUsers = new Set();
  const distinctSongs = new Set();
  const interactionPairs = new Set();
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const user = typeof event.user === 'string' ? event.user : null;
    const song = typeof event.song === 'string' ? event.song : null;
    if (!user || !song) continue;
    if (!userIds.has(user) || !songIds.has(song)) continue;
    usableEvents += 1;
    distinctUsers.add(user);
    distinctSongs.add(song);
    interactionPairs.add(`${user}|${song}`);
  }

  return {
    usable_events: usableEvents,
    distinct_users: distinctUsers.size,
    distinct_songs: distinctSongs.size,
    interaction_pairs: interactionPairs.size,
  };
}

export function evaluateRecommendationReadiness({
  listeningEvents,
  catalogSongs,
  usableEvents,
  distinctUsers,
  distinctSongs,
  interactionPairs,
} = {}) {
  const events = toCount(listeningEvents);
  const songs = toCount(catalogSongs);
  const usable = toCount(usableEvents);
  const users = toCount(distinctUsers);
  const items = toCount(distinctSongs);
  const pairs = toCount(interactionPairs);

  if (events === 0) {
    return { state: PREFLIGHT_STATE_INSUFFICIENT, reason: PREFLIGHT_REASON_NO_LISTENING_EVENTS };
  }
  if (songs === 0) {
    return { state: PREFLIGHT_STATE_INSUFFICIENT, reason: PREFLIGHT_REASON_INSUFFICIENT_SONGS };
  }
  if (usable === 0) {
    return {
      state: PREFLIGHT_STATE_INSUFFICIENT,
      reason: PREFLIGHT_REASON_INSUFFICIENT_TRAINING_DATA,
    };
  }
  if (users < MIN_COLLABORATIVE_USERS) {
    return { state: PREFLIGHT_STATE_INSUFFICIENT, reason: PREFLIGHT_REASON_INSUFFICIENT_USERS };
  }
  if (items < MIN_COLLABORATIVE_SONGS) {
    return { state: PREFLIGHT_STATE_INSUFFICIENT, reason: PREFLIGHT_REASON_INSUFFICIENT_SONGS };
  }
  if (pairs < MIN_COLLABORATIVE_INTERACTION_PAIRS) {
    return {
      state: PREFLIGHT_STATE_INSUFFICIENT,
      reason: PREFLIGHT_REASON_INSUFFICIENT_INTERACTIONS,
    };
  }
  return { state: PREFLIGHT_STATE_READY, reason: null };
}

export function createAdminRecommendationPreflightService({
  trainingInputService = createRecommendationTrainingInputService(),
  ListeningEventModel = ListeningEvent,
  EvaluationRunModel = RecommendationEvaluationRun,
  SnapshotModel = RecommendationSnapshot,
  readFeatureFlags = () => ({
    recommendation_ai_enabled: recommendationConfig.aiEnabled,
    listening_events_enabled: recommendationConfig.listeningEventsEnabled,
  }),
} = {}) {
  if (
    !trainingInputService ||
    typeof trainingInputService.collectRetrainingInput !== 'function'
  ) {
    throw new AdminRecommendationPreflightValidationError(
      'invalid training input service',
    );
  }
  if (typeof ListeningEventModel?.countDocuments !== 'function') {
    throw new AdminRecommendationPreflightValidationError(
      'invalid listening event model',
    );
  }
  if (typeof EvaluationRunModel?.countDocuments !== 'function') {
    throw new AdminRecommendationPreflightValidationError(
      'invalid evaluation run model',
    );
  }
  if (typeof SnapshotModel?.countDocuments !== 'function') {
    throw new AdminRecommendationPreflightValidationError(
      'invalid recommendation snapshot model',
    );
  }
  if (typeof readFeatureFlags !== 'function') {
    throw new AdminRecommendationPreflightValidationError(
      'invalid feature flag reader',
    );
  }

  const getRecommendationPreflight = async () => {
    let listeningEvents = 0;
    try {
      listeningEvents = toCount(await ListeningEventModel.countDocuments());
    } catch {
      throw new AdminRecommendationPreflightReadError(
        ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES.failed,
      );
    }

    let input = null;
    try {
      input = await trainingInputService.collectRetrainingInput();
    } catch (error) {
      const emptyCatalog =
        error instanceof RecommendationTrainingInputLimitError &&
        error.message === EMPTY_SONGS_MESSAGE;
      if (!emptyCatalog) {
        throw new AdminRecommendationPreflightReadError(
          ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES.failed,
        );
      }
    }

    const usable = summarizeUsableEvents(input);
    const catalogSongs =
      input && typeof input.unique_song_count === 'number'
        ? toCount(input.unique_song_count)
        : 0;

    let evaluationRuns = 0;
    let snapshots = 0;
    try {
      evaluationRuns = toCount(await EvaluationRunModel.countDocuments());
      snapshots = toCount(await SnapshotModel.countDocuments());
    } catch {
      throw new AdminRecommendationPreflightReadError(
        ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES.failed,
      );
    }

    const sufficiency = evaluateRecommendationReadiness({
      listeningEvents,
      catalogSongs,
      usableEvents: usable.usable_events,
      distinctUsers: usable.distinct_users,
      distinctSongs: usable.distinct_songs,
      interactionPairs: usable.interaction_pairs,
    });

    return {
      source: ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE,
      feature_flags: normalizePreflightFeatureFlags(readFeatureFlags()),
      catalog: { songs: catalogSongs },
      telemetry: {
        listening_events: listeningEvents,
        usable_events: usable.usable_events,
        distinct_users: usable.distinct_users,
        distinct_songs: usable.distinct_songs,
      },
      persisted: {
        evaluation_runs: evaluationRuns,
        snapshots,
      },
      sufficiency,
    };
  };

  return { getRecommendationPreflight };
}

export default createAdminRecommendationPreflightService;
