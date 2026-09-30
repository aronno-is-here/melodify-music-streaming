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
const youtubePrepare = () => segment(recording(), "} else if (selectedSong.playbackType === 'youtube')", 'const recordingMode');
const failureHelper = () => segment(source, 'const failActiveRecording = (message)', 'const applyPreset');
const stopYoutube = () => segment(source, 'const stopYoutubeBacking = ()', 'const stopBackingPlayback');

test('DIRECT select does not play: selection stores the track without audio.play, new Audio, or provider playback', () => {
  const body = selection();
  assert.match(body, /setSelectedSong\(track\)/);
  assert.match(body, /setStep\(STEPS\.RECORD\)/);
  assert.doesNotMatch(body, /\.play\(/);
  assert.doesNotMatch(body, /new Audio\(/);
  assert.doesNotMatch(body, /loadBackingAudio/);
  assert.doesNotMatch(body, /playVideo/);
  assert.doesNotMatch(body, /ensureYoutubePlayer/);
  assert.doesNotMatch(source, /const startBackingPlayback/);
});

test('DIRECT Record: recorder.start runs before audio.play with no await in between', () => {
  const body = recording();
  const recorderStartIndex = body.indexOf('recorder.start(100)');
  const playIndex = body.indexOf('backingAudioRef.current.play()');
  assert.ok(recorderStartIndex > -1, 'recorder start exists');
  assert.ok(playIndex > recorderStartIndex, 'backing play follows the recorder start');
  const boundary = body.slice(recorderStartIndex, playIndex);
  assert.doesNotMatch(boundary, /await\s/, 'start transition is synchronous after recorder.start');
  assert.match(source, /onClick=\{startRecording\}/);
});

test('DIRECT Record: backing is cued to zero and the AudioContext resumes before playback', () => {
  const body = recording();
  const resetIndex = body.indexOf('backingAudioRef.current.currentTime = 0');
  const resumeIndex = body.indexOf('await audioCtx.resume()');
  const playIndex = body.indexOf('backingAudioRef.current.play()');
  assert.ok(resumeIndex > -1, 'suspended AudioContext is resumed');
  assert.ok(resetIndex > -1 && resetIndex < playIndex, 'backing resets to 0 before play');
  assert.ok(resumeIndex < playIndex, 'context resumes before play');
});

test('DIRECT Record: backing is audible through AudioContext.destination and recorded through the destination stream', () => {
  const body = recording();
  assert.match(body, /createMediaElementSource\(backingAudioRef\.current\)/);
  assert.equal(count(body, 'createMediaElementSource(backingAudioRef.current)'), 1, 'single MediaElementSource per take');
  assert.match(body, /backingSourceNode\.connect\(backingSpeakerGain\)/);
  assert.match(body, /backingSpeakerGain\.connect\(audioCtx\.destination\)/);
  assert.match(body, /backingSourceNode\.connect\(backingRecorderGain\)/);
  assert.match(body, /backingRecorderGain\.connect\(dest\)/);
  assert.match(body, /createMediaStreamDestination\(\)/);
  assert.match(body, /new MediaRecorder\(dest\.stream/);
});

test('DIRECT Record: the microphone reaches the recorder destination but never the speakers', () => {
  const body = recording();
  assert.match(body, /audioCtx\.createMediaStreamSource\(stream\)/);
  assert.match(body, /merger\.connect\(dest\)/);
  const speakerSends = body.split('connect(audioCtx.destination)').length - 1;
  assert.equal(speakerSends, 1, 'exactly one connection to the speakers');
  assert.match(body, /backingSpeakerGain\.connect\(audioCtx\.destination\)/);
  assert.doesNotMatch(body, /source\.connect\(audioCtx\.destination\)/);
  assert.doesNotMatch(body, /gainNode\.connect\(audioCtx\.destination\)/);
  assert.doesNotMatch(body, /merger\.connect\(audioCtx\.destination\)/);
});

test('DIRECT Stop: pauses the backing, resets it to zero, then finalizes the recorder', () => {
  const body = stopping();
  const pauseIndex = body.indexOf('backingAudioRef.current.pause()');
  const resetIndex = body.indexOf('backingAudioRef.current.currentTime = 0');
  const recorderStopIndex = body.indexOf('mediaRecorderRef.current.stop()');
  assert.ok(pauseIndex > -1, 'backing pauses');
  assert.ok(resetIndex > pauseIndex, 'backing resets after pause');
  assert.ok(recorderStopIndex > resetIndex, 'recorder finalizes after the backing stops');
  assert.match(body, /stopYoutubeBacking\(\)/);
});

test('DIRECT second take: every take loads a fresh backing cued to zero before play', () => {
  const body = recording();
  const stopBody = stopping();
  assert.match(body, /stopBackingPlayback\(\)/);
  assert.equal(count(body, 'loadBackingAudio(selectedSong)'), 1, 'single backing load per take');
  const resetIndex = body.indexOf('backingAudioRef.current.currentTime = 0');
  const playIndex = body.indexOf('backingAudioRef.current.play()');
  assert.ok(resetIndex > -1 && resetIndex < playIndex, 'fresh backing starts from 0');
  assert.match(stopBody, /backingAudioRef\.current\.currentTime = 0/);
  assert.match(source, /backingAudioRef\.current = null;/);
});

test('DIRECT play rejection: rolls the recorder back to Ready with the error surfaced', () => {
  const body = recording();
  assert.match(body, /started\.catch\(/);
  assert.match(body, /failActiveRecording\(/);
  const helper = failureHelper();
  assert.match(helper, /playbackFailureRef\.current = message/);
  assert.match(helper, /stopRecording\(\)/);
  const failureBranchIndex = body.indexOf('const failureMessage = playbackFailureRef.current;');
  const blobIndex = body.indexOf('const blob = new Blob');
  assert.ok(body.indexOf('recorder.onstop') > -1 && body.indexOf('recorder.onstop') < failureBranchIndex, 'handled inside onstop');
  assert.ok(failureBranchIndex > -1 && blobIndex > failureBranchIndex, 'failure branch precedes the preview transition');
  const onstopText = body.slice(failureBranchIndex, blobIndex);
  assert.match(onstopText, /cleanupRecording\(\)/);
  assert.match(onstopText, /setRecordingError\(failureMessage\)/);
  assert.match(onstopText, /applyRecordPhase\(RECORD_PHASES\.IDLE\)/);
  assert.doesNotMatch(onstopText, /setStep\(STEPS\.PREVIEW\)/);
});

test('YOUTUBE select does not play: no provider cue or playback from selection', () => {
  const body = selection();
  assert.match(body, /setSelectedSong\(track\)/);
  assert.doesNotMatch(body, /playVideo/);
  assert.doesNotMatch(body, /pauseVideo/);
  assert.doesNotMatch(body, /cueVideoById/);
  assert.doesNotMatch(body, /ensureYoutubePlayer/);
  assert.doesNotMatch(body, /\.play\(/);
});

test('YOUTUBE Record: seeks to zero before the recorder starts, then invokes playVideo after it', () => {
  const body = recording();
  const prepareIndex = body.indexOf("await ensureYoutubePlayer(selectedSong.backingProviderTrackId");
  const seekIndex = body.indexOf('youtubePlayerRef.current.seekTo(0, false)');
  const recorderStartIndex = body.indexOf('recorder.start(100)');
  const playVideoIndex = body.indexOf('youtubePlayerRef.current.playVideo()');
  assert.ok(prepareIndex > -1, 'provider player is prepared at Record time');
  assert.ok(seekIndex > prepareIndex && seekIndex < recorderStartIndex, 'video resets to 0 before the recorder starts');
  assert.ok(playVideoIndex > recorderStartIndex, 'playVideo follows recorder.start');
  const boundary = body.slice(recorderStartIndex, playVideoIndex);
  assert.doesNotMatch(boundary, /await\s/, 'no await between recorder start and provider playback');
  assert.match(youtubePrepare(), /selectedSong\.playbackType === 'youtube'/);
});

test('YOUTUBE Stop: pauses the player and resets it to zero', () => {
  const stopBody = stopping();
  assert.match(stopBody, /stopYoutubeBacking\(\)/);
  const youtubeStop = stopYoutube();
  assert.match(youtubeStop, /pauseVideo\(\)/);
  assert.match(youtubeStop, /seekTo\(0, true\)/);
});

test('YOUTUBE second take: cued track starts from zero again', () => {
  const body = recording();
  assert.match(source, /cueVideoById\(trackId\)/);
  assert.ok(body.indexOf('seekTo(0, false)') > -1, 'record resets the cued video to 0');
  const stopBody = stopping();
  assert.match(stopBody, /stopYoutubeBacking\(\)/);
  assert.match(stopYoutube(), /seekTo\(0, true\)/);
});

test('YOUTUBE audio is never mixed into the MediaRecorder', () => {
  const prepare = youtubePrepare();
  assert.doesNotMatch(prepare, /connect\(/);
  assert.doesNotMatch(prepare, /createMediaElementSource/);
  assert.doesNotMatch(source, /createMediaElementSource\(youtube/i);
  assert.doesNotMatch(source, /youtubePlayerRef\.current\.(connect|captureStream)/);
  const body = recording();
  assert.match(body, /merger\.connect\(dest\)/);
  assert.match(body, /backingRecorderGain\.connect\(dest\)/);
});

test('YOUTUBE iframe is explicitly JS-controllable with enablejsapi=1', () => {
  assert.match(source, /enablejsapi: 1/);
  assert.match(source, /playerVars: \{[\s\S]{0,220}enablejsapi: 1/);
});

test('SHARED: a double Record click cannot create a duplicate recorder or backing', () => {
  const body = recording();
  const head = body.slice(0, body.indexOf('try {'));
  assert.match(head, /recordPhaseRef\.current !== RECORD_PHASES\.IDLE\) return/);
  assert.match(source, /onClick=\{startRecording\}\s+disabled=\{recordPhase !== RECORD_PHASES\.IDLE\}/);
  assert.equal(count(body, 'recorder.start('), 1, 'single recorder start per take');
  assert.equal(count(body, 'mediaRecorderRef.current = recorder'), 1, 'single recorder assignment per take');
  assert.equal(count(body, 'loadBackingAudio(selectedSong)'), 1, 'single backing load per take');
  assert.match(source, /const isRecording = recordPhase === RECORD_PHASES\.RECORDING \|\| recordPhase === RECORD_PHASES\.STOPPING/);
});

test('SHARED: track switching stays blocked while recording', () => {
  assert.match(selection(), /recordPhaseRef\.current !== RECORD_PHASES\.IDLE\) return/);
  const changeBody = segment(source, 'const changeSong = ()', 'return (');
  assert.match(changeBody, /recordPhaseRef\.current !== RECORD_PHASES\.IDLE\) return/);
  assert.match(source, /onClick=\{changeSong\}\s+disabled=\{recordPhase !== RECORD_PHASES\.IDLE\}/);
});

test('SHARED: playback only starts from the Record transition for both modes', () => {
  const body = recording();
  assert.match(body, /backingAudioRef\.current\.play\(\)/);
  assert.match(body, /youtubePlayerRef\.current\.playVideo\(\)/);
  assert.match(source, /Record & play song/);
  const outside = source.split('const startRecording = async').slice(1).join('');
  const afterRecording = outside.slice(outside.indexOf('const stopRecording = ()'));
  assert.doesNotMatch(afterRecording.slice(0, afterRecording.indexOf('const failActiveRecording')), /\.play\(\)/);
  assert.doesNotMatch(selection(), /\.play\(\)/);
});
