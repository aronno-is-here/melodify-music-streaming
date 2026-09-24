import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ADMIN_RECOMMENDATION_HEALTH_BACKEND_STATES,
  ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES,
  ADMIN_RECOMMENDATION_HEALTH_PATH,
  ADMIN_RECOMMENDATION_HEALTH_PAYLOAD_INVALID_MESSAGE,
  ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED_MESSAGE,
  ADMIN_RECOMMENDATION_HEALTH_SOURCE,
  ADMIN_RECOMMENDATION_HEALTH_STATES,
  fetchAdminRecommendationHealth,
  normalizeAdminRecommendationHealthResponse,
} from './adminRecommendationHealth.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const SERVICE_SOURCE = readSource('./adminRecommendationHealth.js');
const HOOK_SOURCE = readSource('../hooks/useAdminRecommendationHealth.js');

const neverRunEnvelope = () => ({
  success: true,
  data: {
    state: 'never-run',
    source: ADMIN_RECOMMENDATION_HEALTH_SOURCE,
    lease: { active: false, run_id: null, expires_at: null },
    latest: null,
  },
});

const runningEnvelope = () => ({
  success: true,
  data: {
    state: 'running',
    source: ADMIN_RECOMMENDATION_HEALTH_SOURCE,
    lease: {
      active: true,
      run_id: 'run-43-01',
      expires_at: '2026-09-15T12:10:00.000Z',
    },
    latest: null,
  },
});

const completedEnvelope = () => ({
  success: true,
  data: {
    state: 'completed',
    source: ADMIN_RECOMMENDATION_HEALTH_SOURCE,
    lease: { active: false, run_id: null, expires_at: null },
    latest: {
      attempt_id: 'run-43-01-ffffffff',
      run_id: 'run-43-01',
      status: 'completed',
      started_at: '2026-09-15T12:00:00.000Z',
      finished_at: '2026-09-15T12:01:00.000Z',
      duration_ms: 60000,
      pipeline_stage: 'policy',
      snapshot_limit: 20,
      artifact_version: 'run-43-01',
      evaluation_run_id: 'run-43-01',
      snapshot_version: 'run-43-01',
      event_window_truncated: false,
      evaluation_created: true,
      failure_code: null,
      failure_message: null,
      input_event_count: 100,
      usable_event_count: 100,
      dropped_event_count: 0,
      train_event_count: 70,
      validation_event_count: 15,
      test_event_count: 15,
      unique_user_count: 5,
      unique_song_count: 8,
      session_count: 20,
      interaction_pair_count: 90,
      content_feature_count: 12,
      snapshot_persisted_count: 3,
      snapshot_reused_count: 1,
    },
  },
});

test('health service: constants match the contract', () => {
  assert.equal(ADMIN_RECOMMENDATION_HEALTH_PATH, '/api/admin/recommendations/health');
  assert.equal(ADMIN_RECOMMENDATION_HEALTH_SOURCE, 'retraining-health');
  assert.deepEqual(ADMIN_RECOMMENDATION_HEALTH_BACKEND_STATES, [
    'running',
    'never-run',
    'completed',
    'failed',
  ]);
  assert.equal(ADMIN_RECOMMENDATION_HEALTH_STATES.IDLE, 'idle');
  assert.equal(ADMIN_RECOMMENDATION_HEALTH_STATES.LOADING, 'loading');
  assert.equal(ADMIN_RECOMMENDATION_HEALTH_STATES.READY, 'ready');
  assert.equal(ADMIN_RECOMMENDATION_HEALTH_STATES.ERROR, 'error');
  assert.equal(
    ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.REQUEST_FAILED,
    'ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID,
    'ADMIN_RECOMMENDATION_HEALTH_PAYLOAD_INVALID',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED_MESSAGE,
    'Failed to load retraining health.',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_HEALTH_PAYLOAD_INVALID_MESSAGE,
    'Retraining health response was invalid.',
  );
});

test('health service: path has no query string', () => {
  assert.equal(ADMIN_RECOMMENDATION_HEALTH_PATH.includes('?'), false);
  assert.equal(ADMIN_RECOMMENDATION_HEALTH_PATH.includes('pipeline_stage'), false);
});

test('health service: normalize never-run ready', () => {
  const result = normalizeAdminRecommendationHealthResponse(neverRunEnvelope());
  assert.equal(result.state, ADMIN_RECOMMENDATION_HEALTH_STATES.READY);
  assert.equal(result.backendState, 'never-run');
  assert.equal(result.lease.active, false);
  assert.equal(result.latest, null);
  assert.equal(result.error, null);
});

test('health service: normalize running ready keeps active lease', () => {
  const result = normalizeAdminRecommendationHealthResponse(runningEnvelope());
  assert.equal(result.state, ADMIN_RECOMMENDATION_HEALTH_STATES.READY);
  assert.equal(result.backendState, 'running');
  assert.equal(result.lease.active, true);
  assert.equal(result.lease.run_id, 'run-43-01');
  assert.equal(result.latest, null);
});

test('health service: normalize completed ready with full latest whitelist', () => {
  const result = normalizeAdminRecommendationHealthResponse(completedEnvelope());
  assert.equal(result.state, ADMIN_RECOMMENDATION_HEALTH_STATES.READY);
  assert.equal(result.backendState, 'completed');
  assert.equal(result.latest.attempt_id, 'run-43-01-ffffffff');
  assert.equal(result.latest.status, 'completed');
  assert.equal(result.latest.failure_code, null);
  assert.equal(result.latest.snapshot_persisted_count, 3);
  assert.equal(result.latest.token, undefined);
});

