import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_LYRICS_ERROR_MESSAGES,
  ADMIN_LYRICS_MATCH_STATUS,
  ADMIN_LYRICS_VERIFIED_SOURCE,
  AdminLyricsConflictError,
  AdminLyricsNotFoundError,
  AdminLyricsValidationError,
  createAdminLyricsService,
  isValidSongId,
} from './adminLyricsService.js';
import { createLyricsProviderService } from './lyricsProviderService.js';
import { createLyricsCache } from './lyricsCache.js';

const SONG_ID = '64b64b64b64b64b64b64b640';
const OTHER_ID = '64b64b64b64b64b64b64b641';
const FIXED_NOW = () => new Date('2026-01-02T03:04:05.000Z');

function makeSongDoc(fields) {
  const doc = {
    _id: SONG_ID,
    title: 'Tum Hi Ho',
    artist: 'Arijit Singh',
    album: 'Hamari Adhuri Kahani',
    duration: '4:05',
    language: 'hi',
    lyrics: '',
    lyrics_verified: false,
    lyrics_source: 'none',
    saveCount: 0,
    async save() {
      this.saveCount += 1;
      return this;
    },
    ...fields,
  };
  return doc;
}

function makeSaveService({ song } = {}) {
  const target = song ?? makeSongDoc({});
  const service = createAdminLyricsService({
    SongModel: {
      findById: (id) => ({
        select: async () => (String(id) === String(target._id) ? target : null),
      }),
    },
  });
  return { service, song: target };
}

function makeQueueService({ total = 0, docs = [] } = {}) {
  const calls = { count: [], find: [] };
  const service = createAdminLyricsService({
    SongModel: {
      countDocuments: async (filter) => {
        calls.count.push(filter);
        return total;
      },
      find: (filter) => {
        const record = { filter };
        calls.find.push(record);
        const chain = {
          select: (value) => { record.select = value; return chain; },
          sort: (value) => { record.sort = value; return chain; },
          skip: (value) => { record.skip = value; return chain; },
          limit: (value) => { record.limit = value; return chain; },
          lean: async () => docs,
        };
        return chain;
      },
    },
  });
  return { service, calls };
}

function makeBulkService({ docs = [] } = {}) {
  const calls = { find: [], updates: [] };
  const service = createAdminLyricsService({
    SongModel: {
      find: (filter) => {
        const record = { filter };
        calls.find.push(record);
        const chain = {
          select: (value) => { record.select = value; return chain; },
          lean: async () => docs,
        };
        return chain;
      },
      updateOne: async (filter, update) => {
        calls.updates.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
  });
  return { service, calls };
}

test('queue listing is paginated, sorted and never selects the lyric body', async () => {
  const { service, calls } = makeQueueService({
    total: 57,
    docs: [
      {
        _id: SONG_ID,
        title: 'Tum Hi Ho',
        artist: 'Arijit Singh',
        lyrics: '',
        lyrics_verified: false,
        lyrics_source: 'none',
        language: 'hi',
      },
    ],
  });

  const result = await service.listMissingLyrics({ page: '2', limit: '20', language: 'hindi' });

  assert.equal(result.state, 'ready');
  assert.equal(result.total, 57);
  assert.equal(result.pages, 3);
  assert.equal(result.page, 2);
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].songId, SONG_ID);
  assert.equal(result.rows[0].lyricsStatus, 'missing');
  assert.equal('lyrics' in result.rows[0], false);

  assert.equal(calls.find[0].skip, 20);
  assert.equal(calls.find[0].limit, 20);
  assert.deepEqual(calls.find[0].sort, { title: 1, _id: 1 });
  assert.match(calls.find[0].select, /\+language/);
  assert.ok(calls.count[0]);
});

test('queue listing reports an empty state when nothing matches', async () => {
  const { service } = makeQueueService({ total: 0, docs: [] });
  const result = await service.listMissingLyrics({});
  assert.equal(result.state, 'empty');
  assert.equal(result.total, 0);
  assert.deepEqual(result.rows, []);
});

