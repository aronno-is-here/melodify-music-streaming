// Only the exact strings 'true' and '1' enable a capability; all other values disable it.
const parseFlag = (value) => value === 'true' || value === '1';

// Pure factory for isolated tests and explicitly supplied environment snapshots.
export const createRecommendationConfig = (env = {}) => Object.freeze({
  catalogSyncEnabled: parseFlag(env.RECOMMENDATION_CATALOG_SYNC_ENABLED),
  listeningEventsEnabled: parseFlag(env.RECOMMENDATION_LISTENING_EVENTS_ENABLED),
  trendingEnabled: parseFlag(env.RECOMMENDATION_TRENDING_ENABLED),
  aiEnabled: parseFlag(env.RECOMMENDATION_AI_ENABLED),
  adminMetricsEnabled: parseFlag(env.RECOMMENDATION_ADMIN_METRICS_ENABLED),
});

// Read once at import. Load environment configuration before importing this module.
// This module deliberately does not load .env files or initialize any services.
const recommendationConfig = createRecommendationConfig(process.env);

export default recommendationConfig;
