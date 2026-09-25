import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegionalImportArgs, runRegionalCatalogImport } from './importRegionalCatalog.js';

test('parseRegionalImportArgs requires region and provides region hint fallback query', () => {
  const parsed = parseRegionalImportArgs(['--region', 'bn-bd']);
  assert.equal(parsed.regionTag, 'bn-bd');
  assert.ok(parsed.query.length > 0);
  assert.equal(parsed.searchLimit, 10);
  assert.equal(parsed.importLimit, 10);
  assert.equal(parsed.dryRun, false);
});

test('parseRegionalImportArgs supports bounded limits and dry run', () => {
  const parsed = parseRegionalImportArgs([
    '--region', 'hi-in',
    '--query', 'latest hindi songs',
    '--search-limit', '12',
    '--import-limit', '6',
    '--dry-run',
  ]);
  assert.equal(parsed.regionTag, 'hi-in');
  assert.equal(parsed.query, 'latest hindi songs');
  assert.equal(parsed.searchLimit, 12);
  assert.equal(parsed.importLimit, 6);
  assert.equal(parsed.dryRun, true);
});

test('parseRegionalImportArgs rejects invalid input', () => {
  assert.throws(() => parseRegionalImportArgs([]), /Invalid or missing --region value/);
  assert.throws(() => parseRegionalImportArgs(['--region', 'xx']), /Invalid or missing --region value/);
  assert.throws(() => parseRegionalImportArgs(['--region', 'en', '--search-limit', '0']), /Invalid --search-limit value/);
  assert.throws(() => parseRegionalImportArgs(['--region', 'en', '--import-limit', '999']), /Invalid --import-limit value/);
  assert.throws(() => parseRegionalImportArgs(['--region', 'en', '--oops']), /Unknown argument/);
});

test('runRegionalCatalogImport imports bounded external candidates and records failures', async () => {
  const seen = [];
  const summary = await runRegionalCatalogImport({
    searchCatalog: async () => ({
      externalState: 'ready',
      localResults: [{ sourceType: 'local', song: { _id: 'local1' } }],
      externalResults: [
        { sourceType: 'external', provider: 'youtube', providerTrackId: 'abc', title: 'A', artist: 'AA' },
        { sourceType: 'external', provider: 'youtube', providerTrackId: 'def', title: 'B', artist: 'BB' },
        { sourceType: 'external', provider: 'youtube', providerTrackId: 'ghi', title: 'C', artist: 'CC' },
      ],
    }),
    importProviderTrack: async ({ providerTrackId }) => {
      seen.push(providerTrackId);
      if (providerTrackId === 'def') throw new Error('provider unavailable');
      return { status: providerTrackId === 'ghi' ? 'existing' : 'inserted', song: { _id: providerTrackId } };
    },
    options: {
      regionTag: 'en',
      query: 'english songs',
      genre: '',
      language: '',
      searchLimit: 10,
      importLimit: 2,
      dryRun: false,
    },
  });

  assert.deepEqual(seen, ['abc', 'def']);
  assert.equal(summary.importAttempted, 2);
  assert.equal(summary.counters.inserted, 1);
  assert.equal(summary.counters.existing, 0);
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.imported.length, 1);
});

test('runRegionalCatalogImport dry run does not call importer', async () => {
  let importCalls = 0;
  const summary = await runRegionalCatalogImport({
    searchCatalog: async () => ({
      externalState: 'ready',
      localResults: [],
      externalResults: [{ sourceType: 'external', provider: 'youtube', providerTrackId: 'z1' }],
    }),
    importProviderTrack: async () => {
      importCalls += 1;
      return { status: 'inserted', song: { _id: 'z1' } };
    },
    options: {
      regionTag: 'bn-bd',
      query: 'bangla songs',
      genre: '',
      language: '',
      searchLimit: 10,
      importLimit: 10,
      dryRun: true,
    },
  });

  assert.equal(importCalls, 0);
  assert.equal(summary.imported[0].status, 'dry-run');
});
