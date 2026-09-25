import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createRecommendationRouter,
  parseRecommendationRequest,
} from './recommendationRoutes.js';
import {
  DEFAULT_RECOMMENDATION_API_LIMIT,
  MAX_RECOMMENDATION_API_LIMIT,
  PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES,
} from '../services/personalizedRecommendationService.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const id = (n) => n.toString(16).padStart(24, '0');
const USER_A = id(0xa);

const readyData = {
  status: 'ready',
  source: 'personalized-snapshot',
  items: [{ rank: 1, song: { _id: id(1), title: 'T', artist: 'A' } }],
  snapshot: {
    snapshot_version: 'v1',
    generated_at: new Date('2026-09-15T12:00:00.000Z'),
    item_count: 1,
    available_count: 1,
    unavailable_count: 0,
  },
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
  enabled = true,
  serviceResult = readyData,
  serviceError = null,
} = {}) {
  const serviceCalls = [];
  const router = createRecommendationRouter({
    protectMiddleware: (req, _res, next) => next(),
    isRecommendationsEnabled: () => enabled,
    personalizedRecommendationService: {
      async getPersonalizedRecommendations(args) {
        serviceCalls.push(args);
        if (serviceError) throw serviceError;
        return serviceResult;
      },
    },
  });

  const layer = router.stack.find((l) => l.route && l.route.path === '/');
  const handlers = layer.route.stack.map((s) => s.handle);

  const invoke = async (query = {}, user = { _id: USER_A }) => {
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
    return { req, res, serviceCalls };
  };

  return { invoke, serviceCalls };
}

// --- 106–115: protect / auth wiring ---

test('106: route uses protect middleware', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.match(source, /import\s*\{\s*protect\s*\}\s*from\s*'\.\.\/middleware\/auth\.js'/);
  assert.match(source, /router\.get\s*\(\s*'\/'\s*,\s*protectMiddleware\s*,/);
});

test('107: route does NOT use adminOnly', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('adminOnly'), false);
});

test('108: default router wires protect from auth middleware', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.match(source, /protectMiddleware\s*=\s*protect/);
});

test('109: no token/JWT verification in route file', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('jwt'), false);
  assert.equal(source.includes('jsonwebtoken'), false);
  assert.equal(source.includes('token'), false);
});

test('110: factory accepts custom protectMiddleware for tests', () => {
  let called = false;
  const router = createRecommendationRouter({
    protectMiddleware: (req, res, next) => { called = true; next(); },
    isRecommendationsEnabled: () => false,
    personalizedRecommendationService: {
      async getPersonalizedRecommendations() { return readyData; },
    },
  });
  assert.ok(router);
  assert.equal(typeof called, 'boolean');
});

test('111: protect runs before flag check (source order)', () => {
  const source = readSource('./recommendationRoutes.js');
  const protectIndex = source.indexOf('protectMiddleware');
  const flagIndex = source.indexOf('isRecommendationsEnabled()');
  assert.ok(protectIndex >= 0 && flagIndex >= 0);
  assert.ok(protectIndex < flagIndex);
});

test('112: disabled handler returns 503 before parse', async () => {
  const { invoke, serviceCalls } = createHandler({ enabled: false });
  const { res } = await invoke({ limit: '10' });
  assert.equal(res.statusCode, 503);
  assert.equal(serviceCalls.length, 0);
});

test('113: disabled handler returns 503 before service', async () => {
  const { invoke, serviceCalls } = createHandler({ enabled: false });
  await invoke({});
  assert.equal(serviceCalls.length, 0);
});

test('114: disabled path performs zero service work', async () => {
  const { invoke, serviceCalls } = createHandler({ enabled: false });
  const { res } = await invoke({ limit: '5', page: '2' });
  assert.equal(res.statusCode, 503);
  assert.equal(serviceCalls.length, 0);
  assert.equal(res.body.error, PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.disabled);
});

test('115: disabled message is exact fixed string', async () => {
  const { invoke } = createHandler({ enabled: false });
  const { res } = await invoke({});
  assert.equal(
    res.body.error,
    'Personalized recommendations are currently unavailable.',
  );
});

// --- 116–130: flag + status codes ---

test('116: enabled request with valid query returns 200', async () => {
  const { invoke } = createHandler({ enabled: true });
  const { res } = await invoke({ limit: '10' });
  assert.equal(res.statusCode, 200);
});

test('117: 200 envelope is success + data', async () => {
  const { invoke } = createHandler();
  const { res } = await invoke({});
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, readyData);
});

