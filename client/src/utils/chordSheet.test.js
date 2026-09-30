import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHORD_FORMATS,
  CHORD_IMPORT_MAX_BATCH,
  CHORD_IMPORT_MAX_BYTES,
  CHORD_IMPORT_EXTENSIONS,
  CHORD_STATUSES,
  MAX_CAPO,
  MAX_CHORD_TEXT_LENGTH,
  MAX_TIMELINE_ENTRIES,
  MAX_TRANSPOSE_SEMITONES,
  detectChordFormat,
  findActiveChord,
  isChordLine,
  normalizeChordTimeline,
  normalizeTransposition,
  parseCapo,
  parseChordKey,
  parseChordPro,
  parseChordToken,
  readChordImportFile,
  transposeChord,
  transposeChordLine,
  transposeChordSheet,
  validateChordText,
} from './chordSheet.js';

test('chord sheet constants stay bounded', () => {
  assert.deepEqual(CHORD_FORMATS, ['plain', 'chordpro', 'synced']);
  assert.deepEqual(CHORD_STATUSES, ['verified', 'available', 'unavailable', 'source-found']);
  assert.deepEqual(CHORD_IMPORT_EXTENSIONS, ['cho', 'chordpro', 'txt', 'json']);
  assert.equal(MAX_CAPO, 12);
  assert.equal(MAX_TRANSPOSE_SEMITONES, 12);
  assert.equal(MAX_TIMELINE_ENTRIES, 2000);
  assert.equal(MAX_CHORD_TEXT_LENGTH, 100000);
  assert.equal(CHORD_IMPORT_MAX_BYTES, 65536);
  assert.equal(CHORD_IMPORT_MAX_BATCH, 25);
});

test('parseChordToken accepts roots qualities and bass notes', () => {
  assert.deepEqual(parseChordToken('C'), { root: 'C', rootIndex: 0, quality: '', bass: null, bassIndex: null, usesFlat: false });
  assert.equal(parseChordToken('Am7add9').quality, 'm7add9');
  assert.equal(parseChordToken('C/G').bass, 'G');
  assert.equal(parseChordToken('Bb').rootIndex, 10);
  assert.equal(parseChordToken('Bb').usesFlat, true);
  assert.equal(parseChordToken('C#m/F#').bassIndex, 6);
});

test('parseChordToken rejects non-chords and oversized tokens', () => {
  assert.equal(parseChordToken('Hello'), null);
  assert.equal(parseChordToken(''), null);
  assert.equal(parseChordToken('   '), null);
  assert.equal(parseChordToken(null), null);
  assert.equal(parseChordToken(12), null);
  assert.equal(parseChordToken('x'.repeat(40)), null);
  assert.equal(parseChordToken('|'), null);
});

test('parseChordKey validates keys with bounded length', () => {
  assert.deepEqual(parseChordKey('Am'), { ok: true, key: 'Am' });
  assert.deepEqual(parseChordKey('Bb'), { ok: true, key: 'Bb' });
  assert.deepEqual(parseChordKey(''), { ok: true, key: null });
  assert.deepEqual(parseChordKey(null), { ok: true, key: null });
  assert.equal(parseChordKey('H').ok, false);
  assert.equal(parseChordKey('x'.repeat(9)).ok, false);
  assert.equal(parseChordKey(5).ok, false);
});

test('parseCapo enforces the integer 0..12 range', () => {
  assert.deepEqual(parseCapo(0), { ok: true, capo: 0 });
  assert.deepEqual(parseCapo(12), { ok: true, capo: 12 });
  assert.deepEqual(parseCapo('5'), { ok: true, capo: 5 });
  assert.deepEqual(parseCapo(''), { ok: true, capo: null });
  assert.deepEqual(parseCapo(null), { ok: true, capo: null });
  assert.equal(parseCapo(13).ok, false);
  assert.equal(parseCapo(-1).ok, false);
  assert.equal(parseCapo(2.5).ok, false);
  assert.equal(parseCapo('three').ok, false);
  assert.equal(parseCapo(true).ok, false);
});

test('transposeChord follows the documented note table', () => {
  assert.equal(transposeChord('C', 1), 'C#');
  assert.equal(transposeChord('C#', 1), 'D');
  assert.equal(transposeChord('Bb', 1), 'B');
  assert.equal(transposeChord('F#m', 1), 'Gm');
  assert.equal(transposeChord('C/G', 1), 'C#/G#');
  assert.equal(transposeChord('C', 12), 'C');
  assert.equal(transposeChord('C', -12), 'C');
  assert.equal(transposeChord('C', -1), 'B');
  assert.equal(transposeChord('Bb', 2), 'C');
  assert.equal(transposeChord('Am', -1), 'G#m');
  assert.equal(transposeChord('C', 0), 'C');
});

