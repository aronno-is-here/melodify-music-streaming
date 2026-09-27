import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRICS_SCRIPT,
  detectLyricsScript,
  romanizeLines,
  romanizeText,
  withScriptPresentation,
} from './lyricsRomanization.js';

test('detectLyricsScript identifies devanagari, bengali, latin, and other', () => {
  assert.equal(detectLyricsScript('तुम ही हो'), LYRICS_SCRIPT.DEVANAGARI);
  assert.equal(detectLyricsScript('বাংলা গান'), LYRICS_SCRIPT.BENGALI);
  assert.equal(detectLyricsScript('Comfortably Numb'), LYRICS_SCRIPT.LATIN);
  assert.equal(detectLyricsScript(''), LYRICS_SCRIPT.OTHER);
  assert.equal(detectLyricsScript('你好'), LYRICS_SCRIPT.OTHER);
});

test('detectLyricsScript keeps latin-dominant text as latin', () => {
  assert.equal(detectLyricsScript('Hello दोस्तों this is English'), LYRICS_SCRIPT.LATIN);
});

test('romanizeText converts hindi lyrics to readable romanized text', () => {
  assert.equal(romanizeText('तुम ही हो'), 'tum hi ho');
  assert.equal(romanizeText('कैसे बताएं'), 'kaise bataen');
});

test('romanizeText converts bengali lyrics to readable romanized text', () => {
  assert.equal(romanizeText('বাংলা গান'), 'bangla gan');
  assert.equal(romanizeText('আমি তোমাকে ভালোবাসি'), 'ami tomake bhalobasi');
});

test('romanizeText leaves english and other scripts unchanged', () => {
  assert.equal(romanizeText('Comfortably Numb'), null);
  assert.equal(romanizeText(''), null);
});

test('romanizeText preserves embedded latin runs inside hindi text', () => {
  assert.equal(romanizeText('Hello दोस्तों'), 'Hello doston');
});

test('romanizeLines keeps synced timestamps and original line objects untouched', () => {
  const original = [
    { time: 1.5, text: 'तुम ही हो' },
    { time: 5.25, text: 'कैसे बताएं' },
  ];
  const romanized = romanizeLines(original, LYRICS_SCRIPT.DEVANAGARI);
  assert.notEqual(romanized, original);
  assert.equal(romanized[0].time, 1.5);
  assert.equal(romanized[0].text, 'tum hi ho');
  assert.equal(romanized[1].time, 5.25);
  assert.equal(romanized[1].text, 'kaise bataen');
  assert.equal(original[0].text, 'तुम ही हो');
});

test('withScriptPresentation defaults hindi to romanized display lines', () => {
  const lines = [{ time: null, text: 'तुम ही हो' }];
  const result = withScriptPresentation({
    source: 'verified-db',
    status: 'verified',
    synced: false,
    lines,
    plain: 'तुम ही हो',
    match: null,
    provider: null,
  });
  assert.equal(result.script, LYRICS_SCRIPT.DEVANAGARI);
  assert.equal(result.romanizedLines[0].text, 'tum hi ho');
  assert.equal(result.displayLines, result.romanizedLines);
  assert.equal(result.lines[0].text, 'तुम ही हो');
});

test('withScriptPresentation keeps bengali original as default display lines', () => {
  const lines = [{ time: null, text: 'বাংলা গান' }];
  const result = withScriptPresentation({
    source: 'verified-db',
    status: 'verified',
    synced: false,
    lines,
    plain: 'বাংলা গান',
    match: null,
    provider: null,
  });
  assert.equal(result.script, LYRICS_SCRIPT.BENGALI);
  assert.ok(result.romanizedLines);
  assert.equal(result.romanizedLines[0].text, 'bangla gan');
  assert.equal(result.displayLines, result.lines);
  assert.equal(result.displayLines[0].text, 'বাংলা গান');
});

test('withScriptPresentation leaves english payload presentation unchanged', () => {
  const lines = [{ time: null, text: 'Comfortably Numb' }];
  const result = withScriptPresentation({
    source: 'verified-db',
    status: 'verified',
    synced: false,
    lines,
    plain: 'Comfortably Numb',
    match: null,
    provider: null,
  });
  assert.equal(result.script, LYRICS_SCRIPT.LATIN);
  assert.equal(result.romanizedLines, null);
  assert.equal(result.displayLines, result.lines);
});

test('withScriptPresentation handles empty lines safely', () => {
  const result = withScriptPresentation({
    source: 'unavailable',
    status: 'unavailable',
    synced: false,
    lines: [],
    plain: '',
    match: 'NONE',
    provider: null,
  });
  assert.equal(result.script, LYRICS_SCRIPT.OTHER);
  assert.equal(result.romanizedLines, null);
  assert.deepEqual(result.displayLines, []);
});
