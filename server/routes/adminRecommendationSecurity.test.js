import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createAdminRecommendationRouter,
  parseAdminRecommendationHistoryQuery,
  parseAdminRecommendationMetricsQuery,
} from './adminRecommendationRoutes.js';
import { createAdminRecommendationMetricsService } from '../services/adminRecommendationMetricsService.js';
import { createAdminRecommendationHistoryService } from '../services/adminRecommendationHistoryService.js';
import { PIPELINE_STAGES } from '../models/RecommendationEvaluationRun.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const ROUTE_SOURCE = readSource('./adminRecommendationRoutes.js');
const SERVICE_SOURCE = readSource('../services/adminRecommendationMetricsService.js');
const SERVER_SOURCE = readSource('../server.js');
const AUTH_SOURCE = readSource('../middleware/auth.js');

const VALID_QUERY_ERROR = 'invalid recommendation metrics query';
const FAILED_ERROR = 'failed to load recommendation metrics';
const VALID_HISTORY_QUERY_ERROR = 'invalid recommendation history query';
const FAILED_HISTORY_ERROR = 'failed to load recommendation history';

const readyData = {
  state: 'ready',
  source: 'evaluation-history',
  pipeline_stage: 'policy',
  latest: {
    run_id: 'eval-2026-09-15-policy-1',
    pipeline_stage: 'policy',
    artifact_version: null,
    evaluated_at: '2026-09-15T12:00:00.000Z',
    metrics: {
      precision_at_5: 0.4,
      precision_at_10: 0.35,
      recall_at_5: 0.5,
      recall_at_10: 0.6,
      ndcg_at_5: 0.45,
      ndcg_at_10: 0.55,
      map_at_10: 0.5,
      hit_rate_at_10: 0.7,
      catalog_coverage: 0.25,
      diversity: 0.8,
    },
    summary: {
      evaluated_user_count: 10,
      recommendation_user_count: 12,
      relevance_user_count: 10,
      catalog_size: 50,
      unique_recommended_at_10: 40,
      diversity_evaluable_user_count: 8,
      diversity_pair_count: 28,
    },
  },
};

const noRunsData = {
  state: 'no-runs',
  source: 'evaluation-history',
  pipeline_stage: 'policy',
  latest: null,
};

function createRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function createHarness({
  serviceResult = readyData,
  serviceError = null,
  protectImpl = null,
  adminOnlyImpl = null,
} = {}) {
  const state = {
    protectCalls: 0,
    adminOnlyCalls: 0,
    serviceCalls: [],
    handlerBodySeen: false,
  };

  const baseProtect =
    protectImpl ??
    ((req, res, next) => {
      next();
    });
  const baseAdmin =
    adminOnlyImpl ??
    ((req, res, next) => {
      next();
    });

  const router = createAdminRecommendationRouter({
    protectMiddleware: (req, res, next) => {
      state.protectCalls += 1;
      return baseProtect(req, res, next);
    },
    adminOnlyMiddleware: (req, res, next) => {
      state.adminOnlyCalls += 1;
      return baseAdmin(req, res, next);
    },
    adminRecommendationMetricsService: {
      async getLatestRecommendationMetrics(args) {
        state.serviceCalls.push(args);
        if (serviceError) throw serviceError;
        return serviceResult;
      },
    },
  });

  const layer = router.stack.find((l) => l.route && l.route.path === '/metrics');
  assert.ok(layer, 'expected GET /metrics route');
  const handlers = layer.route.stack.map((s) => s.handle);

  const invoke = async ({
    query = {},
    headers = {},
    body,
    user = { role: 'admin' },
  } = {}) => {
    const req = { query, headers };
    if (body !== undefined) req.body = body;
    if (user !== null) req.user = user;
    const res = createRes();
    let index = 0;
    const runNext = async () => {
      if (index >= handlers.length) {
        state.handlerBodySeen = true;
        return;
      }
      const handler = handlers[index];
      index += 1;
      await handler(req, res, runNext);
    };
    await runNext();
    return { req, res, state };
  };

  return { invoke, state, handlers, layer, router };
}

const unauthorizedProtect = (req, res) => {
  res.status(401).json({ success: false, error: 'Not authorized, no token' });
};

const forbiddenAdmin = (req, res) => {
  res.status(403).json({ success: false, error: 'Admin access required' });
};

// ============================================================
// ROUTE STRUCTURE
// ============================================================

test('structure: routes are GET /metrics, GET /history, and GET /health only (no write methods)', () => {
  const router = createAdminRecommendationRouter({
    protectMiddleware: (req, res, next) => next(),
    adminOnlyMiddleware: (req, res, next) => next(),
    adminRecommendationMetricsService: {
      async getLatestRecommendationMetrics() {
        return noRunsData;
      },
    },
    adminRecommendationHistoryService: {
      async getRecommendationEvaluationHistory() {
        return {
          state: 'no-runs',
          source: 'evaluation-history',
          pipeline_stage: 'policy',
          limit: 20,
          count: 0,
          runs: [],
        };
      },
    },
    adminRecommendationHealthService: {
      async getRecommendationRetrainingHealth() {
        return {
          state: 'never-run',
          source: 'retraining-health',
          lease: { active: false, run_id: null, expires_at: null },
          latest: null,
        };
      },
    },
  });
  const metricsLayer = router.stack.find((l) => l.route && l.route.path === '/metrics');
  assert.ok(metricsLayer);
  assert.deepEqual(Object.keys(metricsLayer.route.methods), ['get']);
  const historyLayer = router.stack.find((l) => l.route && l.route.path === '/history');
  assert.ok(historyLayer, 'expected GET /history route');
  assert.deepEqual(Object.keys(historyLayer.route.methods), ['get']);
  const healthLayer = router.stack.find((l) => l.route && l.route.path === '/health');
  assert.ok(healthLayer, 'expected GET /health route');
  assert.deepEqual(Object.keys(healthLayer.route.methods), ['get']);
  const writePaths = router.stack.filter(
    (l) =>
      l.route &&
      (l.route.methods.post ||
        l.route.methods.put ||
        l.route.methods.patch ||
        l.route.methods.delete),
  );
  assert.equal(writePaths.length, 0);
  assert.equal(ROUTE_SOURCE.includes('router.post'), false);
  assert.equal(ROUTE_SOURCE.includes('router.put'), false);
  assert.equal(ROUTE_SOURCE.includes('router.patch'), false);
  assert.equal(ROUTE_SOURCE.includes('router.delete'), false);
});

test('structure: middleware order is protect -> adminOnly -> handler', async () => {
  const { invoke, state, handlers } = createHarness();
  const order = [];
  const tracked = createHarness({
    protectImpl: (req, res, next) => {
      order.push('protect');
      next();
    },
    adminOnlyImpl: (req, res, next) => {
      order.push('adminOnly');
      next();
    },
  });
  await tracked.invoke({});
  assert.deepEqual(order, ['protect', 'adminOnly']);
  assert.equal(handlers.length, 3);
  assert.ok(state.protectCalls >= 0);
});

