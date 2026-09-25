import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from './formatDuration.js';

test('formats API clock strings and numeric seconds without losing hours', () => {
  for (const [input, expected] of [['4:43', '4:43'], [' 5:22 ', '5:22'], [283, '4:43'], ['283', '4:43'], [0, '0:00'], [3601, '1:00:01'], ['1:02:03', '1:02:03']]) {
    assert.equal(formatDuration(input), expected);
  }
});

test('supports explicit milliseconds without guessing units from magnitude', () => {
  assert.equal(formatDuration(283000, 'milliseconds'), '4:43');
  assert.equal(formatDuration('283000ms'), '4:43');
  assert.equal(formatDuration(86400), '24:00:00');
});

test('missing and malformed durations never render NaN or invented values', () => {
  for (const input of [null, undefined, '', ' ', 'unknown', '4:75', '1:99:00', '-3', -1, NaN, Infinity, true, {}, '4:']) {
    assert.equal(formatDuration(input), '—');
  }
});
