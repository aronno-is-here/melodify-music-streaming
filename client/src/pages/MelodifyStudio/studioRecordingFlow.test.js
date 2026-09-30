import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'MelodifyStudio.css'), 'utf8');

test('studio recording prepares the microphone first and starts recorder with backing in one transition', () => {
  assert.match(source, /await navigator\.mediaDevices\.getUserMedia/);
  assert.match(source, /recorder\.start\(100\)/);
  assert.match(source, /backingAudioRef\.current\.play\(\)/);
  const micIndex = source.indexOf('await navigator.mediaDevices.getUserMedia');
  const recorderStartIndex = source.indexOf('recorder.start(100)');
  const backingStartIndex = source.indexOf('backingAudioRef.current.play()');
  assert.ok(micIndex > -1 && recorderStartIndex > micIndex, 'microphone is acquired before the recorder starts');
  assert.ok(backingStartIndex > recorderStartIndex, 'backing starts after the recorder start boundary');
  const boundary = source.slice(recorderStartIndex, backingStartIndex);
  assert.doesNotMatch(boundary, /await\s/, 'no await between recorder start and backing start');
  const setupToRecorder = source.slice(micIndex, recorderStartIndex);
  assert.doesNotMatch(setupToRecorder, /backingAudioRef\.current\.play\(\)/, 'backing never plays before the recorder is ready');
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