test('queue listing rejects unsupported query parameters', async () => {
  const { service } = makeQueueService();
  await assert.rejects(
    () => service.listMissingLyrics({ userId: 'abc' }),
    (error) => error instanceof AdminLyricsValidationError && error.status === 400,
  );
});

test('plain text is saved as verified local lyrics with full metadata', async () => {
  const { service, song } = makeSaveService();
  const result = await service.saveVerifiedLyrics({
    songId: SONG_ID,
    lyrics: 'Line one\nLine two\n',
    language: 'hindi',
    sourceUrl: 'https://example.com/lyrics',
    sourceProvider: 'lrclib',
    notes: 'manually checked',
    verifiedBy: '64b64b64b64b64b64b64b6ff',
    now: FIXED_NOW,
  });

  assert.equal(result.saved, true);
  assert.equal(result.replaced, false);
  assert.equal(result.format, 'plain');
  assert.equal(result.lyricsVerified, true);
  assert.equal(song.saveCount, 1);
  assert.equal(song.lyrics, 'Line one\nLine two');
  assert.equal(song.lyrics_verified, true);
  assert.equal(song.lyrics_source, ADMIN_LYRICS_VERIFIED_SOURCE);
  assert.equal(song.lyrics_source_url, 'https://example.com/lyrics');
  assert.equal(song.lyrics_provider_id, 'lrclib');
  assert.equal(song.lyrics_language, 'hindi');
  assert.equal(song.lyrics_notes, 'manually checked');
  assert.equal(song.lyrics_match_status, ADMIN_LYRICS_MATCH_STATUS);
  assert.equal(song.lyrics_verified_by, '64b64b64b64b64b64b64b6ff');
  assert.equal(song.lyrics_last_checked_at.toISOString(), '2026-01-02T03:04:05.000Z');
});

test('valid LRC is stored as synced verified lyrics', async () => {
  const { service, song } = makeSaveService();
  const result = await service.saveVerifiedLyrics({
    songId: SONG_ID,
    lyrics: '[00:12.40]First line\n[00:16.90]Second line',
    format: 'lrc',
    now: FIXED_NOW,
  });

  assert.equal(result.format, 'lrc');
  assert.equal(result.presentation.synced, true);
  assert.equal(result.presentation.displayLines[0].text, 'First line');
  assert.equal(result.presentation.displayLines[0].time, 12.4);
  assert.equal(song.lyrics_verified, true);
  assert.match(song.lyrics, /^\[00:12\.40\]First line/);
});

test('malformed LRC is rejected without touching the song', async () => {
  const { service, song } = makeSaveService();
  await assert.rejects(
    () => service.saveVerifiedLyrics({ songId: SONG_ID, lyrics: '[00:99.00]Broken' }),
    (error) => error instanceof AdminLyricsValidationError && error.status === 400,
  );
  assert.equal(song.saveCount, 0);
  assert.equal(song.lyrics, '');
});

test('unknown song ids are rejected before any write', async () => {
  const { service, song } = makeSaveService();
  await assert.rejects(
    () => service.saveVerifiedLyrics({ songId: 'nope', lyrics: 'words' }),
    (error) => error instanceof AdminLyricsValidationError && error.code === 'SONG_ID_INVALID',
  );
  await assert.rejects(
    () => service.saveVerifiedLyrics({ songId: OTHER_ID, lyrics: 'words' }),
    (error) => error instanceof AdminLyricsNotFoundError && error.status === 404,
  );
  assert.equal(song.saveCount, 0);
  assert.equal(isValidSongId(SONG_ID), true);
  assert.equal(isValidSongId('short'), false);
});

