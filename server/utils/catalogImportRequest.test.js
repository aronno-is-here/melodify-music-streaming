import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_IMPORT_ALLOWED_FIELDS,
  parseCatalogImportRequest,
} from './catalogImportRequest.js';

test('parseCatalogImportRequest accepts valid minimal payload', () => {
  const parsed = parseCatalogImportRequest({
    provider: 'youtube',
    providerTrackId: 'Fn6Ul6sYqro',
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    provider: 'youtube',
    providerTrackId: 'Fn6Ul6sYqro',
  });
});

test('parseCatalogImportRequest lowercases provider and trims text fields', () => {
  const parsed = parseCatalogImportRequest({
    provider: '  YouTube  ',
    providerTrackId: '  Fn6Ul6sYqro ',
    regionTag: 'hi-in',
    genre: ' Pop ',
    language: ' en ',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.provider, 'youtube');
  assert.equal(parsed.value.providerTrackId, 'Fn6Ul6sYqro');
  assert.equal(parsed.value.regionTag, 'hi-in');
  assert.equal(parsed.value.genre, 'Pop');
  assert.equal(parsed.value.language, 'en');
});

test('parseCatalogImportRequest rejects unknown fields', () => {
  const parsed = parseCatalogImportRequest({
    provider: 'youtube',
    providerTrackId: 'Fn6Ul6sYqro',
    nope: true,
  });
  assert.equal(parsed.ok, false);
});

test('parseCatalogImportRequest rejects missing provider/providerTrackId', () => {
  assert.equal(parseCatalogImportRequest({ providerTrackId: 'x' }).ok, false);
  assert.equal(parseCatalogImportRequest({ provider: 'youtube' }).ok, false);
});

test('allowed fields list stays strict', () => {
  assert.deepEqual(CATALOG_IMPORT_ALLOWED_FIELDS, [
    'provider',
    'providerTrackId',
    'regionTag',
    'genre',
    'language',
  ]);
});
