import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTrendingRequest,
  DEFAULT_TRENDING_API_LIMIT,
  MAX_TRENDING_API_LIMIT,
  TRENDING_HTTP_MESSAGES,
} from './trendingRequest.js';

test('1: missing query defaults to limit 10', () => {
  const result = parseTrendingRequest(undefined);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { limit: DEFAULT_TRENDING_API_LIMIT });
  assert.equal(DEFAULT_TRENDING_API_LIMIT, 10);
});

test('2: empty object defaults to limit 10', () => {
  const result = parseTrendingRequest({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { limit: 10 });
});

test('3: limit=1 accepted', () => {
  const result = parseTrendingRequest({ limit: '1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { limit: 1 });
});

test('4: limit=50 accepted at max', () => {
  const result = parseTrendingRequest({ limit: '50' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { limit: 50 });
  assert.equal(MAX_TRENDING_API_LIMIT, 50);
});

test('5: limit=10 accepted', () => {
  const result = parseTrendingRequest({ limit: '10' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { limit: 10 });
});

test('6: limit=0 rejected', () => {
  const result = parseTrendingRequest({ limit: '0' });
  assert.equal(result.ok, false);
  assert.equal(result.error, TRENDING_HTTP_MESSAGES.invalidQuery);
});

test('7: limit=51 rejected above max', () => {
  const result = parseTrendingRequest({ limit: '51' });
  assert.equal(result.ok, false);
});

test('8: limit=1.5 rejected fractional', () => {
  assert.equal(parseTrendingRequest({ limit: '1.5' }).ok, false);
});

test('9: limit=-1 rejected negative', () => {
  assert.equal(parseTrendingRequest({ limit: '-1' }).ok, false);
});

test('10: limit=01x rejected non-numeric suffix', () => {
  assert.equal(parseTrendingRequest({ limit: '01x' }).ok, false);
});

test('11: limit=Infinity rejected', () => {
  assert.equal(parseTrendingRequest({ limit: 'Infinity' }).ok, false);
});

test('12: limit=NaN rejected', () => {
  assert.equal(parseTrendingRequest({ limit: 'NaN' }).ok, false);
});

test('13: empty string limit rejected', () => {
  assert.equal(parseTrendingRequest({ limit: '' }).ok, false);
});

test('14: whitespace limit rejected', () => {
  assert.equal(parseTrendingRequest({ limit: '  ' }).ok, false);
  assert.equal(parseTrendingRequest({ limit: ' 5' }).ok, false);
  assert.equal(parseTrendingRequest({ limit: '5 ' }).ok, false);
});

test('15: non-string limit rejected', () => {
  assert.equal(parseTrendingRequest({ limit: 5 }).ok, false);
  assert.equal(parseTrendingRequest({ limit: null }).ok, false);
  assert.equal(parseTrendingRequest({ limit: true }).ok, false);
  assert.equal(parseTrendingRequest({ limit: NaN }).ok, false);
  assert.equal(parseTrendingRequest({ limit: Infinity }).ok, false);
  assert.equal(parseTrendingRequest({ limit: 1.5 }).ok, false);
});

test('16: array limit rejected', () => {
  assert.equal(parseTrendingRequest({ limit: ['10'] }).ok, false);
  assert.equal(parseTrendingRequest({ limit: [] }).ok, false);
});

test('17: object limit rejected', () => {
  assert.equal(parseTrendingRequest({ limit: { value: '10' } }).ok, false);
});

test('18: unknown user/userId keys rejected', () => {
  assert.equal(parseTrendingRequest({ user: 'x' }).ok, false);
  assert.equal(parseTrendingRequest({ userId: 'x' }).ok, false);
  assert.equal(parseTrendingRequest({ limit: '10', user: 'x' }).ok, false);
});

test('19: unknown ranking/pagination keys rejected', () => {
  for (const key of [
    'genre', 'language', 'artist', 'page', 'pageToken', 'sort',
    'weights', 'window', 'halfLife',
  ]) {
    assert.equal(parseTrendingRequest({ [key]: '1' }).ok, false, key);
    assert.equal(parseTrendingRequest({ limit: '5', [key]: '1' }).ok, false, key);
  }
});

test('20: input not mutated and output contains only limit', () => {
  const query = { limit: '7' };
  const snapshot = { ...query };
  const result = parseTrendingRequest(query);
  assert.equal(result.ok, true);
  assert.deepEqual(query, snapshot);
  assert.deepEqual(Object.keys(result.value), ['limit']);
  assert.equal(result.value.limit, 7);

  const empty = {};
  const emptyResult = parseTrendingRequest(empty);
  assert.deepEqual(Object.keys(emptyResult.value), ['limit']);
  assert.deepEqual(empty, {});
});
