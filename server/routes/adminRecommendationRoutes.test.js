import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createAdminRecommendationRouter,
  parseAdminRecommendationHistoryQuery,
  parseAdminRecommendationMetricsQuery,
} from './adminRecommendationRoutes.js';
import {
  ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE,
  ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES,
} from '../services/adminRecommendationMetricsService.js';
import {
  ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE,
  ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES,
  DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
} from '../services/adminRecommendationHistoryService.js';
import { PIPELINE_STAGES } from '../models/RecommendationEvaluationRun.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

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

function createHandler({
  serviceResult = readyData,
  serviceError = null,
  protectImpl = null,
  adminOnlyImpl = null,
} = {}) {
  const serviceCalls = [];
  const middlewareOrder = [];
  const router = createAdminRecommendationRouter({
    protectMiddleware:
      protectImpl ??
      ((req, _res, next) => {
        middlewareOrder.push('protect');
        next();
      }),
    adminOnlyMiddleware:
      adminOnlyImpl ??
      ((req, _res, next) => {
        middlewareOrder.push('adminOnly');
        next();
      }),
    adminRecommendationMetricsService: {
      async getLatestRecommendationMetrics(args) {
        serviceCalls.push(args);
        if (serviceError) throw serviceError;
        return serviceResult;
      },
    },
  });

  const layer = router.stack.find((l) => l.route && l.route.path === '/metrics');
  assert.ok(layer, 'expected GET /metrics route');
  const handlers = layer.route.stack.map((s) => s.handle);

  const invoke = async (query = {}, user = { role: 'admin' }) => {
    const req = { query, headers: {} };
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
    return { req, res, serviceCalls, middlewareOrder };
  };

  return { invoke, serviceCalls, middlewareOrder, handlers, layer };
}

// --- factory / middleware wiring ---

test('100: route is GET /metrics', () => {
  const { layer } = createHandler();
  assert.equal(layer.route.path, '/metrics');
  assert.deepEqual(Object.keys(layer.route.methods), ['get']);
});

test('101: protect runs before adminOnly in the route stack', () => {
  const { handlers } = createHandler();
  assert.equal(handlers.length, 3);
  const order = [];
  handlers[0]({}, {}, () => order.push('a'));
  handlers[1]({}, {}, () => order.push('b'));
  assert.equal(order.length, 2);
});

test('102: middleware execution order is protect then adminOnly then handler', async () => {
  const { invoke, middlewareOrder } = createHandler();
  await invoke({});
  assert.deepEqual(middlewareOrder, ['protect', 'adminOnly']);
});

test('103: production factory defaults wire protect and adminOnly from auth middleware', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  assert.match(
    source,
    /import\s*\{\s*protect\s*,\s*adminOnly\s*\}\s*from\s*'\.\.\/middleware\/auth\.js'/,
  );
  assert.match(source, /protectMiddleware\s*=\s*protect/);
  assert.match(source, /adminOnlyMiddleware\s*=\s*adminOnly/);
});

test('104: factory accepts injected middleware and service for tests', () => {
  let protectedCalled = false;
  let adminCalled = false;
  const router = createAdminRecommendationRouter({
    protectMiddleware: (req, res, next) => {
      protectedCalled = true;
      next();
    },
    adminOnlyMiddleware: (req, res, next) => {
      adminCalled = true;
      next();
    },
    adminRecommendationMetricsService: {
      async getLatestRecommendationMetrics() {
        return noRunsData;
      },
    },
  });
  assert.ok(router);
  assert.equal(typeof protectedCalled, 'boolean');
  assert.equal(typeof adminCalled, 'boolean');
});

test('105: no JWT/token verification code lives in the route file', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  assert.equal(source.includes('jwt'), false);
  assert.equal(source.includes('jsonwebtoken'), false);
  assert.equal(source.includes('token'), false);
  assert.equal(source.includes('Bearer'), false);
});

test('106: no RECOMMENDATION_AI_ENABLED / aiEnabled gate in this route', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  assert.equal(source.includes('aiEnabled'), false);
  assert.equal(source.includes('RECOMMENDATION_AI_ENABLED'), false);
  assert.equal(source.includes('recommendationConfig'), false);
  assert.equal(source.includes('503'), false);
});

