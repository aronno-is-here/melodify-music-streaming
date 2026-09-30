import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHORD_IMPORT_EXTENSIONS,
  CHORD_JSON_FIELDS,
  CHORD_JSON_MESSAGES,
  MAX_CHORD_TEXT_LENGTH,
  parseChordJsonDocument,
  readChordImportFile,
} from './chordSheet.js';

const jsonFile = (text, name = 'song.json', size) => ({
  name,
  size: size === undefined ? text.length : size,
  text: async () => text,
});

test('json chord import is a bounded supported extension', () => {
  assert.deepEqual(CHORD_IMPORT_EXTENSIONS, ['cho', 'chordpro', 'txt', 'json']);
  assert.ok(CHORD_JSON_FIELDS.includes('text'));
  assert.ok(CHORD_JSON_FIELDS.includes('timeline'));
  assert.equal(Object.isFrozen(CHORD_JSON_FIELDS), true);
});

test('malformed json rejects with a fixed admin-facing message', () => {
  const result = parseChordJsonDocument('{"text": "[C]Hi"');
  assert.equal(result.ok, false);
  assert.equal(result.error, CHORD_JSON_MESSAGES.INVALID_JSON);
  assert.equal(/\bat\s|Error:|stack/i.test(result.error), false);
});

test('non object json roots are rejected', () => {
  assert.equal(parseChordJsonDocument('42').error, CHORD_JSON_MESSAGES.INVALID_JSON);
  assert.equal(parseChordJsonDocument('"chords"').error, CHORD_JSON_MESSAGES.INVALID_JSON);
  assert.equal(parseChordJsonDocument('null').error, CHORD_JSON_MESSAGES.INVALID_JSON);
});

test('unknown json fields are rejected', () => {
  const result = parseChordJsonDocument(JSON.stringify({ text: '[C]Hi', price: 10 }));
  assert.equal(result.ok, false);
  assert.equal(result.error, CHORD_JSON_MESSAGES.UNKNOWN_FIELD);
});

test('prototype pollution style keys are rejected without mutating prototypes', () => {
  const result = parseChordJsonDocument('{"__proto__": {"polluted": true}, "text": "[C]Hi"}');
  assert.equal(result.ok, false);
  assert.equal(result.error, CHORD_JSON_MESSAGES.UNKNOWN_FIELD);
  assert.equal({}.polluted, undefined);
  const ctor = parseChordJsonDocument('{"constructor": {"prototype": {}}, "text": "[C]Hi"}');
  assert.equal(ctor.ok, false);
});