test('transposeChord refuses out-of-range offsets and invalid chords', () => {
  assert.equal(transposeChord('C', 13), null);
  assert.equal(transposeChord('C', -13), null);
  assert.equal(transposeChord('C', 1.5), null);
  assert.equal(transposeChord('C', '1'), null);
  assert.equal(transposeChord('Hello', 1), null);
});

test('normalizeTransposition clamps display offsets', () => {
  assert.equal(normalizeTransposition(0), 0);
  assert.equal(normalizeTransposition(1.9), 1);
  assert.equal(normalizeTransposition(40), 12);
  assert.equal(normalizeTransposition(-40), -12);
  assert.equal(normalizeTransposition(NaN), 0);
});

test('isChordLine recognises chord rows and skips lyrics', () => {
  assert.equal(isChordLine('C   G   Am  F'), true);
  assert.equal(isChordLine('| C | G | Am |'), true);
  assert.equal(isChordLine('Hello world'), false);
  assert.equal(isChordLine('And then we fall'), false);
  assert.equal(isChordLine(''), false);
  assert.equal(isChordLine('   '), false);
  assert.equal(isChordLine(null), false);
});

test('parseChordPro splits markers into chord segments', () => {
  const parsed = parseChordPro('[C]Hello [G]world');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.lines[0].segments, [
    { chord: null, text: '' },
    { chord: 'C', text: 'Hello ' },
    { chord: 'G', text: 'world' },
  ]);
});

test('parseChordPro rejects unterminated invalid and missing markers', () => {
  assert.equal(parseChordPro('[Clyrics').valid, false);
  assert.equal(parseChordPro('[Hello]lyrics').error, 'Chord marker is invalid');
  assert.equal(parseChordPro('plain text').error, 'Chord sheet has no chord markers');
  assert.equal(parseChordPro('<script>alert(1)</script>').error, 'Chord sheet contains disallowed markup');
  assert.equal(parseChordPro(null).error, 'Chord sheet must be text');
  assert.equal(parseChordPro('x'.repeat(MAX_CHORD_TEXT_LENGTH + 1)).error, 'Chord sheet is too long');
});

test('detectChordFormat only reports chordpro for a valid marker sheet', () => {
  assert.equal(detectChordFormat('[C]Hello [G]world'), 'chordpro');
  assert.equal(detectChordFormat('C  G  Am'), 'plain');
  assert.equal(detectChordFormat('[Hello]lyrics'), 'plain');
  assert.equal(detectChordFormat(''), 'plain');
  assert.equal(detectChordFormat(null), 'plain');
});

test('validateChordText enforces format specific well-formedness', () => {
  assert.deepEqual(validateChordText('C G Am F', 'plain'), { ok: true, error: null });
  assert.equal(validateChordText('just lyrics', 'plain').error, 'Chord sheet has no chord lines');
  assert.deepEqual(validateChordText('[C]Hi', 'chordpro'), { ok: true, error: null });
  assert.equal(validateChordText('[Hello]Hi', 'chordpro').error, 'Chord marker is invalid');
  assert.equal(validateChordText('C G', 'guitarpro').error, 'Invalid chord format');
  assert.equal(validateChordText(12, 'plain').error, 'Chord sheet must be text');
  assert.equal(validateChordText('C '.repeat(50001), 'plain').error, 'Chord sheet is too long');
  assert.equal(validateChordText('<script>alert(1)</script>', 'plain').error, 'Chord sheet contains disallowed markup');
  assert.deepEqual(validateChordText('[C]Hi', 'synced'), { ok: true, error: null });
});

test('transposeChordLine handles chordpro markers and plain chord rows', () => {
  assert.equal(transposeChordLine('[C]Hello [G]world', 1, 'chordpro'), '[C#]Hello [G#]world');
  assert.equal(transposeChordLine('C   G   Am', 1, 'plain'), 'C#   G#   A#m');
  assert.equal(transposeChordLine('Hello world', 1, 'plain'), 'Hello world');
  assert.equal(transposeChordLine('[C]Hello', 0, 'chordpro'), '[C]Hello');
  assert.equal(transposeChordLine('[C]Hello', 13, 'chordpro'), '[C]Hello');
  assert.equal(transposeChordLine('[Hello]x', 1, 'chordpro'), '[Hello]x');
  assert.equal(transposeChordLine(null, 1, 'chordpro'), '');
});

