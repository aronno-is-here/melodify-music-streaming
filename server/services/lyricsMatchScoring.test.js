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

test('scoreLyricsMatch accepts noisy title and artist as exact after normalization', () => {
  const result = scoreLyricsMatch({
    song: {
      title: 'Tum Hi Ho (Official Video)',
      artist: 'Arijit Singh - Topic',
      duration: '4:05',
    },
    candidate: {
      trackName: 'Tum Hi Ho',
      artistName: 'Arijit Singh',
      duration: 245,
    },
  });
  assert.equal(result.classification, LYRICS_MATCH_CLASS.EXACT);
});

test('scoreLyricsMatch keeps unknown-artist candidate ambiguous instead of high', () => {
  const result = scoreLyricsMatch({
    song: { title: 'Tum Hi Ho', artist: 'Arijit Singh', duration: '4:05' },
    candidate: {
      trackName: 'Tum Hi Ho',
      artistName: 'Unknown Singers',
      duration: 245,
    },
  });
  assert.equal(result.classification, LYRICS_MATCH_CLASS.AMBIGUOUS);
});

test('scoreLyricsMatch lets album and duration raise the score when available', () => {
  const song = { title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Hamari Adhuri Kahani', duration: '4:05' };
  const candidate = { trackName: 'Tum Hi Ho', artistName: 'Arijit Singh' };
  const withoutExtras = scoreLyricsMatch({ song, candidate });
  const withExtras = scoreLyricsMatch({
    song,
    candidate: { ...candidate, albumName: 'Hamari Adhuri Kahani', duration: 245 },
  });
  assert.ok(withExtras.score > withoutExtras.score);
  assert.equal(withExtras.classification, LYRICS_MATCH_CLASS.EXACT);
});

test('scoreLyricsMatch never classifies far-off duration as exact', () => {
  const result = scoreLyricsMatch({
    song: { title: 'Tum Hi Ho', artist: 'Arijit Singh', duration: '4:05' },
    candidate: { trackName: 'Tum Hi Ho', artistName: 'Arijit Singh', duration: 600 },
  });
  assert.notEqual(result.classification, LYRICS_MATCH_CLASS.EXACT);
});

test('scoreLyricsMatch scores the derived title when the artist repeats at the end', () => {
  const result = scoreLyricsMatch({
    song: {
      title: 'Opare - Bay of Bengal (Official Video)',
      artist: 'Bay of Bengal',
      duration: '4:25',
    },
    candidate: {
      trackName: 'Opare',
      artistName: 'Bay of Bengal',
      albumName: 'Bay of Bengal Songs',
      duration: 265,
    },
  });
  assert.equal(result.classification, LYRICS_MATCH_CLASS.EXACT);
});

test('scoreLyricsMatch scores the derived title when the artist leads the title', () => {
  const result = scoreLyricsMatch({
    song: {
      title: 'Arijit Singh - Tum Hi Ho (Official Video)',
      artist: 'Arijit Singh',
      duration: '4:05',
    },
    candidate: {
      trackName: 'Tum Hi Ho',
      artistName: 'Arijit Singh',
      duration: 245,
    },
  });
  assert.equal(result.classification, LYRICS_MATCH_CLASS.EXACT);
});