test('canonical chord document validates and normalizes every supported field', () => {
  const result = parseChordJsonDocument(JSON.stringify({
    text: '[Am]Hello [G]world',
    format: 'chordpro',
    key: 'Am',
    capo: 3,
    tuning: 'Standard',
    notes: '  transcribed by ear  ',
    verified: true,
    source: 'db_verified',
    sourceUrl: 'https://example.com/chords',
    verifiedBy: 'admin-1',
    timeline: [
      { time: 9, chord: 'F' },
      { time: 2, chord: 'G' },
    ],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.text, '[Am]Hello [G]world');
  assert.equal(result.format, 'chordpro');
  assert.equal(result.key, 'Am');
  assert.equal(result.capo, 3);
  assert.equal(result.tuning, 'Standard');
  assert.equal(result.notes, 'transcribed by ear');
  assert.equal(result.verified, true);
  assert.equal(result.verifiedProvided, true);
  assert.equal(result.source, 'db_verified');
  assert.equal(result.sourceUrl, 'https://example.com/chords');
  assert.equal(result.verifiedBy, 'admin-1');
  assert.deepEqual(result.timeline, [
    { time: 2, chord: 'G' },
    { time: 9, chord: 'F' },
  ]);
});

test('existing chords and chord_timeline aliases normalize to the canonical form', () => {
  const result = parseChordJsonDocument(JSON.stringify({
    chords: '[C]Hi [G]there',
    chord_timeline: [{ time: 0, chord: 'C' }],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.text, '[C]Hi [G]there');
  assert.deepEqual(result.timeline, [{ time: 0, chord: 'C' }]);
});

test('providing both alias spellings is rejected as ambiguous', () => {
  assert.equal(parseChordJsonDocument('{"text":"[C]Hi","chords":"[G]Hi"}').error, CHORD_JSON_MESSAGES.INVALID_JSON);
  assert.equal(parseChordJsonDocument('{"timeline":[],"chord_timeline":[]}').error, CHORD_JSON_MESSAGES.INVALID_JSON);
});

test('a bare timeline array is accepted as a timed chord document', () => {
  const result = parseChordJsonDocument('[{"time":0,"chord":"Am"},{"time":4,"chord":"Dm"}]');
  assert.equal(result.ok, true);
  assert.equal(result.text, '');
  assert.equal(result.format, 'plain');
  assert.deepEqual(result.timeline, [
    { time: 0, chord: 'Am' },
    { time: 4, chord: 'Dm' },
  ]);
});

test('plain chord sheets with unicode bangla lyrics are accepted', () => {
  const sheet = [
    'Am              Dm',
    'তোমার চোখে চেয়ে দেখি আমি জীবনটাকে',
    '',
    'G               C',
    'ভালোবাসার স্মৃতিগুলো মনে পড়ে',
  ].join('\n');
  const result = parseChordJsonDocument(JSON.stringify({ text: sheet, format: 'plain' }));
  assert.equal(result.ok, true);
  assert.equal(result.format, 'plain');
  assert.equal(result.text.includes('তোমার চোখে'), true);
});

test('chordpro markers with crlf line endings are accepted', () => {
  const result = parseChordJsonDocument(JSON.stringify({ text: '[Am] line one\r\n[Dm] line two\r\n' }));
  assert.equal(result.ok, true);
  assert.equal(result.format, 'chordpro');
});

test('format detection stays automatic when the document omits format', () => {
  const result = parseChordJsonDocument(JSON.stringify({ text: '[C]Hello [G]world' }));
  assert.equal(result.ok, true);
  assert.equal(result.format, 'chordpro');
});

test('unknown declared formats are rejected', () => {
  assert.equal(parseChordJsonDocument('{"text":"C G","format":"guitarpro"}').error, 'Invalid chords format');
});

test('invalid keys capos sources and verification flags are rejected', () => {
  assert.equal(parseChordJsonDocument('{"text":"C G","key":"H"}').error, 'Invalid chords key');
  assert.equal(parseChordJsonDocument('{"text":"C G","capo":13}').error, 'Invalid chords capo');
  assert.equal(parseChordJsonDocument('{"text":"C G","source":"magic"}').error, 'Invalid chords source');
  assert.equal(parseChordJsonDocument('{"text":"C G","verified":"yes"}').error, 'Invalid chords verification flag');
  assert.equal(parseChordJsonDocument('{"text":"C G","sourceUrl":"javascript:alert(1)"}').error, 'Invalid chord source URL');
  assert.equal(parseChordJsonDocument('{"text":"C G","notes":123}').error, 'Invalid chords notes');
});

test('negative and non finite timestamps are rejected', () => {
  assert.equal(
    parseChordJsonDocument('[{"time":-1,"chord":"C"}]').error,
    'Chord timeline time is out of range',
  );
  assert.equal(
    parseChordJsonDocument('[{"time":1e999,"chord":"C"}]').error,
    'Chord timeline time is out of range',
  );
});

test('excessive timeline entries are rejected without truncation', () => {
  const oversized = Array.from({ length: 2001 }, (_value, index) => ({ time: index, chord: 'C' }));
  const result = parseChordJsonDocument(JSON.stringify({ timeline: oversized }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Chord timeline is too long');
  assert.equal(result.timeline.length, 0);
});

test('documents without any chord content are rejected', () => {
  assert.equal(parseChordJsonDocument('{}').error, CHORD_JSON_MESSAGES.NO_CONTENT);
  assert.equal(parseChordJsonDocument('{"text":"   ",' + '"timeline":[]}').error, CHORD_JSON_MESSAGES.NO_CONTENT);
});

test('oversized raw json documents are rejected before parsing', () => {
  const oversized = 'x'.repeat(MAX_CHORD_TEXT_LENGTH + 1);
  assert.equal(parseChordJsonDocument(oversized).error, 'Chord sheet is too long');
});

test('readChordImportFile accepts a valid json chord file with its document', async () => {
  const body = JSON.stringify({ text: '[C]Hello [G]world', capo: 2 });
  const result = await readChordImportFile(jsonFile(body), 'json');
  assert.equal(result.ok, true);
  assert.equal(result.text, '[C]Hello [G]world');
  assert.equal(result.format, 'chordpro');
  assert.equal(result.doc.capo, 2);
});

test('readChordImportFile rejects malformed unsupported mismatched and oversized json files', async () => {
  assert.equal((await readChordImportFile(jsonFile('{bad'), 'json')).error, CHORD_JSON_MESSAGES.INVALID_JSON);
  assert.equal((await readChordImportFile(jsonFile('{"text":"[C]Hi"}'), 'md')).error, 'Unsupported chord file type');
  assert.equal((await readChordImportFile(jsonFile('{"text":"[C]Hi"}', 'song.txt'), 'json')).error, 'File extension does not match');
  assert.equal(
    (await readChordImportFile(jsonFile('{"text":"[C]Hi"}', 'song.json', 65537), 'json')).error,
    'Chord file is too large',
  );
});

test('readChordImportFile keeps text formats free of json documents', async () => {
  const result = await readChordImportFile(jsonFile('Am   Dm\nlyrics line', 'song.txt'), 'txt');
  assert.equal(result.ok, true);
  assert.equal(result.doc, null);
});
