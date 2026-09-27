import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BULK_IMPORT_ERROR_MESSAGES,
  BULK_IMPORT_FIELDS,
  BULK_IMPORT_REJECTION_REASONS,
  MAX_BULK_IMPORT_BYTES,
  MAX_BULK_LYRICS_ENTRIES,
  detectBulkImportFormat,
  parseBulkImport,
  parseBulkCsv,
  parseBulkJson,
  readBoundedImportText,
  validateBulkEntries,
} from './bulkLyricsImport.js';

const SONG_ID = '64b64b64b64b64b64b64b640';

test('exported bulk limits are bounded and documented', () => {
  assert.equal(MAX_BULK_LYRICS_ENTRIES, 500);
  assert.equal(MAX_BULK_IMPORT_BYTES, 786432);
  assert.ok(MAX_BULK_IMPORT_BYTES < 2097152);
  assert.deepEqual(BULK_IMPORT_FIELDS, [
    'songId',
    'title',
    'artist',
    'language',
    'lyrics',
    'sourceUrl',
    'sourceProvider',
    'notes',
  ]);
});

test('format detection only accepts .csv and .json', () => {
  assert.equal(detectBulkImportFormat('songs.csv'), 'csv');
  assert.equal(detectBulkImportFormat('songs.JSON'), 'json');
  assert.equal(detectBulkImportFormat('songs.txt'), null);
  assert.equal(detectBulkImportFormat('songs'), null);
});

test('CSV parsing handles quoted fields, escaped quotes and CRLF', () => {
  const csv = 'songId,language,lyrics,sourceUrl\r\n'
    + `"${SONG_ID}","hindi","Line one, line two","https://example.com/a""b"\r\n`;
  const parsed = parseBulkImport({ text: csv, fileName: 'songs.csv' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].songId, SONG_ID);
  assert.equal(parsed.entries[0].lyrics, 'Line one, line two');
  assert.equal(parsed.entries[0].sourceUrl, 'https://example.com/a%22b');
});

test('CSV parsing rejects an unterminated quoted field', () => {
  const parsed = parseBulkCsv(`songId,lyrics\n${SONG_ID},"unterminated`);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, BULK_IMPORT_ERROR_MESSAGES.MALFORMED_CSV);
});

test('CSV parsing requires a songId column', () => {
  const parsed = parseBulkCsv('title,lyrics\nAnything,words');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, BULK_IMPORT_ERROR_MESSAGES.MISSING_HEADER);
});

test('JSON parsing accepts a bare array and an entries envelope', () => {
  const bare = parseBulkImport({
    text: JSON.stringify([{ songId: SONG_ID, lyrics: 'hello' }]),
    fileName: 'songs.json',
  });
  assert.equal(bare.ok, true);
  assert.equal(bare.format, 'json');
  assert.equal(bare.entries[0].songId, SONG_ID);

  const envelope = parseBulkJson(JSON.stringify({ entries: [{ songId: SONG_ID, lyrics: 'hello' }] }));
  assert.equal(envelope.ok, true);
  assert.equal(envelope.entries.length, 1);
});

test('JSON parsing rejects malformed payloads', () => {
  assert.equal(parseBulkJson('{ not json').ok, false);
  assert.equal(parseBulkJson('{"songId":"x"}').ok, false);
  assert.equal(parseBulkJson('[]').error, BULK_IMPORT_ERROR_MESSAGES.MISSING_ENTRIES);
});

test('batch size above the ceiling is rejected', () => {
  const entries = Array.from({ length: MAX_BULK_LYRICS_ENTRIES + 1 }, (_, index) => ({
    songId: SONG_ID,
    lyrics: `line ${index}`,
  }));
  const parsed = parseBulkImport({ text: JSON.stringify(entries), fileName: 'songs.json' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, BULK_IMPORT_ERROR_MESSAGES.TOO_MANY_ENTRIES);
});

test('entry validation rejects structurally invalid rows with reasons', () => {
  const { entries, invalid } = validateBulkEntries([
    'not-an-object',
    { lyrics: 'missing id' },
    { songId: '   ', lyrics: 'x' },
    { songId: 'not an id!', lyrics: 'x' },
    { songId: SONG_ID },
    { songId: SONG_ID, lyrics: '' },
    { songId: SONG_ID, lyrics: 'ok', language: 12 },
    { songId: SONG_ID, lyrics: 'ok', sourceUrl: 'javascript:alert(1)' },
    { songId: SONG_ID, lyrics: 'ok', notes: 'n'.repeat(2000) },
    { songId: SONG_ID, lyrics: 'ok', title: 'T' },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(invalid.length, 9);
  assert.equal(invalid[0].reason, BULK_IMPORT_REJECTION_REASONS.NOT_AN_OBJECT);
  assert.equal(invalid[1].reason, BULK_IMPORT_REJECTION_REASONS.MISSING_SONG_ID);
  assert.equal(invalid[3].reason, BULK_IMPORT_REJECTION_REASONS.INVALID_SONG_ID);
  assert.equal(invalid[4].reason, BULK_IMPORT_REJECTION_REASONS.MISSING_LYRICS);
  assert.equal(invalid[6].reason, BULK_IMPORT_REJECTION_REASONS.INVALID_LANGUAGE);
  assert.equal(invalid[7].reason, BULK_IMPORT_REJECTION_REASONS.INVALID_SOURCE_URL);
  assert.equal(invalid[8].reason, BULK_IMPORT_REJECTION_REASONS.INVALID_TEXT_FIELD);
});

test('valid entries are normalized with surrounding whitespace removed', () => {
  const { entries, invalid } = validateBulkEntries([
    {
      songId: ` ${SONG_ID} `,
      lyrics: '\n  Line one  \n',
      language: ' hindi ',
      sourceUrl: ' https://example.com/lyrics ',
      notes: ' checked ',
    },
  ]);
  assert.equal(invalid.length, 0);
  assert.equal(entries[0].songId, SONG_ID);
  assert.equal(entries[0].lyrics, 'Line one');
  assert.equal(entries[0].language, 'hindi');
  assert.equal(entries[0].notes, 'checked');
  assert.equal(entries[0].sourceUrl, 'https://example.com/lyrics');
});

test('readBoundedImportText enforces empty, size and encoding limits', () => {
  assert.equal(readBoundedImportText(Buffer.alloc(0)).error, BULK_IMPORT_ERROR_MESSAGES.EMPTY_FILE);
  assert.equal(
    readBoundedImportText(Buffer.alloc(MAX_BULK_IMPORT_BYTES + 1)).error,
    BULK_IMPORT_ERROR_MESSAGES.FILE_TOO_LARGE,
  );
  assert.equal(
    readBoundedImportText(Buffer.from([0xff, 0xfe, 0x41])).error,
    BULK_IMPORT_ERROR_MESSAGES.INVALID_ENCODING,
  );
  const ok = readBoundedImportText(Buffer.from('a\r\nb'));
  assert.equal(ok.ok, true);
  assert.equal(ok.text, 'a\nb');
});

test('unknown import formats are rejected', () => {
  const parsed = parseBulkImport({ text: 'anything', fileName: 'songs.txt' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, BULK_IMPORT_ERROR_MESSAGES.INVALID_FORMAT);
});
