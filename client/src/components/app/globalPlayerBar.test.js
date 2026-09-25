import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'GlobalPlayerBar.jsx'), 'utf8');
const fullPlayerSrc = readFileSync(join(__dirname, '..', '..', 'pages', 'Dashboard', 'FullScreenPlayer.jsx'), 'utf8');

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