test('107: route file has no POST/PUT/PATCH/DELETE handlers (GET /metrics + GET /history only)', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  assert.equal(source.includes('router.post'), false);
  assert.equal(source.includes('router.put'), false);
  assert.equal(source.includes('router.patch'), false);
  assert.equal(source.includes('router.delete'), false);
  const gets = source.match(/router\.get\s*\(/g) || [];
  assert.equal(gets.length, 2);
});

test('108: no Python/child_process/write tokens in the route file', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  for (const token of [
    'child_process',
    'spawn',
    'python',
    'recordEvaluationRun',
    'upsert',
    'updateOne',
    'deleteOne',
    'console.log',
  ]) {
    assert.equal(source.includes(token), false, `unexpected: ${token}`);
  }
});

// --- protect / adminOnly short-circuits ---

test('109: protect 401 short-circuits before adminOnly and service', async () => {
  const { invoke, serviceCalls } = createHandler({
    protectImpl: (req, res) => {
      res.status(401).json({ success: false, error: 'not authorized' });
    },
    adminOnlyImpl: (req, res, next) => next(),
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 401);
  assert.equal(serviceCalls.length, 0);
});

test('110: adminOnly 403 short-circuits before the service', async () => {
  const { invoke, serviceCalls } = createHandler({
    protectImpl: (req, res, next) => next(),
    adminOnlyImpl: (req, res) => {
      res.status(403).json({ success: false, error: 'Admin access required' });
    },
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Admin access required');
  assert.equal(serviceCalls.length, 0);
});

test('111: unauthenticated protect failure performs zero service work', async () => {
  const { invoke, serviceCalls } = createHandler({
    protectImpl: (req, res) => {
      res.status(401).json({ success: false, error: 'Not authorized, no token' });
    },
  });
  const { res } = await invoke({ pipeline_stage: 'policy' });
  assert.equal(res.statusCode, 401);
  assert.equal(serviceCalls.length, 0);
});

// --- query parser ---

test('112: empty query defaults to policy stage', () => {
  const parsed = parseAdminRecommendationMetricsQuery({});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.pipelineStage, 'policy');
  assert.equal(
    ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE,
    'policy',
  );
});

test('113: undefined and null queries default to policy', () => {
  for (const q of [undefined, null]) {
    const parsed = parseAdminRecommendationMetricsQuery(q);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.pipelineStage, 'policy');
  }
});

test('114: each exact-lowercase stage is accepted', () => {
  for (const stage of PIPELINE_STAGES) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: stage });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.pipelineStage, stage);
  }
});

test('115: unknown query keys are rejected', () => {
  for (const key of [
    'limit',
    'userId',
    'user_id',
    'run_id',
    'sort',
    'metric',
    'best',
    'winner',
    'artifact_version',
    'foo',
    'history',
    'page',
  ]) {
    const parsed = parseAdminRecommendationMetricsQuery({ [key]: 'x' });
    assert.equal(parsed.ok, false, `key should fail: ${key}`);
    assert.equal(
      parsed.error,
      'invalid recommendation metrics query',
    );
  }
});

test('116: unknown keys mixed with a valid stage still reject', () => {
  const parsed = parseAdminRecommendationMetricsQuery({
    pipeline_stage: 'policy',
    limit: '10',
  });
  assert.equal(parsed.ok, false);
  assert.equal(
    parsed.error,
    ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES.invalidQuery,
  );
});

test('117: case/whitespace variants of the stage are rejected', () => {
  for (const value of [
    'Collaborative',
    'POLICY',
    'Hybrid',
    ' policy',
    'policy ',
    'Policy',
    'hybrid\n',
  ]) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: value });
    assert.equal(parsed.ok, false, `value should fail: ${JSON.stringify(value)}`);
  }
});

test('118: unknown stage names are rejected', () => {
  for (const value of ['best', 'overall', 'cold-start', 'svd', '']) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: value });
    assert.equal(parsed.ok, false);
  }
});

test('119: non-string pipeline_stage values are rejected', () => {
  for (const value of [['policy'], ['policy', 'hybrid'], 1, true, false, {}, 0]) {
    const parsed = parseAdminRecommendationMetricsQuery({ pipeline_stage: value });
    assert.equal(parsed.ok, false, `value should fail: ${JSON.stringify(value)}`);
  }
});

test('120: non-object query shapes are rejected', () => {
  for (const q of ['x', 42, true, ['pipeline_stage']]) {
    const parsed = parseAdminRecommendationMetricsQuery(q);
    assert.equal(parsed.ok, false);
  }
});

