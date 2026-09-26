import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'GlobalPlayerBar.jsx'), 'utf8');
const fullPlayerSrc = readFileSync(join(__dirname, '..', '..', 'pages', 'Dashboard', 'FullScreenPlayer.jsx'), 'utf8');
const shellCss = readFileSync(join(__dirname, '..', '..', 'styles', 'app-shell.css'), 'utf8');
const fullPlayerCss = readFileSync(join(__dirname, '..', '..', 'pages', 'Dashboard', 'FullScreenPlayer.css'), 'utf8');

test('desktop player wiring includes previous, play/pause, next, mode, seek, and volume', () => {
  assert.match(src, /onClick=\{player\.prev\}/);
  assert.match(src, /onClick=\{player\.togglePlay\}/);
  assert.match(src, /onClick=\{player\.next\}/);
  assert.match(src, /player\.setPlayMode/);
  assert.match(src, /aria-label="Seek playback"/);
  assert.match(src, /aria-label="Volume"/);
  assert.match(src, /onChange=\{handleSeek\}/);
  assert.match(src, /onChange=\{handleVolume\}/);
});

test('player uses one global playback status model with retry wiring', () => {
  assert.match(src, /selectPlaybackStatusPresentation/);
  assert.match(src, /onClick=\{player\.retryPlayback\}/);
  assert.match(fullPlayerSrc, /selectPlaybackStatusPresentation/);
  assert.match(fullPlayerSrc, /onClick=\{player\.retryPlayback\}/);
});

test('mobile mini-player exists with play and next actions', () => {
  assert.match(src, /className="app-player-mini"/);
  assert.match(src, /aria-label="Open full player"/);
  assert.match(src, /event\.stopPropagation\(\);\s*\n\s*player\.togglePlay\(\)/);
  assert.match(src, /event\.stopPropagation\(\);\s*\n\s*player\.next\(\)/);
});

test('full player exposes lyrics/chords toggle and favorite action without engine duplication', () => {
  assert.match(fullPlayerSrc, /Show Lyrics & Chords/);
  assert.match(fullPlayerSrc, /onClick=\{onToggleFavorite\}/);
  assert.equal(fullPlayerSrc.includes('createListeningTelemetryController'), false);
  assert.equal(fullPlayerSrc.includes('new Audio('), false);
});

test('desktop player exposes a lyrics and chords drawer button with disabled empty state', () => {
  assert.match(src, /aria-label="Lyrics & Chords"/);
  assert.match(src, /title="Lyrics & Chords"/);
  assert.match(src, /disabled=\{!song\}/);
  assert.match(src, /aria-expanded=\{Boolean\(lyricsOpen && song\)\}/);
  assert.match(src, /aria-controls="app-lyrics-drawer"/);
  assert.match(src, /onClick=\{\(\) => \{ if \(song\) setLyricsOpen\(\(open\) => !open\); \}\}/);
});

test('lyrics drawer opens the shared panel without any playback side effects', () => {
  assert.match(src, /import LyricsChordsPanel from '\.\.\/\.\.\/pages\/Dashboard\/LyricsChordsPanel\.jsx'/);
  assert.match(src, /const \[lyricsOpen, setLyricsOpen\] = useState\(false\)/);
  assert.match(src, /\{lyricsOpen && song \? \(/);
  assert.match(src, /className="app-lyrics-drawer" id="app-lyrics-drawer" role="dialog" aria-label="Lyrics & Chords"/);
  assert.match(src, /<LyricsChordsPanel onClose=\{\(\) => setLyricsOpen\(false\)\} \/>/);
  const lyricsHandler = src.match(/onClick=\{\(\) => \{ if \(song\) setLyricsOpen\(\(open\) => !open\); \}\}/)[0];
  assert.equal(/player\.|playSong|togglePlay|next\(|prev\(/.test(lyricsHandler), false);
  assert.equal(/createListeningTelemetryController|new Audio\(/.test(src), false);
});

test('shell styles place the lyrics drawer above the bottom player and keep the panel scrollable', () => {
  assert.match(shellCss, /\.app-lyrics-drawer \{/);
  assert.match(shellCss, /bottom: calc\(var\(--mel-player-h\) \+ 22px\)/);
  assert.match(shellCss, /position: fixed/);
  assert.match(shellCss, /\.app-lyrics-drawer \.lc-panel \{[^}]*height: 100%/);
  assert.match(shellCss, /@media \(max-width: 768px\)[\s\S]*\.app-lyrics-drawer \{[^}]*width: 100vw/);
});

test('full player lyrics surface is a right-side drawer, not a small bottom section', () => {
  assert.match(fullPlayerSrc, /fs-player\$\{closing \? ' closing' : ''\}\$\{lyricsOpen \? ' lyrics-open' : ''\}/);
  assert.match(fullPlayerCss, /\.fs-lyrics-sheet \{[^}]*position: absolute/);
  assert.match(fullPlayerCss, /\.fs-lyrics-sheet \{[^}]*right: 0/);
  assert.match(fullPlayerCss, /\.fs-lyrics-sheet \{[^}]*top: 0/);
  assert.match(fullPlayerCss, /\.fs-lyrics-sheet \.lc-panel \{[^}]*max-height: none/);
  assert.equal(fullPlayerCss.includes('lyrics-open .fs-content'), false);
  assert.equal(fullPlayerCss.includes('max-height: 38dvh'), false);
  assert.match(fullPlayerCss, /@media \(max-width: 768px\)[\s\S]*\.fs-lyrics-sheet \{[^}]*width: 100%/);
});
