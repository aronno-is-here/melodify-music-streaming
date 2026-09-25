import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CatalogImportError,
  createCatalogImportService,
} from './catalogImportService.js';

const TRACK = {
  title: 'Die With A Smile',
  artist: 'Lady Gaga & Bruno Mars',
  youtube_id: 'Fn6Ul6sYqro',
  thumbnail: 'https://img.youtube.com/vi/Fn6Ul6sYqro/hqdefault.jpg',
  duration: '4:11',
  language: 'en',
};

function createFakeSongModel() {
  const byIdentity = new Map();
  const byYoutube = new Map();
  let seq = 0;

  const makeDoc = (doc) => ({
    ...doc,
    save: async function save() {
      byIdentity.set(`${this.source_provider}|${this.external_id}`, this);
      if (this.youtube_id) byYoutube.set(this.youtube_id, this);
      return this;
    },
  });

  return {
    async findOne(query) {
      if (query.source_provider && query.external_id) {
        return byIdentity.get(`${query.source_provider}|${query.external_id}`) || null;
      }
      if (query.youtube_id) {
        return byYoutube.get(query.youtube_id) || null;
      }
      return null;
    },
    async create(doc) {
      seq += 1;
      const created = makeDoc({ _id: String(seq), ...doc });
      byIdentity.set(`${created.source_provider}|${created.external_id}`, created);
      if (created.youtube_id) byYoutube.set(created.youtube_id, created);
      return created;
    },
    __seed(doc) {
      const seeded = makeDoc(doc);
      byIdentity.set(`${seeded.source_provider}|${seeded.external_id}`, seeded);
      if (seeded.youtube_id) byYoutube.set(seeded.youtube_id, seeded);
      return seeded;
    },
  };
}

const providerRegistry = {
  getProvider(provider) {
    if (provider !== 'youtube') return null;
    return {
      async getTrack() {
        return { ...TRACK };
      },
    };
  },
};

test('import inserts a new canonical provider song', async () => {
  const SongModel = createFakeSongModel();
  const service = createCatalogImportService({ SongModel, providerRegistry });
  const result = await service.importProviderTrack({ provider: 'youtube', providerTrackId: 'Fn6Ul6sYqro' });
  assert.equal(result.status, 'inserted');
  assert.equal(result.song.youtube_id, 'Fn6Ul6sYqro');
});

test('import returns existing for duplicate identity', async () => {
  const SongModel = createFakeSongModel();
  SongModel.__seed({
    _id: '1',
    title: 'Existing',
    artist: 'A',
    genre: 'Unknown',
    youtube_id: 'Fn6Ul6sYqro',
    source_provider: 'youtube',
    external_id: 'Fn6Ul6sYqro',
  });
  const service = createCatalogImportService({ SongModel, providerRegistry });
  const result = await service.importProviderTrack({ provider: 'youtube', providerTrackId: 'Fn6Ul6sYqro' });
  assert.equal(result.status, 'existing');
  assert.equal(result.song._id, '1');
});

test('import adopts legacy youtube song when canonical identity is missing', async () => {
  const SongModel = createFakeSongModel();
  const legacy = SongModel.__seed({
    _id: 'legacy-1',
    title: 'Legacy',
    artist: 'A',
    genre: 'Unknown',
    youtube_id: 'Fn6Ul6sYqro',
    source_provider: '',
    external_id: '',
  });
  const service = createCatalogImportService({ SongModel, providerRegistry });
  const result = await service.importProviderTrack({ provider: 'youtube', providerTrackId: 'Fn6Ul6sYqro' });
  assert.equal(result.status, 'adopted-legacy');
  assert.equal(result.song._id, 'legacy-1');
  assert.equal(legacy.source_provider, 'youtube');
});

test('import rejects unsupported provider', async () => {
  const SongModel = createFakeSongModel();
  const service = createCatalogImportService({ SongModel, providerRegistry });
  await assert.rejects(
    () => service.importProviderTrack({ provider: 'spotify', providerTrackId: 'x' }),
    (error) => error instanceof CatalogImportError && error.code === 'UNSUPPORTED_PROVIDER',
  );
});