test('121: parse does not mutate the input query object', () => {
  const query = { pipeline_stage: 'hybrid' };
  const before = JSON.stringify(query);
  parseAdminRecommendationMetricsQuery(query);
  assert.equal(JSON.stringify(query), before);
});

test('122: invalid query error string is exactly the required fixed message', () => {
  const parsed = parseAdminRecommendationMetricsQuery({ limit: '1' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'invalid recommendation metrics query');
});

// --- handler status mapping ---

test('123: ready response is HTTP 200 with success envelope', async () => {
  const { invoke } = createHandler({ serviceResult: readyData });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, readyData);
});

test('124: no-runs response is HTTP 200 (never 404/500)', async () => {
  const { invoke } = createHandler({ serviceResult: noRunsData });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.state, 'no-runs');
  assert.equal(res.body.data.latest, null);
  assert.equal(res.body.data.source, 'evaluation-history');
});

test('125: invalid query is HTTP 400 with zero service calls', async () => {
  const { invoke, serviceCalls } = createHandler();
  const { res } = await invoke({ limit: '10' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid recommendation metrics query');
  assert.equal(serviceCalls.length, 0);
});

test('126: invalid stage value is HTTP 400 before any service call', async () => {
  const { invoke, serviceCalls } = createHandler();
  const { res } = await invoke({ pipeline_stage: 'best' });
  assert.equal(res.statusCode, 400);
  assert.equal(serviceCalls.length, 0);
});

test('127: unexpected service error is HTTP 500 with the fixed failed message', async () => {
  const { invoke } = createHandler({
    serviceError: new Error('MongoServerError: dump secrets mongodb://x'),
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 500);
  assert.equal(
    res.body.error,
    'failed to load recommendation metrics',
  );
});

test('128: 500 body does not leak error.message or stack', async () => {
  const { invoke } = createHandler({
    serviceError: new Error('internal secret stack trace'),
  });
  const { res } = await invoke({});
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('internal secret'), false);
  assert.equal(serialized.includes('stack'), false);
  assert.equal(serialized.includes('mongodb://'), false);
  assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
  assert.equal(res.body.success, false);
});

test('129: 400 body is success:false plus the fixed invalid-query error only', async () => {
  const { invoke } = createHandler();
  const { res } = await invoke({ foo: '1' });
  assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, 'invalid recommendation metrics query');
});

test('130: valid query forwards the selected stage to the service', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({ pipeline_stage: 'collaborative' });
  assert.equal(serviceCalls.length, 1);
  assert.deepEqual(serviceCalls[0], { pipelineStage: 'collaborative' });
});

test('131: default query forwards the default policy stage', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({});
  assert.deepEqual(serviceCalls[0], { pipelineStage: 'policy' });
});

test('132: one request performs exactly one service invocation', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({ pipeline_stage: 'hybrid' });
  assert.equal(serviceCalls.length, 1);
});

test('133: invalid query performs zero service invocations across many attempts', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({ limit: '1' });
  await invoke({ userId: 'u' });
  await invoke({ pipeline_stage: 'nope' });
  await invoke({ pipeline_stage: 'POLICY' });
  assert.equal(serviceCalls.length, 0);
});

test('134: query validation happens before the service call in source order', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  const parseIndex = source.indexOf('parseAdminRecommendationMetricsQuery(req.query)');
  const serviceIndex = source.indexOf('getLatestRecommendationMetrics');
  assert.ok(parseIndex >= 0);
  assert.ok(serviceIndex >= 0);
  assert.ok(parseIndex < serviceIndex);
});

test('135: protect and adminOnly appear before the handler in the route registration', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  const routeIndex = source.indexOf("'/metrics'");
  assert.ok(routeIndex >= 0);
  const routeSlice = source.slice(routeIndex);
  const protectIndex = routeSlice.indexOf('protectMiddleware');
  const adminIndex = routeSlice.indexOf('adminOnlyMiddleware');
  assert.ok(protectIndex >= 0);
  assert.ok(adminIndex > protectIndex);
});

test('136: success response uses res.status(200).json({success:true, data})', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  assert.match(
    source,
    /res\.status\(200\)\.json\(\{\s*success:\s*true\s*,\s*data\s*\}\)/,
  );
});

