import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPAIR_CATALOG_METADATA_USAGE,
  REPAIRABLE_FIELDS,
  REPAIR_ERROR_MESSAGES,
  buildCatalogRepairPlan,
  formatCatalogRepairPlan,
  parseRepairCatalogArgs,
  runCatalogRepairCli,
} from './repairCatalogMetadata.js';

const JABO = '6ab8172e551ea0bb04b37d64';
const MITWA = '6ab93ed37b45defcdfb6b688';
const PIERS = '6ab722702fe37579bd0f4bcf';
const PERFECT = '6aa850ce489bbe39d7336dd3';

const rows = [
  {
    _id: JABO,
    title: 'Jabo Hariye | Arfin Rumey | \u09DF\u09BE\u09AC\u09CB \u09B9\u09BE\u09B0\u09BF\u09DF\u0987\u0987 | Premer Pothe | Music Video',
    artist: 'Sangeeta Music',
    genre: 'Unknown',
  },
  {
    _id: MITWA,
    title: 'Mitwa - Full Video | Shahrukh Khan | Rani Mukherjee | Shafqat Amanat Ali',
    artist: 'Sony Music India',
    genre: 'Unknown',
  },
  {
    _id: PIERS,
    title: "Ed Sheeran's Cousin Brands Him a 'Snake' & 'Coward' | Exclusive Interview With Piers Morgan",
    artist: 'Piers Morgan Uncensored',
    genre: 'Unknown',
    recommendation_eligible: true,
  },
  {
    _id: PERFECT,
    title: 'Perfect',
    artist: 'Ed Sheeran',
    genre: 'Romantic',
  },
];

test('parseRepairCatalogArgs requires explicit song ids', () => {
  assert.deepEqual(
    parseRepairCatalogArgs(['--song-id', JABO]),
    { songIds: [JABO], apply: false, help: false }
  );
  assert.deepEqual(
    parseRepairCatalogArgs(['--song-id', JABO.toUpperCase(), '--apply']),
    { songIds: [JABO], apply: true, help: false }
  );
  assert.throws(() => parseRepairCatalogArgs([]), new RegExp(REPAIR_ERROR_MESSAGES.missingSongId));
  assert.throws(() => parseRepairCatalogArgs(['--song-id', 'nope']), new RegExp(REPAIR_ERROR_MESSAGES.invalidSongId));
  assert.throws(() => parseRepairCatalogArgs(['--apply']), new RegExp(REPAIR_ERROR_MESSAGES.missingSongId));
  assert.throws(() => parseRepairCatalogArgs(['--song-id', JABO, '--oops']), /Unknown argument/);
  assert.deepEqual(parseRepairCatalogArgs(['--help']), { songIds: [], apply: false, help: true });
});

test('buildCatalogRepairPlan only accepts explicit catalog rows', () => {
  assert.throws(
    () => buildCatalogRepairPlan(rows, { songIds: ['000000000000000000000000'] }),
    new RegExp(REPAIR_ERROR_MESSAGES.unknownSong)
  );
  const plan = buildCatalogRepairPlan(rows, { songIds: [JABO] });
  assert.deepEqual(plan.songIds, [JABO]);
  assert.ok(plan.changes.length > 0);
  for (const change of plan.changes) {
    assert.ok(REPAIRABLE_FIELDS.includes(change.field));
    assert.equal(change.songId, JABO);
  }
});

test('buildCatalogRepairPlan applies only HIGH confidence repairs', () => {
  const plan = buildCatalogRepairPlan(rows, { songIds: [JABO, MITWA, PIERS, PERFECT] });
  const bySong = new Map();
  for (const change of plan.changes) {
    bySong.set(change.songId, (bySong.get(change.songId) || 0) + 1);
  }
  assert.equal(bySong.get(JABO), 3);
  assert.equal(bySong.has(MITWA), false);
  assert.equal(bySong.has(PERFECT), false);
  assert.equal(bySong.get(PIERS), 1);

  const jaboArtist = plan.changes.find((change) => change.songId === JABO && change.field === 'artist');
  assert.equal(jaboArtist.to, 'Arfin Rumey');
  const jaboTitle = plan.changes.find((change) => change.songId === JABO && change.field === 'title');
  assert.equal(jaboTitle.to, 'Jabo Hariye');
  const piersEligibility = plan.changes.find((change) => change.songId === PIERS);
  assert.equal(piersEligibility.field, 'recommendation_eligible');
  assert.equal(piersEligibility.to, false);
});

