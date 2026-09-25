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