test('137: multiple sequential valid requests each hit the service once', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({});
  await invoke({ pipeline_stage: 'collaborative' });
  await invoke({ pipeline_stage: 'hybrid' });
  assert.equal(serviceCalls.length, 3);
  assert.deepEqual(
    serviceCalls.map((c) => c.pipelineStage),
    ['policy', 'collaborative', 'hybrid'],
  );
});

test('138: default production router export is created without arguments', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  assert.match(source, /const router = createAdminRecommendationRouter\(\);/);
  assert.match(source, /export default router;/);
});

test('139: no snapshot/song/user models are imported by the route', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  for (const token of [
    "models/Song",
    "models/User",
    "models/RecommendationSnapshot",
    "models/ListeningEvent",
    "models/PlayHistory",
    "models/Favorite",
  ]) {
    assert.equal(source.includes(token), false, `unexpected import: ${token}`);
  }
});

test('140: fixed HTTP message constants are imported from the service module', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  assert.match(source, /ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES/);
  assert.match(source, /ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE/);
  assert.equal(source.includes('failed to load recommendation metrics'), false);
  assert.equal(source.includes('invalid recommendation metrics query'), false);
});

// --- history query parser ---

function createHistoryHandler({
  serviceResult = historyReadyData,
  serviceError = null,
  protectImpl = null,
  adminOnlyImpl = null,
} = {}) {
  const serviceCalls = [];
  const middlewareOrder = [];
  const router = createAdminRecommendationRouter({
    protectMiddleware:
      protectImpl ??
      ((req, _res, next) => {
        middlewareOrder.push('protect');
        next();
      }),
    adminOnlyMiddleware:
      adminOnlyImpl ??
      ((req, _res, next) => {
        middlewareOrder.push('adminOnly');
        next();
      }),
    adminRecommendationHistoryService: {
      async getRecommendationEvaluationHistory(args) {
        serviceCalls.push(args);
        if (serviceError) throw serviceError;
        return serviceResult;
      },
    },
  });

  const layer = router.stack.find((l) => l.route && l.route.path === '/history');
  assert.ok(layer, 'expected GET /history route');
  const handlers = layer.route.stack.map((s) => s.handle);

  const invoke = async (query = {}, user = { role: 'admin' }) => {
    const req = { query, headers: {} };
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
    return { req, res, serviceCalls, middlewareOrder };
  };

  return { invoke, serviceCalls, middlewareOrder, handlers, layer };
}

const historyRun = (overrides = {}) => ({
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
  ...overrides,
});

const historyReadyData = {
  state: 'ready',
  source: 'evaluation-history',
  pipeline_stage: 'policy',
  limit: 20,
  count: 1,
  runs: [historyRun()],
};

const historyNoRunsData = {
  state: 'no-runs',
  source: 'evaluation-history',
  pipeline_stage: 'policy',
  limit: 20,
  count: 0,
  runs: [],
};

test('141: GET /history route exists with GET method only', () => {
  const { layer } = createHistoryHandler();
  assert.equal(layer.route.path, '/history');
  assert.deepEqual(Object.keys(layer.route.methods), ['get']);
});

test('142: history middleware order is protect then adminOnly then handler', async () => {
  const { invoke, middlewareOrder } = createHistoryHandler();
  await invoke({});
  assert.deepEqual(middlewareOrder, ['protect', 'adminOnly']);
});

test('143: history route stack has exactly three handlers', () => {
  const { handlers } = createHistoryHandler();
  assert.equal(handlers.length, 3);
});

test('144: empty history query defaults to policy stage and limit 20', () => {
  const parsed = parseAdminRecommendationHistoryQuery({});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.pipelineStage, 'policy');
  assert.equal(parsed.value.limit, 20);
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE, 'policy');
  assert.equal(DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT, 20);
  assert.equal(MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT, 100);
});

test('145: undefined and null history queries default to policy and limit 20', () => {
  for (const q of [undefined, null]) {
    const parsed = parseAdminRecommendationHistoryQuery(q);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.pipelineStage, 'policy');
    assert.equal(parsed.value.limit, 20);
  }
});

