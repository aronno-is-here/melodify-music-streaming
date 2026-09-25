import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'MelodifyStudio.css'), 'utf8');

test('Studio uses API client for recording publish and removes raw fetch usage', () => {
  assert.match(src, /api\.post\('\/api\/recordings', formData\)/);
  assert.equal(src.includes('fetch('), false);
  assert.equal(src.includes('usePlayer'), false);
});

test('Studio keeps multi-step workflow and accessible labels/sliders', () => {
  assert.match(src, /const STEPS = Object\.freeze/);
  assert.match(src, /className="studio-stepper"/);
  assert.match(src, /htmlFor="studio-song-query"/);
  assert.match(src, /id="studio-gain" type="range"/);
  assert.match(src, /id="studio-reverb" type="range"/);
  assert.match(src, /id="studio-echo" type="range"/);
  assert.match(src, /id="studio-bass" type="range"/);
  assert.match(src, /id="studio-treble" type="range"/);
});

test('Studio preserves recording constraints and reduced-motion styles', () => {
  assert.match(src, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(src, /new MediaRecorder/);
  assert.match(src, /mimeType: 'audio\/webm'/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.studio-page/);
  assert.equal(/(^|\n)\s*header\s*\{/.test(css), false);
});
