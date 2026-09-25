import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'recordingRoutes.js'), 'utf8');

test('recording routes parse and persist synchronization metadata', () => {
  assert.match(source, /parseRecordingSyncPayload/);
  assert.match(source, /recordingMode/);
  assert.match(source, /backingSong/);
  assert.match(source, /backingProviderId/);
  assert.match(source, /backingStartOffsetMs/);
  assert.match(source, /recordingDurationMs/);
});

test('recording routes enforce backing reference and support song fallback on publish', () => {
  assert.match(source, /Backing track reference is required/);
  assert.match(source, /song: recording\.backingSong\?\._id \|\| undefined/);
  assert.match(source, /karaoke: recording\.karaoke\?\._id \|\| undefined/);
});
