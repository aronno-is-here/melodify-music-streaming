import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYBACK_STATUS_MESSAGES,
  PLAYBACK_RETRY_LABEL,
  PLAYBACK_RETRY_ARIA_LABEL,
  selectPlaybackStatusPresentation,
} from './playbackStatusUi.js';

test('loading presents the fixed loading message without retry', () => {
  const ui = selectPlaybackStatusPresentation({ playbackStatus: 'loading', hasSong: true });
  assert.equal(ui.visible, true);
  assert.equal(ui.message, 'Loading…');
  assert.equal(ui.showRetry, false);
});

test('blocked presents tap to play with a retry action', () => {
  const ui = selectPlaybackStatusPresentation({ playbackStatus: 'blocked', hasSong: true });
  assert.equal(ui.visible, true);
  assert.equal(ui.message, 'Tap to play');
  assert.equal(ui.showRetry, true);
  assert.equal(ui.retryLabel, 'Retry');
  assert.equal(ui.retryAriaLabel, 'Retry playback');
});

test('error presents a bounded friendly failure with a retry action', () => {
  const ui = selectPlaybackStatusPresentation({ playbackStatus: 'error', hasSong: true });
  assert.equal(ui.visible, true);
  assert.equal(ui.message, 'Unable to play this song.');
  assert.equal(ui.showRetry, true);
  assert.equal(ui.retryAriaLabel, PLAYBACK_RETRY_ARIA_LABEL);
  assert.equal(ui.retryLabel, PLAYBACK_RETRY_LABEL);
});

test('idle playing and paused present no status surface', () => {
  for (const status of ['idle', 'playing', 'paused']) {
    const ui = selectPlaybackStatusPresentation({ playbackStatus: status, hasSong: true });
    assert.equal(ui.visible, false, status);
    assert.equal(ui.message, null, status);
    assert.equal(ui.showRetry, false, status);
  }
});

test('no current song always hides the status surface', () => {
  for (const status of ['loading', 'blocked', 'error', 'idle', 'playing', 'paused']) {
    const ui = selectPlaybackStatusPresentation({ playbackStatus: status, hasSong: false });
    assert.equal(ui.visible, false, status);
    assert.equal(ui.showRetry, false, status);
  }
});

test('unknown status strings never render a message or retry', () => {
  const ui = selectPlaybackStatusPresentation({ playbackStatus: 'weird-status', hasSong: true });
  assert.equal(ui.visible, false);
  assert.equal(ui.message, null);
  assert.equal(ui.showRetry, false);
});

test('missing or non string status throws instead of guessing', () => {
  assert.throws(() => selectPlaybackStatusPresentation({ hasSong: true }), TypeError);
  assert.throws(() => selectPlaybackStatusPresentation({ playbackStatus: 7, hasSong: true }), TypeError);
  assert.throws(() => selectPlaybackStatusPresentation(), TypeError);
});

test('messages are exactly three fixed literals with no engine details', () => {
  assert.deepEqual(Object.keys(PLAYBACK_STATUS_MESSAGES), ['loading', 'blocked', 'error']);
  assert.deepEqual(Object.values(PLAYBACK_STATUS_MESSAGES), [
    'Loading…',
    'Tap to play',
    'Unable to play this song.',
  ]);
  const serialized = JSON.stringify(PLAYBACK_STATUS_MESSAGES);
  assert.equal(/youtube|Error \d|#|stack|code/i.test(serialized), false);
});

test('presentation exposes only factual display fields', () => {
  const ui = selectPlaybackStatusPresentation({ playbackStatus: 'error', hasSong: true });
  assert.deepEqual(Object.keys(ui).sort(), [
    'message',
    'retryAriaLabel',
    'retryLabel',
    'showRetry',
    'visible',
  ]);
});
