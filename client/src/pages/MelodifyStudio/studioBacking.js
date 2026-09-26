export const BACKING_MODES = Object.freeze({
  AUDIO: 'audio',
  YOUTUBE: 'youtube',
  NONE: 'none',
});

export const TRACK_CLASSIFICATIONS = Object.freeze({
  KARAOKE_READY: 'KARAOKE_READY',
  SING_ALONG: 'SING_ALONG',
});

export const RECORDING_MODES = Object.freeze({
  MIXED: 'MIXED',
  COMPOSITE: 'COMPOSITE',
});

const trimText = (value) => (typeof value === 'string' ? value.trim() : '');

const firstText = (...values) => {
  for (const value of values) {
    const text = trimText(value);
    if (text) return text;
  }
  return '';
};

export function resolveBackingSource(song) {
  if (!song || typeof song !== 'object') {
    return { mode: BACKING_MODES.NONE, source: '', providerTrackId: '' };
  }

  const declared = trimText(song.playbackType);
  const direct = firstText(song.backingAudioUrl);
  const provider = firstText(song.backingProviderTrackId, song.youtubeId);

  if (declared === BACKING_MODES.NONE) {
    return { mode: BACKING_MODES.NONE, source: '', providerTrackId: provider };
  }
  if (declared === BACKING_MODES.AUDIO && direct) {
    return { mode: BACKING_MODES.AUDIO, source: direct, providerTrackId: provider };
  }
  if (declared === BACKING_MODES.YOUTUBE && provider) {
    return { mode: BACKING_MODES.YOUTUBE, source: '', providerTrackId: provider };
  }
  if (direct) {
    return { mode: BACKING_MODES.AUDIO, source: direct, providerTrackId: provider };
  }
  if (provider) {
    return { mode: BACKING_MODES.YOUTUBE, source: '', providerTrackId: provider };
  }
  return { mode: BACKING_MODES.NONE, source: '', providerTrackId: '' };
}

export function normalizeStudioTrack(song) {
  if (!song || typeof song !== 'object') return null;

  const backing = resolveBackingSource(song);
  const declaredClassification = trimText(song.classification);
  const classification = (
    declaredClassification === TRACK_CLASSIFICATIONS.KARAOKE_READY
    || declaredClassification === TRACK_CLASSIFICATIONS.SING_ALONG
  )
    ? declaredClassification
    : (backing.mode === BACKING_MODES.AUDIO
      ? TRACK_CLASSIFICATIONS.KARAOKE_READY
      : TRACK_CLASSIFICATIONS.SING_ALONG);

  const declaredRecordingMode = trimText(song.recordingMode);
  const recordingMode = (
    declaredRecordingMode === RECORDING_MODES.MIXED
    || declaredRecordingMode === RECORDING_MODES.COMPOSITE
  )
    ? declaredRecordingMode
    : (classification === TRACK_CLASSIFICATIONS.KARAOKE_READY && backing.mode === BACKING_MODES.AUDIO
      ? RECORDING_MODES.MIXED
      : RECORDING_MODES.COMPOSITE);

  return {
    ...song,
    id: firstText(song.id, song._id),
    playbackType: backing.mode,
    backingAudioUrl: backing.source || firstText(song.backingAudioUrl),
    backingProviderTrackId: backing.mode === BACKING_MODES.YOUTUBE
      ? backing.providerTrackId
      : firstText(song.backingProviderTrackId),
    classification,
    recordingMode,
  };
}