test('existing verified lyrics block overwrites unless replace is explicit', async () => {
  const { service, song } = makeSaveService({
    song: makeSongDoc({ lyrics: 'already verified', lyrics_verified: true }),
  });

  await assert.rejects(
    () => service.saveVerifiedLyrics({ songId: SONG_ID, lyrics: 'replacement' }),
    (error) => {
      assert.ok(error instanceof AdminLyricsConflictError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'VERIFIED_LYRICS_EXISTS');
      assert.equal(error.message, ADMIN_LYRICS_ERROR_MESSAGES.VERIFIED_LYRICS_EXISTS);
      return true;
    },
  );
  assert.equal(song.lyrics, 'already verified');
  assert.equal(song.saveCount, 0);

  const result = await service.saveVerifiedLyrics({
    songId: SONG_ID,
    lyrics: 'replacement',
    replaceVerified: true,
    now: FIXED_NOW,
  });
  assert.equal(result.replaced, true);
  assert.equal(song.lyrics, 'replacement');
  assert.equal(song.saveCount, 1);
});

test('legacy unverified lyrics do not trigger duplicate protection', async () => {
  const { service, song } = makeSaveService({
    song: makeSongDoc({ lyrics: 'legacy words', lyrics_verified: false }),
  });
  const result = await service.saveVerifiedLyrics({ songId: SONG_ID, lyrics: 'fresh', now: FIXED_NOW });
  assert.equal(result.saved, true);
  assert.equal(result.replaced, false);
  assert.equal(song.saveCount, 1);
});

test('Hindi lyrics are presented romanized by default', async () => {
  const { service } = makeSaveService();
  const result = await service.saveVerifiedLyrics({
    songId: SONG_ID,
    lyrics: 'कैसे बताएं',
    language: 'hindi',
    now: FIXED_NOW,
  });
  assert.equal(result.presentation.script, 'devanagari');
  assert.ok(Array.isArray(result.presentation.romanizedLines));
  assert.notEqual(result.presentation.displayLines[0].text, 'कैसे बताएं');
  assert.match(result.presentation.displayLines[0].text, /^[a-z]/i);
  assert.equal(result.presentation.plain, 'कैसे बताएं');
});

test('Bengali lyrics keep বাংলা as the display default while exposing romanization', async () => {
  const { service } = makeSaveService();
  const result = await service.saveVerifiedLyrics({
    songId: SONG_ID,
    lyrics: 'কেন হঠাৎ তুমি এলে',
    language: 'bn-bd',
    now: FIXED_NOW,
  });
  assert.equal(result.presentation.script, 'bengali');
  assert.ok(Array.isArray(result.presentation.romanizedLines));
  assert.notEqual(result.presentation.romanizedLines[0].text, 'কেন হঠাৎ তুমি এলে');
  assert.equal(result.presentation.displayLines[0].text, 'কেন হঠাৎ তুমি এলে');
});

test('English lyrics are never romanized', async () => {
  const { service } = makeSaveService();
  const result = await service.saveVerifiedLyrics({
    songId: SONG_ID,
    lyrics: 'Comfortably Numb',
    language: 'english',
    now: FIXED_NOW,
  });
  assert.equal(result.presentation.script, 'latin');
  assert.equal(result.presentation.romanizedLines, null);
  assert.equal(result.presentation.displayLines[0].text, 'Comfortably Numb');
});

test('saved verified lyrics win the user-facing read path without any provider call', async () => {
  const { service, song } = makeSaveService();
  await service.saveVerifiedLyrics({ songId: SONG_ID, lyrics: 'Verified line one\nVerified line two', now: FIXED_NOW });

  const providerService = createLyricsProviderService({
    SongModel: { findById: async () => song },
    lrclibClient: {
      getExact: () => { throw new Error('provider must not be called'); },
      search: () => { throw new Error('provider must not be called'); },
    },
    lyricsCache: createLyricsCache(),
  });

  const result = await providerService.resolveSongLyrics(SONG_ID);
  assert.equal(result.notFound, false);
  assert.equal(result.lyrics.source, 'verified-db');
  assert.equal(result.lyrics.status, 'verified');
  assert.equal(result.lyrics.synced, false);
  assert.equal(result.song.lyrics_verified, true);
  assert.equal(result.song.lyrics_source, ADMIN_LYRICS_VERIFIED_SOURCE);
});