test('118: no-snapshot response is 200 not 404', async () => {
  const { invoke } = createHandler({
    serviceResult: {
      status: 'no-snapshot',
      source: 'personalized-snapshot',
      items: [],
      snapshot: null,
    },
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.status, 'no-snapshot');
});

test('119: empty ready snapshot is 200', async () => {
  const { invoke } = createHandler({
    serviceResult: {
      status: 'ready',
      source: 'personalized-snapshot',
      items: [],
      snapshot: {
        snapshot_version: 'v1',
        generated_at: '2026-09-15T12:00:00.000Z',
        item_count: 0,
        available_count: 0,
        unavailable_count: 0,
      },
    },
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.status, 'ready');
  assert.equal(res.body.data.items.length, 0);
});

test('120: service error maps to 500 with fixed message', async () => {
  const { invoke } = createHandler({
    serviceError: new Error('internal secret stack'),
  });
  const { res } = await invoke({});
  assert.equal(res.statusCode, 500);
  assert.equal(
    res.body.error,
    PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.failed,
  );
});

test('121: 500 response does not leak error.message', async () => {
  const { invoke } = createHandler({
    serviceError: new Error('internal secret stack'),
  });
  const { res } = await invoke({});
  assert.equal(JSON.stringify(res.body).includes('internal secret'), false);
  assert.equal(JSON.stringify(res.body).includes('stack'), false);
});

test('122: 500 body is success:false + fixed error only', async () => {
  const { invoke } = createHandler({ serviceError: new Error('x') });
  const { res } = await invoke({});
  assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
  assert.equal(res.body.success, false);
});

test('123: disabled body is success:false + fixed error', async () => {
  const { invoke } = createHandler({ enabled: false });
  const { res } = await invoke({});
  assert.deepEqual(Object.keys(res.body).sort(), ['error', 'success']);
  assert.equal(res.body.success, false);
});

test('124: invalid query maps to 400', async () => {
  const { invoke, serviceCalls } = createHandler();
  const { res } = await invoke({ limit: 'abc', page: '1' });
  assert.equal(res.statusCode, 400);
  assert.equal(serviceCalls.length, 0);
});

test('125: 400 message is invalid recommendation query', async () => {
  const { invoke } = createHandler();
  const { res } = await invoke({ unknown: '1' });
  assert.equal(res.body.error, PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.invalidQuery);
});

test('126: 400 occurs before service invocation', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({ limit: '0' });
  assert.equal(serviceCalls.length, 0);
});

test('127: flag check precedes query parse in source', () => {
  const source = readSource('./recommendationRoutes.js');
  const flagIndex = source.indexOf('isRecommendationsEnabled()');
  const parseIndex = source.indexOf('parseRecommendationRequest(req.query)');
  assert.ok(flagIndex >= 0 && parseIndex >= 0);
  assert.ok(flagIndex < parseIndex);
});

test('128: flag check precedes service call in source', () => {
  const source = readSource('./recommendationRoutes.js');
  const flagIndex = source.indexOf('isRecommendationsEnabled()');
  const serviceIndex = source.indexOf('getPersonalizedRecommendations');
  assert.ok(flagIndex < serviceIndex);
});

test('129: single service invocation path in handler', () => {
  const source = readSource('./recommendationRoutes.js');
  const matches = source.match(/getPersonalizedRecommendations\s*\(/g) || [];
  assert.equal(matches.length, 1);
});

test('130: success response is status 200 json', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.match(source, /res\.status\(200\)\.json\(\{\s*success:\s*true\s*,\s*data\s*\}\)/);
});

// --- 131–150: query parser ---

test('131: parse accepts empty object as default limit', () => {
  const parsed = parseRecommendationRequest({});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.limit, DEFAULT_RECOMMENDATION_API_LIMIT);
});

test('132: default limit is 10', () => {
  assert.equal(DEFAULT_RECOMMENDATION_API_LIMIT, 10);
  const parsed = parseRecommendationRequest({});
  assert.equal(parsed.value.limit, 10);
});

test('133: parse accepts undefined query as default', () => {
  const parsed = parseRecommendationRequest(undefined);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.limit, 10);
});

test('134: parse accepts null query as default', () => {
  const parsed = parseRecommendationRequest(null);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.limit, 10);
});

test('135: only allowed key is limit', () => {
  const parsed = parseRecommendationRequest({ page: '1' });
  assert.equal(parsed.ok, false);
});

test('136: unknown key rejected even with valid limit', () => {
  const parsed = parseRecommendationRequest({ limit: '10', extra: 'x' });
  assert.equal(parsed.ok, false);
});

test('137: user key rejected', () => {
  const parsed = parseRecommendationRequest({ user: USER_A });
  assert.equal(parsed.ok, false);
});

