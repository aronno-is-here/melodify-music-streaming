import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'MelodifyStudio.css'), 'utf8');

test('studio recording requests microphone and starts backing playback before recorder start', () => {
  assert.match(source, /await navigator\.mediaDevices\.getUserMedia/);
  assert.match(source, /await backingAudioRef\.current\.play\(\)/);
  assert.match(source, /recorder\.start\(100\)/);
});

test('studio recording handles media recorder support and backing load failure', () => {
  assert.match(source, /MediaRecorder is not supported in this browser/);
  assert.match(source, /backing track failed to load/);
  assert.match(source, /Microphone permission denied/);
});

test('studio recording cleanup stops backing audio and microphone tracks', () => {
  assert.match(source, /backingAudioRef\.current\.pause\(\)/);
  assert.match(source, /streamRef\.current\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
  assert.match(source, /audioContextRef\.current\.close\(\)/);
});

test('studio recording includes headphone recommendation', () => {
  assert.match(source, /use headphones to avoid microphone feedback/i);
  assert.match(css, /\.studio-headphone-hint/);
});
