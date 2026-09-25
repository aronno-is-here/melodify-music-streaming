import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKaraokeDiscoveryService,
  KARAOKE_DISCOVERY_CLASSIFICATION,
  KARAOKE_DISCOVERY_MODE,
} from './karaokeDiscoveryService.js';

function createFakeKaraokeModel(rows) {
  return {
    find() {
      return {
        select() { return this; },
        sort() { return this; },
        limit() { return this; },
        lean: async () => rows,
      };
    },
  };
}

test('karaoke discovery classifies local backing as karaoke ready and provider as sing along', async () => {
  const KaraokeModel = createFakeKaraokeModel([
    {
      _id: 'k1',
      title: 'Local Backing',
      artist: 'Singer',
      poster_url: '/poster-a.jpg',
      duration: '3:00',
      file_path: 'assets/songs/uploads/local-backing.mp3',
      youtube_id: '',
      lyrics: '',
    },
  ]);

  const service = createKaraokeDiscoveryService({
    KaraokeModel,
    catalogDiscoveryService: {
      async searchCatalog() {
        return {
          externalState: 'ready',
          externalError: null,
          mergedResults: [
            {
              sourceType: 'external',
              provider: 'youtube',
              providerTrackId: 'abc123',
              youtube_id: 'abc123',
              title: 'Provider Track',
              artist: 'Artist B',
              duration: '4:00',
              thumbnail: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
            },
          ],
        };
      },
    },
  });

  const result = await service.discoverTracks({ query: 'song', limit: 10, page: 1 });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].classification, KARAOKE_DISCOVERY_CLASSIFICATION.KARAOKE_READY);
  assert.equal(result.items[0].recordingMode, KARAOKE_DISCOVERY_MODE.MIXED);
  assert.equal(result.items[0].playbackType, 'audio');
  assert.equal(result.items[0].backingAudioUrl, '/assets/songs/uploads/local-backing.mp3');
  assert.equal(result.items[1].classification, KARAOKE_DISCOVERY_CLASSIFICATION.SING_ALONG);
  assert.equal(result.items[1].recordingMode, KARAOKE_DISCOVERY_MODE.COMPOSITE);
  assert.equal(result.items[1].playbackType, 'youtube');
});

test('karaoke discovery dedupes deterministic youtube duplicates', async () => {
  const KaraokeModel = createFakeKaraokeModel([
    {
      _id: 'k2',
      title: 'Same Song',
      artist: 'Artist X',
      poster_url: '',
      duration: '3:30',
      file_path: '',
      youtube_id: 'dup-yt',
      lyrics: '',
    },
  ]);

  const service = createKaraokeDiscoveryService({
    KaraokeModel,
    catalogDiscoveryService: {
      async searchCatalog() {
        return {
          externalState: 'ready',
          externalError: null,
          mergedResults: [
            {
              sourceType: 'external',
              provider: 'youtube',
              providerTrackId: 'dup-yt',
              youtube_id: 'dup-yt',
              title: 'Same Song',
              artist: 'Artist X',
              thumbnail: '',
            },
          ],
        };
      },
    },
  });

  const result = await service.discoverTracks({ query: 'same', limit: 10, page: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'karaoke:k2');
});

test('karaoke discovery returns bounded pagination slices', async () => {
  const KaraokeModel = createFakeKaraokeModel([
    { _id: 'a', title: 'A', artist: 'A', poster_url: '', duration: '', file_path: '', youtube_id: '', lyrics: '' },
    { _id: 'b', title: 'B', artist: 'B', poster_url: '', duration: '', file_path: '', youtube_id: '', lyrics: '' },
    { _id: 'c', title: 'C', artist: 'C', poster_url: '', duration: '', file_path: '', youtube_id: '', lyrics: '' },
  ]);
  const service = createKaraokeDiscoveryService({
    KaraokeModel,
    catalogDiscoveryService: {
      async searchCatalog() {
        return { externalState: 'skipped', externalError: null, mergedResults: [] };
      },
    },
  });

  const pageTwo = await service.discoverTracks({ query: '', limit: 2, page: 2 });
  assert.equal(pageTwo.limit, 2);
  assert.equal(pageTwo.page, 2);
  assert.equal(pageTwo.total, 3);
  assert.equal(pageTwo.pages, 2);
  assert.equal(pageTwo.items.length, 1);
  assert.equal(pageTwo.items[0].id, 'karaoke:c');
});
