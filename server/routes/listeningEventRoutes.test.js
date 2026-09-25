import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

test('34: route uses protect', () => {
  const source = readSource('./listeningEventRoutes.js');
  assert.match(source, /import\s*\{\s*protect\s*\}\s*from\s*'\.\.\/middleware\/auth\.js'/);
  assert.match(source, /router\.post\s*\(\s*'\/'\s*,\s*protect\s*,/);
});

test('35: route does NOT use adminOnly', () => {
  const source = readSource('./listeningEventRoutes.js');
  assert.equal(source.includes('adminOnly'), false);
});

test('36: route uses req.user identity', () => {
  const source = readSource('./listeningEventRoutes.js');
  assert.match(source, /userId:\s*req\.user\._id/);
});

test('37: route does not read req.body.user/userId', () => {
  const source = readSource('./listeningEventRoutes.js');
  assert.equal(/req\.body\.user(?:Id)?\b/.test(source), false);
  assert.equal(source.includes('req.query.user'), false);
  assert.equal(source.includes('req.params.user'), false);
});

test('38: feature flag checked before service invocation', () => {
  const source = readSource('./listeningEventRoutes.js');
  const flagIndex = source.indexOf('recommendationConfig.listeningEventsEnabled');
  const serviceIndex = source.indexOf('recordListeningEvent');
  assert.ok(flagIndex >= 0, 'feature flag present');
  assert.ok(serviceIndex >= 0, 'service invocation present');
  assert.ok(flagIndex < serviceIndex, 'flag checked before service call');
  const earlyReturn = source.slice(flagIndex, serviceIndex);
  assert.match(earlyReturn, /return\s+res\.status\(503\)/);
});

test('39: only one service invocation path exists', () => {
  const source = readSource('./listeningEventRoutes.js');
  const matches = source.match(/recordListeningEvent\s*\(/g) || [];
  assert.equal(matches.length, 1);
});

test('40: no PlayHistory import/write', () => {
  const source = readSource('./listeningEventRoutes.js');
  assert.equal(source.includes('PlayHistory'), false);
});

test('41: no raw error.message response', () => {
  const source = readSource('./listeningEventRoutes.js');
  assert.equal(source.includes('error.message'), false);
  assert.equal(source.includes('err.message'), false);
});

test('server mounts listening-events router exactly once', () => {
  const source = readSource('../server.js');
  const importCount = (source.match(/import listeningEventRoutes from/g) || []).length;
  const mountCount = (
    source.match(/app\.use\(\s*['"]\/api\/listening-events['"]\s*,\s*listeningEventRoutes\s*\)/g) ||
    []
  ).length;
  assert.equal(importCount, 1);
  assert.equal(mountCount, 1);
  assert.equal(source.includes('/api/listening-events/listening-events'), false);
});
