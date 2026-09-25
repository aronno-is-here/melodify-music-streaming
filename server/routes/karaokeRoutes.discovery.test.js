import test from 'node:test';
import assert from 'node:assert/strict';
import { createKaraokeRouter, KARAOKE_ROUTE_MESSAGES } from './karaokeRoutes.js';

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

function createHarness({ discoveryResult, discoveryError } = {}) {
  const discoveryCalls = [];
  const router = createKaraokeRouter({
    protectMiddleware: (_req, _res, next) => next(),
    adminOnlyMiddleware: (_req, _res, next) => next(),
    uploadMiddleware: { fields: () => (_req, _res, next) => next() },
    KaraokeModel: {
      find() {
        return {
          sort() { return this; },
          skip() { return this; },
          limit() { return this; },
          then(resolve) { resolve([]); },
        };
      },
      countDocuments: async () => 0,
      create: async () => ({}),
      findById: async () => null,
      findByIdAndUpdate: async () => null,
      findByIdAndDelete: async () => null,
    },
    karaokeDiscoveryService: {
      async discoverTracks(args) {
        discoveryCalls.push(args);
        if (discoveryError) throw discoveryError;
        return discoveryResult || { items: [], total: 0, page: 1, pages: 1, limit: 12 };
      },
    },
  });

  const invoke = async ({ path, method, query = {} }) => {
    const layer = router.stack.find((entry) => entry.route && entry.route.path === path);
    const stack = layer.route.stack;
    const req = { query, params: {}, body: {}, method: method.toUpperCase() };
    const res = createRes();
    let index = 0;
    const next = async () => {
      if (index >= stack.length) return;
      const handler = stack[index].handle;
      index += 1;
      await handler(req, res, next);
    };
    await next();
    return { res, discoveryCalls };
  };

  return { invoke, discoveryCalls };
}

test('karaoke discovery route validates query before service call', async () => {
  const { invoke, discoveryCalls } = createHarness();
  const { res } = await invoke({ path: '/discovery', method: 'get', query: { nope: '1' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, KARAOKE_ROUTE_MESSAGES.invalidDiscoveryQuery);
  assert.equal(discoveryCalls.length, 0);
});

test('karaoke discovery route returns payload on success', async () => {
  const { invoke, discoveryCalls } = createHarness({
    discoveryResult: { items: [{ id: 'a' }], total: 1, page: 1, pages: 1, limit: 12 },
  });
  const { res } = await invoke({ path: '/discovery', method: 'get', query: { q: 'hello', region: 'en', limit: '12', page: '1' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(discoveryCalls.length, 1);
  assert.equal(res.body.data.items.length, 1);
});

test('karaoke discovery route maps errors to fixed message', async () => {
  const { invoke } = createHarness({ discoveryError: new Error('provider token leaked') });
  const { res } = await invoke({ path: '/discovery', method: 'get', query: { q: 'hello' } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, KARAOKE_ROUTE_MESSAGES.discoveryFailed);
});
