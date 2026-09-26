import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKING_MODES,
  RECORDING_MODES,
  TRACK_CLASSIFICATIONS,
  normalizeStudioTrack,
  resolveBackingSource,
} from './studioBacking.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');

const segment = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  assert.notEqual(start, -1, `expected anchor ${from}`);
  assert.ok(end > start, `expected anchor ${to} after ${from}`);
  return text.slice(start, end);
};

test('studio selection keeps the provider track identity for later steps', () => {
  const track = normalizeStudioTrack({
    _id: '64b64b64b64b64b64b64b642',
    id: 'provider:youtube:abc123',
    karaokeId: null,
    catalogSongId: '64b64b64b64b64b64b64b643',
    youtubeId: 'abc123',
    title: 'Nisshash',
    artist: 'G.M. Ashraf',
    posterUrl: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
    playbackType: BACKING_MODES.YOUTUBE,
    backingAudioUrl: null,
    backingProviderTrackId: 'abc123',
    classification: TRACK_CLASSIFICATIONS.SING_ALONG,
    recordingMode: RECORDING_MODES.COMPOSITE,
  });

  assert.equal(track.id, 'provider:youtube:abc123');
  assert.equal(track.title, 'Nisshash');
  assert.equal(track.artist, 'G.M. Ashraf');
  assert.equal(track.catalogSongId, '64b64b64b64b64b64b64b643');
  assert.equal(track.youtubeId, 'abc123');
  assert.equal(track.backingProviderTrackId, 'abc123');
  assert.equal(track.playbackType, BACKING_MODES.YOUTUBE);
});

test('studio selection resolves a valid local backing track to the audio path', () => {
  const track = normalizeStudioTrack({
    _id: '64b64b64b64b64b64b64b644',
    karaokeId: '64b64b64b64b64b64b64b645',
    catalogSongId: null,
    title: 'Local Take',
    artist: 'Studio Artist',
    playbackType: BACKING_MODES.AUDIO,
    backingAudioUrl: '/assets/songs/uploads/local-take.mp3',
    backingProviderTrackId: null,
    classification: TRACK_CLASSIFICATIONS.KARAOKE_READY,
    recordingMode: RECORDING_MODES.MIXED,
  });

  assert.equal(track.playbackType, BACKING_MODES.AUDIO);
  assert.equal(track.backingAudioUrl, '/assets/songs/uploads/local-take.mp3');
  assert.equal(track.classification, TRACK_CLASSIFICATIONS.KARAOKE_READY);
  assert.equal(track.recordingMode, RECORDING_MODES.MIXED);
  assert.equal(resolveBackingSource(track).mode, BACKING_MODES.AUDIO);
});

test('studio selection keeps a provider track on the sing-along path', () => {
  const track = normalizeStudioTrack({
    id: 'provider:youtube:def456',
    title: 'Provider Take',
    artist: 'Provider Artist',
    playbackType: BACKING_MODES.YOUTUBE,
    backingAudioUrl: null,
    backingProviderTrackId: null,
    youtubeId: 'def456',
    classification: TRACK_CLASSIFICATIONS.SING_ALONG,
    recordingMode: RECORDING_MODES.COMPOSITE,
  });

  assert.equal(track.playbackType, BACKING_MODES.YOUTUBE);
  assert.equal(track.backingProviderTrackId, 'def456');
  assert.equal(track.backingAudioUrl, '');
  assert.equal(track.classification, TRACK_CLASSIFICATIONS.SING_ALONG);
  assert.equal(track.recordingMode, RECORDING_MODES.COMPOSITE);
});

test('studio selection never classifies a youtube-only track as karaoke ready', () => {
  const track = normalizeStudioTrack({
    id: 'provider:youtube:ghi789',
    title: 'Sing Along Only',
    artist: 'Provider Artist',
    youtubeId: 'ghi789',
  });

  assert.equal(track.classification, TRACK_CLASSIFICATIONS.SING_ALONG);
  assert.equal(track.recordingMode, RECORDING_MODES.COMPOSITE);
  assert.notEqual(track.classification, TRACK_CLASSIFICATIONS.KARAOKE_READY);
});

test('studio selection infers backing mode from provider local track fields', () => {
  const fromAsset = normalizeStudioTrack({
    id: 'catalog:64b64b64b64b64b64b64b646',
    title: 'Inferred Asset',
    artist: 'Catalog Artist',
    backingAudioUrl: '/assets/songs/uploads/inferred.mp3',
  });
  assert.equal(fromAsset.playbackType, BACKING_MODES.AUDIO);
  assert.equal(fromAsset.classification, TRACK_CLASSIFICATIONS.KARAOKE_READY);
  assert.equal(fromAsset.recordingMode, RECORDING_MODES.MIXED);

  const fromProvider = normalizeStudioTrack({
    id: 'provider:youtube:jkl012',
    title: 'Inferred Provider',
    artist: 'Catalog Artist',
    backingProviderTrackId: 'jkl012',
  });
  assert.equal(fromProvider.playbackType, BACKING_MODES.YOUTUBE);
  assert.equal(fromProvider.backingProviderTrackId, 'jkl012');
});

