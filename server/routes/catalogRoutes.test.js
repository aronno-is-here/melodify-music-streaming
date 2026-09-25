import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_ROUTE_MESSAGES,
  createCatalogRouter,
} from './catalogRoutes.js';

function createRes() {
  const res = {
    statusCode: 200,
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

function createHarness({ searchResult, searchError } = {}) {
  const searchCalls = [];
  const router = createCatalogRouter({
    protectMiddleware: (_req, _res, next) => next(),
    catalogDiscoveryService: {
      async searchCatalog(args) {
        searchCalls.push(args);
        if (searchError) throw searchError;
        return searchResult || { mergedResults: [] };
      },
    },
  });

  const invoke = async ({ path, method, query = {} }) => {
    const layer = router.stack.find((entry) => entry.route && entry.route.path === path);
    const stack = layer.route.stack;
    const req = { query, params: {}, method: method.toUpperCase() };
    const res = createRes();
    let index = 0;
    const next = async () => {
      if (index >= stack.length) return;
      const handler = stack[index].handle;
      index += 1;
      await handler(req, res, next);
    };
    await next();
    return { res, searchCalls };
  };

  return { invoke, searchCalls };
}

test('catalog /regions returns stable region list', async () => {
  const { invoke } = createHarness();
  const { res } = await invoke({ path: '/regions', method: 'get' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(Array.isArray(res.body.data), true);
  assert.equal(res.body.data.length >= 4, true);
});

test('catalog /search validates query before service call', async () => {
  const { invoke, searchCalls } = createHarness();
  const { res } = await invoke({ path: '/search', method: 'get', query: { nope: '1' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, CATALOG_ROUTE_MESSAGES.invalidSearchQuery);
  assert.equal(searchCalls.length, 0);
});

test('catalog /search returns service payload on success', async () => {
  const { invoke, searchCalls } = createHarness({
    searchResult: { mergedResults: [{ sourceType: 'local' }] },
  });
  const { res } = await invoke({ path: '/search', method: 'get', query: { q: 'arnob' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(searchCalls.length, 1);
});

test('catalog /search maps service failure to fixed 500 message', async () => {
  const { invoke } = createHarness({ searchError: new Error('secret provider key') });
  const { res } = await invoke({ path: '/search', method: 'get', query: { q: 'arnob' } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, CATALOG_ROUTE_MESSAGES.searchFailed);
});
