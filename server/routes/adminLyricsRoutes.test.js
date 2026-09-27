import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ADD_LYRICS_BODY_KEYS,
  ADMIN_LYRICS_BODY_ERROR,
  ADMIN_LYRICS_LIST_ERROR,
  ADMIN_LYRICS_SAVE_ERROR,
  IMPORT_LYRICS_BODY_KEYS,
  createAdminLyricsRouter,
} from './adminLyricsRoutes.js';
import {
  ADMIN_LYRICS_ERROR_MESSAGES,
  AdminLyricsConflictError,
  AdminLyricsNotFoundError,
  AdminLyricsReadError,
  AdminLyricsSaveError,
  AdminLyricsValidationError,
} from '../services/adminLyricsService.js';
import { protect, adminOnly } from '../middleware/auth.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const ROUTE_SOURCE = readSource('./adminLyricsRoutes.js');
const SERVICE_SOURCE = readSource('../services/adminLyricsService.js');
const SERVER_SOURCE = readSource('../server.js');

const SONG_ID = '64b64b64b64b64b64b64b640';

const QUEUE_RESULT = {
  state: 'ready',
  q: null,
  language: null,
  missing: true,
  page: 1,
  limit: 20,
  total: 1,
  pages: 1,
  count: 1,
  rows: [{ songId: SONG_ID, title: 'Tum Hi Ho', lyricsStatus: 'missing' }],
};

const SAVE_RESULT = {
  songId: SONG_ID,
  saved: true,
  replaced: false,
  format: 'plain',
  lyricsVerified: true,
  lyricsSource: 'db_verified',
};