test('138: userId key rejected', () => {
  const parsed = parseRecommendationRequest({ userId: USER_A });
  assert.equal(parsed.ok, false);
});

test('139: email key rejected', () => {
  const parsed = parseRecommendationRequest({ email: 'a@b.c' });
  assert.equal(parsed.ok, false);
});

test('140: limit=1 accepted', () => {
  const parsed = parseRecommendationRequest({ limit: '1' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.limit, 1);
});

test('141: limit=100 accepted', () => {
  const parsed = parseRecommendationRequest({ limit: '100' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.limit, 100);
});

test('142: MAX is 100', () => {
  assert.equal(MAX_RECOMMENDATION_API_LIMIT, 100);
});

test('143: limit=101 rejected', () => {
  const parsed = parseRecommendationRequest({ limit: '101' });
  assert.equal(parsed.ok, false);
});

test('144: limit=0 rejected', () => {
  const parsed = parseRecommendationRequest({ limit: '0' });
  assert.equal(parsed.ok, false);
});

test('145: negative limit rejected', () => {
  const parsed = parseRecommendationRequest({ limit: '-1' });
  assert.equal(parsed.ok, false);
});

test('146: float limit rejected', () => {
  const parsed = parseRecommendationRequest({ limit: '1.5' });
  assert.equal(parsed.ok, false);
});

test('147: non-numeric limit rejected', () => {
  const parsed = parseRecommendationRequest({ limit: 'ten' });
  assert.equal(parsed.ok, false);
});

test('148: empty string limit rejected', () => {
  const parsed = parseRecommendationRequest({ limit: '' });
  assert.equal(parsed.ok, false);
});

test('149: whitespace limit rejected', () => {
  const parsed = parseRecommendationRequest({ limit: ' 10 ' });
  assert.equal(parsed.ok, false);
});

test('150: array limit rejected', () => {
  const parsed = parseRecommendationRequest({ limit: ['10'] });
  assert.equal(parsed.ok, false);
});

test('151: boolean limit rejected', () => {
  const parsed = parseRecommendationRequest({ limit: true });
  assert.equal(parsed.ok, false);
});

test('152: number limit value (non-string) rejected', () => {
  const parsed = parseRecommendationRequest({ limit: 10 });
  assert.equal(parsed.ok, false);
});

test('153: array query object rejected', () => {
  const parsed = parseRecommendationRequest(['limit']);
  assert.equal(parsed.ok, false);
});

test('154: non-object query rejected', () => {
  const parsed = parseRecommendationRequest('limit=10');
  assert.equal(parsed.ok, false);
});

test('155: limit with leading plus rejected', () => {
  const parsed = parseRecommendationRequest({ limit: '+10' });
  assert.equal(parsed.ok, false);
});

test('156: leading-zero limit like 010 is digits-only accepted as 10', () => {
  const parsed = parseRecommendationRequest({ limit: '010' });
  // DIGITS_ONLY allows 010 → Number 10
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.limit, 10);
});

test('157: parse does not mutate input query', () => {
  const query = { limit: '10' };
  const snapshot = { ...query };
  parseRecommendationRequest(query);
  assert.deepEqual(query, snapshot);
});

test('158: invalid parse returns fixed invalid query error', () => {
  const parsed = parseRecommendationRequest({ nope: '1' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'Invalid recommendation query');
});

// --- 159–175: identity + service wiring ---

test('159: identity comes only from req.user._id', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.match(source, /userId:\s*req\.user\?\._id/);
});

test('160: route does not read req.query.user for identity', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('req.query.user'), false);
  assert.equal(source.includes('req.query.userId'), false);
  assert.equal(source.includes('req.body.user'), false);
});

test('161: service receives validated limit from parser', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({ limit: '7' });
  assert.equal(serviceCalls.length, 1);
  assert.equal(serviceCalls[0].limit, 7);
});

test('162: service receives default limit when query empty', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({});
  assert.equal(serviceCalls[0].limit, 10);
});

test('163: service receives userId from authenticated user', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({}, { _id: USER_A });
  assert.equal(String(serviceCalls[0].userId), USER_A);
});

test('164: service args keys are only userId and limit', async () => {
  const { invoke, serviceCalls } = createHandler();
  await invoke({ limit: '3' });
  assert.deepEqual(Object.keys(serviceCalls[0]).sort(), ['limit', 'userId']);
});

