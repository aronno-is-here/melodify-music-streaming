import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'PlayerContext.jsx'), 'utf8');
const telemetrySrc = readFileSync(join(__dirname, 'listeningTelemetry.js'), 'utf8');
const dashboardSrc = readFileSync(join(__dirname, '..', 'pages', 'Dashboard', 'Dashboard.jsx'), 'utf8');
const shellPlayerSrc = readFileSync(join(__dirname, '..', 'components', 'app', 'GlobalPlayerBar.jsx'), 'utf8');
const fullPlayerSrc = readFileSync(join(__dirname, '..', 'pages', 'Dashboard', 'FullScreenPlayer.jsx'), 'utf8');
const statusUiSrc = readFileSync(join(__dirname, '..', 'pages', 'Dashboard', 'playbackStatusUi.js'), 'utf8');

const slice = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to));

const switchTrackBlock = slice(src, 'const switchTrack', 'const playSong =');
const markPlayingBlock = slice(src, 'const markPlaying =', 'const markPaused =');
const markPausedBlock = slice(src, 'const markPaused =', 'const isYoutubeTrackActive');
const initTimerBlock = slice(src, 'const startInitTimer =', 'const startConfirmTimer =');
const confirmTimerBlock = slice(src, 'const startConfirmTimer =', 'const markPlaying =');
const togglePlayBlock = slice(src, 'const togglePlay =', 'const pause =');
const retryBlock = slice(src, 'const retryPlayback =', 'const value =');
const valueBlock = slice(src, 'const value = {', 'return <PlayerContext.Provider');
const ytPlayingBlock = slice(src, 'if (e.data === window.YT.PlayerState.PLAYING)', '} else if (e.data === window.YT.PlayerState.PAUSED)');
const ytPausedBlock = slice(src, '} else if (e.data === window.YT.PlayerState.PAUSED)', '} else if (e.data === window.YT.PlayerState.ENDED)');
const ytErrorBlock = slice(src, 'onError:', 'const loadYT');
const audioPlayBlock = slice(src, "audio.addEventListener('play'", "audio.addEventListener('pause'");
const audioPauseBlock = slice(src, "audio.addEventListener('pause'", 'loadYT();');

test('11: selecting a not ready YouTube song enters loading, not playing', () => {
  assert.match(switchTrackBlock, /PLAYBACK_STATUS\.LOADING/);
  assert.match(switchTrackBlock, /pendingLoadRef\.current = \{ song \}/);
  assert.match(switchTrackBlock, /startInitTimer\(\)/);
  assert.equal(switchTrackBlock.includes('setIsPlaying(true)'), false);
  assert.equal(switchTrackBlock.includes('markPlaying'), false);
});

test('12: isPlaying remains false before engine confirmation', () => {
  const setTrue = src.match(/setIsPlaying\(true\)/g) || [];
  assert.equal(setTrue.length, 1);
  assert.match(markPlayingBlock, /setIsPlaying\(true\)/);
  assert.equal(markPlayingBlock.includes('setStatus(PLAYBACK_STATUS.PLAYING)'), true);
  const calls = src.match(/markPlaying\(\)/g) || [];
  assert.equal(calls.length, 2);
});

test('13: YT PLAYING sets playing and isPlaying true', () => {
  assert.match(ytPlayingBlock, /markPlaying\(\)/);
  assert.match(src, /PlayerState\.PLAYING/);
});

test('14: YT PAUSED sets paused and isPlaying false', () => {
  assert.match(ytPausedBlock, /markPaused\(\)/);
  assert.match(markPausedBlock, /setIsPlaying\(false\)/);
  assert.match(markPausedBlock, /setStatus\(PLAYBACK_STATUS\.PAUSED\)/);
});