test('buildCatalogRepairPlan keeps ambiguous rows review only', () => {
  const plan = buildCatalogRepairPlan(rows, { songIds: [MITWA] });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.review.length, 1);
  assert.equal(plan.review[0].songId, MITWA);
  assert.equal(plan.review[0].confidence, 'LOW');
});

test('formatCatalogRepairPlan prints old and new values', () => {
  const plan = buildCatalogRepairPlan(rows, { songIds: [JABO] });
  const text = formatCatalogRepairPlan(plan).join('\n');
  assert.match(text, /mode: dry-run/);
  assert.match(text, new RegExp(`songs: 1`));
  assert.match(text, new RegExp(`${JABO} artist:`));
  assert.match(text, /"Sangeeta Music" -> "Arfin Rumey"/);
  const applied = formatCatalogRepairPlan(plan, { apply: true }).join('\n');
  assert.match(applied, /mode: apply/);
});

test('runCatalogRepairCli dry run never writes', async () => {
  const written = [];
  let applied = 0;
  const code = await runCatalogRepairCli({
    argv: ['--song-id', JABO],
    writeOut: (line) => written.push(String(line)),
    writeErr: () => {},
    connect: async () => {},
    findSongs: async (songIds) => rows.filter((row) => songIds.includes(String(row._id))),
    applyChanges: async () => { applied += 1; return { updated: 0, fields: 0 }; },
    disconnect: async () => {},
  });
  assert.equal(code, 0);
  assert.equal(applied, 0);
  assert.match(written.join('\n'), /dry-run/);
  assert.match(written.join('\n'), /artist:/);
});

test('runCatalogRepairCli apply writes approved changes only', async () => {
  const written = [];
  const seen = [];
  const code = await runCatalogRepairCli({
    argv: ['--song-id', JABO, '--apply'],
    writeOut: (line) => written.push(String(line)),
    writeErr: () => {},
    connect: async () => {},
    findSongs: async (songIds) => rows.filter((row) => songIds.includes(String(row._id))),
    applyChanges: async (changes) => {
      seen.push(...changes);
      return { updated: 1, fields: changes.length };
    },
    disconnect: async () => {},
  });
  assert.equal(code, 0);
  assert.equal(seen.length, 3);
  for (const change of seen) {
    assert.ok(REPAIRABLE_FIELDS.includes(change.field));
  }
  assert.match(written.join('\n'), /"applied":true/);
});

test('runCatalogRepairCli apply skips writes when nothing qualifies', async () => {
  const written = [];
  let applied = 0;
  const code = await runCatalogRepairCli({
    argv: ['--song-id', PERFECT, '--apply'],
    writeOut: (line) => written.push(String(line)),
    writeErr: () => {},
    connect: async () => {},
    findSongs: async (songIds) => rows.filter((row) => songIds.includes(String(row._id))),
    applyChanges: async () => { applied += 1; return { updated: 0, fields: 0 }; },
    disconnect: async () => {},
  });
  assert.equal(code, 0);
  assert.equal(applied, 0);
  assert.match(written.join('\n'), /no approved changes to apply/);
});

test('runCatalogRepairCli fails closed on unknown song ids', async () => {
  const errors = [];
  const code = await runCatalogRepairCli({
    argv: ['--song-id', '000000000000000000000000', '--apply'],
    writeOut: () => {},
    writeErr: (line) => errors.push(String(line)),
    connect: async () => {},
    findSongs: async () => rows,
    applyChanges: async () => ({ updated: 0, fields: 0 }),
    disconnect: async () => {},
  });
  assert.equal(code, 1);
  assert.match(JSON.parse(errors.join('\n')).error, /not present in the catalog/);
});

test('usage string documents the guarded apply flag', () => {
  assert.match(REPAIR_CATALOG_METADATA_USAGE, /--song-id <song-id>/);
  assert.match(REPAIR_CATALOG_METADATA_USAGE, /\[--apply\]/);
});
