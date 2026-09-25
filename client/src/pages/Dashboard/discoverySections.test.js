import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecentlyAddedSongs,
  createQuickPicks,
  createGenreBuckets,
  createArtistBuckets,
} from './discoverySections.js';

const songs = [
  { _id: '1', title: 'One', artist: 'A', genre: 'Rock' },
  { _id: '2', title: 'Two', artist: 'B', genre: 'Pop' },
  { _id: '3', title: 'Three', artist: 'A', genre: 'Rock' },
  { _id: '4', title: 'Four', artist: 'C', genre: 'Jazz' },
];

test('recently added keeps newest-first list order and deduplicates by _id', () => {
  const result = createRecentlyAddedSongs([songs[0], songs[0], songs[1], songs[2]], 3);
  assert.deepEqual(result.map((song) => song._id), ['1', '2', '3']);
});

test('quick picks combine history, favorites, and catalog without duplicates', () => {
  const result = createQuickPicks({
    history: [songs[2], songs[1]],
    favorites: [songs[1], songs[0]],
    songs,
    limit: 5,
  });
  assert.deepEqual(result.map((song) => song._id), ['3', '2', '1', '4']);
});

test('genre buckets derive factual groups with bounded songs per bucket', () => {
  const result = createGenreBuckets(songs, { bucketLimit: 3, songLimit: 1 });
  assert.deepEqual(result.map((bucket) => bucket.label), ['Jazz', 'Pop', 'Rock']);
  assert.deepEqual(result.map((bucket) => bucket.count), [1, 1, 1]);
  assert.deepEqual(result[2].songs.map((song) => song._id), ['1']);
});

test('artist buckets derive factual groups and keep deterministic ordering', () => {
  const result = createArtistBuckets(songs, { bucketLimit: 3, songLimit: 3 });
  assert.deepEqual(result.map((bucket) => bucket.label), ['A', 'B', 'C']);
  assert.deepEqual(result.map((bucket) => bucket.count), [2, 1, 1]);
});

test('empty and malformed input fail closed to empty collections', () => {
  assert.deepEqual(createRecentlyAddedSongs(null), []);
  assert.deepEqual(createQuickPicks(), []);
  assert.deepEqual(createGenreBuckets([{ _id: '' }, null, 1]), []);
  assert.deepEqual(createArtistBuckets(undefined), []);
});
