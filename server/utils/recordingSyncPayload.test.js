import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecordingSyncPayload, RECORDING_MODE } from './recordingSyncPayload.js';

test('recording sync payload parser applies defaults for legacy mic-only recordings', () => {
  const parsed = parseRecordingSyncPayload({});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.recordingMode, RECORDING_MODE.MIC_ONLY);
  assert.equal(parsed.value.backingProvider, '');
  assert.equal(parsed.value.backingProviderId, '');
});

test('recording sync payload parser accepts composite metadata', () => {
  const parsed = parseRecordingSyncPayload({
    recordingMode: 'COMPOSITE',
    backingSongId: '66f0f0f0f0f0f0f0f0f0f0f0',
    backingProvider: 'youtube',
    backingProviderId: 'abc123',
    backingStartOffsetMs: '1500',
    recordingDurationMs: '30000',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.recordingMode, RECORDING_MODE.COMPOSITE);
  assert.equal(parsed.value.backingProvider, 'youtube');
  assert.equal(parsed.value.backingProviderId, 'abc123');
  assert.equal(parsed.value.backingStartOffsetMs, 1500);
  assert.equal(parsed.value.recordingDurationMs, 30000);
});

test('recording sync payload parser rejects invalid metadata', () => {
  assert.equal(parseRecordingSyncPayload({ recordingMode: 'WRONG' }).ok, false);
  assert.equal(parseRecordingSyncPayload({ backingStartOffsetMs: '-1' }).ok, false);
  assert.equal(parseRecordingSyncPayload({ recordingDurationMs: 'oops' }).ok, false);
});
