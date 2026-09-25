import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_SEARCH_DEFAULT_LIMIT,
  CATALOG_SEARCH_MAX_LIMIT,
  parseCatalogSearchQuery,
} from './catalogSearchRequest.js';

test('parseCatalogSearchQuery accepts minimal valid query', () => {
  const parsed = parseCatalogSearchQuery({ q: 'arnob' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.query, 'arnob');
  assert.equal(parsed.value.limit, CATALOG_SEARCH_DEFAULT_LIMIT);
  assert.equal(parsed.value.includeExternal, true);
  assert.equal(parsed.value.broadenExternal, false);
});

test('parseCatalogSearchQuery rejects unknown keys', () => {
  const parsed = parseCatalogSearchQuery({ q: 'abc', page: '1' });
  assert.equal(parsed.ok, false);
});

test('parseCatalogSearchQuery rejects invalid limit', () => {
  assert.equal(parseCatalogSearchQuery({ q: 'abc', limit: '0' }).ok, false);
  assert.equal(parseCatalogSearchQuery({ q: 'abc', limit: String(CATALOG_SEARCH_MAX_LIMIT + 1) }).ok, false);
  assert.equal(parseCatalogSearchQuery({ q: 'abc', limit: '1.5' }).ok, false);
});

test('parseCatalogSearchQuery accepts bounded limit and region', () => {
  const parsed = parseCatalogSearchQuery({
    q: 'abc',
    limit: String(CATALOG_SEARCH_MAX_LIMIT),
    region: 'bn-bd',
    external: 'false',
    broaden: 'true',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.limit, CATALOG_SEARCH_MAX_LIMIT);
  assert.equal(parsed.value.regionTag, 'bn-bd');
  assert.equal(parsed.value.includeExternal, false);
  assert.equal(parsed.value.broadenExternal, true);
});

test('parseCatalogSearchQuery rejects non-object query', () => {
  assert.equal(parseCatalogSearchQuery(null).ok, false);
  assert.equal(parseCatalogSearchQuery(['q=abc']).ok, false);
  assert.equal(parseCatalogSearchQuery('q=abc').ok, false);
});

test('parseCatalogSearchQuery ignores Vercel rewrite path metadata', () => {
  const parsed = parseCatalogSearchQuery({
    path: 'catalog/search',
    q: 'ed sheeran',
    limit: '40',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.query, 'ed sheeran');
  assert.equal(parsed.value.limit, 40);
  assert.equal(parsed.value.includeExternal, true);
  assert.equal(parsed.value.broadenExternal, false);
  assert.equal(parsed.value.regionTag, undefined);
});

test('parseCatalogSearchQuery ignores repeated Vercel path metadata', () => {
  const parsed = parseCatalogSearchQuery({
    path: ['catalog', 'search'],
    q: 'ed sheeran',
    limit: '40',
    region: 'bn-bd',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.query, 'ed sheeran');
  assert.equal(parsed.value.limit, 40);
  assert.equal(parsed.value.regionTag, 'bn-bd');
});

test('parseCatalogSearchQuery still rejects unknown application keys', () => {
  const parsed = parseCatalogSearchQuery({ q: 'ed sheeran', unexpected: 'x' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'invalid catalog search query');
});

test('parseCatalogSearchQuery does not let path metadata change catalog behavior', () => {
  const withPath = parseCatalogSearchQuery({ path: 'catalog/search', q: 'abc', limit: '5' });
  const withoutPath = parseCatalogSearchQuery({ q: 'abc', limit: '5' });
  assert.equal(withPath.ok, true);
  assert.equal(withoutPath.ok, true);
  assert.deepEqual(withPath.value, withoutPath.value);
});
