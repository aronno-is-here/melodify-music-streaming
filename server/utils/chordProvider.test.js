import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHORD_STATES,
  normalizeChordifyEmbedUrl,
  normalizeChordifyUrl,
  normalizeChordReferenceUrl,
  selectChordPresentation,
} from './chordProvider.js';

test('normalizeChordifyUrl accepts only chordify hosts over https', () => {
  assert.equal(normalizeChordifyUrl('https://chordify.net/chords/foo'), 'https://chordify.net/chords/foo');
  assert.equal(normalizeChordifyUrl('https://www.chordify.net/chords/foo'), 'https://www.chordify.net/chords/foo');
  assert.equal(normalizeChordifyUrl('http://chordify.net/chords/foo'), null);
  assert.equal(normalizeChordifyUrl('https://example.com/chords/foo'), null);
});

test('normalizeChordifyEmbedUrl requires non-root path', () => {
  assert.equal(normalizeChordifyEmbedUrl('https://chordify.net/'), null);
  assert.equal(normalizeChordifyEmbedUrl('https://chordify.net/chords/bar'), 'https://chordify.net/chords/bar');
});

test('normalizeChordReferenceUrl accepts any https URL', () => {
  assert.equal(normalizeChordReferenceUrl('https://tabs.ultimate-guitar.com/foo'), 'https://tabs.ultimate-guitar.com/foo');
  assert.equal(normalizeChordReferenceUrl('http://tabs.ultimate-guitar.com/foo'), null);
});

test('selectChordPresentation prefers verified db chord text', () => {
  const presentation = selectChordPresentation({
    chords: 'C G Am F',
    chords_verified: true,
    chords_source: 'db_verified',
  });
  assert.equal(presentation.state, CHORD_STATES.VERIFIED_DB);
  assert.equal(presentation.chordsVerified, true);
});

test('selectChordPresentation returns provider state for chordify links', () => {
  const presentation = selectChordPresentation({
    chords: '',
    chordify_url: 'https://chordify.net/chords/foo',
    chords_source: 'chordify',
  });
  assert.equal(presentation.state, CHORD_STATES.PROVIDER);
  assert.equal(presentation.source, 'chordify');
});

test('selectChordPresentation returns unavailable when no chords exist', () => {
  const presentation = selectChordPresentation({ chords: '' });
  assert.equal(presentation.state, CHORD_STATES.UNAVAILABLE);
  assert.equal(presentation.chords, '');
});
