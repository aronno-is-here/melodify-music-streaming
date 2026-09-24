import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

test('1: route uses protect', () => {
  const source = readSource('./trendingRoutes.js');
  assert.match(source, /import\s*\{\s*protect\s*\}\s*from\s*'\.\.\/middleware\/auth\.js'/);
  assert.match(source, /router\.get\s*\(\s*'\/'\s*,\s*protect\s*,/);
});

test('2: route does NOT use adminOnly', () => {
  const source = readSource('./trendingRoutes.js');
  assert.equal(source.includes('adminOnly'), false);
});

test('3: feature flag checked before service invocation', () => {
  const source = readSource('./trendingRoutes.js');
  const flagIndex = source.indexOf('recommendationConfig.trendingEnabled');
  const serviceIndex = source.indexOf('getTrendingSongs');
  assert.ok(flagIndex >= 0, 'feature flag present');
  assert.ok(serviceIndex >= 0, 'service invocation present');
  assert.ok(flagIndex < serviceIndex, 'flag checked before service call');
  const earlyReturn = source.slice(flagIndex, serviceIndex);
  assert.match(earlyReturn, /return\s+res\.status\(503\)/);
});

test('4: feature-disabled path returns 503 before parse and service (zero work)', () => {
  const source = readSource('./trendingRoutes.js');
  const flagIndex = source.indexOf('recommendationConfig.trendingEnabled');
  const parseIndex = source.indexOf('await trendingService.getTrendingSongs');
  const serviceIndex = parseIndex;
  assert.ok(flagIndex >= 0 && parseIndex >= 0 && serviceIndex >= 0);
  assert.ok(flagIndex < parseIndex, 'flag before parse/service');
  const disabledSlice = source.slice(flagIndex, parseIndex);
  assert.match(disabledSlice, /status\(503\)/);
  assert.match(disabledSlice, /parseTrendingRequest/, 'parser reference after early return');
  assert.equal(disabledSlice.includes('await trendingService.getTrendingSongs'), false);
  assert.equal(disabledSlice.includes('find('), false);
  assert.match(source.slice(0, flagIndex + 40), /trendingEnabled/, 'flag is first runtime check after protect');
  const protectedIndex = source.indexOf('protect');
  assert.ok(protectedIndex < flagIndex, 'protect before flag');
});

test('5: parser runs before service invocation', () => {
  const source = readSource('./trendingRoutes.js');
  const parseIndex = source.indexOf('parseTrendingRequest');
  const serviceIndex = source.indexOf('getTrendingSongs');
  assert.ok(parseIndex >= 0 && serviceIndex >= 0);
  assert.ok(parseIndex < serviceIndex);
});

test('6: only one service invocation path exists', () => {
  const source = readSource('./trendingRoutes.js');
  const matches = source.match(/getTrendingSongs\s*\(/g) || [];
  assert.equal(matches.length, 1);
});

test('7: success response is 200 with success and data envelope', () => {
  const source = readSource('./trendingRoutes.js');
  assert.match(source, /res\.status\(200\)\.json\(\{\s*success:\s*true\s*,\s*data\s*\}\)/);
});

test('8: invalid query maps to fixed 400 message', () => {
  const source = readSource('./trendingRoutes.js');
  assert.match(source, /res\.status\(400\)/);
  assert.match(source, /error:\s*parsed\.error/);
  assert.match(source, /parseTrendingRequest/);
});

test('9: disabled maps to fixed 503 message', () => {
  const source = readSource('./trendingRoutes.js');
  assert.match(source, /res\.status\(503\)/);
  assert.match(source, /TRENDING_HTTP_MESSAGES\.disabled/);
});

test('10: failure maps to fixed 500 message without leaking error', () => {
  const source = readSource('./trendingRoutes.js');
  assert.match(source, /res\.status\(500\)/);
  assert.match(source, /TRENDING_HTTP_MESSAGES\.failed/);
  assert.equal(source.includes('error.message'), false);
  assert.equal(source.includes('err.message'), false);
  assert.equal(source.includes('stack'), false);
});

test('11: route does not read user identity for ranking', () => {
  const source = readSource('./trendingRoutes.js');
  assert.equal(source.includes('req.user'), false);
  assert.equal(source.includes('req.body.user'), false);
  assert.equal(source.includes('req.query.user'), false);
  assert.equal(source.includes('userId'), false);
  assert.equal(source.includes('genre'), false);
  assert.equal(source.includes('Favorite'), false);
  assert.equal(source.includes('Playlist'), false);
});

test('12: no PlayHistory import/write', () => {
  const source = readSource('./trendingRoutes.js');
  assert.equal(source.includes('PlayHistory'), false);
});

test('13: no adminOnly and no personalization/ML imports', () => {
  const source = readSource('./trendingRoutes.js');
  assert.equal(source.includes('adminOnly'), false);
  assert.equal(source.includes('userPreference'), false);
  assert.equal(source.includes('explicitPreference'), false);
  assert.equal(source.includes('python'), false);
  assert.equal(source.includes('ml'), false);
});

test('14: server mounts trending router exactly once', () => {
  const source = readSource('../server.js');
  const importCount = (source.match(/import trendingRoutes from/g) || []).length;
  const mountCount = (
    source.match(/app\.use\(\s*['"]\/api\/trending['"]\s*,\s*trendingRoutes\s*\)/g) ||
    []
  ).length;
  assert.equal(importCount, 1);
  assert.equal(mountCount, 1);
  assert.equal(source.includes('/api/trending/trending'), false);
  assert.equal(source.includes('/api/trending/'), false);
});

test('15: no raw Mongoose docs, tokens, or user/session/event ids in route source', () => {
  const source = readSource('./trendingRoutes.js');
  assert.equal(source.includes('token'), false);
  assert.equal(source.includes('session_id'), false);
  assert.equal(source.includes('event_id'), false);
  assert.equal(source.includes('email'), false);
  assert.equal(source.includes('toObject'), false);
});
