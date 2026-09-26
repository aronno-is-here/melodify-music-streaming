import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'GlobalPlayerBar.jsx'), 'utf8');
const css = readFileSync(join(__dirname, '..', '..', 'styles', 'app-shell.css'), 'utf8');

const playerBlock = css.match(/\.app-player \{[^}]*\}/)[0];
const mainBlock = css.match(/\.app-player-main \{[^}]*\}/)[0];
const desktopSlice = src.slice(src.indexOf('app-player app-player-desktop'), src.indexOf('{lyricsOpen && song ? ('));
const miniSlice = src.slice(src.indexOf('className="app-player-mini"'));

test('player container sits flush at the viewport bottom', () => {
  assert.match(playerBlock, /position: fixed/);
  assert.match(playerBlock, /bottom: 0/);
  assert.equal(/bottom:\s*\d/.test(playerBlock.replace('bottom: 0', '')), false);
  assert.equal(css.includes('bottom: 10px'), false);
  assert.equal(/env\(safe-area-inset-bottom\)/.test(playerBlock), false);
});

test('player container has no margin or padding gap below it', () => {
  assert.equal(/margin-bottom/.test(playerBlock), false);
  assert.equal(/margin:/.test(playerBlock), false);
  assert.equal(/margin-bottom/.test(mainBlock), false);
});

test('a visible lyrics and chords control exists inside the desktop player', () => {
  assert.match(desktopSlice, /className=\{`music-icon-control app-player-lyrics\$\{lyricsOpen && song \? ' is-active' : ''\}`\}/);
  assert.match(desktopSlice, /<span className="app-player-lyrics-label">Lyrics<\/span>/);
  assert.match(desktopSlice, /title="Lyrics & Chords"/);
  assert.match(desktopSlice, /aria-label="Lyrics & Chords"/);
  assert.match(css, /\.app-player-lyrics \{[^}]*gap: 6px/);
  assert.match(css, /\.app-player-lyrics \{[^}]*padding-inline: 12px/);
});

test('lyrics control is disabled when there is no current song', () => {
  assert.match(desktopSlice, /disabled=\{!song\}/);
  assert.match(desktopSlice, /aria-expanded=\{Boolean\(lyricsOpen && song\)\}/);
});

test('lyrics control opens the shared LyricsChordsPanel drawer', () => {
  assert.match(src, /import LyricsChordsPanel from '\.\.\/\.\.\/pages\/Dashboard\/LyricsChordsPanel\.jsx'/);
  assert.match(desktopSlice, /aria-controls="app-lyrics-drawer"/);
  assert.match(src, /className="app-lyrics-drawer" id="app-lyrics-drawer" role="dialog" aria-label="Lyrics & Chords"/);
  assert.match(src, /<LyricsChordsPanel onClose=\{\(\) => setLyricsOpen\(false\)\} \/>/);
  assert.match(css, /\.app-lyrics-drawer \{[^}]*bottom: calc\(var\(--mel-player-h\) \+ 8px\)/);
  assert.match(css, /\.app-lyrics-drawer \.lc-panel \{[^}]*height: 100%/);
});

test('opening or closing lyrics never plays, pauses, or switches tracks', () => {
  const handlers = [
    ...src.matchAll(/onClick=\{[^}]*setLyricsOpen[^}]*\}/g),
  ].map((match) => match[0]);
  assert.ok(handlers.length >= 2, 'expected desktop and mini lyrics handlers');
  for (const handler of handlers) {
    assert.equal(/togglePlay|player\.next|player\.prev|switchTrack|loadVideo|\.pause\(|playSong/.test(handler), false, handler);
  }
  const miniLyricsHandler = miniSlice.match(/aria-label="Lyrics & Chords"[\s\S]*?onClick=\{\(event\) => \{[\s\S]*?setLyricsOpen\(\(open\) => !open\);\s*\}\}/)[0];
  assert.equal(/togglePlay|player\.next|player\.prev|switchTrack|loadVideo/.test(miniLyricsHandler), false);
  assert.equal(/switchTrack/.test(src), false);
});

test('mobile mini player keeps a usable compact lyrics control', () => {
  assert.match(miniSlice, /aria-label="Lyrics & Chords"/);
  assert.match(miniSlice, /title="Lyrics & Chords"/);
  assert.match(miniSlice, /setLyricsOpen\(\(open\) => !open\)/);
  assert.match(miniSlice, /event\.stopPropagation\(\)/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.app-lyrics-drawer \{[^}]*width: 100vw/);
  assert.match(css, /\.app-lyrics-drawer \{[^}]*z-index: 56/);
});
