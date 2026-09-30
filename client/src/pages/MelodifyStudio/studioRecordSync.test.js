import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');

const segment = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  assert.notEqual(start, -1, `expected anchor ${from}`);
  assert.ok(end > start, `expected anchor ${to} after ${from}`);
  return text.slice(start, end);
};

const count = (text, needle) => text.split(needle).length - 1;

const selection = () => segment(source, 'const selectSong = (song)', 'const startRecording = async');
const recording = () => segment(source, 'const startRecording = async', 'const stopRecording = ()');
const stopping = () => segment(source, 'const stopRecording = ()', 'const applyPreset');
const failureHelper = () => segment(source, 'const failActiveRecording = (message)', 'const applyPreset');
const catchBlock = () => {
  const body = recording();
  const index = body.indexOf('} catch (error) {');
  assert.notEqual(index, -1, 'startRecording catch block exists');
  return body.slice(index);
};

test('1. selecting a KARAOKE_READY (direct audio) track does not start playback', () => {
  const selectionBody = selection();
  assert.match(selectionBody, /normalizeStudioTrack\(song\)/);
  assert.doesNotMatch(selectionBody, /new Audio\(/);
  assert.doesNotMatch(selectionBody, /\.play\(/);
  assert.doesNotMatch(selectionBody, /loadBackingAudio/);
  assert.doesNotMatch(selectionBody, /startBackingPlayback/);
});

test('2. selecting a SING_ALONG (provider) track does not start playback', () => {
  const selectionBody = selection();
  assert.match(selectionBody, /normalizeStudioTrack\(song\)/);
  assert.doesNotMatch(selectionBody, /playVideo/);
  assert.doesNotMatch(selectionBody, /ensureYoutubePlayer/);
  assert.doesNotMatch(selectionBody, /startBackingPlayback/);
  assert.doesNotMatch(selectionBody, /\.play\(/);
});

test('3. selecting a track sets the ready-to-record state', () => {
  const selectionBody = selection();
  assert.match(selectionBody, /setStep\(STEPS\.RECORD\)/);
  assert.match(selectionBody, /setSelectedSong\(track\)/);
  assert.match(source, /Ready to record/);
});

test('4. Record prepares the microphone before starting any backing playback', () => {
  const body = recording();
  const micIndex = body.indexOf('await navigator.mediaDevices.getUserMedia');
  const backingLoadIndex = body.indexOf('loadBackingAudio(selectedSong)');
  const providerLoadIndex = body.indexOf('ensureYoutubePlayer(selectedSong.backingProviderTrackId');
  const recorderStartIndex = body.indexOf('recorder.start(100)');
  const backingStartIndex = body.indexOf('backingAudioRef.current.play()');
  assert.ok(micIndex > -1, 'microphone acquisition exists');
  assert.ok(backingLoadIndex > micIndex, 'direct backing loads after the microphone');
  assert.ok(providerLoadIndex > micIndex, 'provider backing prepares after the microphone');
  assert.ok(recorderStartIndex > micIndex, 'recorder starts after the microphone');
  assert.ok(backingStartIndex > micIndex, 'backing starts after the microphone');
});

test('5. Record starts MediaRecorder and direct backing in the same start transition', () => {
  const body = recording();
  const recorderStartIndex = body.indexOf('recorder.start(100)');
  const backingStartIndex = body.indexOf('backingAudioRef.current.play()');
  assert.ok(recorderStartIndex > -1, 'recorder start exists');
  assert.ok(backingStartIndex > recorderStartIndex, 'backing starts after the recorder');
  const boundary = body.slice(recorderStartIndex, backingStartIndex);
  assert.doesNotMatch(boundary, /await\s/, 'no await between recorder start and backing start');
  const micIndex = body.indexOf('await navigator.mediaDevices.getUserMedia');
  const recorderSetupIndex = body.indexOf('new MediaRecorder');
  assert.ok(micIndex < recorderSetupIndex && recorderSetupIndex < recorderStartIndex, 'recorder prepared after mic and started at the boundary');
});

test('6. Record starts MediaRecorder plus provider playback for SING_ALONG', () => {
  const body = recording();
  const recorderStartIndex = body.indexOf('recorder.start(100)');
  const providerStartIndex = body.indexOf('youtubePlayerRef.current.playVideo()');
  assert.ok(recorderStartIndex > -1, 'recorder start exists');
  assert.ok(providerStartIndex > recorderStartIndex, 'provider playback starts after the recorder');
  const boundary = body.slice(recorderStartIndex, providerStartIndex);
  assert.doesNotMatch(boundary, /await\s/, 'no await between recorder start and provider start');
  assert.match(body, /selectedSong\.playbackType === 'youtube'/);
});

test('7. microphone permission failure never starts the backing', () => {
  const catchText = catchBlock();
  assert.match(catchText, /NotAllowedError/);
  assert.match(catchText, /Microphone permission denied/);
  assert.doesNotMatch(catchText, /\.play\(/);
  assert.doesNotMatch(catchText, /playVideo/);
  assert.doesNotMatch(catchText, /loadBackingAudio/);
  assert.match(catchText, /applyRecordPhase\(RECORD_PHASES\.IDLE\)/);
});

test('8. MediaRecorder setup failure never starts the backing', () => {
  const catchText = catchBlock();
  assert.doesNotMatch(catchText, /\.play\(/);
  assert.doesNotMatch(catchText, /playVideo/);
  const body = recording();
  const recorderSetupIndex = body.indexOf('new MediaRecorder');
  const backingLoadIndex = body.indexOf('loadBackingAudio(selectedSong)');
  assert.ok(recorderSetupIndex > -1 && recorderSetupIndex < backingLoadIndex, 'recorder is prepared before backing load so setup failure blocks playback');
});

test('9. backing failure rolls back the active recording safely', () => {
  const body = recording();
  assert.match(body, /started\.catch\(/);
  assert.match(body, /failActiveRecording\(/);
  assert.match(body, /backingAudioRef\.current\.onerror/);
  const helper = failureHelper();
  assert.match(helper, /playbackFailureRef\.current = message/);
  assert.match(helper, /stopRecording\(\)/);
  assert.match(helper, /RECORD_PHASES\.RECORDING/);
  const failureBranchIndex = body.indexOf('const failureMessage = playbackFailureRef.current;');
  const previewIndex = body.indexOf('setStep(STEPS.PREVIEW)');
  assert.ok(failureBranchIndex > -1 && failureBranchIndex < previewIndex, 'failure rollback branch precedes the preview transition');
  const onstopHead = body.slice(failureBranchIndex, body.indexOf('const blob = new Blob'));
  assert.match(onstopHead, /setRecordingError\(failureMessage\)/);
  assert.match(onstopHead, /applyRecordPhase\(RECORD_PHASES\.IDLE\)/);
  assert.doesNotMatch(onstopHead, /setStep\(STEPS\.PREVIEW\)/);
});

test('10. Stop stops the MediaRecorder', () => {
  const stopBody = stopping();
  assert.match(stopBody, /recordPhaseRef\.current !== RECORD_PHASES\.RECORDING\) return/);
  assert.match(stopBody, /mediaRecorderRef\.current && mediaRecorderRef\.current\.state === 'recording'/);
  assert.match(stopBody, /mediaRecorderRef\.current\.stop\(\)/);
});

test('11. Stop stops the direct backing audio', () => {
  const stopBody = stopping();
  assert.match(stopBody, /backingAudioRef\.current\.pause\(\)/);
});

test('12. Stop pauses provider playback', () => {
  const stopBody = stopping();
  assert.match(stopBody, /stopYoutubeBacking\(\)/);
  assert.match(source, /const stopYoutubeBacking = [\s\S]{0,200}pauseVideo\(\)/);
});

test('13. Stop resets the song to the beginning where supported', () => {
  const stopBody = stopping();
  assert.match(stopBody, /backingAudioRef\.current\.currentTime = 0/);
  assert.match(source, /const stopYoutubeBacking = [\s\S]{0,250}seekTo\(0, true\)/);
});

test('14. a second recording take starts the backing from the beginning', () => {
  const body = recording();
  const resetIndex = body.indexOf('backingAudioRef.current.currentTime = 0');
  const providerResetIndex = body.indexOf('seekTo(0, false)');
  const backingStartIndex = body.indexOf('backingAudioRef.current.play()');
  assert.ok(resetIndex > -1 && resetIndex < backingStartIndex, 'direct backing resets to 0 before the start boundary');
  assert.ok(providerResetIndex > -1, 'provider backing resets to 0 before playback');
  const stopBody = stopping();
  assert.match(stopBody, /backingAudioRef\.current\.currentTime = 0/);
});

test('15. track switching is blocked during recording', () => {
  assert.match(selection(), /recordPhaseRef\.current !== RECORD_PHASES\.IDLE\) return/);
  const changeBody = segment(source, 'const changeSong = ()', 'return (');
  assert.match(changeBody, /recordPhaseRef\.current !== RECORD_PHASES\.IDLE\) return/);
  assert.match(source, /onClick=\{changeSong\}\s+disabled=\{recordPhase !== RECORD_PHASES\.IDLE\}/);
  assert.match(source, /disabled=\{recordPhase !== RECORD_PHASES\.IDLE\}/);
});

test('16. changing the selected track while idle never autoplays', () => {
  const selectionBody = selection();
  assert.match(selectionBody, /stopBackingPlayback\(\)/);
  assert.doesNotMatch(selectionBody, /\.play\(/);
  assert.doesNotMatch(selectionBody, /playVideo/);
  assert.doesNotMatch(selectionBody, /loadBackingAudio/);
  assert.doesNotMatch(selectionBody, /ensureYoutubePlayer/);
});

test('17. natural direct-backing end finalizes the recording', () => {
  const body = recording();
  assert.match(body, /backingAudioRef\.current\.onended = \(\) =>/);
  assert.match(body, /recordPhaseRef\.current === RECORD_PHASES\.RECORDING\) stopRecording\(\)/);
});

test('18. a double Record click cannot create a duplicate backing source', () => {
  const body = recording();
  const head = body.slice(0, body.indexOf('try {'));
  assert.match(head, /recordPhaseRef\.current !== RECORD_PHASES\.IDLE\) return/);
  assert.match(source, /onClick=\{startRecording\}\s+disabled=\{recordPhase !== RECORD_PHASES\.IDLE\}/);
  assert.equal(count(body, 'loadBackingAudio(selectedSong)'), 1, 'single backing load per take');
});

test('19. a double Record click cannot create a duplicate MediaRecorder', () => {
  const body = recording();
  const head = body.slice(0, body.indexOf('try {'));
  assert.match(head, /recordPhaseRef\.current !== RECORD_PHASES\.IDLE\) return/);
  assert.equal(count(body, 'mediaRecorderRef.current = recorder'), 1, 'single recorder assignment per take');
  assert.match(source, /disabled=\{recordPhase !== RECORD_PHASES\.IDLE\}/);
});

test('20. KARAOKE_READY mix behavior remains intact', () => {
  assert.match(source, /createMediaElementSource\(backingAudioRef\.current\)/);
  assert.match(source, /createMediaStreamDestination\(\)/);
  assert.match(source, /backingSourceNode\.connect\(backingRecorderGain\)/);
  assert.match(source, /backingRecorderGain\.connect\(dest\)/);
  assert.match(source, /merger\.connect\(dest\)/);
  assert.match(source, /backingSpeakerGain\.connect\(audioCtx\.destination\)/);
  assert.doesNotMatch(source, /merger\.connect\(audioCtx\.destination\)/);
});

test('21. SING_ALONG provider audio is never captured or ripped', () => {
  assert.doesNotMatch(source, /createMediaElementSource\(youtube/i);
  assert.doesNotMatch(source, /youtubePlayerRef\.current\.(connect|captureStream)/);
  assert.match(source, /selectedSong\.playbackType === 'audio' \? 'MIXED' : 'COMPOSITE'/);
  assert.match(source, /formData\.append\('recordingMode'/);
  assert.match(source, /formData\.append\('backingProviderId'/);
});