test('studio selection fails safely for a missing or unsupported backing source', () => {
  assert.equal(normalizeStudioTrack(null), null);
  assert.equal(normalizeStudioTrack(undefined), null);

  const none = normalizeStudioTrack({
    id: 'provider:youtube:no-source',
    title: 'No Source',
    artist: 'Nobody',
    playbackType: BACKING_MODES.NONE,
    backingAudioUrl: null,
    backingProviderTrackId: null,
    youtubeId: null,
  });
  assert.equal(none.playbackType, BACKING_MODES.NONE);
  assert.equal(none.backingAudioUrl, '');
  assert.equal(resolveBackingSource(none).mode, BACKING_MODES.NONE);

  const broken = normalizeStudioTrack({
    id: 'provider:youtube:broken',
    title: 'Broken Source',
    artist: 'Nobody',
    playbackType: BACKING_MODES.AUDIO,
    backingAudioUrl: '',
    youtubeId: null,
  });
  assert.equal(broken.playbackType, BACKING_MODES.NONE);
});

test('studio starts and replaces backing playback from the track selection gesture', () => {
  const playback = segment(source, 'const startBackingPlayback = (song)', 'const selectSong = (song)');
  assert.match(playback, /stopBackingPlayback\(\)/);
  assert.match(playback, /new Audio\(track\.backingAudioUrl\)/);
  assert.match(playback, /backingAudio\.play\(\)/);
  assert.match(playback, /ensureYoutubePlayer\(track\.backingProviderTrackId\)/);
  assert.match(playback, /playVideo\(\)/);
  assert.match(playback, /return BACKING_MODES\.NONE/);
  assert.doesNotMatch(playback, /getUserMedia/);
  assert.doesNotMatch(playback, /createMediaStreamDestination/);

  const selection = segment(source, 'const selectSong = (song)', 'const startRecording = async');
  assert.match(selection, /normalizeStudioTrack\(song\)/);
  assert.match(selection, /setStep\(STEPS\.RECORD\)/);
  assert.match(selection, /startBackingPlayback\(track\)/);
});

test('studio selection stops the previous backing source before starting the next one', () => {
  const playback = segment(source, 'const startBackingPlayback = (song)', 'const selectSong = (song)');
  const stopIndex = playback.indexOf('stopBackingPlayback()');
  const audioIndex = playback.indexOf('new Audio(track.backingAudioUrl)');
  const youtubeIndex = playback.indexOf('ensureYoutubePlayer(track.backingProviderTrackId)');
  assert.ok(stopIndex > -1 && stopIndex < audioIndex, 'stop must run before local audio start');
  assert.ok(stopIndex < youtubeIndex, 'stop must run before provider playback start');
});

test('studio recording keeps a single backing source and restores an audible audio context', () => {
  const recording = segment(source, 'const startRecording = async', 'const stopRecording = ()');
  assert.match(recording, /stopBackingPlayback\(\)/);
  assert.match(recording, /await backingAudioRef\.current\.play\(\)/);
  assert.match(recording, /audioCtx\.state === 'suspended'/);
  assert.match(recording, /await audioCtx\.resume\(\)/);
  assert.match(recording, /createMediaElementSource\(backingAudioRef\.current\)/);
  assert.match(recording, /backingSpeakerGain\.connect\(audioCtx\.destination\)/);
  assert.doesNotMatch(recording, /merger\.connect\(audioCtx\.destination\)/);
});

test('studio cleans up backing playback on step changes and unmount', () => {
  assert.match(source, /if \(step === STEPS\.SELECT\) \{\s*stopBackingPlayback\(\);/);
  assert.match(source, /cleanupRecording\(\);\s*if \(previewAudioRef\.current\)/);
  assert.match(source, /const stopBackingPlayback = useCallback/);
  assert.match(source, /const cleanupRecording = useCallback/);
  assert.match(source, /stopBackingPlayback\(\);\s+if \(streamRef\.current\)/);
});

test('studio warms the provider player before the selection gesture', () => {
  const warmup = segment(source, 'loadYoutubeApi().catch(() => {});', 'const loadBackingAudio');
  assert.match(warmup, /loadYoutubeApi\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(warmup, /\}, \[\]\);/);
});
