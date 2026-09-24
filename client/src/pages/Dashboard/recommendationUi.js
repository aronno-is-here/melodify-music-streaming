import {
  PERSONALIZED_RECOMMENDATION_STATES,
} from '../../services/personalizedRecommendations.js';

export {
  PERSONALIZED_RECOMMENDATION_STATES,
  PERSONALIZED_RECOMMENDATION_EMPTY_REASONS,
  PERSONALIZED_RECOMMENDATION_ERROR_CODES,
  PERSONALIZED_RECOMMENDATION_SOURCE,
  PERSONALIZED_RECOMMENDATION_PATH,
  DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT,
  PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
  classifyPersonalizedRecommendationPayload,
  shouldUseLegacyRecommendationFallback,
  getPersonalizedRecommendationEmptyReason,
} from '../../services/personalizedRecommendations.js';

export const DASHBOARD_RECOMMENDATION_MODES = Object.freeze({
  LOADING: 'loading',
  PERSONALIZED: 'personalized',
  LEGACY: 'legacy',
});

export const DASHBOARD_RECOMMENDATION_LOADING_MESSAGE = 'Loading...';

const STATE_TO_MODE = Object.freeze({
  [PERSONALIZED_RECOMMENDATION_STATES.IDLE]: DASHBOARD_RECOMMENDATION_MODES.LOADING,
  [PERSONALIZED_RECOMMENDATION_STATES.LOADING]: DASHBOARD_RECOMMENDATION_MODES.LOADING,
  [PERSONALIZED_RECOMMENDATION_STATES.READY]: DASHBOARD_RECOMMENDATION_MODES.PERSONALIZED,
  [PERSONALIZED_RECOMMENDATION_STATES.NO_SNAPSHOT]: DASHBOARD_RECOMMENDATION_MODES.LEGACY,
  [PERSONALIZED_RECOMMENDATION_STATES.EMPTY]: DASHBOARD_RECOMMENDATION_MODES.LEGACY,
  [PERSONALIZED_RECOMMENDATION_STATES.DISABLED]: DASHBOARD_RECOMMENDATION_MODES.LEGACY,
  [PERSONALIZED_RECOMMENDATION_STATES.ERROR]: DASHBOARD_RECOMMENDATION_MODES.LEGACY,
});

export function selectDashboardRecommendationPresentation({
  state,
  personalizedSongs,
  legacySongs,
} = {}) {
  if (!Object.hasOwn(STATE_TO_MODE, state)) {
    throw new Error('invalid recommendation state');
  }

  const mode = STATE_TO_MODE[state];
  const presentation = {
    mode,
    state,
    isFallback: mode === DASHBOARD_RECOMMENDATION_MODES.LEGACY,
    songs: [],
  };

  if (mode === DASHBOARD_RECOMMENDATION_MODES.LOADING) {
    return presentation;
  }

  if (mode === DASHBOARD_RECOMMENDATION_MODES.PERSONALIZED) {
    presentation.songs = Array.isArray(personalizedSongs) ? personalizedSongs : [];
    return presentation;
  }

  presentation.songs = Array.isArray(legacySongs) ? legacySongs : [];
  return presentation;
}
