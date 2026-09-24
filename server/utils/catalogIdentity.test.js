import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSourceProvider,
  normalizeExternalId,
  buildCatalogIdentity,
  getCatalogIdentityFromSongLike,
  getLegacyYoutubeLookupId,
} from './catalogIdentity.js';

test('provider normalization trims whitespace', () => {
  assert.equal(normalizeSourceProvider(' \tyoutube\n'), 'youtube');
});

test('provider normalization lowercases names', () => {
  assert.equal(normalizeSourceProvider('YouTube'), 'youtube');
});

test('external IDs are trimmed and retain case and provider-specific punctuation', () => {
  assert.equal(normalizeExternalId(' \tdQw4w9WgXcQ\n'), 'dQw4w9WgXcQ');
  assert.equal(normalizeExternalId(' Catalog:Ab/C-123 '), 'Catalog:Ab/C-123');
});

test('empty and whitespace-only providers are unavailable', () => {
  for (const value of ['', ' ', '\t\n']) {
    assert.equal(normalizeSourceProvider(value), null);
    assert.equal(buildCatalogIdentity(value, 'id'), null);
  }
});

test('empty and whitespace-only external IDs are unavailable', () => {
  for (const value of ['', ' ', '\t\n']) {
    assert.equal(normalizeExternalId(value), null);
    assert.equal(buildCatalogIdentity('provider', value), null);
  }
});

test('non-string components fail safely without coercing nested objects', () => {
  const noCoercion = { toString() { throw new Error('must not coerce'); } };
  for (const value of [undefined, null, 0, 1, true, NaN, [], ['id'], {}, { nested: 'id' }, noCoercion, Symbol('id'), 1n, () => 'id']) {
    assert.equal(normalizeSourceProvider(value), null);
    assert.equal(normalizeExternalId(value), null);
    assert.equal(buildCatalogIdentity(value, 'id'), null);
    assert.equal(buildCatalogIdentity('provider', value), null);
  }
});

test('normalized components have bounded lengths and are never truncated', () => {
  assert.equal(normalizeSourceProvider(` ${'P'.repeat(128)} `), 'p'.repeat(128));
  assert.equal(normalizeExternalId(` ${'I'.repeat(256)} `), 'I'.repeat(256));
  assert.equal(normalizeSourceProvider('p'.repeat(129)), null);
  assert.equal(normalizeExternalId('i'.repeat(257)), null);
  assert.equal(buildCatalogIdentity('p'.repeat(129), 'id'), null);
  assert.equal(buildCatalogIdentity('provider', 'i'.repeat(257)), null);
  // Lowercasing can expand Unicode strings; bound the normalized result too.
  assert.equal(normalizeSourceProvider('\u0130'.repeat(128)), null);
});

test('equivalent normalized inputs produce the same deterministic identity', () => {
  const identity = buildCatalogIdentity(' YouTube ', ' dQw4w9WgXcQ ');
  assert.equal(identity, buildCatalogIdentity('youtube', 'dQw4w9WgXcQ'));
  assert.deepEqual(JSON.parse(identity), ['youtube', 'dQw4w9WgXcQ']);
});

test('different providers, external IDs, and external-ID case remain distinct', () => {
  const identities = [
    buildCatalogIdentity('youtube', 'Abc'),
    buildCatalogIdentity('youtube', 'Def'),
    buildCatalogIdentity('youtube', 'abc'),
    buildCatalogIdentity('other-provider', 'Abc'),
  ];
  assert.equal(new Set(identities).size, identities.length);
});

test('identity encoding cannot collide through delimiters, quotes, or escapes', () => {
  assert.notEqual(buildCatalogIdentity('ab', 'c:d'), buildCatalogIdentity('ab:c', 'd'));
  assert.notEqual(buildCatalogIdentity('ab', 'c","d'), buildCatalogIdentity('ab","c', 'd'));
  assert.deepEqual(JSON.parse(buildCatalogIdentity('a\\b', 'c"\nd')), ['a\\b', 'c"\nd']);
});

test('song-like identity uses only explicit provider and external ID', () => {
  assert.equal(getCatalogIdentityFromSongLike({
    source_provider: ' Other ', external_id: ' ExplicitId ', youtube_id: 'legacyId',
  }), buildCatalogIdentity('other', 'ExplicitId'));
  for (const input of [
    { youtube_id: 'legacyId' },
    { source_provider: 'youtube', youtube_id: 'legacyId' },
    { external_id: 'ExplicitId', youtube_id: 'legacyId' },
    { source_provider: '', external_id: 'ExplicitId', youtube_id: 'legacyId' },
    { source_provider: { nested: 'youtube' }, external_id: 'ExplicitId' },
    { source_provider: 'youtube', external_id: ['ExplicitId'] },
  ]) {
    assert.equal(getCatalogIdentityFromSongLike(input), null);
  }
});

test('song-like helpers reject malformed top-level input', () => {
  for (const input of [undefined, null, 'id', 1, true, [], ['id'], Symbol('id'), () => 'id']) {
    assert.equal(getCatalogIdentityFromSongLike(input), null);
    assert.equal(getLegacyYoutubeLookupId(input), null);
  }
});

test('legacy YouTube lookup trims a non-empty ID without changing its case', () => {
  assert.equal(getLegacyYoutubeLookupId({ youtube_id: ' dQw4w9WgXcQ ' }), 'dQw4w9WgXcQ');
});

test('legacy YouTube lookup rejects missing, empty, malformed, or overlong IDs', () => {
  assert.equal(getLegacyYoutubeLookupId({ source_provider: 'youtube', external_id: 'id' }), null);
  for (const youtube_id of [undefined, null, '', ' \t\n', 1, true, [], {}, { id: 'id' }, 'x'.repeat(257)]) {
    assert.equal(getLegacyYoutubeLookupId({ youtube_id }), null);
  }
});

test('helpers do not mutate or reclassify their input', () => {
  for (const input of [
    { youtube_id: ' LegacyId ' },
    { source_provider: ' YouTube ', external_id: ' ExplicitId ', youtube_id: ' LegacyId ' },
  ]) {
    const before = { ...input };
    Object.freeze(input);
    getCatalogIdentityFromSongLike(input);
    getLegacyYoutubeLookupId(input);
    assert.deepEqual(input, before);
  }
});