test('15: HTML audio play confirms playing', () => {
  assert.match(audioPlayBlock, /markPlaying\(\)/);
  assert.match(audioPlayBlock, /telemetry\.confirmedPlay\(/);
});

test('16: HTML audio pause confirms paused', () => {
  assert.match(audioPauseBlock, /markPaused\(\)/);
  assert.match(markPausedBlock, /setStatus\(PLAYBACK_STATUS\.PAUSED\)/);
});

test('17: blocked or deferred path retries from an explicit user action', () => {
  assert.match(valueBlock, /\n    retryPlayback,\r?\n/);
  assert.equal((src.match(/retryPlayback\(/g) || []).length, 0);
  assert.match(shellPlayerSrc, /onClick=\{player\.retryPlayback\}/);
  assert.match(fullPlayerSrc, /onClick=\{player\.retryPlayback\}/);
  assert.match(confirmTimerBlock, /setStatus\(PLAYBACK_STATUS\.BLOCKED\)/);
});

test('18: initialization timeout enters a bounded failure state', () => {
  assert.match(src, /export const YOUTUBE_INIT_TIMEOUT_MS = 10000/);
  assert.match(src, /export const PLAY_CONFIRM_TIMEOUT_MS = 8000/);
  assert.match(initTimerBlock, /setTimeout\(/);
  assert.match(initTimerBlock, /YOUTUBE_INIT_TIMEOUT_MS/);
  assert.match(initTimerBlock, /setStatus\(PLAYBACK_STATUS\.ERROR\)/);
  assert.equal((src.match(/setTimeout\(/g) || []).length, 2);
});

test('19: YouTube error enters a visible failure state', () => {
  assert.match(ytErrorBlock, /setStatus\(PLAYBACK_STATUS\.ERROR\)/);
  assert.match(ytErrorBlock, /setIsPlaying\(false\)/);
  assert.match(ytErrorBlock, /nextRef\.current\(\)/);
  assert.equal(ytErrorBlock.includes('manual-next'), false);
});

test('20: HTML audio play rejection enters a failure state', () => {
  const rejections = src.match(/attempt\.catch\(\(\) => \{[\s\S]*?\}\)/g) || [];
  assert.ok(rejections.length >= 2, 'audio play rejections are handled');
  for (const block of rejections) {
    assert.match(block, /setStatus\(PLAYBACK_STATUS\.ERROR\)/);
    assert.match(block, /setIsPlaying\(false\)/);
  }
  assert.equal(switchTrackBlock.includes('audio.play().catch(() => {})'), false);
});

test('21: retry does not create an automatic loop', () => {
  assert.equal((src.match(/retryPlayback\(/g) || []).length, 0);
  assert.equal((src.match(/setInterval\(/g) || []).length, 1);
  assert.equal((src.match(/setTimeout\(/g) || []).length, 2);
  assert.equal(/retryPlayback/.test(ytErrorBlock), false);
  assert.equal(/retryPlayback/.test(initTimerBlock), false);
  assert.equal(/retryPlayback/.test(confirmTimerBlock), false);
});

test('22: no raw engine error leaks into the UI', () => {
  assert.equal(/lastError|errorMessage|engineError|errorDetail/.test(src), false);
  assert.equal(/lastError|errorMessage|engineError|errorDetail/.test(dashboardSrc), false);
  assert.equal(dashboardSrc.includes('{error.message}'), false);
  assert.equal(dashboardSrc.includes('{err.message}'), false);
  assert.match(statusUiSrc, /Unable to play this song\./);
  assert.match(statusUiSrc, /Tap to play/);
  assert.match(statusUiSrc, /Loading…/);
  assert.equal(/youtube|Error \d|#[0-9a-f]{3,8}/i.test(statusUiSrc), false);
  assert.equal(/onError|console\./.test(statusUiSrc), false);
});

test('23: same playing song toggle pauses without reloading', () => {
  const pauseBranch = togglePlayBlock.slice(
    togglePlayBlock.indexOf('if (playing)'),
    togglePlayBlock.indexOf('pendingLoadRef.current = { song }'),
  );
  assert.match(pauseBranch, /pauseVideo\(\)/);
  assert.match(pauseBranch, /audioRef\.current\?\.pause\(\)/);
  assert.equal(pauseBranch.includes('playSongRef'), false);
  assert.equal(pauseBranch.includes('loadVideo'), false);
  assert.equal(pauseBranch.includes('switchTrack'), false);
});

test('24: same paused song resumes without resetting position', () => {
  const resumeBlock = togglePlayBlock.slice(togglePlayBlock.indexOf('if (playerReadyRef.current && ytRef.current)'));
  assert.match(resumeBlock, /ytRef\.current\.playVideo\(\)/);
  assert.equal(resumeBlock.includes('loadVideoById'), false);
  assert.equal(resumeBlock.includes('playSongRef.current'), false);
  assert.equal(resumeBlock.includes('seekTo(0'), false);
  assert.equal(togglePlayBlock.includes('loadVideo('), false);
  assert.match(togglePlayBlock, /pendingLoadRef\.current = \{ song \}/);
});

test('25: selecting a different song still changes queue and index', () => {
  assert.match(switchTrackBlock, /stateRef\.current\.list = newList/);
  assert.match(switchTrackBlock, /stateRef\.current\.index = i/);
  assert.match(switchTrackBlock, /setList\(newList\)/);
  assert.match(switchTrackBlock, /setIndex\(i\)/);
  assert.match(src, /switchTrack\(newList, i, 'new-selection'\)/);
});

test('26: no play-started from loading', () => {
  for (const line of src.split('\n')) {
    if (line.includes('setStatus(PLAYBACK_STATUS.LOADING')) {
      assert.equal(line.includes('telemetry.'), false, line);
      assert.equal(line.includes('confirmedPlay'), false, line);
    }
  }
  assert.match(switchTrackBlock, /setStatus\(PLAYBACK_STATUS\.LOADING\)/);
  assert.equal(switchTrackBlock.includes('confirmedPlay'), false);
});

test('27: no play-started from blocked', () => {
  for (const line of src.split('\n')) {
    if (line.includes('PLAYBACK_STATUS.BLOCKED')) {
      assert.equal(line.includes('telemetry.'), false, line);
      assert.equal(line.includes('confirmedPlay'), false, line);
    }
  }
});

test('28: no play-started from error', () => {
  for (const line of src.split('\n')) {
    if (line.includes('PLAYBACK_STATUS.ERROR')) {
      assert.equal(line.includes('telemetry.'), false, line);
      assert.equal(line.includes('confirmedPlay'), false, line);
    }
  }
  assert.equal(retryBlock.includes('telemetry.'), false);
  assert.equal(confirmTimerBlock.includes('telemetry.'), false);
  assert.equal(initTimerBlock.includes('telemetry.'), false);
});

test('29: play-started remains engine confirmed', () => {
  const confirmed = src.match(/telemetry\.confirmedPlay\(/g) || [];
  assert.equal(confirmed.length, 2);
  assert.match(ytPlayingBlock, /telemetry\.confirmedPlay\(/);
  assert.match(audioPlayBlock, /telemetry\.confirmedPlay\(/);
  assert.equal(switchTrackBlock.includes('confirmedPlay'), false);
  assert.equal(retryBlock.includes('confirmedPlay'), false);
});

test('30: progress cadence unchanged', () => {
  assert.equal((src.match(/telemetry\.progress\(/g) || []).length, 2);
  assert.match(src, /}, 250\);/);
  assert.match(telemetrySrc, /export const PROGRESS_EMIT_INTERVAL_SECONDS = 15;/);
  assert.equal((telemetrySrc.match(/PROGRESS_EMIT_INTERVAL_SECONDS/g) || []).length >= 3, true);
});

test('31: skipped ordering unchanged', () => {
  assert.equal((src.match(/telemetry\.skip\(/g) || []).length, 1);
  assert.match(switchTrackBlock, /if \(!sameTrack && transitionReason\)/);
  assert.ok(
    switchTrackBlock.indexOf('telemetry.skip(') < switchTrackBlock.indexOf('telemetry.prepare(song)'),
  );
  assert.match(src, /const next = useCallback\(\(\) => advanceNext\('manual-next'\)/);
  assert.match(src, /playSongRef\.current\(l, n, 'manual-previous'\)/);
  assert.match(src, /playSongRef\.current\(l, n, transitionReason\)/);
});

test('32: completed behavior unchanged', () => {
  assert.equal((src.match(/telemetry\.complete\(/g) || []).length, 2);
  const ytEndBlock = slice(src, '} else if (e.data === window.YT.PlayerState.ENDED)', 'onError:');
  const audioEndBlock = slice(src, "audio.addEventListener('ended'", "audio.addEventListener('play'");
  for (const block of [ytEndBlock, audioEndBlock]) {
    assert.match(block, /telemetry\.complete\(/);
    assert.match(block, /nextRef\.current\(\)/);
    assert.equal(/manual-next|telemetry\.skip|confirmedPlay/.test(block), false);
  }
});

test('33: replay-started behavior unchanged', () => {
  assert.match(telemetrySrc, /emit\('replay-started'/);
  assert.match(telemetrySrc, /eventType === 'replay-started'/);
  assert.equal((telemetrySrc.match(/'replay-started'/g) || []).length >= 2, true);
});

test('34: history write remains first confirmed play only', () => {
  assert.equal((src.match(/api\.post\('\/api\/history'/g) || []).length, 1);
  assert.equal((src.match(/api\.post\('\/api\/listening-events'/g) || []).length, 1);
  assert.equal(dashboardSrc.includes("api.post('/api/history'"), false);
  assert.equal(dashboardSrc.includes('recordPlay'), false);
  assert.match(src, /recordHistory: \(songId\) =>/);
});

test('playback status vocabulary is the six factual states', () => {
  assert.match(src, /IDLE: 'idle'/);
  assert.match(src, /LOADING: 'loading'/);
  assert.match(src, /PLAYING: 'playing'/);
  assert.match(src, /PAUSED: 'paused'/);
  assert.match(src, /BLOCKED: 'blocked'/);
  assert.match(src, /ERROR: 'error'/);
  assert.match(valueBlock, /playbackStatus,/);
});

test('deferred YouTube container has no negative stacking', () => {
  assert.equal(src.includes('z-index:-1'), false);
  assert.match(src, /pointer-events:none/);
  assert.match(src, /opacity:0\.01/);
});

test('dashboard renders the status surface with an accessible retry button', () => {
  assert.match(shellPlayerSrc, /selectPlaybackStatusPresentation\(/);
  assert.match(shellPlayerSrc, /role="status"/);
  assert.match(fullPlayerSrc, /role="status"/);
  assert.match(shellPlayerSrc, /onClick=\{player\.retryPlayback\}/);
  assert.match(fullPlayerSrc, /onClick=\{player\.retryPlayback\}/);
  assert.equal(dashboardSrc.includes('setInterval'), false);
  assert.equal(dashboardSrc.includes('refresh()'), false);
});
