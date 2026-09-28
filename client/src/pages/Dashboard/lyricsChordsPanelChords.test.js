import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'LyricsChordsPanel.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'LyricsChordsPanel.css'), 'utf8');

test('chords tab loads verified chord data from the chords endpoint', () => {
  assert.match(src, /api\.get\(`\/api\/chords\/\$\{song\._id\}`\)/);
  assert.match(src, /if \(activeTab !== 'chords'\) return undefined;/);
  assert.match(src, /setChordLoading\(true\)/);
  assert.match(src, /setTransposeOffset\(0\)/);
});

test('chords tab keeps the shared lyrics request untouched', () => {
  assert.match(src, /api\.get\(`\/api\/lyrics\/\$\{song\._id\}`\)/);
  assert.match(src, /if \(data\.success\) \{/);
  assert.match(src, /setLyricsLines\(data\.lines \|\| \[\]\)/);
});

test('chords tab stores the documented response fields', () => {
  for (const field of ['status', 'format', 'key', 'capo', 'tuning', 'source', 'sourceUrl', 'verified', 'timeline']) {
    assert.ok(src.includes(`${field}:`), `missing ${field}`);
  }
});

test('transpose controls are bounded to plus or minus twelve semitones', () => {
  assert.match(src, /const TRANSPOSE_FLOOR = -12;/);
  assert.match(src, /const TRANSPOSE_CEILING = 12;/);
  assert.match(src, /aria-label="Transpose down one semitone"/);
  assert.match(src, /aria-label="Transpose up one semitone"/);
  assert.match(src, /disabled=\{transposeOffset <= TRANSPOSE_FLOOR\}/);
  assert.match(src, /disabled=\{transposeOffset >= TRANSPOSE_CEILING\}/);
  assert.match(src, /onClick=\{\(\) => setTransposeOffset\(0\)\}/);
  assert.match(src, /aria-label="Transpose chords"/);
});

test('display transposition is derived and never written back to the song', () => {
  assert.match(src, /const chords = useMemo\(/);
  assert.match(src, /transposeChordSheet\(chordText, transposeOffset, chordFormat\)/);
  assert.equal(/api\.(put|post|patch)\([^)]*chord/.test(src), false);
  assert.equal(src.includes('setChordText(transposed'), false);
});

test('chordpro sheets render parsed markers as chord tokens', () => {
  assert.match(src, /parseChordPro\(chords\)/);
  assert.match(src, /chordPro\.lines\.map/);
  assert.match(src, /className="lc-chord-token"/);
  assert.match(src, /segment\.chord \? <b className="lc-chord-token">\{segment\.chord\}<\/b> : null/);
});

test('plain chord sheets keep the monospace pre renderer', () => {
  assert.match(src, /<pre className="lc-text lc-chords">\{chords\}<\/pre>/);
});

test('synced chord timeline highlights the active entry from player time', () => {
  assert.match(src, /findActiveChord\(chordTimeline, player\.currentTime\)/);
  assert.match(src, /chordTimeline\.map\(\(entry, i\) =>/);
  assert.match(src, /i === activeChordIndex \? ' active' : ''/);
  assert.match(src, /formatChordTime\(entry\.time\)/);
});

test('timeline chords seek only when the player duration is available', () => {
  assert.match(src, /const seekToChord = \(seconds\) => \{/);
  assert.match(src, /if \(!Number\.isFinite\(seconds\) \|\| !player\.duration\) return;/);
  assert.match(src, /player\.seek\(seconds \/ player\.duration\)/);
  assert.match(src, /disabled=\{!player\.duration\}/);
});

test('chord metadata header surfaces key capo tuning format and verification', () => {
  assert.match(src, />Key <b>/);
  assert.match(src, />Capo <b>/);
  assert.match(src, />Tuning <b>/);
  assert.match(src, />Format <b>/);
  assert.match(src, /chordMeta\?\.verified \? 'Verified' : 'Unverified'/);
});

test('empty and source-found chord states stay honest', () => {
  assert.match(src, /Chords not available for this song\./);
  assert.match(src, /Add Verified Chords/);
  assert.match(src, /sourcePageUrl \? \(/);
  assert.match(src, /View Source/);
  assert.equal(src.includes('Chord diagrams'), false);
});

test('panel performs no writes, no injection and no polling', () => {
  assert.equal(/dangerouslySetInnerHTML|innerHTML|document\.write/.test(src), false);
  assert.equal(/setInterval\(|setTimeout\(/.test(src), false);
  assert.equal(/fetch\(/.test(src), false);
});

test('chord styles exist and plain sheets scroll horizontally', () => {
  assert.match(css, /\.lc-chord-toolbar \{/);
  assert.match(css, /\.lc-chord-meta \{/);
  assert.match(css, /\.lc-transpose-btn/);
  assert.match(css, /\.lc-chord-token \{/);
  assert.match(css, /\.lc-timeline-row/);
  assert.match(css, /\.lc-chords \{[^}]*white-space: pre;/);
  assert.match(css, /\.lc-chords \{[^}]*overflow-x: auto;/);
  assert.match(css, /@media \(max-width: 768px\)/);
});
