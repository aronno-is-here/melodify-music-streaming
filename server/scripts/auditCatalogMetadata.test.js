import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_CATALOG_METADATA_USAGE,
  KNOWN_CASE_TITLE_PATTERNS,
  buildCatalogMetadataAudit,
  parseAuditCatalogMetadataArgs,
  runCatalogMetadataAuditCli,
} from './auditCatalogMetadata.js';

const rows = [
  {
    _id: '6ab8172e551ea0bb04b37d64',
    title: 'Jabo Hariye | Arfin Rumey | \u09DF\u09BE\u09AC\u09CB \u09B9\u09BE\u09B0\u09BF\u09DF\u0987\u0987 | Premer Pothe | Music Video',
    artist: 'Sangeeta Music',
    genre: 'Unknown',
  },
  {
    _id: '6ab93ed37b45defcdfb6b688',
    title: 'Mitwa - Full Video | Shahrukh Khan | Rani Mukherjee | Shafqat Amanat Ali',
    artist: 'Sony Music India',
    genre: 'Unknown',
  },
  {
    _id: '6ab722702fe37579bd0f4bcf',
    title: "Ed Sheeran's Cousin Brands Him a 'Snake' & 'Coward' | Exclusive Interview With Piers Morgan",
    artist: 'Piers Morgan Uncensored',
    genre: 'Unknown',
    recommendation_eligible: true,
  },
  {
    _id: '6aa850ce489bbe39d7336dd3',
    title: 'Perfect',
    artist: 'Ed Sheeran',
    genre: 'Romantic',
  },
];

test('parseAuditCatalogMetadataArgs defaults to the whole catalog', () => {
  assert.deepEqual(parseAuditCatalogMetadataArgs([]), { songIds: [], help: false });
});

test('parseAuditCatalogMetadataArgs accepts bounded song ids', () => {
  const parsed = parseAuditCatalogMetadataArgs(['--song-id', '6aa850ce489bbe39d7336dd3', '--song-id', '6AA850CE489BBE39D7336DD3']);
  assert.deepEqual(parsed, { songIds: ['6aa850ce489bbe39d7336dd3'], help: false });
  assert.deepEqual(parseAuditCatalogMetadataArgs(['--help']), { songIds: [], help: true });
});

test('parseAuditCatalogMetadataArgs rejects malformed input', () => {
  assert.throws(() => parseAuditCatalogMetadataArgs(['--song-id', 'nope']), /Invalid --song-id value/);
  assert.throws(() => parseAuditCatalogMetadataArgs(['--oops']), /Unknown argument/);
  const many = [];
  for (let index = 0; index < 51; index += 1) {
    many.push('--song-id', `6aa850ce489bbe39d7336d${String(index).padStart(2, '0')}`);
  }
  assert.throws(() => parseAuditCatalogMetadataArgs(many), /Too many --song-id values/);
});

test('buildCatalogMetadataAudit buckets findings and repairs', () => {
  const audit = buildCatalogMetadataAudit(rows);

  assert.equal(audit.audited, 4);
  assert.equal(audit.summary.good, 1);
  assert.equal(audit.summary.probableUploaderAsArtist, 3);
  assert.equal(audit.summary.nonMusic, 1);
  assert.equal(audit.summary.ambiguous, 1);
  assert.deepEqual(audit.songIds.probableUploaderAsArtist, [
    '6ab8172e551ea0bb04b37d64',
    '6ab93ed37b45defcdfb6b688',
    '6ab722702fe37579bd0f4bcf',
  ]);
  assert.ok(audit.songIds.noisyTitle.includes('6ab8172e551ea0bb04b37d64'));
  assert.deepEqual(audit.songIds.nonMusic, ['6ab722702fe37579bd0f4bcf']);
  assert.deepEqual(audit.songIds.ambiguous, ['6ab93ed37b45defcdfb6b688']);
  assert.ok(audit.songIds.highConfidenceRepair.includes('6ab8172e551ea0bb04b37d64'));
  assert.equal(audit.repairs.length, 2);
  assert.equal(audit.review.length, 2);
  assert.equal(audit.repairs[0].changes.length > 0, true);
});

test('buildCatalogMetadataAudit surfaces the named known cases only', () => {
  const audit = buildCatalogMetadataAudit(rows);
  const titles = audit.knownCases.map((entry) => entry.title);
  assert.equal(titles.length, 3);
  assert.ok(titles.some((title) => title.includes('Jabo Hariye')));
  assert.ok(titles.some((title) => title.includes('Mitwa')));
  assert.ok(titles.some((title) => title.includes('Piers Morgan')));
  assert.equal(new Set(KNOWN_CASE_TITLE_PATTERNS).size, 6);
  const jabo = audit.knownCases.find((entry) => entry.songId === '6ab8172e551ea0bb04b37d64');
  assert.equal(jabo.uploaderLevel, 'HIGH');
  assert.equal(jabo.repairConfidence, 'HIGH');
  assert.ok(jabo.changes.some((change) => change.field === 'artist' && change.to === 'Arfin Rumey'));
});

test('runCatalogMetadataAuditCli writes a bounded success payload', async () => {
  const written = [];
  const code = await runCatalogMetadataAuditCli({
    argv: [],
    writeOut: (line) => written.push(line),
    writeErr: () => {},
    connect: async () => {},
    findSongs: async (songIds) => {
      assert.deepEqual(songIds, []);
      return rows;
    },
    disconnect: async () => {},
  });
  assert.equal(code, 0);
  const payload = JSON.parse(written.join('\n'));
  assert.equal(payload.success, true);
  assert.equal(payload.usage, AUDIT_CATALOG_METADATA_USAGE);
  assert.equal(payload.audited, 4);
  assert.ok(!written.join('\n').includes('lyrics:'));
});

test('runCatalogMetadataAuditCli reports usage for --help', async () => {
  const written = [];
  let connected = false;
  const code = await runCatalogMetadataAuditCli({
    argv: ['--help'],
    writeOut: (line) => written.push(line),
    writeErr: () => {},
    connect: async () => { connected = true; },
    findSongs: async () => rows,
    disconnect: async () => {},
  });
  assert.equal(code, 0);
  assert.equal(written[0], AUDIT_CATALOG_METADATA_USAGE);
  assert.equal(connected, false);
});

test('runCatalogMetadataAuditCli fails closed on bad arguments', async () => {
  const errors = [];
  const code = await runCatalogMetadataAuditCli({
    argv: ['--song-id', 'bad'],
    writeOut: () => {},
    writeErr: (line) => errors.push(line),
    connect: async () => {},
    findSongs: async () => rows,
    disconnect: async () => {},
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(errors.join('\n')).success, false);
});