test('165: missing req.user still reaches service with undefined userId', async () => {
  // protect would normally guarantee req.user; factory test uses fake protect
  const { invoke, serviceCalls } = createHandler({
    serviceError: new Error('bad user'),
  });
  const { res } = await invoke({}, null);
  // with user null/absent, service gets userId undefined; our fake throws → 500
  assert.equal(res.statusCode, 500);
  assert.equal(serviceCalls.length, 1);
  assert.equal(serviceCalls[0].userId, undefined);
});

// --- 176–190: source static constraints ---

test('176: no adminOnly import', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('adminOnly'), false);
});

test('177: no Python / child_process / ml imports', () => {
  const source = readSource('./recommendationRoutes.js');
  for (const forbidden of ['child_process', 'python', "from 'ml", 'svd']) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test('178: no Favorite / Playlist / ListeningEvent / PlayHistory', () => {
  const source = readSource('./recommendationRoutes.js');
  for (const forbidden of ['Favorite', 'Playlist', 'ListeningEvent', 'PlayHistory']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('179: no response of basis/score diagnostics fields', () => {
  const source = readSource('./recommendationRoutes.js');
  for (const forbidden of ['policy_score', 'hybrid_score', 'profile_score', 'collaborative_known', 'basis']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('180: no error.message / stack in responses', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('error.message'), false);
  assert.equal(source.includes('err.message'), false);
  assert.equal(source.includes('stack'), false);
});

test('181: no console logging in route', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('console.'), false);
});

test('182: no admin metrics / evaluation run imports', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('EvaluationRun'), false);
  assert.equal(source.includes('adminMetrics'), false);
  assert.equal(source.includes('trending'), false);
});

test('183: route file does not import Song model directly', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes("from '../models/Song.js'"), false);
  assert.equal(source.includes("from '../models/RecommendationSnapshot.js'"), false);
});

test('184: route uses recommendationConfig.aiEnabled default gate', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.match(source, /recommendationConfig\.aiEnabled/);
  assert.match(source, /import recommendationConfig from '\.\.\/config\/recommendation\.js'/);
});

test('185: no second feature-flag env var introduced', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('process.env'), false);
  assert.equal(source.includes('RECOMMENDATION_TRENDING'), false);
  assert.equal(source.includes('RECOMMENDATION_LISTENING'), false);
  assert.equal(source.includes('RECOMMENDATION_CATALOG'), false);
  assert.equal(source.includes('RECOMMENDATION_ADMIN'), false);
});

test('186: no write HTTP methods — only GET', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes("router.post"), false);
  assert.equal(source.includes("router.put"), false);
  assert.equal(source.includes("router.patch"), false);
  assert.equal(source.includes("router.delete"), false);
  assert.equal((source.match(/router\.get\s*\(/g) || []).length, 1);
});

test('187: no rate limiter / new middleware added in route file', () => {
  const source = readSource('./recommendationRoutes.js');
  assert.equal(source.includes('rateLimit'), false);
  assert.equal(source.includes('helmet'), false);
});

// --- 191–196: server.js mount ---

test('191: server mounts recommendations router exactly once', () => {
  const source = readSource('../server.js');
  const importCount = (source.match(/import recommendationRoutes from/g) || []).length;
  const mountCount = (
    source.match(/app\.use\(\s*['"]\/api\/recommendations['"]\s*,\s*recommendationRoutes\s*\)/g) || []
  ).length;
  assert.equal(importCount, 1);
  assert.equal(mountCount, 1);
});

test('192: no double-mounted path', () => {
  const source = readSource('../server.js');
  assert.equal(source.includes('/api/recommendations/recommendations'), false);
  assert.equal(source.includes('/api/recommendations/'), false);
});

test('193: mount path is exactly /api/recommendations', () => {
  const source = readSource('../server.js');
  assert.match(source, /app\.use\(\s*['"]\/api\/recommendations['"]\s*,\s*recommendationRoutes\s*\)/);
});

test('194: server import path is routes/recommendationRoutes.js', () => {
  const source = readSource('../server.js');
  assert.match(source, /import recommendationRoutes from '\.\/routes\/recommendationRoutes\.js'/);
});

test('195: mount sits with other recommendation routes after trending', () => {
  const source = readSource('../server.js');
  const trendingIndex = source.indexOf("app.use('/api/trending'");
  const recIndex = source.indexOf("app.use('/api/recommendations'");
  assert.ok(trendingIndex >= 0 && recIndex >= 0);
  assert.ok(trendingIndex < recIndex);
});

test('196: package.json has no new dependencies from this checkpoint', () => {
  const pkg = JSON.parse(readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8',
  ));
  assert.equal(pkg.dependencies.express, '^4.19.2');
  assert.equal(Object.keys(pkg.dependencies).length, 10);
  assert.equal(pkg.devDependencies.nodemon, '^3.1.4');
});
