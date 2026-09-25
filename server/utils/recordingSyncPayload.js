export const RECORDING_MODE = Object.freeze({
  MIXED: 'MIXED',
  COMPOSITE: 'COMPOSITE',
  MIC_ONLY: 'MIC_ONLY',
});

const MAX_PROVIDER_LENGTH = 64;
const MAX_PROVIDER_ID_LENGTH = 256;

const toTrimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const parseNonNegativeNumber = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
};

export function parseRecordingSyncPayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const rawMode = toTrimmed(payload.recordingMode);
  const mode = rawMode || RECORDING_MODE.MIC_ONLY;
  if (!Object.values(RECORDING_MODE).includes(mode)) {
    return { ok: false, error: 'invalid recording mode' };
  }

  const backingProvider = toTrimmed(payload.backingProvider);
  if (backingProvider.length > MAX_PROVIDER_LENGTH) {
    return { ok: false, error: 'invalid backing provider' };
  }

  const backingProviderId = toTrimmed(payload.backingProviderId);
  if (backingProviderId.length > MAX_PROVIDER_ID_LENGTH) {
    return { ok: false, error: 'invalid backing provider id' };
  }

  const backingStartOffsetMs = parseNonNegativeNumber(payload.backingStartOffsetMs ?? payload.backingStartOffset, 0);
  if (backingStartOffsetMs === null) {
    return { ok: false, error: 'invalid backing start offset' };
  }

  const recordingDurationMs = parseNonNegativeNumber(payload.recordingDurationMs, 0);
  if (recordingDurationMs === null) {
    return { ok: false, error: 'invalid recording duration' };
  }

  return {
    ok: true,
    value: {
      recordingMode: mode,
      backingSongId: toTrimmed(payload.backingSongId),
      backingProvider,
      backingProviderId,
      backingStartOffsetMs: Math.round(backingStartOffsetMs),
      recordingDurationMs: Math.round(recordingDurationMs),
    },
  };
}