test('transposeChordSheet keeps offset zero and invalid offsets verbatim', () => {
  const sheet = '[C]Hello\n[G]world';
  assert.equal(transposeChordSheet(sheet, 0, 'chordpro'), sheet);
  assert.equal(transposeChordSheet(sheet, 40, 'chordpro'), sheet);
  assert.equal(transposeChordSheet('C\nHello\nG', 1, 'plain'), 'C#\nHello\nG#');
  assert.equal(transposeChordSheet(null, 1, 'plain'), '');
});

test('normalizeChordTimeline sorts entries and rejects malformed input', () => {
  const sorted = normalizeChordTimeline([{ time: 9, chord: 'F' }, { time: 2, chord: 'G' }, { time: 2, chord: 'A' }]);
  assert.equal(sorted.ok, true);
  assert.deepEqual(sorted.entries, [
    { time: 2, chord: 'A' },
    { time: 2, chord: 'G' },
    { time: 9, chord: 'F' },
  ]);
  assert.deepEqual(normalizeChordTimeline(null), { ok: true, entries: [], error: null });
  assert.deepEqual(normalizeChordTimeline([]), { ok: true, entries: [], error: null });
  assert.equal(normalizeChordTimeline('nope').error, 'Chord timeline must be an array');
  assert.equal(normalizeChordTimeline([1]).error, 'Chord timeline entries must be objects');
  assert.equal(normalizeChordTimeline([{ time: -1, chord: 'C' }]).error, 'Chord timeline time is out of range');
  assert.equal(normalizeChordTimeline([{ time: 1e9, chord: 'C' }]).error, 'Chord timeline time is out of range');
  assert.equal(normalizeChordTimeline([{ time: 1, chord: '' }]).error, 'Chord timeline chord is invalid');
  assert.equal(normalizeChordTimeline([{ time: 1, chord: '<script>' }]).error, 'Chord timeline chord is invalid');
  assert.equal(
    normalizeChordTimeline(Array.from({ length: MAX_TIMELINE_ENTRIES + 1 }, (_value, index) => ({ time: index, chord: 'C' }))).error,
    'Chord timeline is too long'
  );
});

test('normalizeChordTimeline does not mutate the input array', () => {
  const input = [{ time: 5, chord: 'G' }, { time: 1, chord: 'C' }];
  normalizeChordTimeline(input);
  assert.deepEqual(input, [{ time: 5, chord: 'G' }, { time: 1, chord: 'C' }]);
});

test('findActiveChord binary searches the timeline', () => {
  const entries = normalizeChordTimeline([
    { time: 0, chord: 'C' },
    { time: 4, chord: 'G' },
    { time: 8, chord: 'Am' },
    { time: 12, chord: 'F' },
  ]).entries;
  assert.equal(findActiveChord(entries, -1), -1);
  assert.equal(findActiveChord(entries, 0), 0);
  assert.equal(findActiveChord(entries, 3.9), 0);
  assert.equal(findActiveChord(entries, 4), 1);
  assert.equal(findActiveChord(entries, 11.99), 2);
  assert.equal(findActiveChord(entries, 1000), 3);
  assert.equal(findActiveChord([], 4), -1);
  assert.equal(findActiveChord('nope', 4), -1);
  assert.equal(findActiveChord(entries, NaN), -1);
});

test('readChordImportFile validates type extension size and content', async () => {
  const valid = await readChordImportFile(
    { name: 'song.cho', size: 12, text: async () => '[C]Hello [G]world' },
    'cho'
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.format, 'chordpro');
  assert.equal(valid.text, '[C]Hello [G]world');

  const plain = await readChordImportFile(
    { name: 'song.txt', size: 12, text: async () => 'C G Am F' },
    'txt'
  );
  assert.equal(plain.ok, true);
  assert.equal(plain.format, 'plain');

  assert.equal((await readChordImportFile({ name: 'song.txt', size: 1, text: async () => 'C' }, 'md')).error, 'Unsupported chord file type');
  assert.equal((await readChordImportFile({ name: 'song.txt', size: 1, text: async () => 'C' }, 'cho')).error, 'File extension does not match');
  assert.equal((await readChordImportFile({ name: 'song.cho', size: CHORD_IMPORT_MAX_BYTES + 1, text: async () => 'C' }, 'cho')).error, 'Chord file is too large');
  assert.equal((await readChordImportFile({ name: 'song.cho', size: 4, text: async () => 'plain lyrics' }, 'cho')).error, 'Chord sheet has no chord lines');
  assert.equal((await readChordImportFile({ name: 'song.cho', size: 4, text: async () => { throw new Error('boom'); } }, 'cho')).error, 'Unable to read chord file');
  assert.equal((await readChordImportFile(null, 'cho')).error, 'Select a chord file to import');
  assert.equal((await readChordImportFile({ name: 'song.cho', size: 1 }, 'cho')).error, 'Select a chord file to import');
});
