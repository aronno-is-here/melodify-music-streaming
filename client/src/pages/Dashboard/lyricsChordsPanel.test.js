import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'LyricsChordsPanel.jsx'), 'utf8');

test('lyrics panel reads active playback song/time from shared player context', () => {
  assert.match(src, /const player = usePlayer\(\)/);
  assert.match(src, /const song = songOverride \|\| player\.currentSong/);
  assert.match(src, /: player\.currentTime;/);
});

test('lyrics panel fetches authoritative payload and hydrates chords from response', () => {
  assert.match(src, /api\.get\(`\/api\/lyrics\/\$\{song\._id\}`\)/);
  assert.match(src, /if \(typeof data\.chords === 'string'\) \{/);
  assert.match(src, /setChords\(data\.chords\)/);
});

test('lyrics panel supports shell/fullscreen embedding without requiring close controls', () => {
  assert.match(src, /showCloseButton = true/);
  assert.match(src, /const canClose = showCloseButton && typeof onClose === 'function'/);
  assert.equal(src.includes('showCloseButton={false}'), false);
});

test('lyrics panel does not emit playback telemetry or history writes', () => {
  assert.equal(src.includes('createListeningTelemetryController'), false);
  assert.equal(src.includes("api.post('/api/history'"), false);
  assert.equal(src.includes("api.post('/api/listening-events'"), false);
});
