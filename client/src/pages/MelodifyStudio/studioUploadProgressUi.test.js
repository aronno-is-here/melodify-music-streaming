import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'MelodifyStudio.css'), 'utf8');

test('studio upload ui includes accessible progress semantics', () => {
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-valuemin=\{0\}/);
  assert.match(source, /aria-valuemax=\{100\}/);
  assert.match(source, /aria-valuenow=/);
  assert.match(source, /aria-live="polite"/);
});

test('studio upload flow tracks uploading, processing, success, and error states', () => {
  assert.match(source, /setUploadState\('uploading'\)/);
  assert.match(source, /setUploadState\('processing'\)/);
  assert.match(source, /setUploadState\('success'\)/);
  assert.match(source, /setUploadState\('error'\)/);
  assert.match(source, /xhr\.upload\.onprogress/);
});

test('studio upload status card is themed and avoids default white container', () => {
  assert.match(css, /\.studio-upload-status/);
  assert.match(css, /\.studio-upload-progress/);
  assert.match(css, /\.studio-upload-progress-fill/);
  assert.match(css, /linear-gradient\(90deg, #00b4d8/);
});