const IMPORT_RESULT = {
  state: 'ready',
  format: 'csv',
  counts: { imported: 1, rejected: 0, duplicate: 0, invalid: 0, total: 1 },
  importedSongIds: [SONG_ID],
  invalid: [],
  rejected: [],
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

function createRouter({
  queueResult = QUEUE_RESULT,
  saveResult = SAVE_RESULT,
  importResult = IMPORT_RESULT,
  queueError = null,
  saveError = null,
  importError = null,
  protectImpl = protect,
  adminOnlyImpl = adminOnly,
} = {}) {
  const serviceCalls = { list: [], save: [], bulk: [] };
  const middlewareOrder = [];

  const router = createAdminLyricsRouter({
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
    adminLyricsService: {
      async listMissingLyrics(args) {
        serviceCalls.list.push(args);
        if (queueError) throw queueError;
        return queueResult;
      },
      async saveVerifiedLyrics(args) {
        serviceCalls.save.push(args);
        if (saveError) throw saveError;
        return saveResult;
      },
      async bulkImport(args) {
        serviceCalls.bulk.push(args);
        if (importError) throw importError;
        return importResult;
      },
    },
  });

  const middlewareLayers = router.stack.filter((layer) => !layer.route);
  const routeLayer = (path, method) =>
    router.stack.find((layer) => layer.route && layer.route.path === path && layer.route.methods[method]);

  const invoke = async (path, method, { query = {}, body = undefined, params = {}, user = { role: 'admin', _id: '64b64b64b64b64b64b64b6ff' } } = {}) => {
    const layer = routeLayer(path, method);
    assert.ok(layer, `expected ${method.toUpperCase()} ${path} route`);
    const req = { query, body, params, headers: {} };
    if (user !== null) req.user = user;
    const res = createRes();
    await layer.route.stack[0].handle(req, res, () => {});
    return { res, serviceCalls, middlewareOrder };
  };

  return { router, middlewareLayers, routeLayer, invoke, serviceCalls, middlewareOrder };
}

test('routes: queue, import and single-song save are all registered', () => {
  const { routeLayer } = createRouter();
  assert.deepEqual(Object.keys(routeLayer('/', 'get').route.methods), ['get']);
  assert.deepEqual(Object.keys(routeLayer('/import', 'post').route.methods), ['post']);
  assert.deepEqual(Object.keys(routeLayer('/:songId', 'post').route.methods), ['post']);
});

test('routes: protect runs before adminOnly as router-level middleware', () => {
  const { middlewareLayers } = createRouter();
  assert.equal(middlewareLayers.length, 2);
  assert.equal(middlewareLayers[0].route, undefined);
  assert.equal(middlewareLayers[1].route, undefined);
  assert.equal(middlewareLayers[0].handle, protect);
  assert.equal(middlewareLayers[1].handle, adminOnly);
});

test('routes: unauthenticated requests stop at protect with 401', async () => {
  const { router } = createRouter();
  const middlewareLayers = router.stack.filter((layer) => !layer.route);
  const res = createRes();
  let called = false;
  await middlewareLayers[0].handle({ headers: {} }, res, () => { called = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
  assert.equal(res.body.success, false);
});

test('routes: non-admin requests stop at adminOnly with 403 and never reach the handler', async () => {
  const { middlewareLayers, serviceCalls } = createRouter();
  const res = createRes();
  let called = false;
  await middlewareLayers[1].handle({ user: { role: 'user' } }, res, () => { called = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Admin access required');
  assert.equal(called, false);
  assert.equal(serviceCalls.list.length, 0);
  assert.equal(serviceCalls.save.length, 0);
  assert.equal(serviceCalls.bulk.length, 0);
});

test('routes: header, query and body role claims never bypass adminOnly', async () => {
  const { middlewareLayers } = createRouter();
  for (const req of [
    { headers: { 'x-role': 'admin' } },
    { headers: { 'x-admin': '1' } },
    { headers: { authorization: 'Bearer anything' }, user: { role: 'user' } },
    { headers: {}, query: { role: 'admin' }, user: { role: 'user' } },
    { headers: {}, body: { role: 'admin' }, user: { role: 'user' } },
  ]) {
    const res = createRes();
    let called = false;
    await middlewareLayers[1].handle(req, res, () => { called = true; });
    assert.equal(res.statusCode, 403, JSON.stringify(req.headers));
    assert.equal(called, false);
  }
});

test('routes: middleware order is protect then adminOnly on an authorized request', async () => {
  const order = [];
  const { middlewareLayers } = createRouter({
    protectImpl: (req, _res, next) => {
      order.push('protect');
      next();
    },
    adminOnlyImpl: (req, _res, next) => {
      order.push('adminOnly');
      next();
    },
  });
  for (const layer of middlewareLayers) {
    await layer.handle({ user: { role: 'admin' }, headers: {} }, createRes(), () => {});
  }
  assert.deepEqual(order, ['protect', 'adminOnly']);
});

test('routes: queue GET forwards only the query to the service', async () => {
  const { invoke, serviceCalls } = createRouter();
  const { res } = await invoke('/', 'get', { query: { q: 'tum', page: '2' } });
  assert.equal(res.statusCode, null);
  assert.deepEqual(res.body, { success: true, data: QUEUE_RESULT });
  assert.deepEqual(serviceCalls.list, [{ q: 'tum', page: '2' }]);
});

test('routes: single-song save forwards the body plus the trusted admin id', async () => {
  const { invoke, serviceCalls } = createRouter();
  const { res } = await invoke('/:songId', 'post', {
    params: { songId: SONG_ID },
    body: { lyrics: 'words', language: 'hindi', sourceUrl: 'https://example.com/a' },
    user: { role: 'admin', _id: '64b64b64b64b64b64b64b6ff' },
  });
  assert.deepEqual(res.body, { success: true, data: SAVE_RESULT });
  assert.equal(serviceCalls.save.length, 1);
  assert.deepEqual(serviceCalls.save[0], {
    songId: SONG_ID,
    lyrics: 'words',
    language: 'hindi',
    sourceUrl: 'https://example.com/a',
    sourceProvider: undefined,
    notes: undefined,
    format: undefined,
    replaceVerified: undefined,
    verifiedBy: '64b64b64b64b64b64b64b6ff',
  });
});

test('routes: bulk import forwards the file payload plus the trusted admin id', async () => {
  const { invoke, serviceCalls } = createRouter();
  const { res } = await invoke('/import', 'post', {
    body: { text: 'songId,lyrics', fileName: 'songs.csv' },
    user: { role: 'admin', _id: '64b64b64b64b64b64b64b6ff' },
  });
  assert.deepEqual(res.body, { success: true, data: IMPORT_RESULT });
  assert.equal(serviceCalls.bulk.length, 1);
  assert.equal(serviceCalls.bulk[0].fileName, 'songs.csv');
  assert.equal(serviceCalls.bulk[0].text, 'songId,lyrics');
  assert.equal(serviceCalls.bulk[0].verifiedBy, '64b64b64b64b64b64b64b6ff');
});

test('routes: unknown body keys are rejected before any service call', async () => {
  const { invoke, serviceCalls } = createRouter();
  for (const body of [
    { lyrics: 'x', userId: 'abc' },
    { lyrics: 'x', role: 'admin' },
    { lyrics: 'x', isAdmin: true },
    { lyrics: 'x', token: 'secret' },
  ]) {
    const { res } = await invoke('/:songId', 'post', { params: { songId: SONG_ID }, body });
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.body.error, ADMIN_LYRICS_BODY_ERROR);
  }
  for (const body of [{ text: 'a', debug: '1' }, { text: 'a', limit: '999' }]) {
    const { res } = await invoke('/import', 'post', { body });
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.body.error, ADMIN_LYRICS_BODY_ERROR);
  }
  assert.equal(serviceCalls.save.length, 0);
  assert.equal(serviceCalls.bulk.length, 0);
});

test('routes: allowed body keys are explicit whitelists', () => {
  assert.deepEqual(ADD_LYRICS_BODY_KEYS, [
    'lyrics',
    'language',
    'sourceUrl',
    'sourceProvider',
    'notes',
    'format',
    'replaceVerified',
  ]);
  assert.deepEqual(IMPORT_LYRICS_BODY_KEYS, ['text', 'fileName', 'format', 'replaceVerified']);
  assert.equal(ADD_LYRICS_BODY_KEYS.includes('userId'), false);
  assert.equal(IMPORT_LYRICS_BODY_KEYS.includes('role'), false);
});

test('routes: validation, not-found, conflict and read errors map to fixed statuses', async () => {
  const cases = [
    [new AdminLyricsValidationError('Lyrics are invalid'), 400, 'Lyrics are invalid'],
    [new AdminLyricsNotFoundError('Song not found'), 404, 'Song not found'],
    [
      new AdminLyricsConflictError(ADMIN_LYRICS_ERROR_MESSAGES.VERIFIED_LYRICS_EXISTS),
      409,
      ADMIN_LYRICS_ERROR_MESSAGES.VERIFIED_LYRICS_EXISTS,
    ],
    [new AdminLyricsReadError(ADMIN_LYRICS_ERROR_MESSAGES.READ_FAILED), 500, ADMIN_LYRICS_ERROR_MESSAGES.READ_FAILED],
    [new AdminLyricsSaveError(ADMIN_LYRICS_ERROR_MESSAGES.SAVE_FAILED), 500, ADMIN_LYRICS_ERROR_MESSAGES.SAVE_FAILED],
  ];

  for (const [error, status, message] of cases) {
    const queue = createRouter({ queueError: error });
    const { res } = await queue.invoke('/', 'get');
    assert.equal(res.statusCode, status);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, message);
  }
});

test('routes: unexpected errors return sanitized fixed messages', async () => {
  const leak = new Error('mongodb://user:pass@host/secret?token=abc');
  const queue = createRouter({ queueError: leak });
  const queueRes = (await queue.invoke('/', 'get')).res;
  assert.equal(queueRes.statusCode, 500);
  assert.equal(queueRes.body.error, ADMIN_LYRICS_LIST_ERROR);
  assert.equal(JSON.stringify(queueRes.body).includes('secret'), false);

  const save = createRouter({ saveError: leak });
  const saveRes = (await save.invoke('/:songId', 'post', { params: { songId: SONG_ID }, body: { lyrics: 'x' } })).res;
  assert.equal(saveRes.statusCode, 500);
  assert.equal(saveRes.body.error, ADMIN_LYRICS_SAVE_ERROR);

  const bulk = createRouter({ importError: leak });
  const bulkRes = (await bulk.invoke('/import', 'post', { body: { text: 'x' } })).res;
  assert.equal(bulkRes.statusCode, 500);
  assert.equal(bulkRes.body.error, ADMIN_LYRICS_SAVE_ERROR);
});

test('routes: successful responses expose only success and data', async () => {
  const { invoke } = createRouter();
  const queueRes = (await invoke('/', 'get')).res;
  assert.deepEqual(Object.keys(queueRes.body), ['success', 'data']);
  const saveRes = (await invoke('/:songId', 'post', { params: { songId: SONG_ID }, body: { lyrics: 'x' } })).res;
  assert.deepEqual(Object.keys(saveRes.body), ['success', 'data']);
  const importRes = (await invoke('/import', 'post', { body: { text: 'x' } })).res;
  assert.deepEqual(Object.keys(importRes.body), ['success', 'data']);
});

test('routes: source never parses JWTs or roles itself', () => {
  assert.equal(/jsonwebtoken|jwt\.verify|Authorization/.test(ROUTE_SOURCE), false);
  assert.equal(/req\.(query|body|headers)\.(role|admin|isAdmin)/.test(ROUTE_SOURCE), false);
  assert.equal(/Bearer|jwt/.test(SERVICE_SOURCE), false);
});

test('routes: no external lyric page fetching in route or service', () => {
  for (const source of [ROUTE_SOURCE, SERVICE_SOURCE]) {
    assert.equal(/\bfetch\s*\(/.test(source), false);
    assert.equal(/axios|node-fetch|got\(|https?\.request|XMLHttpRequest/.test(source), false);
    assert.equal(/cheerio|playwright|puppeteer/.test(source), false);
    assert.equal(/lyricsify|genius\.com|azlyrics|musixmatch|lyricfind|search\.lyrics/.test(source), false);
  }
});

test('routes: read-only response shape keeps no credential or user email fields', () => {
  assert.equal(/password|token|secret|email/.test(ROUTE_SOURCE), false);
  assert.equal(/req\.user\.email/.test(ROUTE_SOURCE), false);
});

test('server: admin lyrics router is mounted at /api/admin/lyrics before the generic admin router', () => {
  const lyricsMount = SERVER_SOURCE.indexOf("app.use('/api/admin/lyrics', adminLyricsRoutes)");
  const adminMount = SERVER_SOURCE.indexOf("app.use('/api/admin', adminRoutes)");
  assert.ok(lyricsMount > 0, 'expected /api/admin/lyrics mount');
  assert.ok(adminMount > 0, 'expected /api/admin mount');
  assert.ok(lyricsMount < adminMount, 'admin lyrics mount must come first');
  assert.ok(SERVER_SOURCE.includes("import adminLyricsRoutes from './routes/adminLyricsRoutes.js'"));
});

test('service: no network clients are imported for lyric discovery in the admin workflow', () => {
  assert.equal(/child_process|net\.connect|createConnection/.test(SERVICE_SOURCE), false);
  assert.equal(/fetch|axios|https?\.get|https?\.request/.test(SERVICE_SOURCE), false);
});
