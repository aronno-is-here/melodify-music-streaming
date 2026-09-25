import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCatalogSyncRequest,
  CATALOG_SYNC_DEFAULT_MAX_RESULTS,
  CATALOG_SYNC_MAX_RESULTS_LIMIT,
} from './catalogSyncRequest.js';

test('28: missing query rejected', () => {
  const result = parseCatalogSyncRequest({});
  assert.equal(result.ok, false);
  assert.match(result.error, /query/);
});

test('29: non-string query rejected', () => {
  for (const query of [42, null, undefined, ['a'], { q: 'a' }, true]) {
    if (query === undefined) continue;
    const result = parseCatalogSyncRequest({ query });
    assert.equal(result.ok, false, JSON.stringify(query));
  }
  const missing = parseCatalogSyncRequest(Object.create(null));
  assert.equal(missing.ok, false);
});

test('30: empty query rejected', () => {
  for (const query of ['', '   ', '\t\n']) {
    const result = parseCatalogSyncRequest({ query });
    assert.equal(result.ok, false);
    assert.match(result.error, /query/);
  }
});

test('31: overlong query rejected', () => {
  const result = parseCatalogSyncRequest({ query: 'a'.repeat(201) });
  assert.equal(result.ok, false);
  assert.match(result.error, /query/);
  const atLimit = parseCatalogSyncRequest({ query: 'a'.repeat(200) });
  assert.equal(atLimit.ok, true);
});

test('32: maxResults default = 5', () => {
  const result = parseCatalogSyncRequest({ query: 'hello' });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxResults, CATALOG_SYNC_DEFAULT_MAX_RESULTS);
  assert.equal(result.value.maxResults, 5);
});

test('33: maxResults 1 accepted', () => {
  const result = parseCatalogSyncRequest({ query: 'hello', maxResults: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxResults, 1);
});

test('34: maxResults 10 accepted', () => {
  const result = parseCatalogSyncRequest({ query: 'hello', maxResults: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxResults, 10);
  assert.equal(result.value.maxResults, CATALOG_SYNC_MAX_RESULTS_LIMIT);
});

test('35: maxResults 11 rejected', () => {
  const result = parseCatalogSyncRequest({ query: 'hello', maxResults: 11 });
  assert.equal(result.ok, false);
  assert.match(result.error, /maxResults/);
});

test('36: non-integer maxResults rejected', () => {
  for (const maxResults of [1.5, '5', NaN, Infinity, -1, 0, {}, []]) {
    const result = parseCatalogSyncRequest({ query: 'hello', maxResults });
    assert.equal(result.ok, false, JSON.stringify(maxResults));
    assert.match(result.error, /maxResults/);
  }
});

test('37: genre trimmed', () => {
  const result = parseCatalogSyncRequest({ query: 'hello', genre: '  Pop  ' });
  assert.equal(result.ok, true);
  assert.equal(result.value.genre, 'Pop');
});

test('38: empty genre becomes absent', () => {
  for (const genre of ['', '   ']) {
    const result = parseCatalogSyncRequest({ query: 'hello', genre });
    assert.equal(result.ok, true);
    assert.equal('genre' in result.value, false);
  }
});

test('39: language trimmed', () => {
  const result = parseCatalogSyncRequest({ query: 'hello', language: '  bn  ' });
  assert.equal(result.ok, true);
  assert.equal(result.value.language, 'bn');
});

test('40: empty language becomes absent', () => {
  for (const language of ['', '   ']) {
    const result = parseCatalogSyncRequest({ query: 'hello', language });
    assert.equal(result.ok, true);
    assert.equal('language' in result.value, false);
  }
});

test('41: arbitrary extra Song fields never reach upsert context', () => {
  const result = parseCatalogSyncRequest({
    query: 'hello',
    genre: 'Pop',
    language: 'en',
    title: 'Injected',
    artist: 'Injected',
    lyrics: 'Injected',
    chords: 'Injected',
    source_provider: 'vimeo',
    external_id: 'evil',
    recommendation_score: 99,
    user_id: 'user-1',
    pageToken: 'next',
    videoId: 'abc',
    _id: 'evil-id',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['genre', 'language', 'maxResults', 'query']);
  assert.equal(result.value.query, 'hello');
});

test('non-object body rejected', () => {
  for (const body of [null, undefined, 'x', 42, [], true]) {
    if (body === undefined) continue;
    const result = parseCatalogSyncRequest(body);
    assert.equal(result.ok, false, JSON.stringify(body));
  }
});

test('non-string genre and language rejected', () => {
  assert.equal(parseCatalogSyncRequest({ query: 'a', genre: 42 }).ok, false);
  assert.equal(parseCatalogSyncRequest({ query: 'a', language: ['bn'] }).ok, false);
});

test('overlong genre and language rejected', () => {
  assert.equal(parseCatalogSyncRequest({ query: 'a', genre: 'g'.repeat(129) }).ok, false);
  assert.equal(parseCatalogSyncRequest({ query: 'a', language: 'l'.repeat(65) }).ok, false);
});
