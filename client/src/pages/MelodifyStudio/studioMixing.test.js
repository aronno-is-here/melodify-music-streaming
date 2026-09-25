import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');

test('studio mix uses media element source plus media stream destination for recording', () => {
  assert.match(source, /createMediaElementSource\(backingAudioRef\.current\)/);
  assert.match(source, /createMediaStreamDestination\(\)/);
  assert.match(source, /backingSourceNode\.connect\(backingRecorderGain\)/);
  assert.match(source, /backingRecorderGain\.connect\(dest\)/);
  assert.match(source, /merger\.connect\(dest\)/);
});

test('studio mix routes backing to speakers but keeps microphone off speaker destination', () => {
  assert.match(source, /backingSpeakerGain\.connect\(audioCtx\.destination\)/);
  assert.doesNotMatch(source, /merger\.connect\(audioCtx\.destination\)/);
});

test('studio mix negotiates media recorder mime type safely', () => {
  assert.match(source, /MediaRecorder\.isTypeSupported/);
  assert.match(source, /new MediaRecorder\(dest\.stream, \{ mimeType \}\)/);
});

test('studio mix exposes backing and vocal level controls', () => {
  assert.match(source, /label>Backing</);
  assert.match(source, /label>Vocal</);
  assert.match(source, /updateBackingVolume/);
  assert.match(source, /updateVocalGain/);
});
