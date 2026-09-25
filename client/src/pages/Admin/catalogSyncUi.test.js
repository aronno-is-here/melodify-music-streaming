import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalogSyncPayload,
  formatCatalogSyncStatus,
  mapCatalogSyncError,
  CATALOG_SYNC_DEFAULT_MAX_RESULTS,
  CATALOG_SYNC_MAX_RESULTS,
  CATALOG_SYNC_DISABLED_MESSAGE,
  CATALOG_SYNC_UPSTREAM_MESSAGE,
  CATALOG_SYNC_GENERIC_MESSAGE,
} from './catalogSyncUi.js';

test('1: trims query', () => {
  const result = buildCatalogSyncPayload({ query: '  hello world  ' });
  assert.equal(result.ok, true);
  assert.equal(result.payload.query, 'hello world');
});

test('2: rejects empty query', () => {
  for (const query of ['', '   ', '\t\n']) {
    const result = buildCatalogSyncPayload({ query });
    assert.equal(result.ok, false);
    assert.match(result.error, /query/i);
  }
  assert.equal(buildCatalogSyncPayload({}).ok, false);
  assert.equal(buildCatalogSyncPayload({ query: 42 }).ok, false);
});

test('3: rejects query >200', () => {
  const overlong = buildCatalogSyncPayload({ query: 'a'.repeat(201) });
  assert.equal(overlong.ok, false);
  const atLimit = buildCatalogSyncPayload({ query: 'a'.repeat(200) });
  assert.equal(atLimit.ok, true);
  assert.equal(atLimit.payload.query.length, 200);
});

test('4: omits blank genre', () => {
  for (const genre of ['', '   ', undefined, null]) {
    const result = buildCatalogSyncPayload({ query: 'hello', genre });
    assert.equal(result.ok, true);
    assert.equal(Object.hasOwn(result.payload, 'genre'), false, JSON.stringify(genre));
  }
});

test('5: omits blank language', () => {
  for (const language of ['', '   ', undefined, null]) {
    const result = buildCatalogSyncPayload({ query: 'hello', language });
    assert.equal(result.ok, true);
    assert.equal(Object.hasOwn(result.payload, 'language'), false, JSON.stringify(language));
  }
});

test('6: maxResults default/validation', () => {
  const defaults = buildCatalogSyncPayload({ query: 'hello' });
  assert.equal(defaults.ok, true);
  assert.equal(defaults.payload.maxResults, CATALOG_SYNC_DEFAULT_MAX_RESULTS);
  assert.equal(defaults.payload.maxResults, 5);

  const one = buildCatalogSyncPayload({ query: 'hello', maxResults: 1 });
  assert.equal(one.ok, true);
  assert.equal(one.payload.maxResults, 1);

  const ten = buildCatalogSyncPayload({ query: 'hello', maxResults: 10 });
  assert.equal(ten.ok, true);
  assert.equal(ten.payload.maxResults, 10);

  for (const bad of [0, -1, 1.5, 'abc', NaN, Infinity, {}, []]) {
    const result = buildCatalogSyncPayload({ query: 'hello', maxResults: bad });
    assert.equal(result.ok, false, JSON.stringify(bad));
  }
});

test('7: maxResults >10 rejected', () => {
  const result = buildCatalogSyncPayload({ query: 'hello', maxResults: 11 });
  assert.equal(result.ok, false);
  assert.match(result.error, /max/i);
  assert.equal(buildCatalogSyncPayload({ query: 'hello', maxResults: CATALOG_SYNC_MAX_RESULTS + 1 }).ok, false);
});

test('8: only allowed payload fields emitted', () => {
  const result = buildCatalogSyncPayload({
    query: 'hello',
    genre: 'Pop',
    language: 'en',
    maxResults: 7,
    title: 'Injected',
    artist: 'Injected',
    lyrics: 'Injected',
    source_provider: 'vimeo',
    external_id: 'evil',
    user_id: 'u1',
    pageToken: 'next',
    api_key: 'AIzaEvil',
    _id: 'evil',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.payload).sort(), ['genre', 'language', 'maxResults', 'query']);
  assert.equal(result.payload.query, 'hello');
  assert.equal(result.payload.maxResults, 7);
  assert.equal(result.payload.genre, 'Pop');
  assert.equal(result.payload.language, 'en');
});

test('9: status formatting deterministic', () => {
  assert.equal(formatCatalogSyncStatus('inserted'), 'Inserted');
  assert.equal(formatCatalogSyncStatus('updated'), 'Updated');
  assert.equal(formatCatalogSyncStatus('adopted-legacy'), 'Adopted legacy');
  assert.equal(formatCatalogSyncStatus('skipped'), 'Skipped');
  assert.equal(formatCatalogSyncStatus('conflict'), 'Conflict');
  assert.equal(formatCatalogSyncStatus('persistence-failed'), 'Persistence failed');
  assert.equal(formatCatalogSyncStatus('ineligible'), 'Ineligible');
  assert.equal(formatCatalogSyncStatus('ambiguous-legacy-match'), 'Ambiguous legacy match');
  assert.equal(formatCatalogSyncStatus('inserted'), formatCatalogSyncStatus('inserted'));
  assert.equal(formatCatalogSyncStatus(null), '—');
  assert.equal(formatCatalogSyncStatus(''), '—');
  assert.equal(formatCatalogSyncStatus(undefined), '—');
  assert.equal(formatCatalogSyncStatus(42), '—');
});

