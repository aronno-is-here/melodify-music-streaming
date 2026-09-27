import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'LyricsChordsPanel.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'LyricsChordsPanel.css'), 'utf8');

test('hindi lyrics default to the romanized view', () => {
  assert.match(
    src,
    /setLyricsView\(script === 'devanagari' && romanized \? 'romanized' : 'original'\)/,
  );
});

test('bengali lyrics default to the original view with a bengali toggle label', () => {
  assert.match(
    src,
    /setLyricsView\(script === 'devanagari' && romanized \? 'romanized' : 'original'\)/,
  );
  assert.match(src, /lyricsScript === 'bengali'/);
  assert.match(src, /\{ original: 'বাংলা', romanized: 'Romanized' \}/);
});

test('romanized toggle renders only when both forms exist', () => {
  assert.match(src, /const canToggleLyricsView = Boolean\(romanizedLines\) && lyricsLines\.length > 0;/);
  assert.match(src, /\{canToggleLyricsView \? \(/);
  assert.match(src, /className="lc-view-toggle" role="group" aria-label="Lyrics view"/);
  assert.match(src, /aria-pressed=\{lyricsView === 'original'\}/);
  assert.match(src, /aria-pressed=\{lyricsView === 'romanized'\}/);
  assert.match(src, /onClick=\{\(\) => setLyricsView\('original'\)\}/);
  assert.match(src, /onClick=\{\(\) => setLyricsView\('romanized'\)\}/);
});

test('synced highlighting and rendering follow the active display view', () => {
  assert.match(
    src,
    /const displayLines = showRomanized \? romanizedLines : lyricsLines;/,
  );
  assert.match(src, /if \(!lyricsSynced \|\| displayLines\.length === 0\)/);
  assert.match(src, /for \(let i = displayLines\.length - 1; i >= 0; i--\)/);
  assert.match(src, /displayLines\[i\]\.time !== null && time >= displayLines\[i\]\.time/);
  assert.match(src, /\[player\.currentTime, lyricsSynced, displayLines\]/);
  assert.match(src, /\{displayLines\.map\(\(line, i\) =>/);
  assert.match(src, /\{line\.text \|\| '\\u00A0'\}/);
});

test('romanized view preserves original lyric lines and sync effect structure', () => {
  assert.match(src, /setLyricsLines\(data\.lines \|\| \[\]\)/);
  assert.match(src, /setRomanizedLines\(romanized\)/);
  assert.match(src, /const romanized = Array\.isArray\(data\.romanizedLines\) && data\.romanizedLines\.length > 0/);
  assert.match(src, /className=\{`lc-lyrics\$\{lyricsSynced \? ' synced' : ''\}`\}/);
  assert.match(src, /lc-lyric-line\$\{isActive \? ' active' : ''\}\$\{!lyricsSynced \? ' static' : ''\}/);
  assert.match(src, /container\.scrollTo\(\{ top: container\.scrollTop \+ offset, behavior: 'smooth' \}\)/);
});

test('lyrics and chords behavior does not regress', () => {
  assert.match(src, /aria-label="Show lyrics"/);
  assert.match(src, /aria-label="Show chords"/);
  assert.match(src, /<pre className="lc-text lc-chords">\{chords\}<\/pre>/);
  assert.match(src, /Lyrics not available for this song\./);
  assert.match(src, /Chords not available for this song\./);
  assert.match(src, /Loading\.\.\./);
  assert.match(src, /if \(e\.key === 'Escape'\) onClose\(\);/);
  assert.match(src, /api\.get\(`\/api\/lyrics\/\$\{song\._id\}`\)/);
  assert.match(src, /if \(data\.success\) \{/);
  assert.match(src, /data-page-css/);
  assert.match(css, /\.lc-view-toggle \{/);
  assert.match(css, /\.lc-view-btn\.active \{/);
  assert.match(css, /\.lc-view-btn:focus-visible \{/);
  assert.match(css, /\.lc-lyrics \{/);
  assert.match(css, /\.lc-lyrics\.synced \.lc-lyric-line:not\(\.static\)/);
});
