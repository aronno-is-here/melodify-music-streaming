import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRICS_MATCH_CLASS,
  scoreLyricsMatch,
  selectBestLyricsCandidate,
} from './lyricsMatchScoring.js';

const SONG = {
  title: 'Die With A Smile',
  artist: 'Lady Gaga & Bruno Mars',
  album: 'Die With A Smile',
  duration: '4:11',
};

test('scoreLyricsMatch classifies exact match', () => {
  const result = scoreLyricsMatch({
    song: SONG,
    candidate: {
      trackName: 'Die With A Smile',
      artistName: 'Lady Gaga & Bruno Mars',
      albumName: 'Die With A Smile',
      duration: 251,
    },
  });
  assert.equal(result.classification, LYRICS_MATCH_CLASS.EXACT);
});

test('scoreLyricsMatch classifies obvious mismatch as NONE', () => {
  const result = scoreLyricsMatch({
    song: SONG,
    candidate: {
      trackName: 'Some Other Song',
      artistName: 'Different Artist',
      albumName: 'Unknown',
      duration: 190,
    },
  });
  assert.equal(result.classification, LYRICS_MATCH_CLASS.NONE);
});

test('scoreLyricsMatch penalizes version mismatch markers', () => {
  const result = scoreLyricsMatch({
    song: { ...SONG, title: 'Die With A Smile' },
    candidate: {
      trackName: 'Die With A Smile (Live)',
      artistName: 'Lady Gaga & Bruno Mars',
      duration: 251,
    },
  });
  assert.notEqual(result.classification, LYRICS_MATCH_CLASS.EXACT);
});

test('selectBestLyricsCandidate returns highest-scoring result', () => {
  const selected = selectBestLyricsCandidate(SONG, [
    { trackName: 'Other', artistName: 'Other', duration: 200 },
    { trackName: 'Die With A Smile', artistName: 'Lady Gaga & Bruno Mars', duration: 251 },
  ]);
  assert.equal(selected.classification, LYRICS_MATCH_CLASS.EXACT);
  assert.equal(selected.best.trackName, 'Die With A Smile');
});