test('bulk import counts imported, duplicate, rejected and invalid entries', async () => {
  const { service, calls } = makeBulkService({
    docs: [
      { _id: SONG_ID, lyrics: '', lyrics_verified: false },
      { _id: OTHER_ID, lyrics: 'already verified', lyrics_verified: true },
    ],
  });

  const csv = [
    'songId,lyrics,language',
    `${SONG_ID},Brand new words,hindi`,
    `${OTHER_ID},Should be skipped,hindi`,
    '64b64b64b64b64b64b64b649,Unknown song,hindi',
  ].join('\n');

  const result = await service.bulkImport({
    text: csv,
    fileName: 'songs.csv',
    verifiedBy: '64b64b64b64b64b64b64b6ff',
    now: FIXED_NOW,
  });

  assert.equal(result.format, 'csv');
  assert.deepEqual(result.counts, {
    imported: 1,
    rejected: 1,
    duplicate: 1,
    invalid: 0,
    total: 3,
  });
  assert.deepEqual(result.importedSongIds, [SONG_ID]);
  assert.equal(result.rejected[0].reason, 'songId does not match a Melodify song');
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].filter, { _id: SONG_ID });
  assert.equal(calls.updates[0].update.$set.lyrics, 'Brand new words');
  assert.equal(calls.updates[0].update.$set.lyrics_verified, true);
  assert.equal(calls.updates[0].update.$set.lyrics_source, ADMIN_LYRICS_VERIFIED_SOURCE);
  assert.equal(calls.updates[0].update.$set.lyrics_verified_by, '64b64b64b64b64b64b64b6ff');
  assert.equal(calls.updates[0].update.$set.lyrics_last_checked_at.toISOString(), '2026-01-02T03:04:05.000Z');
});

test('bulk import rejects structurally invalid entries without dropping the batch', async () => {
  const { service, calls } = makeBulkService({ docs: [{ _id: SONG_ID, lyrics: '', lyrics_verified: false }] });
  const json = JSON.stringify([
    { songId: SONG_ID, lyrics: 'Good line' },
    { songId: 'bad id', lyrics: 'Bad id line' },
    { songId: '64b64b64b64b64b64b64b649', lyrics: 'Unknown song' },
  ]);

  const result = await service.bulkImport({ text: json, fileName: 'songs.json', now: FIXED_NOW });

  assert.equal(result.counts.imported, 1);
  assert.equal(result.counts.invalid, 1);
  assert.equal(result.counts.rejected, 1);
  assert.equal(result.counts.duplicate, 0);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(calls.updates.length, 1);
});

test('bulk import reports every invalid entry instead of failing silently', async () => {
  const { service } = makeBulkService();
  const result = await service.bulkImport({
    text: JSON.stringify([{ notAnObject: true }, { songId: SONG_ID }]),
    fileName: 'songs.json',
    now: FIXED_NOW,
  });
  assert.equal(result.counts.imported, 0);
  assert.equal(result.counts.invalid, 2);
  assert.equal(result.counts.total, 2);
  assert.equal(result.invalid.length, 2);
});

test('bulk import rejects malformed payloads with a validation error', async () => {
  const { service, calls } = makeBulkService();
  await assert.rejects(
    () => service.bulkImport({ text: 'not json at all', fileName: 'songs.json' }),
    (error) => error instanceof AdminLyricsValidationError && error.status === 400,
  );
  await assert.rejects(
    () => service.bulkImport({ text: 'songId\nanything', fileName: 'songs.txt' }),
    (error) => error instanceof AdminLyricsValidationError && error.status === 400,
  );
  assert.equal(calls.updates.length, 0);
});

test('bulk import enforces the batch ceiling', async () => {
  const { service } = makeBulkService();
  const entries = Array.from({ length: 501 }, () => ({ songId: SONG_ID, lyrics: 'line' }));
  await assert.rejects(
    () => service.bulkImport({ text: JSON.stringify(entries), fileName: 'songs.json' }),
    (error) => {
      assert.ok(error instanceof AdminLyricsValidationError);
      assert.equal(error.status, 400);
      assert.match(error.message, /at most 500 entries/);
      return true;
    },
  );
});

test('service factory requires a Song model', () => {
  assert.throws(() => createAdminLyricsService({}), /SongModel is required/);
});
