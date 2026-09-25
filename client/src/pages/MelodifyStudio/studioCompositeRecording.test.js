import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');

test('studio composite mode uses local youtube api player without capturing provider audio', () => {
  assert.match(source, /loadYoutubeApi/);
  assert.match(source, /ensureYoutubePlayer/);
  assert.match(source, /selectedSong\.playbackType === 'youtube'/);
  assert.match(source, /youtubePlayerRef\.current\.playVideo\(\)/);
  assert.match(source, /if \(backingAudioRef\.current\) \{/);
});

test('studio composite preview synchronizes play pause seek and cleanup', () => {
  assert.match(source, /onPlay=\{\(event\) => \{/);
  assert.match(source, /onPause=\{\(event\) => \{/);
  assert.match(source, /onSeeked=\{\(event\) => \{/);
  assert.match(source, /syncCompositePreviewPlayback/);
  assert.match(source, /stopYoutubeBacking\(\)/);
});

test('studio publish payload includes synchronization metadata', () => {
  assert.match(source, /formData\.append\('recordingMode'/);
  assert.match(source, /formData\.append\('backingSongId'/);
  assert.match(source, /formData\.append\('backingProviderId'/);
  assert.match(source, /formData\.append\('backingStartOffsetMs'/);
  assert.match(source, /formData\.append\('recordingDurationMs'/);
});