test('10: 503 maps to disabled message', () => {
  assert.equal(
    mapCatalogSyncError({ success: false, error: 'Catalog synchronization is disabled' }, 503),
    CATALOG_SYNC_DISABLED_MESSAGE,
  );
  assert.equal(
    mapCatalogSyncError({ success: false, error: 'Catalog synchronization is disabled' }),
    CATALOG_SYNC_DISABLED_MESSAGE,
  );
  assert.equal(mapCatalogSyncError(null, 503), CATALOG_SYNC_DISABLED_MESSAGE);
});

test('11: 502 maps to upstream unavailable', () => {
  assert.equal(
    mapCatalogSyncError({ success: false, error: 'Catalog synchronization failed' }, 502),
    CATALOG_SYNC_UPSTREAM_MESSAGE,
  );
  assert.equal(
    mapCatalogSyncError({ success: false, error: 'Catalog synchronization failed' }),
    CATALOG_SYNC_UPSTREAM_MESSAGE,
  );
  assert.equal(mapCatalogSyncError(null, 502), CATALOG_SYNC_UPSTREAM_MESSAGE);
});

test('12: 500 maps to generic failure', () => {
  assert.equal(
    mapCatalogSyncError({ success: false, error: 'Internal server error' }, 500),
    CATALOG_SYNC_GENERIC_MESSAGE,
  );
  assert.equal(mapCatalogSyncError({ success: false, error: 'Internal server error' }), CATALOG_SYNC_GENERIC_MESSAGE);
  assert.equal(mapCatalogSyncError(null, 500), CATALOG_SYNC_GENERIC_MESSAGE);
});

test('13: unknown error does not expose raw object', () => {
  const nested = {
    success: false,
    error: { message: 'secret stack', code: 'E11000', key: 'AIzaSySecret' },
  };
  const mapped = mapCatalogSyncError(nested);
  assert.equal(mapped, CATALOG_SYNC_GENERIC_MESSAGE);
  assert.equal(mapped.includes('AIza'), false);
  assert.equal(mapped.includes('E11000'), false);
  assert.equal(mapped.includes('secret'), false);

  const weird = mapCatalogSyncError({ success: false, error: ['array', { a: 1 }] });
  assert.equal(weird, CATALOG_SYNC_GENERIC_MESSAGE);

  const stackLike = mapCatalogSyncError({
    success: false,
    error: 'TypeError: boom\n    at Object.<anonymous> (file.js:1:1)',
  });
  assert.equal(stackLike, CATALOG_SYNC_GENERIC_MESSAGE);

  assert.equal(mapCatalogSyncError('not-an-object'), CATALOG_SYNC_GENERIC_MESSAGE);
  assert.equal(mapCatalogSyncError(null), CATALOG_SYNC_GENERIC_MESSAGE);
  assert.equal(mapCatalogSyncError(undefined), CATALOG_SYNC_GENERIC_MESSAGE);
});

test('14: input values not mutated', () => {
  const values = {
    query: '  hello  ',
    genre: '  Pop  ',
    language: '  en  ',
    maxResults: 5,
    extra: 'keep-me',
  };
  const before = structuredClone(values);
  const result = buildCatalogSyncPayload(values);
  assert.equal(result.ok, true);
  assert.deepEqual(values, before);

  const statusInput = 'adopted-legacy';
  formatCatalogSyncStatus(statusInput);
  assert.equal(statusInput, 'adopted-legacy');

  const errorInput = { success: false, error: 'Catalog synchronization is disabled' };
  const errorBefore = structuredClone(errorInput);
  mapCatalogSyncError(errorInput);
  assert.deepEqual(errorInput, errorBefore);
});

test('safe 400 validation messages are preserved', () => {
  assert.equal(
    mapCatalogSyncError({ success: false, error: 'query is required and must be a string' }),
    'query is required and must be a string',
  );
  assert.equal(
    mapCatalogSyncError({ success: false, error: 'maxResults must be between 1 and 10' }),
    'maxResults must be between 1 and 10',
  );
});

test('trims optional genre and language', () => {
  const result = buildCatalogSyncPayload({
    query: 'hello',
    genre: '  Hip-Hop  ',
    language: '  Bangla  ',
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.genre, 'Hip-Hop');
  assert.equal(result.payload.language, 'Bangla');
});

test('rejects overlong genre and language', () => {
  assert.equal(buildCatalogSyncPayload({ query: 'a', genre: 'g'.repeat(129) }).ok, false);
  assert.equal(buildCatalogSyncPayload({ query: 'a', language: 'l'.repeat(65) }).ok, false);
});