test('structure: adminOnly cannot run before protect (stack registration order)', () => {
  const { handlers } = createHarness();
  assert.equal(handlers.length, 3);
  let protectRan = false;
  let adminRan = false;
  handlers[0]({}, {}, () => {
    protectRan = true;
  });
  handlers[1]({}, {}, () => {
    adminRan = true;
  });
  assert.equal(protectRan, true);
  assert.equal(adminRan, true);
  const sourceSlice = ROUTE_SOURCE.slice(ROUTE_SOURCE.indexOf("'/metrics'"));
  const protectIndex = sourceSlice.indexOf('protectMiddleware');
  const adminIndex = sourceSlice.indexOf('adminOnlyMiddleware');
  const handlerIndex = sourceSlice.indexOf('async (req, res)');
  assert.ok(protectIndex >= 0);
  assert.ok(adminIndex > protectIndex);
  assert.ok(handlerIndex > adminIndex);
});

test('structure: mount path in server.js is exactly /api/admin/recommendations (single mount)', () => {
  const mounts = SERVER_SOURCE.match(
    /app\.use\(\s*['"]\/api\/admin\/recommendations['"]/g,
  );
  assert.ok(mounts);
  assert.equal(mounts.length, 1);
  assert.match(
    SERVER_SOURCE,
    /app\.use\(\s*['"]\/api\/admin\/recommendations['"]\s*,\s*adminRecommendationRoutes\s*\)/,
  );
});

test('structure: no feature-flag middleware or RECOMMENDATION_AI_ENABLED in route', () => {
  assert.equal(ROUTE_SOURCE.includes('aiEnabled'), false);
  assert.equal(ROUTE_SOURCE.includes('RECOMMENDATION_AI_ENABLED'), false);
  assert.equal(ROUTE_SOURCE.includes('recommendationConfig'), false);
  assert.equal(ROUTE_SOURCE.includes('503'), false);
});

test('structure: no custom auth middleware beyond injected protect/adminOnly', () => {
  assert.match(
    ROUTE_SOURCE,
    /import\s*\{\s*protect\s*,\s*adminOnly\s*\}\s*from\s*'\.\.\/middleware\/auth\.js'/,
  );
  assert.equal(ROUTE_SOURCE.includes('router.use'), false);
  assert.equal(ROUTE_SOURCE.includes('requireAuth'), false);
  assert.equal(ROUTE_SOURCE.includes('isAuthenticated'), false);
});

// ============================================================
// UNAUTHENTICATED SHORT-CIRCUIT
// ============================================================

test('unauth: protect rejection short-circuits adminOnly, handler, and service', async () => {
  const { invoke, state } = createHarness({ protectImpl: unauthorizedProtect });
  const { res } = await invoke({ query: { pipeline_stage: 'policy' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Not authorized, no token');
  assert.equal(state.adminOnlyCalls, 0);
  assert.equal(state.serviceCalls.length, 0);
  assert.equal(res.body.data, undefined);
  assert.equal(JSON.stringify(res.body).includes('evaluation-history'), false);
});

test('unauth: protect rejection short-circuits even with valid query', async () => {
  const { invoke, state } = createHarness({ protectImpl: unauthorizedProtect });
  const { res } = await invoke({ query: { pipeline_stage: 'hybrid' } });
  assert.equal(res.statusCode, 401);
  assert.equal(state.serviceCalls.length, 0);
  assert.equal(state.adminOnlyCalls, 0);
});

test('unauth: protect rejection short-circuits even with invalid query', async () => {
  const { invoke, state } = createHarness({ protectImpl: unauthorizedProtect });
  const { res } = await invoke({ query: { limit: '10', foo: 'bar' } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Not authorized, no token');
  assert.equal(res.statusCode, 400 === res.statusCode ? 400 : 401);
  assert.equal(state.serviceCalls.length, 0);
});

test('unauth: role/admin query cannot bypass protect', async () => {
  const { invoke, state } = createHarness({ protectImpl: unauthorizedProtect });
  for (const query of [
    { admin: 'true' },
    { role: 'admin' },
    { isAdmin: 'true' },
  ]) {
    const { res } = await invoke({ query });
    assert.equal(res.statusCode, 401, JSON.stringify(query));
    assert.equal(state.serviceCalls.length, 0);
    assert.equal(state.adminOnlyCalls, 0);
  }
});

test('unauth: admin header cannot bypass protect', async () => {
  const { invoke, state } = createHarness({ protectImpl: unauthorizedProtect });
  for (const headers of [
    { 'x-admin': 'true' },
    { 'x-role': 'admin' },
    { authorization: 'Bearer fake-token' },
  ]) {
    const { res } = await invoke({ headers, query: { pipeline_stage: 'policy' } });
    assert.equal(res.statusCode, 401, JSON.stringify(headers));
    assert.equal(state.serviceCalls.length, 0);
  }
});

test('unauth: authentication failure preserves existing protect contract (401 + fixed body)', () => {
  assert.match(AUTH_SOURCE, /res\.status\(401\)\.json\(\{\s*success:\s*false\s*,\s*error:\s*'Not authorized, no token'/);
  assert.match(AUTH_SOURCE, /res\.status\(403\)\.json\(\{\s*success:\s*false\s*,\s*error:\s*'Admin access required'/);
});

// ============================================================
// NON-ADMIN SHORT-CIRCUIT
// ============================================================

test('non-admin: protect succeeds, adminOnly rejects, service never called', async () => {
  const { invoke, state } = createHarness({ adminOnlyImpl: forbiddenAdmin });
  const { res } = await invoke({ query: { pipeline_stage: 'policy' } });
  assert.equal(state.protectCalls, 1);
  assert.equal(state.adminOnlyCalls, 1);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Admin access required');
  assert.equal(state.serviceCalls.length, 0);
  assert.equal(res.body.data, undefined);
});

test('non-admin: valid policy query cannot bypass adminOnly', async () => {
  const { invoke, state } = createHarness({ adminOnlyImpl: forbiddenAdmin });
  const { res } = await invoke({ query: { pipeline_stage: 'policy' } });
  assert.equal(res.statusCode, 403);
  assert.equal(state.serviceCalls.length, 0);
});

test('non-admin: role/admin query cannot bypass adminOnly', async () => {
  const { invoke, state } = createHarness({ adminOnlyImpl: forbiddenAdmin });
  for (const query of [
    { role: 'admin' },
    { admin: 'true' },
    { isAdmin: 'true' },
  ]) {
    const { res } = await invoke({ query });
    assert.equal(res.statusCode, 403, JSON.stringify(query));
    assert.equal(state.serviceCalls.length, 0);
  }
});

test('non-admin: body role cannot bypass adminOnly', async () => {
  const { invoke, state } = createHarness({ adminOnlyImpl: forbiddenAdmin });
  const { res } = await invoke({
    query: {},
    body: { role: 'admin' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(state.serviceCalls.length, 0);
});

test('non-admin: header role cannot bypass adminOnly', async () => {
  const { invoke, state } = createHarness({ adminOnlyImpl: forbiddenAdmin });
  const { res } = await invoke({
    headers: { 'x-role': 'admin', 'x-admin': 'true' },
    query: { pipeline_stage: 'policy' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(state.serviceCalls.length, 0);
});

test('non-admin: no metrics object appears on 403', async () => {
  const { invoke } = createHarness({ adminOnlyImpl: forbiddenAdmin });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 403);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('metrics'), false);
  assert.equal(serialized.includes('run_id'), false);
  assert.equal(serialized.includes('evaluation-history'), false);
});

// ============================================================
// AUTHORIZED ADMIN SUCCESS
// ============================================================

test('admin: authorized request reaches handler and calls service exactly once', async () => {
  const { invoke, state } = createHarness();
  const { res } = await invoke({ query: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(state.serviceCalls.length, 1);
  assert.deepEqual(state.serviceCalls[0], { pipelineStage: 'policy' });
});

test('admin: explicit stages each call service once with exact stage', async () => {
  for (const stage of ['policy', 'hybrid', 'collaborative']) {
    const { invoke, state } = createHarness();
    const { res } = await invoke({ query: { pipeline_stage: stage } });
    assert.equal(res.statusCode, 200, stage);
    assert.equal(state.serviceCalls.length, 1, stage);
    assert.deepEqual(state.serviceCalls[0], { pipelineStage: stage }, stage);
  }
});

test('admin: ready returns 200 with success envelope', async () => {
  const { invoke } = createHarness({ serviceResult: readyData });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.state, 'ready');
});

test('admin: no-runs returns 200 with latest null', async () => {
  const { invoke } = createHarness({ serviceResult: noRunsData });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.state, 'no-runs');
  assert.equal(res.body.data.latest, null);
  assert.equal(res.body.data.source, 'evaluation-history');
});

test('admin: request user object is not forwarded into service args', async () => {
  const { invoke, state } = createHarness();
  await invoke({
    query: {},
    user: { role: 'admin', _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'a@b.c' },
  });
  assert.equal(state.serviceCalls.length, 1);
  const argKeys = Object.keys(state.serviceCalls[0]);
  assert.deepEqual(argKeys, ['pipelineStage']);
  const serialized = JSON.stringify(state.serviceCalls[0]);
  assert.equal(serialized.includes('aaaaaaaaaaaaaaaaaaaaaaaa'), false);
  assert.equal(serialized.includes('email'), false);
  assert.equal(serialized.includes('role'), false);
});

// ============================================================
// STRICT QUERY / STAGE HARDENING
// ============================================================

test('query: empty query defaults to policy', () => {
  const parsed = parseAdminRecommendationMetricsQuery({});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.pipelineStage, 'policy');
});

test('query: accepted stages are exactly policy/hybrid/collaborative (exact lowercase)', () => {
  assert.deepEqual([...PIPELINE_STAGES], ['collaborative', 'hybrid', 'policy']);
  for (const stage of ['policy', 'hybrid', 'collaborative']) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: stage });
    assert.equal(parsed.ok, true, stage);
    assert.equal(parsed.value.pipelineStage, stage);
  }
});

test('query: case/whitespace/control variants of stage rejected', () => {
  const invalid = [
    'POLICY',
    'Policy',
    ' policy',
    'policy ',
    'policy\n',
    'policy\t',
    '',
    'Hybrid',
    'COLLABORATIVE',
    ' policy ',
  ];
  for (const value of invalid) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: value });
    assert.equal(parsed.ok, false, JSON.stringify(value));
    assert.equal(parsed.error, VALID_QUERY_ERROR);
  }
});

test('query: array/multi-value stage rejected (no first-value coercion)', () => {
  for (const value of [
    ['policy'],
    ['policy', 'hybrid'],
    ['hybrid', 'policy'],
    ['policy', 'policy'],
  ]) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: value });
    assert.equal(parsed.ok, false, JSON.stringify(value));
    assert.equal(parsed.error, VALID_QUERY_ERROR);
  }
});

test('query: non-string stage types rejected', () => {
  for (const value of [{}, true, false, 1, 0, null, undefined]) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: value });
    assert.equal(parsed.ok, false, JSON.stringify(value));
    assert.equal(parsed.error, VALID_QUERY_ERROR);
  }
});

test('query: unknown stage names rejected', () => {
  for (const value of ['best', 'overall', 'cold-start', 'svd', 'winner']) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: value });
    assert.equal(parsed.ok, false, value);
  }
});

test('query: unknown/identity keys rejected (table-driven)', () => {
  const keys = [
    'admin',
    'role',
    'isAdmin',
    'userId',
    'user_id',
    'email',
    'run_id',
    'limit',
    'sort',
    'metric',
    'best',
    'winner',
    'debug',
    'include',
    'fields',
    'raw',
    'dataset',
    'configuration',
    'payload_sha256',
    'constructor',
    'prototype',
    'foo',
    'history',
  ];
  for (const key of keys) {
    const parsed = parseAdminRecommendationMetricsQuery({ [key]: 'x' });
    assert.equal(parsed.ok, false, `key should fail: ${key}`);
    assert.equal(parsed.error, VALID_QUERY_ERROR);
  }
});

test('query: unknown key mixed with valid stage still rejects', () => {
  const parsed = parseAdminRecommendationMetricsQuery({
    pipeline_stage: 'policy',
    admin: 'true',
  });
  assert.equal(parsed.ok, false);
});

test('query: non-object query shapes rejected', () => {
  for (const q of ['x', 42, true, ['pipeline_stage']]) {
    const parsed = parseAdminRecommendationMetricsQuery(q);
    assert.equal(parsed.ok, false, JSON.stringify(q));
  }
});

test('query: special keys do not mutate Object.prototype or grant access', () => {
  const before = Object.prototype.hasOwnProperty('admin');
  parseAdminRecommendationMetricsQuery({ constructor: 'x', prototype: 'y' });
  assert.equal(Object.prototype.hasOwnProperty('admin'), before);
  assert.equal(Object.prototype.admin, undefined);
  assert.equal(Object.prototype.role, undefined);
});

test('query invalid short-circuit: invalid stage => 400 and zero service calls', async () => {
  const { invoke, state } = createHarness();
  const { res } = await invoke({ query: { pipeline_stage: 'best' } });
  assert.equal(res.statusCode, 400);
  assert.equal(state.serviceCalls.length, 0);
});

test('query invalid short-circuit: unknown key => 400 and zero service calls', async () => {
  const { invoke, state } = createHarness();
  const { res } = await invoke({ query: { limit: '10' } });
  assert.equal(res.statusCode, 400);
  assert.equal(state.serviceCalls.length, 0);
});

test('query invalid short-circuit: array stage => 400 and zero service calls', async () => {
  const { invoke, state } = createHarness();
  const { res } = await invoke({ query: { pipeline_stage: ['policy', 'hybrid'] } });
  assert.equal(res.statusCode, 400);
  assert.equal(state.serviceCalls.length, 0);
});

test('query invalid short-circuit: malformed object query => 400 and zero service calls', async () => {
  const { invoke, state } = createHarness();
  const { res } = await invoke({ query: { pipeline_stage: 'POLICY' } });
  assert.equal(res.statusCode, 400);
  assert.equal(state.serviceCalls.length, 0);
  const { res: res2 } = await invoke({ query: { foo: '<script>' } });
  assert.equal(res2.statusCode, 400);
  assert.equal(state.serviceCalls.length, 0);
});

test('query invalid short-circuit: many invalid attempts accumulate zero service calls', async () => {
  const { invoke, state } = createHarness();
  await invoke({ query: { admin: 'true' } });
  await invoke({ query: { role: 'admin' } });
  await invoke({ query: { userId: 'u' } });
  await invoke({ query: { pipeline_stage: 'nope' } });
  await invoke({ query: { pipeline_stage: ['policy'] } });
  await invoke({ query: { pipeline_stage: ' policy' } });
  assert.equal(state.serviceCalls.length, 0);
});

// ============================================================
// AUTH FAILURE PRECEDES QUERY INFORMATION
// ============================================================

test('auth before query: unauthenticated + malformed query never reaches service', async () => {
  const { invoke, state } = createHarness({ protectImpl: unauthorizedProtect });
  const { res } = await invoke({
    query: { limit: '999', admin: 'true', pipeline_stage: 'POLICY' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(state.serviceCalls.length, 0);
  assert.equal(state.adminOnlyCalls, 0);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('invalid recommendation metrics query'), false);
});

test('auth before query: non-admin + valid policy never reaches service', async () => {
  const { invoke, state } = createHarness({ adminOnlyImpl: forbiddenAdmin });
  const { res } = await invoke({ query: { pipeline_stage: 'policy' } });
  assert.equal(res.statusCode, 403);
  assert.equal(state.serviceCalls.length, 0);
});

// ============================================================
// DATA LEAKAGE
// ============================================================

test('leak: ready response top-level keys limited to state/source/pipeline_stage/latest', async () => {
  const { invoke } = createHarness({ serviceResult: readyData });
  const { res } = await invoke({});
  assert.deepEqual(Object.keys(res.body.data).sort(), [
    'latest',
    'pipeline_stage',
    'source',
    'state',
  ]);
});

test('leak: latest whitelist keys only (no internal fields)', async () => {
  const { invoke } = createHarness({ serviceResult: readyData });
  const { res } = await invoke({});
  assert.deepEqual(Object.keys(res.body.data.latest).sort(), [
    'artifact_version',
    'evaluated_at',
    'metrics',
    'pipeline_stage',
    'run_id',
    'summary',
  ]);
  const serialized = JSON.stringify(res.body.data);
  for (const forbidden of [
    'payload_sha256',
    'dataset',
    'configuration',
    '"_id":',
    'createdAt',
    'updatedAt',
    'schema_version',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('leak: ready response has no user data', async () => {
  const { invoke } = createHarness({ serviceResult: readyData });
  const { res } = await invoke({});
  const serialized = JSON.stringify(res.body);
  for (const token of [
    '"user":',
    '"user_id":',
    '"user_ids":',
    '"email":',
    '"username":',
    '"profile":',
    '"role":',
    'aaaaaaaaaaaaaaaaaaaaaaaa',
    '@gmail.com',
    '@outlook.com',
  ]) {
    assert.equal(serialized.includes(token), false, `leaked user token: ${token}`);
  }
  assert.equal(/"email"\s*:/.test(serialized), false);
  assert.equal(/"user_(id|ids)"\s*:/.test(serialized), false);
});

test('leak: ready response has no song/recommendation/snapshot data', async () => {
  const { invoke } = createHarness({ serviceResult: readyData });
  const { res } = await invoke({});
  const serialized = JSON.stringify(res.body);
  for (const token of [
    'song',
    'snapshot',
    'recommendations',
    'policy_score',
    'hybrid_score',
    'profile_score',
    'collaborative_known',
    'youtube_id',
    'rank',
  ]) {
    assert.equal(serialized.includes(token), false, `leaked: ${token}`);
  }
});

test('leak: ready response has no raw listening-event data', async () => {
  const { invoke } = createHarness({ serviceResult: readyData });
  const { res } = await invoke({});
  const serialized = JSON.stringify(res.body);
  for (const token of [
    'ListeningEvent',
    'session_id',
    'event_id',
    'listened_seconds_delta',
    'play-started',
    'completed',
  ]) {
    assert.equal(serialized.includes(token), false, `leaked: ${token}`);
  }
});

test('leak: injected service result with internal fields is returned as-is (route does not re-sanitize; service owns whitelist)', async () => {
  const polluted = {
    ...readyData,
    payload_sha256: 'deadbeef',
    dataset: { raw_event_count: 1 },
    _id: '64b000000000000000000001',
  };
  const { invoke } = createHarness({ serviceResult: polluted });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.payload_sha256, 'deadbeef');
  assert.equal(ROUTE_SOURCE.includes('payload_sha256'), false);
  assert.equal(ROUTE_SOURCE.includes('schema_version'), false);
  assert.equal(SERVICE_SOURCE.includes('payload_sha256'), false);
  assert.equal(SERVICE_SOURCE.includes('return {'), true);
});

// ============================================================
// ERROR LEAKAGE
// ============================================================

test('error leak: 500 does not expose Mongo URI / token / user id / payload SHA / stack', async () => {
  const secrets = [
    'mongodb://fake-secret-host/db',
    'payload_sha256=fakehashabcdef',
    'Authorization: Bearer fake-token',
    'user_id=aaaaaaaaaaaaaaaaaaaaaaaa',
    'at Object.<anonymous> (/fake/stack/path.js:1:1)',
    'rawErrorDetails',
  ];
  const { invoke } = createHarness({
    serviceError: new Error(secrets.join(' | ')),
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, FAILED_ERROR);
  assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
  const serialized = JSON.stringify(res.body);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `leaked: ${secret}`);
  }
  for (const token of ['mongodb://', 'Bearer', 'stack', 'cause', 'details', 'query']) {
    assert.equal(serialized.includes(token), false, `leaked token: ${token}`);
  }
});

test('error leak: 400 does not reflect attacker query input', async () => {
  const { invoke } = createHarness();
  const evil = 'policy<script>alert(1)</script>';
  const { res } = await invoke({ query: { pipeline_stage: evil } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, VALID_QUERY_ERROR);
  assert.equal(JSON.stringify(res.body).includes('<script>'), false);
  assert.equal(JSON.stringify(res.body).includes('alert'), false);
  assert.equal(JSON.stringify(res.body).includes(evil), false);
});

test('error leak: unknown query key values are not reflected', async () => {
  const { invoke } = createHarness();
  const { res } = await invoke({
    query: { foo: '<img src=x onerror=alert(1)>' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, VALID_QUERY_ERROR);
  assert.equal(JSON.stringify(res.body).includes('<img'), false);
  assert.equal(JSON.stringify(res.body).includes('onerror'), false);
  assert.equal(JSON.stringify(res.body).includes('foo'), false);
});

test('no HTML generation: route source has no res.send / template / HTML construction', () => {
  assert.equal(ROUTE_SOURCE.includes('res.send('), false);
  assert.equal(ROUTE_SOURCE.includes('text/html'), false);
  assert.equal(ROUTE_SOURCE.includes('<html'), false);
  assert.equal(ROUTE_SOURCE.includes('`<'), false);
  assert.equal(ROUTE_SOURCE.includes('render('), false);
});

// ============================================================
// READ-ONLY GUARANTEE
// ============================================================

test('read-only: route source has no write/record/upsert operations', () => {
  for (const token of [
    'recordEvaluationRun',
    '.create(',
    '.insert',
    '.save(',
    '.update',
    '.updateOne',
    '.updateMany',
    '.findOneAndUpdate',
    '.replaceOne',
    '.delete',
    '.deleteOne',
    '.deleteMany',
    '.findOneAndDelete',
    'upsert',
  ]) {
    assert.equal(ROUTE_SOURCE.includes(token), false, `route has: ${token}`);
  }
});

test('read-only: service source has no write/record/upsert operations', () => {
  for (const token of [
    'recordEvaluationRun',
    '.create(',
    '.insert',
    '.save(',
    '.updateOne',
    '.updateMany',
    '.findOneAndUpdate',
    '.replaceOne',
    '.deleteOne',
    '.deleteMany',
    'upsert',
    '.find(',
    '.aggregate(',
    'countDocuments',
    'estimatedDocumentCount',
    'distinct',
  ]) {
    assert.equal(SERVICE_SOURCE.includes(token), false, `service has: ${token}`);
  }
});

test('read-only: service performs exactly one listEvaluationRuns call site', () => {
  const matches = SERVICE_SOURCE.match(/listEvaluationRuns\s*\(/g) || [];
  assert.equal(matches.length, 1);
});

test('read-only: service stays behind 32/43 boundary (no direct model find/aggregate)', () => {
  assert.equal(SERVICE_SOURCE.includes('RecommendationEvaluationRun.find'), false);
  assert.equal(SERVICE_SOURCE.includes('RecommendationEvaluationRun.aggregate'), false);
  assert.equal(SERVICE_SOURCE.includes('RecommendationEvaluationRun.create'), false);
  assert.equal(SERVICE_SOURCE.includes('import RecommendationEvaluationRun'), false);
  assert.match(
    SERVICE_SOURCE,
    /from '\.\/recommendationEvaluationRunService\.js'/,
  );
});

test('read-only: no alternate history queries (aggregate/count/distinct)', () => {
  for (const token of [
    'aggregate(',
    'countDocuments',
    'estimatedDocumentCount',
    'distinct(',
    'findOneAndUpdate',
  ]) {
    assert.equal(SERVICE_SOURCE.includes(token), false, token);
    assert.equal(ROUTE_SOURCE.includes(token), false, token);
  }
});

test('no metric sorting / winner logic in production route+service', () => {
  for (const source of [ROUTE_SOURCE, SERVICE_SOURCE]) {
    for (const token of [
      'precision_at_5 DESC',
      'sort({',
      '.sort(',
      'best_model',
      'winner',
      'winning',
      'quality_score',
      'overall_score',
      'composite_score',
      'grade',
      'tier',
    ]) {
      assert.equal(source.includes(token), false, token);
    }
  }
});

// ============================================================
// NO ML / EVALUATION / ARTIFACT / SNAPSHOT EXECUTION
// ============================================================

test('no execution: route+service free of Python/child_process/SVD/rank/eval/artifact/snapshot', () => {
  for (const source of [ROUTE_SOURCE, SERVICE_SOURCE]) {
    for (const token of [
      'child_process',
      'spawn',
      'exec(',
      'python',
      'TruncatedSVD',
      'train_collaborative_model',
      'evaluate_recommendations',
      'rank_hybrid_candidates',
      'rank_with_cold_start_policy',
      'publish_artifact_release',
      'activate_artifact_release',
      'RecommendationSnapshot',
      'personalizedRecommendationService',
      'getLatestRecommendationSnapshot',
    ]) {
      assert.equal(source.includes(token), false, token);
    }
  }
});

test('no evaluation recomputation: service only lists persisted runs', () => {
  assert.equal(/(?:^|[^A-Za-z])evaluate(?:Recommendations|_recommendations|\s*\()/.test(SERVICE_SOURCE), false);
  assert.equal(SERVICE_SOURCE.includes('evaluate_recommendations'), false);
  assert.equal(SERVICE_SOURCE.includes('train'), false);
  assert.equal(SERVICE_SOURCE.includes('rank_'), false);
  assert.equal(SERVICE_SOURCE.includes('Date.now()'), false);
  assert.equal(ROUTE_SOURCE.includes('evaluate'), false);
  assert.equal(/\btrain\b/.test(ROUTE_SOURCE), false);
  assert.equal(ROUTE_SOURCE.includes('runRetrainingPython'), false);
  assert.equal(ROUTE_SOURCE.includes('collectRetrainingInput'), false);
  assert.equal(ROUTE_SOURCE.includes('child_process'), false);
});

// ============================================================
// NO FEATURE FLAG / NO CUSTOM JWT / NO CUSTOM ROLE / NO PER-USER
// ============================================================

test('no feature flag: route+server mount independent of RECOMMENDATION_AI_ENABLED', () => {
  assert.equal(ROUTE_SOURCE.includes('RECOMMENDATION_AI_ENABLED'), false);
  assert.equal(ROUTE_SOURCE.includes('aiEnabled'), false);
  assert.equal(ROUTE_SOURCE.includes('recommendationConfig'), false);
});

test('no custom JWT: route does not import/parse JWT or Authorization manually', () => {
  assert.equal(ROUTE_SOURCE.includes('jsonwebtoken'), false);
  assert.equal(ROUTE_SOURCE.includes('jwt.verify'), false);
  assert.equal(ROUTE_SOURCE.includes('jwt.decode'), false);
  assert.equal(ROUTE_SOURCE.includes('Bearer'), false);
  assert.equal(ROUTE_SOURCE.includes('authorization'), false);
  assert.equal(ROUTE_SOURCE.includes('Authorization'), false);
});

test('no custom role: route has no req.query/body/header role or admin logic', () => {
  for (const token of [
    'req.query.role',
    'req.body.role',
    'req.headers["x-role"]',
    "req.headers['x-role']",
    'req.headers["x-admin"]',
    "req.headers['x-admin']",
    "req.user.role ===",
    'req.user?.role',
    'isAdmin',
  ]) {
    assert.equal(ROUTE_SOURCE.includes(token), false, token);
  }
});

test('no per-user metrics: route does not pass req.user._id or accept user_id/email filters', () => {
  assert.equal(ROUTE_SOURCE.includes('req.user._id'), false);
  assert.equal(ROUTE_SOURCE.includes('userId'), false);
  assert.equal(ROUTE_SOURCE.includes('user_id'), false);
  assert.equal(ROUTE_SOURCE.includes('email'), false);
  assert.equal(ROUTE_SOURCE.includes('user_id'), false);
});

test('one-read boundary: service factory issues exactly one listEvaluationRuns({limit:1, stage}) per request', async () => {
  const listCalls = [];
  const service = createAdminRecommendationMetricsService({
    evaluationRunService: {
      async listEvaluationRuns(options) {
        listCalls.push(options);
        return [];
      },
    },
  });
  await service.getLatestRecommendationMetrics({ pipelineStage: 'policy' });
  assert.equal(listCalls.length, 1);
  assert.deepEqual(listCalls[0], { limit: 1, pipeline_stage: 'policy' });
});

test('one-read boundary: sequential authorized-looking requests still one list each (no caching)', async () => {
  const listCalls = [];
  const service = createAdminRecommendationMetricsService({
    evaluationRunService: {
      async listEvaluationRuns(options) {
        listCalls.push(options);
        return [];
      },
    },
  });
  await service.getLatestRecommendationMetrics();
  await service.getLatestRecommendationMetrics({ pipelineStage: 'hybrid' });
  await service.getLatestRecommendationMetrics({ pipelineStage: 'collaborative' });
  assert.equal(listCalls.length, 3);
  assert.deepEqual(listCalls, [
    { limit: 1, pipeline_stage: 'policy' },
    { limit: 1, pipeline_stage: 'hybrid' },
    { limit: 1, pipeline_stage: 'collaborative' },
  ]);
});

// ============================================================
// NO MODEL JUDGMENT LABELS IN OUTPUT
// ============================================================

test('no model judgment: ready/no-runs payloads free of overall/composite/winner/best/quality', async () => {
  for (const data of [readyData, noRunsData]) {
    const { invoke } = createHarness({ serviceResult: data });
    const { res } = await invoke({});
    const serialized = JSON.stringify(res.body);
    for (const token of [
      'overall',
      'composite',
      'winner',
      'best',
      'quality',
      'grade',
      'tier',
      'percent',
    ]) {
      assert.equal(serialized.includes(token), false, token);
    }
  }
});

test('auth middleware files remain read-only referenced (auth exports protect+adminOnly)', () => {
  assert.match(AUTH_SOURCE, /export const protect/);
  assert.match(AUTH_SOURCE, /export const adminOnly/);
});

// ============================================================
// HISTORY ROUTE SECURITY (42/43)
// ============================================================

function createHistoryHarness({
  serviceResult = null,
  serviceError = null,
  protectImpl = null,
  adminOnlyImpl = null,
} = {}) {
  const state = {
    protectCalls: 0,
    adminOnlyCalls: 0,
    serviceCalls: [],
  };

  const defaultResult =
    serviceResult ?? {
      state: 'ready',
      source: 'evaluation-history',
      pipeline_stage: 'policy',
      limit: 20,
      count: 1,
      runs: [
        {
          run_id: 'eval-2026-09-15-policy-1',
          pipeline_stage: 'policy',
          artifact_version: null,
          evaluated_at: '2026-09-15T12:00:00.000Z',
          metrics: {
            precision_at_5: 0.4,
            precision_at_10: 0.35,
            recall_at_5: 0.5,
            recall_at_10: 0.6,
            ndcg_at_5: 0.45,
            ndcg_at_10: 0.55,
            map_at_10: 0.5,
            hit_rate_at_10: 0.7,
            catalog_coverage: 0.25,
            diversity: 0.8,
          },
          summary: {
            evaluated_user_count: 10,
            recommendation_user_count: 12,
            relevance_user_count: 10,
            catalog_size: 50,
            unique_recommended_at_10: 40,
            diversity_evaluable_user_count: 8,
            diversity_pair_count: 28,
          },
          dataset: {
            raw_event_count: 100,
            train_event_count: 70,
            validation_event_count: 15,
            test_event_count: 15,
            unique_user_count: 5,
            unique_song_count: 8,
            session_count: 20,
            interaction_pair_count: 90,
            content_feature_count: 12,
          },
          configuration: {
            random_seed: 42,
            algorithm: null,
            requested_components: null,
            effective_components: null,
            collaborative_weight: null,
            content_weight: null,
            base_hybrid_policy_weight: null,
            explicit_profile_policy_weight: null,
            exploration_interval: null,
          },
        },
      ],
    };

  const baseProtect =
    protectImpl ??
    ((req, res, next) => {
      next();
    });
  const baseAdmin =
    adminOnlyImpl ??
    ((req, res, next) => {
      next();
    });

  const router = createAdminRecommendationRouter({
    protectMiddleware: (req, res, next) => {
      state.protectCalls += 1;
      return baseProtect(req, res, next);
    },
    adminOnlyMiddleware: (req, res, next) => {
      state.adminOnlyCalls += 1;
      return baseAdmin(req, res, next);
    },
    adminRecommendationHistoryService: {
      async getRecommendationEvaluationHistory(args) {
        state.serviceCalls.push(args);
        if (serviceError) throw serviceError;
        return defaultResult;
      },
    },
  });

  const layer = router.stack.find((l) => l.route && l.route.path === '/history');
  assert.ok(layer, 'expected GET /history route');
  const handlers = layer.route.stack.map((s) => s.handle);

  const invoke = async ({
    query = {},
    headers = {},
    body,
    user = { role: 'admin' },
  } = {}) => {
    const req = { query, headers };
    if (body !== undefined) req.body = body;
    if (user !== null) req.user = user;
    const res = createRes();
    let index = 0;
    const runNext = async () => {
      if (index >= handlers.length) return;
      const handler = handlers[index];
      index += 1;
      await handler(req, res, runNext);
    };
    await runNext();
    return { req, res, state };
  };

  return { invoke, state, handlers, layer, router };
}

test('history security: structure middleware order is protect -> adminOnly -> handler', () => {
  const { handlers } = createHistoryHarness();
  assert.equal(handlers.length, 3);
  const order = [];
  handlers[0]({}, {}, () => order.push('protect'));
  handlers[1]({}, {}, () => order.push('adminOnly'));
  assert.deepEqual(order, ['protect', 'adminOnly']);
});

test('history security: unauthenticated short-circuit yields 401 and zero service calls', async () => {
  const { invoke, state } = createHistoryHarness({
    protectImpl: unauthorizedProtect,
  });
  const { res } = await invoke({ query: { pipeline_stage: 'policy' } });
  assert.equal(res.statusCode, 401);
  assert.equal(state.adminOnlyCalls, 0);
  assert.equal(state.serviceCalls.length, 0);
  assert.equal(res.body.data, undefined);
});

test('history security: unauthenticated with invalid query still 401, zero service calls', async () => {
  const { invoke, state } = createHistoryHarness({
    protectImpl: unauthorizedProtect,
  });
  const { res } = await invoke({ query: { limit: '999', admin: 'true' } });
  assert.equal(res.statusCode, 401);
  assert.equal(state.serviceCalls.length, 0);
});

test('history security: role/admin/header cannot bypass protect', async () => {
  const { invoke, state } = createHistoryHarness({
    protectImpl: unauthorizedProtect,
  });
  for (const query of [{ admin: 'true' }, { role: 'admin' }, { isAdmin: 'true' }]) {
    const { res } = await invoke({ query });
    assert.equal(res.statusCode, 401, JSON.stringify(query));
    assert.equal(state.serviceCalls.length, 0);
  }
  for (const headers of [
    { 'x-admin': 'true' },
    { 'x-role': 'admin' },
    { authorization: 'Bearer fake-token' },
  ]) {
    const { res } = await invoke({ headers, query: { pipeline_stage: 'policy' } });
    assert.equal(res.statusCode, 401, JSON.stringify(headers));
    assert.equal(state.serviceCalls.length, 0);
  }
});

test('history security: non-admin short-circuit yields 403 and zero service calls', async () => {
  const { invoke, state } = createHistoryHarness({ adminOnlyImpl: forbiddenAdmin });
  const { res } = await invoke({ query: { pipeline_stage: 'policy', limit: '5' } });
  assert.equal(state.protectCalls, 1);
  assert.equal(state.adminOnlyCalls, 1);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Admin access required');
  assert.equal(state.serviceCalls.length, 0);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('runs'), false);
  assert.equal(serialized.includes('evaluation-history'), false);
});

test('history security: body/header role cannot bypass adminOnly', async () => {
  const { invoke, state } = createHistoryHarness({ adminOnlyImpl: forbiddenAdmin });
  const { res } = await invoke({ body: { role: 'admin' } });
  assert.equal(res.statusCode, 403);
  assert.equal(state.serviceCalls.length, 0);
  const { res: res2 } = await invoke({
    headers: { 'x-role': 'admin', 'x-admin': 'true' },
    query: { pipeline_stage: 'policy' },
  });
  assert.equal(res2.statusCode, 403);
  assert.equal(state.serviceCalls.length, 0);
});

test('history security: authorized admin reaches handler with exact stage and limit args', async () => {
  const { invoke, state } = createHistoryHarness();
  const { res } = await invoke({ query: { pipeline_stage: 'hybrid', limit: '10' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(state.serviceCalls.length, 1);
  assert.deepEqual(state.serviceCalls[0], { pipelineStage: 'hybrid', limit: 10 });
});

test('history security: request user object is not forwarded into service args', async () => {
  const { invoke, state } = createHistoryHarness();
  await invoke({
    query: {},
    user: { role: 'admin', _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', email: 'a@b.c' },
  });
  assert.equal(state.serviceCalls.length, 1);
  const argKeys = Object.keys(state.serviceCalls[0]);
  assert.deepEqual(argKeys.sort(), ['limit', 'pipelineStage']);
  const serialized = JSON.stringify(state.serviceCalls[0]);
  assert.equal(serialized.includes('aaaaaaaaaaaaaaaaaaaaaaaa'), false);
  assert.equal(serialized.includes('email'), false);
  assert.equal(serialized.includes('role'), false);
});

test('history security: malformed query yields 400 before any service call', async () => {
  const { invoke, state } = createHistoryHarness();
  for (const query of [
    { limit: '101' },
    { limit: '0' },
    { limit: '-5' },
    { limit: '1.5' },
    { pipeline_stage: 'POLICY' },
    { pipeline_stage: ['policy'] },
    { pipeline_stage: 'best' },
    { userId: 'u' },
    { run_id: 'r' },
    { sort: 'metric' },
    { best: '1' },
    { winner: '1' },
    { admin: 'true' },
    { role: 'admin' },
    { email: 'a@b.c' },
    { foo: '<script>' },
    { payload_sha256: 'x' },
    { dataset: 'x' },
    { configuration: 'x' },
  ]) {
    const { res } = await invoke({ query });
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(res.body.error, VALID_HISTORY_QUERY_ERROR);
    assert.equal(state.serviceCalls.length, 0, JSON.stringify(query));
  }
});

test('history security: 400 body does not reflect attacker input', async () => {
  const { invoke } = createHistoryHarness();
  const evil = 'policy<script>alert(1)</script>';
  const { res } = await invoke({ query: { pipeline_stage: evil } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, VALID_HISTORY_QUERY_ERROR);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('<script>'), false);
  assert.equal(serialized.includes('alert'), false);
  assert.equal(serialized.includes(evil), false);
});

test('history security: 500 does not expose Mongo URI / token / user id / stack', async () => {
  const secrets = [
    'mongodb://fake-secret-host/db',
    'Authorization: Bearer fake-token',
    'user_id=aaaaaaaaaaaaaaaaaaaaaaaa',
    'at Object.<anonymous> (/fake/stack/path.js:1:1)',
  ];
  const { invoke } = createHistoryHarness({
    serviceError: new Error(secrets.join(' | ')),
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, FAILED_HISTORY_ERROR);
  assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
  const serialized = JSON.stringify(res.body);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `leaked: ${secret}`);
  }
  for (const token of ['mongodb://', 'Bearer', 'stack', 'cause', 'details']) {
    assert.equal(serialized.includes(token), false, `leaked token: ${token}`);
  }
});

test('history security: ready response top-level keys limited to the six envelope fields', async () => {
  const { invoke } = createHistoryHarness();
  const { res } = await invoke({});
  assert.deepEqual(Object.keys(res.body.data).sort(), [
    'count',
    'limit',
    'pipeline_stage',
    'runs',
    'source',
    'state',
  ]);
});

test('history security: run whitelist strips internal fields and has no user data', async () => {
  const { invoke } = createHistoryHarness();
  const { res } = await invoke({});
  const run = res.body.data.runs[0];
  assert.deepEqual(Object.keys(run).sort(), [
    'artifact_version',
    'configuration',
    'dataset',
    'evaluated_at',
    'metrics',
    'pipeline_stage',
    'run_id',
    'summary',
  ]);
  const serialized = JSON.stringify(res.body);
  for (const forbidden of [
    'payload_sha256',
    '"_id":',
    'createdAt',
    'updatedAt',
    'schema_version',
    '"user":',
    '"user_id":',
    '"email":',
    'youtube_id',
    'ListeningEvent',
    'session_id',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('history security: no feature flag / no custom JWT / no custom role in route', () => {
  assert.equal(ROUTE_SOURCE.includes('RECOMMENDATION_AI_ENABLED'), false);
  assert.equal(ROUTE_SOURCE.includes('aiEnabled'), false);
  assert.equal(ROUTE_SOURCE.includes('recommendationConfig'), false);
  assert.equal(ROUTE_SOURCE.includes('503'), false);
  assert.equal(ROUTE_SOURCE.includes('jsonwebtoken'), false);
  assert.equal(ROUTE_SOURCE.includes('jwt.verify'), false);
  assert.equal(ROUTE_SOURCE.includes('Bearer'), false);
  assert.equal(ROUTE_SOURCE.includes('req.query.role'), false);
  assert.equal(ROUTE_SOURCE.includes('req.body.role'), false);
  assert.equal(ROUTE_SOURCE.includes('req.user._id'), false);
  assert.equal(ROUTE_SOURCE.includes('isAdmin'), false);
});

test('history security: route+history service free of writes/Python/child_process/ML', () => {
  const HISTORY_SERVICE_SOURCE = readSource(
    '../services/adminRecommendationHistoryService.js',
  );
  for (const source of [ROUTE_SOURCE, HISTORY_SERVICE_SOURCE]) {
    for (const token of [
      'recordEvaluationRun',
      '.create(',
      '.save(',
      '.updateOne',
      '.updateMany',
      '.findOneAndUpdate',
      '.replaceOne',
      '.deleteOne',
      '.deleteMany',
      'upsert',
      'child_process',
      'spawn',
      'exec(',
      'python',
      'TruncatedSVD',
      'train_collaborative_model',
      'evaluate_recommendations',
      'rank_hybrid_candidates',
      'rank_with_cold_start_policy',
      'publish_artifact_release',
      'activate_artifact_release',
      'RecommendationSnapshot',
      'countDocuments',
      'estimatedDocumentCount',
      'distinct(',
      'aggregate(',
    ]) {
      assert.equal(source.includes(token), false, token);
    }
  }
});

test('history security: history service issues exactly one listEvaluationRuns call', () => {
  const HISTORY_SERVICE_SOURCE = readSource(
    '../services/adminRecommendationHistoryService.js',
  );
  const matches = HISTORY_SERVICE_SOURCE.match(/listEvaluationRuns\s*\(/g) || [];
  assert.equal(matches.length, 1);
  assert.equal(
    HISTORY_SERVICE_SOURCE.includes('RecommendationEvaluationRun.find'),
    false,
  );
  assert.equal(
    HISTORY_SERVICE_SOURCE.includes('RecommendationEvaluationRun.aggregate'),
    false,
  );
  assert.equal(
    HISTORY_SERVICE_SOURCE.includes('import RecommendationEvaluationRun'),
    false,
  );
});

test('history security: no model judgment labels in history payloads', async () => {
  const { invoke } = createHistoryHarness();
  const { res } = await invoke({});
  const serialized = JSON.stringify(res.body);
  for (const token of [
    'overall',
    'composite',
    'winner',
    'best',
    'quality',
    'grade',
    'tier',
    'percent',
  ]) {
    assert.equal(serialized.includes(token), false, token);
  }
});

test('history security: history service factory rejects missing listEvaluationRuns', () => {
  assert.throws(
    () =>
      createAdminRecommendationHistoryService({
        evaluationRunService: {},
      }),
    (error) => {
      assert.equal(error.name, 'AdminRecommendationHistoryValidationError');
      return true;
    },
  );
});

test('history security: sequential authorized requests each hit history service once', async () => {
  const { invoke, state } = createHistoryHarness();
  await invoke({ query: { pipeline_stage: 'policy' } });
  await invoke({ query: { pipeline_stage: 'hybrid', limit: '5' } });
  await invoke({ query: { pipeline_stage: 'collaborative', limit: '1' } });
  assert.equal(state.serviceCalls.length, 3);
  assert.deepEqual(state.serviceCalls, [
    { pipelineStage: 'policy', limit: 20 },
    { pipelineStage: 'hybrid', limit: 5 },
    { pipelineStage: 'collaborative', limit: 1 },
  ]);
});

test('history security: history query parser rejects prototype pollution keys without mutating Object.prototype', () => {
  const before = Object.prototype.hasOwnProperty('admin');
  parseAdminRecommendationHistoryQuery({ constructor: 'x', prototype: 'y' });
  assert.equal(Object.prototype.hasOwnProperty('admin'), before);
  assert.equal(Object.prototype.admin, undefined);
  assert.equal(Object.prototype.role, undefined);
});

test('history security: no HTML generation in route for history path', () => {
  assert.equal(ROUTE_SOURCE.includes('res.send('), false);
  assert.equal(ROUTE_SOURCE.includes('text/html'), false);
  assert.equal(ROUTE_SOURCE.includes('<html'), false);
  assert.equal(ROUTE_SOURCE.includes('render('), false);
});

test('history security: history and metrics remain read-only in route source', () => {
  for (const token of [
    'router.post',
    'router.put',
    'router.patch',
    'router.delete',
    '.create(',
    '.insert',
    '.updateOne',
    'upsert',
  ]) {
    assert.equal(ROUTE_SOURCE.includes(token), false, token);
  }
});

// ============================================================
// HEALTH ENDPOINT SECURITY (43/43)
// ============================================================

function createHealthSecurityHarness({
  serviceResult = {
    state: 'never-run',
    source: 'retraining-health',
    lease: { active: false, run_id: null, expires_at: null },
    latest: null,
  },
  serviceError = null,
  protectImpl = null,
  adminOnlyImpl = null,
} = {}) {
  const state = {
    protectCalls: 0,
    adminOnlyCalls: 0,
    serviceCalls: [],
  };
  const baseProtect =
    protectImpl ??
    ((req, res, next) => {
      next();
    });
  const baseAdmin =
    adminOnlyImpl ??
    ((req, res, next) => {
      next();
    });

  const router = createAdminRecommendationRouter({
    protectMiddleware: (req, res, next) => {
      state.protectCalls += 1;
      return baseProtect(req, res, next);
    },
    adminOnlyMiddleware: (req, res, next) => {
      state.adminOnlyCalls += 1;
      return baseAdmin(req, res, next);
    },
    adminRecommendationHealthService: {
      async getRecommendationRetrainingHealth(args) {
        state.serviceCalls.push(args ?? null);
        if (serviceError) throw serviceError;
        return serviceResult;
      },
    },
  });

  const layer = router.stack.find((l) => l.route && l.route.path === '/health');
  assert.ok(layer, 'expected GET /health route');
  const handlers = layer.route.stack.map((s) => s.handle);

  const invoke = async ({
    query = {},
    headers = {},
    body,
    user = { role: 'admin' },
  } = {}) => {
    const req = { query, headers };
    if (body !== undefined) req.body = body;
    if (user !== null) req.user = user;
    const res = createRes();
    let index = 0;
    const runNext = async () => {
      if (index >= handlers.length) return;
      const handler = handlers[index];
      index += 1;
      await handler(req, res, runNext);
    };
    await runNext();
    return { req, res, state };
  };

  return { invoke, state, handlers, layer, router };
}

test('health security: middleware order is protect -> adminOnly -> handler', () => {
  const { handlers } = createHealthSecurityHarness();
  assert.equal(handlers.length, 3);
  const order = [];
  handlers[0]({}, {}, () => order.push('protect'));
  handlers[1]({}, {}, () => order.push('adminOnly'));
  assert.deepEqual(order, ['protect', 'adminOnly']);
});

test('health security: unauthenticated short-circuits with 401 and zero service calls', async () => {
  const { invoke, state } = createHealthSecurityHarness({
    protectImpl: unauthorizedProtect,
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 401);
  assert.equal(state.adminOnlyCalls, 0);
  assert.equal(state.serviceCalls.length, 0);
});

test('health security: role/header cannot bypass protect on health', async () => {
  const { invoke, state } = createHealthSecurityHarness({
    protectImpl: unauthorizedProtect,
  });
  for (const headers of [
    { 'x-admin': 'true' },
    { 'x-role': 'admin' },
    { authorization: 'Bearer fake' },
  ]) {
    const { res } = await invoke({ headers });
    assert.equal(res.statusCode, 401, JSON.stringify(headers));
    assert.equal(state.serviceCalls.length, 0);
  }
});

test('health security: non-admin short-circuits with 403 and zero service calls', async () => {
  const { invoke, state } = createHealthSecurityHarness({
    adminOnlyImpl: forbiddenAdmin,
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Admin access required');
  assert.equal(state.serviceCalls.length, 0);
});

test('health security: authorized admin invokes health service exactly once with no args', async () => {
  const { invoke, state } = createHealthSecurityHarness();
  const { res } = await invoke({}, );
  assert.equal(res.statusCode, 200);
  assert.equal(state.serviceCalls.length, 1);
  assert.equal(state.serviceCalls[0], null);
});

test('health security: any query key is 400 before service', async () => {
  const { invoke, state } = createHealthSecurityHarness();
  for (const query of [{ limit: '1' }, { admin: 'true' }, { run_id: 'x' }]) {
    const { res } = await invoke({ query });
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(res.body.error, 'invalid recommendation health query');
  }
  assert.equal(state.serviceCalls.length, 0);
});

test('health security: response never includes lease token or secrets', async () => {
  const { invoke } = createHealthSecurityHarness({
    serviceResult: {
      state: 'running',
      source: 'retraining-health',
      lease: {
        active: true,
        run_id: 'run-43-01',
        expires_at: '2026-09-15T12:10:00.000Z',
        token: 'should-not-leak',
      },
      latest: {
        attempt_id: 'run-43-01-ffffffff',
        run_id: 'run-43-01',
        status: 'completed',
        failure_code: null,
        failure_message: null,
      },
    },
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('should-not-leak'), false);
  assert.equal(serialized.includes('token'), false);
});

test('health security: 500 uses fixed message and never leaks service error details', async () => {
  const { invoke } = createHealthSecurityHarness({
    serviceError: new Error('mongodb://user:pass@host'),
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    error: 'failed to load retraining health',
  });
  assert.equal(JSON.stringify(res.body).includes('mongodb'), false);
  assert.equal(JSON.stringify(res.body).includes('stack'), false);
});

test('health security: route source has no retrain execution, child_process, or Express extras', () => {
  for (const token of [
    'child_process',
    'spawn',
    'python',
    'runRecommendationRetraining',
    'recommendationPythonRunner',
    'exec(',
    'execSync(',
    'spawnSync(',
    'shell: true',
    'RECOMMENDATION_AI_ENABLED',
    'router.post',
    'router.put',
    'router.patch',
    'router.delete',
  ]) {
    assert.equal(ROUTE_SOURCE.includes(token), false, token);
  }
});