test('health service: unknown backend state is payload invalid', () => {
  const envelope = neverRunEnvelope();
  envelope.data.state = 'healthy';
  const result = normalizeAdminRecommendationHealthResponse(envelope);
  assert.equal(result.state, ADMIN_RECOMMENDATION_HEALTH_STATES.ERROR);
  assert.equal(result.error.code, ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID);
});

test('health service: wrong source is payload invalid', () => {
  const envelope = neverRunEnvelope();
  envelope.data.source = 'evaluation-history';
  const result = normalizeAdminRecommendationHealthResponse(envelope);
  assert.equal(result.error.code, ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID);
});

test('health service: running with inactive lease is payload invalid', () => {
  const envelope = runningEnvelope();
  envelope.data.lease = { active: false, run_id: null, expires_at: null };
  const result = normalizeAdminRecommendationHealthResponse(envelope);
  assert.equal(result.error.code, ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID);
});

test('health service: completed with active lease is payload invalid', () => {
  const envelope = completedEnvelope();
  envelope.data.lease = {
    active: true,
    run_id: 'run-43-01',
    expires_at: '2026-09-15T12:10:00.000Z',
  };
  const result = normalizeAdminRecommendationHealthResponse(envelope);
  assert.equal(result.error.code, ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID);
});

test('health service: failed status without failure_code is payload invalid', () => {
  const envelope = completedEnvelope();
  envelope.data.state = 'failed';
  envelope.data.latest.status = 'failed';
  const result = normalizeAdminRecommendationHealthResponse(envelope);
  assert.equal(result.error.code, ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID);
});

test('health service: lease token field is stripped by normalization', () => {
  const envelope = runningEnvelope();
  envelope.data.lease.token = 'secret-token';
  const result = normalizeAdminRecommendationHealthResponse(envelope);
  assert.equal(result.state, ADMIN_RECOMMENDATION_HEALTH_STATES.READY);
  assert.equal(result.lease.token, undefined);
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
});

test('health service: success:false maps to request failed', () => {
  const result = normalizeAdminRecommendationHealthResponse({
    success: false,
    error: 'nope',
  });
  assert.equal(result.error.code, ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.REQUEST_FAILED);
  assert.equal(result.error.message, ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED_MESSAGE);
});

test('health service: non-object payload maps to payload invalid', () => {
  assert.equal(
    normalizeAdminRecommendationHealthResponse(null).error.code,
    ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID,
  );
  assert.equal(
    normalizeAdminRecommendationHealthResponse('x').error.code,
    ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID,
  );
  assert.equal(
    normalizeAdminRecommendationHealthResponse({}).error.code,
    ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID,
  );
});

test('health service: fetch missing client fails without request', async () => {
  let called = false;
  const result = await fetchAdminRecommendationHealth({
    apiClient: {
      async get() {
        called = true;
        return neverRunEnvelope();
      },
    },
  });
  assert.equal(result.state, ADMIN_RECOMMENDATION_HEALTH_STATES.READY);

  const missing = await fetchAdminRecommendationHealth({});
  assert.equal(missing.error.code, ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.REQUEST_FAILED);

  let secondCalled = false;
  await fetchAdminRecommendationHealth({
    apiClient: {
      async get() {
        secondCalled = true;
        throw new Error('network');
      },
    },
  });
  assert.equal(secondCalled, true);
  assert.equal(called, true);
});

test('health service: fetch uses exact path and optional signal', async () => {
  const paths = [];
  const options = [];
  const result = await fetchAdminRecommendationHealth({
    apiClient: {
      async get(path, opts) {
        paths.push(path);
        options.push(opts);
        return neverRunEnvelope();
      },
    },
  });
  assert.equal(paths[0], ADMIN_RECOMMENDATION_HEALTH_PATH);
  assert.equal(options[0], undefined);
  assert.equal(result.backendState, 'never-run');

  const controller = new AbortController();
  await fetchAdminRecommendationHealth({
    apiClient: {
      async get(path, opts) {
        paths.push(path);
        options.push(opts);
        return neverRunEnvelope();
      },
    },
    signal: controller.signal,
  });
  assert.equal(paths[1], ADMIN_RECOMMENDATION_HEALTH_PATH);
  assert.deepEqual(options[1], { signal: controller.signal });
});

test('health service source: no POST/PUT/DELETE, no React, no token storage', () => {
  for (const token of [
    'api.post',
    'api.put',
    'api.delete',
    'api.patch',
    'axios',
    'fetch(',
    'localStorage',
    'sessionStorage',
    'Bearer',
    'Authorization',
    'child_process',
    'RECOMMENDATION_AI_ENABLED',
    'setInterval',
    'Math.random',
    'winner',
    'healthy',
    'quality_score',
  ]) {
    assert.equal(SERVICE_SOURCE.includes(token), false, token);
    assert.equal(HOOK_SOURCE.includes(token), false, token);
  }
});

test('health hook source: one initial request pattern, no polling', () => {
  assert.equal(HOOK_SOURCE.includes('setInterval'), false);
  assert.equal(HOOK_SOURCE.includes('setTimeout'), false);
  assert.equal(HOOK_SOURCE.includes('auto'), false);
  assert.ok(HOOK_SOURCE.includes('useEffect'));
  assert.ok(HOOK_SOURCE.includes('refresh'));
  assert.ok(HOOK_SOURCE.includes('fetchAdminRecommendationHealth'));
});
