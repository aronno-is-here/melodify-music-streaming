import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTrackAlbum,
  normalizeTrackArtist,
  normalizeTrackTitle,
  prepareTrackForProvider,
} from './trackNormalization.js';

test('normalizeTrackTitle strips noise brackets and keeps version brackets', () => {
  assert.equal(normalizeTrackTitle('Shape of You (Official Audio)'), 'Shape of You');
  assert.equal(normalizeTrackTitle('Lehra Doon (Lyrics)'), 'Lehra Doon');
  assert.equal(normalizeTrackTitle('Perfect (Live)'), 'Perfect (Live)');
  assert.equal(normalizeTrackTitle('Acoustic Song [Visualizer]'), 'Acoustic Song');
});

test('normalizeTrackTitle trims trailing noise words and phrases', () => {
  assert.equal(normalizeTrackTitle('Song Name 4K'), 'Song Name');
  assert.equal(normalizeTrackTitle('Song Name - Official Video'), 'Song Name');
  assert.equal(normalizeTrackTitle('Official Video - My Song'), 'My Song');
  assert.equal(normalizeTrackTitle('The Sound of Music'), 'The Sound of Music');
});

test('normalizeTrackTitle removes featured credits', () => {
  assert.equal(normalizeTrackTitle('Stay (feat. Justin Bieber)'), 'Stay');
  assert.equal(normalizeTrackTitle('One Love ft. XYZ'), 'One Love');
});

test('normalizeTrackArtist strips topic and vevo suffixes', () => {
  assert.equal(normalizeTrackArtist('Arijit Singh - Topic'), 'Arijit Singh');
  assert.equal(normalizeTrackArtist('Coldplay VEVO'), 'Coldplay');
  assert.equal(normalizeTrackArtist('Artist feat. Someone'), 'Artist');
  assert.equal(normalizeTrackArtist('Lady Gaga & Bruno Mars'), 'Lady Gaga & Bruno Mars');
});

test('normalizeTrackAlbum strips noise brackets only', () => {
  assert.equal(normalizeTrackAlbum('Album Name (Official)'), 'Album Name');
  assert.equal(normalizeTrackAlbum('Album (Deluxe Edition)'), 'Album (Deluxe Edition)');
});

test('prepareTrackForProvider splits artist prefix when it matches the artist', () => {
  const matched = prepareTrackForProvider({
    title: 'Arijit Singh - Tum Hi Ho (Official Video)',
    artist: 'Arijit Singh',
    album: 'Album',
    duration: '4:05',
  });
  assert.equal(matched.title, 'Tum Hi Ho');
  assert.equal(matched.artist, 'Arijit Singh');
  assert.equal(matched.album, 'Album');
  assert.equal(matched.duration, '4:05');
});

test('prepareTrackForProvider keeps title when prefix does not match artist', () => {
  const result = prepareTrackForProvider({ title: 'Jai Ho - Slumdog', artist: 'Arijit Singh' });
  assert.equal(result.title, 'Jai Ho - Slumdog');
  assert.equal(result.artist, 'Arijit Singh');
});

test('prepareTrackForProvider adopts artist prefix when artist is missing', () => {
  const result = prepareTrackForProvider({ title: 'Pritam - Tum Hi Ho', artist: '' });
  assert.equal(result.title, 'Tum Hi Ho');
  assert.equal(result.artist, 'Pritam');
});

test('prepareTrackForProvider drops trailing artist suffix from the title', () => {
  const result = prepareTrackForProvider({
    title: 'Opare - Bay of Bengal (Official Video)',
    artist: 'Bay of Bengal',
  });
  assert.equal(result.title, 'Opare');
  assert.equal(result.artist, 'Bay of Bengal');
});

test('prepareTrackForProvider keeps trailing suffix that does not match the artist', () => {
  const result = prepareTrackForProvider({
    title: 'Opare - Bay of Bengal (Official Video)',
    artist: 'J A F Music',
  });
  assert.equal(result.title, 'Opare - Bay of Bengal');
  assert.equal(result.artist, 'J A F Music');
});

test('prepareTrackForProvider handles empty input without throwing', () => {
  const result = prepareTrackForProvider({});
  assert.equal(result.title, '');
  assert.equal(result.artist, '');
  assert.equal(result.album, '');
  assert.equal(result.duration, undefined);
});
