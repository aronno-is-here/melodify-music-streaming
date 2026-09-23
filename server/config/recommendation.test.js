import assert from 'node:assert/strict';
import test from 'node:test';
import recommendationConfig, { createRecommendationConfig } from './recommendation.js';

const flags = {
  RECOMMENDATION_CATALOG_SYNC_ENABLED: 'catalogSyncEnabled',
  RECOMMENDATION_LISTENING_EVENTS_ENABLED: 'listeningEventsEnabled',
  RECOMMENDATION_TRENDING_ENABLED: 'trendingEnabled',
  RECOMMENDATION_AI_ENABLED: 'aiEnabled',
  RECOMMENDATION_ADMIN_METRICS_ENABLED: 'adminMetricsEnabled',
};

const disabled = {
  catalogSyncEnabled: false,
  listeningEventsEnabled: false,
  trendingEnabled: false,
  aiEnabled: false,
  adminMetricsEnabled: false,
};

test('missing environment values disable every capability', () => {
  assert.deepEqual(createRecommendationConfig(), disabled);
  assert.deepEqual(createRecommendationConfig({}), disabled);
});

for (const [value, expected] of [
  [undefined, false],
  ['false', false],
  ['0', false],
  ['true', true],
  ['1', true],
  ['unexpected', false],
  ['', false],
  ['TRUE', false],
  [' true ', false],
  [true, false],
  [1, false],
]) {
  test(`strict parsing of ${typeof value} ${JSON.stringify(value)}`, () => {
    for (const [envName, property] of Object.entries(flags)) {
      const config = createRecommendationConfig({ [envName]: value });
      assert.deepEqual(config, { ...disabled, [property]: expected }, envName);
    }
  });
}

test('configuration is an immutable snapshot of its input', () => {
  const env = { RECOMMENDATION_AI_ENABLED: 'true' };
  const config = createRecommendationConfig(env);
  assert.deepEqual(env, { RECOMMENDATION_AI_ENABLED: 'true' });
  env.RECOMMENDATION_AI_ENABLED = 'false';
  assert.equal(config.aiEnabled, true);
  assert.equal(Object.isFrozen(config), true);
  assert.throws(() => { config.aiEnabled = false; }, TypeError);
});

test('default export is a frozen object containing only the five boolean flags', () => {
  assert.equal(Object.isFrozen(recommendationConfig), true);
  assert.deepEqual(Object.keys(recommendationConfig), Object.keys(disabled));
  for (const value of Object.values(recommendationConfig)) {
    assert.equal(typeof value, 'boolean');
  }
});
