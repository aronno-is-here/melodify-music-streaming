import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogContentSummary, parseAuditCatalogArgs } from './auditCatalogContent.js';

test('parseAuditCatalogArgs uses defaults', () => {
  assert.deepEqual(parseAuditCatalogArgs([]), { sampleLimit: 25 });
});

test('parseAuditCatalogArgs accepts bounded sample limit', () => {
  assert.deepEqual(parseAuditCatalogArgs(['--sample-limit', '40']), { sampleLimit: 40 });
});

test('parseAuditCatalogArgs rejects unknown flags and invalid limits', () => {
  assert.throws(() => parseAuditCatalogArgs(['--oops']), /Unknown argument/);
  assert.throws(() => parseAuditCatalogArgs(['--sample-limit', '-1']), /Invalid --sample-limit value/);
  assert.throws(() => parseAuditCatalogArgs(['--sample-limit', '500']), /Invalid --sample-limit value/);
});

test('buildCatalogContentSummary counts lyrics and chord coverage plus samples', () => {
  const songs = [
    {
      _id: 'a',
      title: 'Song A',
      artist: 'Artist A',
      lyrics: 'Line',
      chords: '',
      lyrics_verified: true,
      chords_verified: false,
      lyrics_source: 'db_verified',
      chords_source: 'none',
      regional_tag: 'bn-bd',
      source_provider: 'youtube',
      external_id: 'x1',
    },
    {
      _id: 'b',
      title: 'Song B',
      artist: 'Artist B',
      lyrics: '',
      chords: '',
      lyrics_verified: false,
      chords_verified: false,
      lyrics_source: 'none',
      chords_source: 'none',
      regional_tag: '',
      source_provider: '',
      external_id: '',
    },
  ];

  const summary = buildCatalogContentSummary(songs, { sampleLimit: 1 });

  assert.equal(summary.totalSongs, 2);
  assert.equal(summary.withLyrics, 1);
  assert.equal(summary.withChords, 0);
  assert.equal(summary.withNeither, 1);
  assert.equal(summary.withVerifiedLyrics, 1);
  assert.equal(summary.importedSongs, 1);
  assert.equal(summary.byRegionTag['bn-bd'], 1);
  assert.equal(summary.byRegionTag.none, 1);
  assert.equal(summary.sampleMissingContent.length, 1);
  assert.equal(summary.sampleMissingContent[0].title, 'Song B');
});