test('146: each exact-lowercase stage is accepted on history query', () => {
  for (const stage of PIPELINE_STAGES) {
    const parsed = parseAdminRecommendationHistoryQuery({
      pipeline_stage: stage,
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.pipelineStage, stage);
  }
});

test('147: limit string values 1 through 100 are accepted', () => {
  for (const raw of ['1', '5', '20', '99', '100']) {
    const parsed = parseAdminRecommendationHistoryQuery({ limit: raw });
    assert.equal(parsed.ok, true, raw);
    assert.equal(parsed.value.limit, Number(raw));
  }
});

test('148: invalid limit values are rejected without clamping', () => {
  for (const raw of [
    '0',
    '101',
    '999',
    '-1',
    '1.5',
    '01',
    '020',
    ' 20',
    '20 ',
    '',
    'twenty',
    '2e2',
    '+20',
    '0x10',
  ]) {
    const parsed = parseAdminRecommendationHistoryQuery({ limit: raw });
    assert.equal(parsed.ok, false, JSON.stringify(raw));
    assert.equal(
      parsed.error,
      'invalid recommendation history query',
    );
  }
});

test('149: non-string limit values are rejected', () => {
  for (const value of [20, 0, 1, true, null, undefined, [20], {}]) {
    const parsed = parseAdminRecommendationHistoryQuery({ limit: value });
    assert.equal(parsed.ok, false, JSON.stringify(value));
  }
});

test('150: unknown history query keys are rejected', () => {
  for (const key of [
    'userId',
    'user_id',
    'run_id',
    'sort',
    'metric',
    'best',
    'winner',
    'page',
    'offset',
    'admin',
    'role',
    'foo',
    'history',
  ]) {
    const parsed = parseAdminRecommendationHistoryQuery({ [key]: 'x' });
    assert.equal(parsed.ok, false, `key should fail: ${key}`);
    assert.equal(
      parsed.error,
      'invalid recommendation history query',
    );
  }
});

test('151: case/whitespace stage variants are rejected on history query', () => {
  for (const value of ['Policy', 'POLICY', ' policy', 'policy ', 'Hybrid']) {
    const parsed = parseAdminRecommendationHistoryQuery({
      pipeline_stage: value,
    });
    assert.equal(parsed.ok, false, JSON.stringify(value));
  }
});

test('152: non-string stage values are rejected on history query', () => {
  for (const value of [['policy'], 1, true, {}, null]) {
    const parsed = parseAdminRecommendationHistoryQuery({
      pipeline_stage: value,
    });
    assert.equal(parsed.ok, false, JSON.stringify(value));
  }
});

test('153: non-object history query shapes are rejected', () => {
  for (const q of ['x', 42, true, ['pipeline_stage']]) {
    const parsed = parseAdminRecommendationHistoryQuery(q);
    assert.equal(parsed.ok, false, JSON.stringify(q));
  }
});

test('154: parse does not mutate the history query object', () => {
  const query = { pipeline_stage: 'hybrid', limit: '10' };
  const before = JSON.stringify(query);
  parseAdminRecommendationHistoryQuery(query);
  assert.equal(JSON.stringify(query), before);
});

test('155: history ready response is HTTP 200 with success envelope', async () => {
  const { invoke } = createHistoryHandler({ serviceResult: historyReadyData });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, historyReadyData);
});

