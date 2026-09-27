import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LYRICS_FILE_BYTES,
  MAX_LYRICS_TEXT_LENGTH,
  LYRICS_TEXT_ERROR_MESSAGES,
  detectLyricsFormat,
  getFileExtension,
  isAllowedLyricsFile,
  normalizeLyricsText,
  normalizeNewlines,
  validateLyricsText,
  validateLrcStrict,
} from './lyricsTextImport.js';

const VALID_LRC = [
  '[00:12.40]First line',
  '[00:16.90]Second line',
  '[00:21.00]Third line',
].join('\n');

test('normalizeNewlines converts CRLF and lone CR to LF', () => {
  assert.equal(normalizeNewlines('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(normalizeNewlines(undefined), '');
  assert.equal(normalizeNewlines(42), '');
});

test('normalizeLyricsText only trims surrounding blank lines and keeps internal blank lines', () => {
  const input = '\n\nline one\n\nline two\n\n';
  assert.equal(normalizeLyricsText(input), 'line one\n\nline two');
  assert.equal(normalizeLyricsText(''), '');
  assert.equal(normalizeLyricsText(null), '');
});

test('file extension helpers accept .txt and .lrc only', () => {
  assert.equal(getFileExtension('notes.txt'), '.txt');
  assert.equal(getFileExtension('notes.LRC'), '.lrc');
  assert.equal(getFileExtension('noextension'), '');
  assert.equal(isAllowedLyricsFile('song.txt'), true);
  assert.equal(isAllowedLyricsFile('song.lrc'), true);
  assert.equal(isAllowedLyricsFile('song.mp3'), false);
  assert.equal(isAllowedLyricsFile('song.html'), false);
  assert.equal(isAllowedLyricsFile('song.pdf'), false);
});

test('TXT import accepts plain text and normalizes newlines', () => {
  const result = validateLyricsText('Line one\r\nLine two\r\n', { fileName: 'lyrics.txt' });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'plain');
  assert.equal(result.lines, null);
  assert.equal(result.text, 'Line one\nLine two');
});

test('valid LRC parses into timed lines', () => {
  const result = validateLyricsText(VALID_LRC, { fileName: 'lyrics.lrc' });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'lrc');
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0].text, 'First line');
  assert.equal(result.lines[0].time, 12.4);
  assert.equal(result.lines[1].time, 16.9);
});

test('malformed LRC seconds are rejected instead of silently reinterpreted', () => {
  const result = validateLyricsText('[00:99.00]Broken\n[00:01.00]Fine', { fileName: 'lyrics.lrc' });
  assert.equal(result.ok, false);
  assert.equal(result.error, LYRICS_TEXT_ERROR_MESSAGES.MALFORMED);
});

test('malformed LRC bracket without a closing bracket is rejected', () => {
  const result = validateLrcStrict('[00:12.40Broken line');
  assert.equal(result.ok, false);
  assert.equal(result.error, LYRICS_TEXT_ERROR_MESSAGES.MALFORMED);
});

test('LRC forced without any timestamp is rejected', () => {
  const result = validateLyricsText('Just plain words', { format: 'lrc' });
  assert.equal(result.ok, false);
  assert.equal(result.error, LYRICS_TEXT_ERROR_MESSAGES.NO_TIMESTAMPS);
});

test('empty lyrics are rejected', () => {
  const result = validateLyricsText('   \n  ');
  assert.equal(result.ok, false);
  assert.equal(result.error, LYRICS_TEXT_ERROR_MESSAGES.EMPTY);
});

test('too-long lyrics are rejected', () => {
  const result = validateLyricsText('a'.repeat(MAX_LYRICS_TEXT_LENGTH + 1));
  assert.equal(result.ok, false);
  assert.equal(result.error, LYRICS_TEXT_ERROR_MESSAGES.TOO_LONG);
});

test('file byte ceiling rejects oversized payloads', () => {
  const oversized = 'अ'.repeat(Math.ceil(MAX_LYRICS_FILE_BYTES / 3) + 100);
  assert.ok(oversized.length < MAX_LYRICS_TEXT_LENGTH);
  const result = validateLyricsText(oversized);
  assert.equal(result.ok, false);
  assert.equal(result.error, LYRICS_TEXT_ERROR_MESSAGES.FILE_TOO_LARGE);
});

test('disallowed file extension is rejected', () => {
  const result = validateLyricsText('words', { fileName: 'payload.html' });
  assert.equal(result.ok, false);
  assert.equal(result.error, LYRICS_TEXT_ERROR_MESSAGES.BAD_EXTENSION);
});

test('detectLyricsFormat distinguishes synced LRC from plain text', () => {
  assert.equal(detectLyricsFormat(VALID_LRC), 'lrc');
  assert.equal(detectLyricsFormat('No stamps here'), 'plain');
  assert.equal(detectLyricsFormat('[00:99.00]Broken'), 'lrc');
});

test('metadata and lyric brackets are not treated as timestamps', () => {
  const text = [
    '[ar: Some Artist]',
    '[ti: Some Title]',
    '[00:05.00]In [2024] we sang',
    '[Chorus]',
  ].join('\n');
  const result = validateLyricsText(text, { fileName: 'lyrics.lrc' });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'lrc');
  assert.equal(result.lines[0].time, 5);
  assert.equal(result.lines[0].text, 'In [2024] we sang');
  assert.equal(
    result.lines.filter((line) => line.time !== null).length,
    1,
  );
});
