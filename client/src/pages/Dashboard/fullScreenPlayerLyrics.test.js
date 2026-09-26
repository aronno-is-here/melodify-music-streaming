import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'FullScreenPlayer.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'FullScreenPlayer.css'), 'utf8');

test('opening the lyrics drawer does not add any rule that shifts fs-content', () => {
  assert.equal(css.includes('lyrics-open .fs-content'), false);
  assert.equal(/lyrics-open[^}]*margin-right/.test(css), false);
  assert.equal(/lyrics-open[^}]*translateX/.test(css), false);
  assert.equal(/lyrics-open[^}]*grid-template/.test(css), false);
  assert.equal(/lyrics-open[^}]*padding-right/.test(css), false);
  assert.equal(/fs-content[^}]*margin-right:\s*min/.test(css), false);
});

test('fs-content stays centered in its normal position', () => {
  assert.match(css, /\.fs-content \{[^}]*margin: auto/);
  assert.match(css, /\.fs-content \{[^}]*width: min\(560px, 100%\)/);
  assert.match(src, /<div className="fs-content">/);
  assert.match(css, /\.fs-poster-wrap \{[^}]*margin: 0 auto/);
});

test('fs-lyrics-sheet remains a full-height right-side overlay', () => {
  assert.match(css, /\.fs-lyrics-sheet \{[^}]*position: absolute/);
  assert.match(css, /\.fs-lyrics-sheet \{[^}]*top: 0/);
  assert.match(css, /\.fs-lyrics-sheet \{[^}]*right: 0/);
  assert.match(css, /\.fs-lyrics-sheet \{[^}]*bottom: 0/);
  assert.match(css, /\.fs-lyrics-sheet \{[^}]*width: min\(420px, 40vw\)/);
  assert.match(css, /\.fs-lyrics-sheet \{[^}]*z-index: 3/);
  assert.match(css, /\.fs-top,\s*\.fs-content,\s*\.fs-lyrics-sheet \{[^}]*z-index: 2/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.fs-lyrics-sheet \{[^}]*width: 100%/);
});

test('closing the lyrics drawer preserves playback state', () => {
  assert.match(src, /onClick=\{\(\) => setLyricsOpen\(\(open\) => !open\)\}/);
  assert.match(src, /<LyricsChordsPanel onClose=\{\(\) => setLyricsOpen\(false\)\} \/>/);
  const escapeBranch = src.match(/if \(lyricsOpen\) \{[\s\S]*?return;/)[0];
  assert.equal(/player\.|togglePlay|loadVideo|seek\(|setIsPlaying/.test(escapeBranch), false);
  const lyricsToggle = src.match(/onClick=\{\(\) => setLyricsOpen\(\(open\) => !open\)\}/)[0];
  assert.equal(/player\.|togglePlay|next\(|prev\(/.test(lyricsToggle), false);
  assert.equal(/createListeningTelemetryController|new Audio\(/.test(src), false);
});