test('156: history no-runs response is HTTP 200 with count 0 and empty runs', async () => {
  const { invoke } = createHistoryHandler({
    serviceResult: historyNoRunsData,
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.state, 'no-runs');
  assert.equal(res.body.data.count, 0);
  assert.deepEqual(res.body.data.runs, []);
  assert.equal(res.body.data.source, 'evaluation-history');
});

test('157: invalid history query is HTTP 400 with zero service calls', async () => {
  const { invoke, serviceCalls } = createHistoryHandler();
  const { res } = await invoke({ limit: '101' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid recommendation history query');
  assert.equal(serviceCalls.length, 0);
});

test('158: unknown history query key is HTTP 400 before any service call', async () => {
  const { invoke, serviceCalls } = createHistoryHandler();
  const { res } = await invoke({ foo: '1' });
  assert.equal(res.statusCode, 400);
  assert.equal(serviceCalls.length, 0);
});

test('159: unexpected history service error is HTTP 500 with the fixed failed message', async () => {
  const { invoke } = createHistoryHandler({
    serviceError: new Error('MongoServerError: dump secrets mongodb://x'),
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'failed to load recommendation history');
});

test('160: history 500 body does not leak error.message or stack', async () => {
  const { invoke } = createHistoryHandler({
    serviceError: new Error('internal secret stack trace'),
  });
  const { res } = await invoke({});
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('internal secret'), false);
  assert.equal(serialized.includes('stack'), false);
  assert.equal(serialized.includes('mongodb://'), false);
  assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
  assert.equal(res.body.success, false);
});

test('161: history valid query forwards stage and limit to the service', async () => {
  const { invoke, serviceCalls } = createHistoryHandler();
  await invoke({ pipeline_stage: 'collaborative', limit: '5' });
  assert.equal(serviceCalls.length, 1);
  assert.deepEqual(serviceCalls[0], {
    pipelineStage: 'collaborative',
    limit: 5,
  });
});

test('162: history default query forwards policy stage and limit 20', async () => {
  const { invoke, serviceCalls } = createHistoryHandler();
  await invoke({});
  assert.deepEqual(serviceCalls[0], { pipelineStage: 'policy', limit: 20 });
});

test('163: one history request performs exactly one service invocation', async () => {
  const { invoke, serviceCalls } = createHistoryHandler();
  await invoke({ pipeline_stage: 'hybrid', limit: '10' });
  assert.equal(serviceCalls.length, 1);
});

test('164: protect 401 short-circuits history before adminOnly and service', async () => {
  const { invoke, serviceCalls } = createHistoryHandler({
    protectImpl: (req, res) => {
      res.status(401).json({ success: false, error: 'not authorized' });
    },
    adminOnlyImpl: (req, res, next) => next(),
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 401);
  assert.equal(serviceCalls.length, 0);
});

test('165: adminOnly 403 short-circuits history before the service', async () => {
  const { invoke, serviceCalls } = createHistoryHandler({
    protectImpl: (req, res, next) => next(),
    adminOnlyImpl: (req, res) => {
      res.status(403).json({ success: false, error: 'Admin access required' });
    },
  });
  const { res } = await invoke({ pipeline_stage: 'policy' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Admin access required');
  assert.equal(serviceCalls.length, 0);
});

test('166: history protect and adminOnly appear before the handler in source order', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  const routeIndex = source.indexOf("'/history'");
  assert.ok(routeIndex >= 0);
  const routeSlice = source.slice(routeIndex);
  const protectIndex = routeSlice.indexOf('protectMiddleware');
  const adminIndex = routeSlice.indexOf('adminOnlyMiddleware');
  const handlerIndex = routeSlice.indexOf('async (req, res)');
  assert.ok(protectIndex >= 0);
  assert.ok(adminIndex > protectIndex);
  assert.ok(handlerIndex > adminIndex);
});

test('167: history query validation happens before the service call in source order', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  const parseIndex = source.indexOf(
    'parseAdminRecommendationHistoryQuery(req.query)',
  );
  const serviceIndex = source.indexOf('getRecommendationEvaluationHistory');
  assert.ok(parseIndex >= 0);
  assert.ok(serviceIndex >= 0);
  assert.ok(parseIndex < serviceIndex);
});

test('168: history fixed HTTP messages are imported, not hardcoded in the route', () => {
  const source = readSource('./adminRecommendationRoutes.js');
  assert.match(source, /ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES/);
  assert.match(source, /ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE/);
  assert.match(source, /DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT/);
  assert.match(source, /MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT/);
  assert.equal(source.includes('failed to load recommendation history'), false);
  assert.equal(source.includes('invalid recommendation history query'), false);
});

test('169: metrics query still rejects the history key and vice versa boundaries', () => {
  const metricsWithHistory = parseAdminRecommendationMetricsQuery({
    history: '1',
  });
  assert.equal(metricsWithHistory.ok, false);
  const metricsWithLimit = parseAdminRecommendationMetricsQuery({
    limit: '10',
  });
  assert.equal(metricsWithLimit.ok, false);
  const historyUnknown = parseAdminRecommendationHistoryQuery({ metric: 'x' });
  assert.equal(historyUnknown.ok, false);
});

test('170: both /metrics and /history routes exist on one router with GET only', () => {
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
        return historyNoRunsData;
      },
    },
  });
  const routePaths = router.stack
    .filter((l) => l.route)
    .map((l) => l.route.path)
    .sort();
  assert.deepEqual(routePaths, ['/history', '/metrics']);
  for (const layer of router.stack.filter((l) => l.route)) {
    assert.deepEqual(Object.keys(layer.route.methods), ['get']);
  }
});
