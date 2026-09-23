import assert from 'node:assert/strict';
import test from 'node:test';
import Song from './Song.js';

const legacySong = {
  title: 'Example Song',
  artist: 'Example Artist',
  genre: 'Bengali',
  youtube_id: 'example1234',
  file_path: '',
  poster_url: 'https://example.com/poster.jpg',
  duration: '4:05',
  release_date: new Date('2020-01-01T00:00:00.000Z'),
  lyrics: 'Example lyrics',
  chords: 'C G',
};

const metadataTypes = {
  language: 'String',
  category: 'String',
  duration_seconds: 'Number',
  normalized_artist: 'String',
  normalized_genre: 'String',
  source_provider: 'String',
  external_id: 'String',
  recommendation_eligible: 'Boolean',
  metadata_provenance: 'Embedded',
  metadata_refreshed_at: 'Date',
};

test('legacy songs remain valid with all existing fields preserved', () => {
  const song = new Song(legacySong);
  assert.equal(song.validateSync(), undefined);
  for (const [field, value] of Object.entries(legacySong)) {
    assert.deepEqual(song.get(field), value, field);
  }
  assert.equal(Song.schema.options.timestamps, true);
  assert.equal(Song.schema.path('createdAt').instance, 'Date');
  assert.equal(Song.schema.path('updatedAt').instance, 'Date');

  const minimal = new Song({ title: 'Upload', artist: 'Artist', genre: 'Rock' });
  assert.equal(minimal.validateSync(), undefined);
  assert.equal(minimal.duration, '3:00');
  assert.equal(minimal.youtube_id, '');
  assert.equal(minimal.file_path, '');
});

test('new paths are optional and excluded from normal query projections', () => {
  for (const [field, type] of Object.entries(metadataTypes)) {
    const path = Song.schema.path(field);
    assert.ok(path, field);
    assert.equal(path.instance, type, field);
    assert.notEqual(path.isRequired, true, field);
    assert.equal(path.options.select, false, field);
  }
});

test('unknown metadata is not inferred from existing fields on construction or hydration', () => {
  for (const song of [new Song(legacySong), Song.hydrate(legacySong)]) {
    assert.equal(song.validateSync(), undefined);
    for (const field of Object.keys(metadataTypes)) {
      if (field !== 'recommendation_eligible') assert.equal(song.get(field), undefined, field);
    }
    assert.equal(song.recommendation_eligible, true);
  }
});

test('recommendation eligibility defaults to true but permits explicit exclusion', () => {
  const song = new Song({ ...legacySong, recommendation_eligible: false });
  assert.equal(song.validateSync(), undefined);
  assert.equal(song.recommendation_eligible, false);
});

for (const value of [undefined, null, 0, 245.5]) {
  test(`duration_seconds accepts ${String(value)}`, () => {
    const song = new Song({ ...legacySong, duration_seconds: value });
    assert.equal(song.validateSync(), undefined);
    assert.equal(song.duration_seconds, value);
  });
}

for (const value of [-1, NaN, Infinity, -Infinity]) {
  test(`duration_seconds rejects ${String(value)}`, () => {
    const song = new Song({ ...legacySong, duration_seconds: value });
    const error = song.validateSync();
    assert.ok(error?.errors.duration_seconds);
  });
}

test('display duration and numeric duration remain independent', () => {
  const song = new Song({ ...legacySong, duration_seconds: 10 });
  assert.equal(Song.schema.path('duration').instance, 'String');
  assert.equal(song.duration, '4:05');
  song.duration_seconds = 20;
  assert.equal(song.duration, '4:05');
  song.duration = '5:00';
  assert.equal(song.duration_seconds, 20);
  assert.equal(song.validateSync(), undefined);
});

test('text metadata is trimmed without changing original artist or genre', () => {
  const metadata = {
    language: 'bn',
    category: 'Music',
    normalized_artist: 'example artist',
    normalized_genre: 'rock',
    source_provider: 'catalog-provider',
    external_id: 'external-001',
  };
  const padded = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, ` ${value} `]));
  const song = new Song({ ...legacySong, ...padded });
  assert.equal(song.validateSync(), undefined);
  for (const [field, value] of Object.entries(metadata)) {
    assert.equal(song.get(field), value, field);
  }
  assert.equal(song.artist, legacySong.artist);
  assert.equal(song.genre, legacySong.genre);
});

test('optional metadata accepts explicit null values', () => {
  const metadata = Object.fromEntries(Object.keys(metadataTypes).map((field) => [field, null]));
  const song = new Song({ ...legacySong, ...metadata });
  assert.equal(song.validateSync(), undefined);
});

test('provenance retains only its fixed fields and explicit timestamps', () => {
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const song = new Song({
    ...legacySong,
    metadata_provenance: {
      source: ' catalog-api ',
      reference: ' import-001 ',
      imported_at: timestamp,
      raw_response: { arbitrary: { nested: 'payload' } },
    },
    metadata_refreshed_at: timestamp,
  });
  assert.equal(song.validateSync(), undefined);
  assert.deepEqual(song.metadata_provenance.toObject(), {
    source: 'catalog-api',
    reference: 'import-001',
    imported_at: timestamp,
  });
  assert.deepEqual(song.metadata_refreshed_at, timestamp);
});

test('provenance labels are bounded and do not generate timestamps', () => {
  const song = new Song({ ...legacySong, metadata_provenance: { source: 'manual' } });
  assert.equal(song.validateSync(), undefined);
  assert.equal(song.metadata_provenance.imported_at, undefined);
  assert.equal(song.metadata_refreshed_at, undefined);
  for (const [field, length] of [['source', 129], ['reference', 257]]) {
    const invalid = new Song({ ...legacySong, metadata_provenance: { [field]: 'x'.repeat(length) } });
    assert.ok(invalid.validateSync()?.errors[`metadata_provenance.${field}`]);
  }
});

test('Song schema adds no indexes or unique identity constraints', () => {
  assert.deepEqual(Song.schema.indexes(), []);
  assert.notEqual(Song.schema.path('youtube_id').options.unique, true);
  assert.notEqual(Song.schema.path('external_id').options.unique, true);
});
