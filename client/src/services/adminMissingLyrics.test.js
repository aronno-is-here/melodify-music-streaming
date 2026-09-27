import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_MISSING_LYRICS_PATH,
  ADMIN_LYRICS_IMPORT_PATH,
  MAX_LYRICS_TEXT_LENGTH,
  MAX_LYRICS_FILE_BYTES,
  MAX_BULK_IMPORT_BYTES,
  MAX_BULK_LYRICS_ENTRIES,
  LYRICS_FILE_EXTENSIONS,
  BULK_IMPORT_FILE_EXTENSIONS,
  MISSING_LYRICS_LANGUAGE_FILTERS,
  ADMIN_MISSING_LYRICS_MESSAGES,
  lyricsSongPath,
  getFileExtension,
  buildMissingLyricsPath,
  detectLyricsFormat,
  validateLyricsFileSelection,
  validateBulkFileSelection,
  validateLyricsDraft,
  normalizeMissingLyricsQueueResponse,
  normalizeAdminLyricsSaveResponse,
  normalizeBulkImportResponse,
  mapAdminLyricsError,
  fetchMissingLyricsQueue,
  saveVerifiedLyrics,
  importVerifiedLyrics,
  findSongLyricsSources,
} from './adminMissingLyrics.js';

test('1: fixed api paths', () => {
  assert.equal(ADMIN_MISSING_LYRICS_PATH, '/api/admin/lyrics');
  assert.equal(ADMIN_LYRICS_IMPORT_PATH, '/api/admin/lyrics/import');
  assert.equal(lyricsSongPath('abc'), '/api/admin/lyrics/abc');
});

test('2: bounded constants', () => {
  assert.equal(MAX_LYRICS_TEXT_LENGTH, 100000);
  assert.equal(MAX_LYRICS_FILE_BYTES, 262144);
  assert.equal(MAX_BULK_IMPORT_BYTES, 786432);
  assert.equal(MAX_BULK_LYRICS_ENTRIES, 500);
  assert.deepEqual([...LYRICS_FILE_EXTENSIONS], ['.txt', '.lrc']);
  assert.deepEqual([...BULK_IMPORT_FILE_EXTENSIONS], ['.csv', '.json']);
});

test('3: language filter vocabulary', () => {
  assert.deepEqual(
    MISSING_LYRICS_LANGUAGE_FILTERS.map((entry) => entry.value),
    ['', 'hindi', 'bn-bd', 'bn-in', 'english'],
  );
  assert.equal(MISSING_LYRICS_LANGUAGE_FILTERS[0].label, 'All languages');
});

test('4: getFileExtension', () => {
  assert.equal(getFileExtension('a.TXT'), '.txt');
  assert.equal(getFileExtension('  song.lrc  '), '.lrc');
  assert.equal(getFileExtension('archive.tar.gz'), '.gz');
  assert.equal(getFileExtension('noext'), '');
  assert.equal(getFileExtension('.hidden'), '');
  assert.equal(getFileExtension(42), '');
});

test('5: buildMissingLyricsPath omits absent params', () => {
  assert.equal(buildMissingLyricsPath(), ADMIN_MISSING_LYRICS_PATH);
  assert.equal(buildMissingLyricsPath({}), ADMIN_MISSING_LYRICS_PATH);
  assert.equal(buildMissingLyricsPath({ q: '   ' }), ADMIN_MISSING_LYRICS_PATH);
});

test('6: buildMissingLyricsPath emits only q/language/missing/page/limit', () => {
  const path = buildMissingLyricsPath({
    q: ' hello world ',
    language: 'hindi',
    missing: false,
    page: 3,
    limit: 10,
    userId: 'leak',
    email: 'leak@example.com',
  });
  const [base, query] = path.split('?');
  assert.equal(base, ADMIN_MISSING_LYRICS_PATH);
  assert.deepEqual(
    query.split('&').map((pair) => pair.split('=')[0]),
    ['q', 'language', 'missing', 'page', 'limit'],
  );
  assert.ok(query.includes('q=hello%20world'));
  assert.ok(query.includes('missing=0'));
  assert.ok(query.includes('page=3'));
  assert.ok(query.includes('limit=10'));
});

test('7: buildMissingLyricsPath defaults missing to 1 and drops page 1', () => {
  const path = buildMissingLyricsPath({ missing: true, page: 1, limit: 20 });
  assert.ok(path.includes('missing=1'));
  assert.ok(path.includes('limit=20'));
  assert.ok(!path.includes('page='));
  assert.equal(buildMissingLyricsPath({ page: '2' }).includes('page='), false);
  assert.equal(buildMissingLyricsPath({ page: 0 }).includes('page='), false);
  assert.equal(buildMissingLyricsPath({ limit: -1 }).includes('limit='), false);
});

test('8: detectLyricsFormat', () => {
  assert.equal(detectLyricsFormat('[00:12.40]first line'), 'lrc');
  assert.equal(detectLyricsFormat('line one\n[01:02.345]line two'), 'lrc');
  assert.equal(detectLyricsFormat('plain lyrics only'), 'plain');
  assert.equal(detectLyricsFormat(''), 'plain');
  assert.equal(detectLyricsFormat(undefined), 'plain');
  assert.equal(detectLyricsFormat('[2024]'), 'plain');
});

test('9: validateLyricsFileSelection allows only .txt and .lrc', () => {
  assert.equal(validateLyricsFileSelection({ name: 'song.txt', size: 10 }).ok, true);
  assert.equal(validateLyricsFileSelection({ name: 'SONG.LRC', size: 10 }).ok, true);
  assert.equal(validateLyricsFileSelection({ name: 'song.md', size: 10 }).ok, false);
  assert.equal(validateLyricsFileSelection({ name: 'song.csv', size: 10 }).ok, false);
  assert.equal(validateLyricsFileSelection({ name: 'song', size: 10 }).ok, false);
});

test('10: validateLyricsFileSelection size and type rules', () => {
  assert.equal(validateLyricsFileSelection({ name: 'song.txt', size: 0 }).error,
    ADMIN_MISSING_LYRICS_MESSAGES.EMPTY_FILE);
  assert.equal(validateLyricsFileSelection({ name: 'song.txt', size: MAX_LYRICS_FILE_BYTES + 1 }).error,
    ADMIN_MISSING_LYRICS_MESSAGES.FILE_TOO_LARGE);
  assert.equal(validateLyricsFileSelection({ name: 'song.txt', size: MAX_LYRICS_FILE_BYTES }).ok, true);
  assert.equal(validateLyricsFileSelection({ name: 'song.txt', size: 10, type: 'application/pdf' }).ok, false);
  assert.equal(validateLyricsFileSelection({ name: 'song.txt', size: 10, type: 'text/plain' }).ok, true);
  assert.equal(validateLyricsFileSelection({ name: 'song.txt', size: 10, type: 'application/octet-stream' }).ok, true);
  assert.equal(validateLyricsFileSelection({ name: 'song.txt', size: 10, type: '' }).ok, true);
});

test('11: validateBulkFileSelection allows only .csv and .json', () => {
  assert.equal(validateBulkFileSelection({ name: 'a.csv', size: 10 }).ok, true);
  assert.equal(validateBulkFileSelection({ name: 'a.json', size: 10 }).ok, true);
  assert.equal(validateBulkFileSelection({ name: 'a.txt', size: 10 }).ok, false);
  assert.equal(validateBulkFileSelection({ name: 'a.lrc', size: 10 }).ok, false);
  assert.equal(validateBulkFileSelection({ name: 'a.csv', size: 0 }).ok, false);
  assert.equal(validateBulkFileSelection({ name: 'a.csv', size: MAX_BULK_IMPORT_BYTES + 1 }).ok, false);
  assert.equal(validateBulkFileSelection({ name: 'a.csv', size: MAX_BULK_IMPORT_BYTES }).ok, true);
});

test('12: validateLyricsDraft', () => {
  assert.equal(validateLyricsDraft({ lyrics: '   \n\n ' }).ok, false);
  assert.equal(validateLyricsDraft({}).ok, false);
  assert.equal(validateLyricsDraft({ lyrics: 42 }).ok, false);

  const plain = validateLyricsDraft({ lyrics: '  hello  ' });
  assert.equal(plain.ok, true);
  assert.equal(plain.text, 'hello');
  assert.equal(plain.format, 'plain');

  const lrc = validateLyricsDraft({ lyrics: '[00:01.00]line' });
  assert.equal(lrc.format, 'lrc');

  assert.equal(validateLyricsDraft({ lyrics: 'x', format: 'lrc' }).format, 'lrc');
  assert.equal(validateLyricsDraft({ lyrics: 'x', format: 'bogus' }).format, 'plain');

  const crlf = validateLyricsDraft({ lyrics: 'a\r\nb' });
  assert.equal(crlf.text, 'a\nb');

  const tooLong = validateLyricsDraft({ lyrics: 'a'.repeat(MAX_LYRICS_TEXT_LENGTH + 1) });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error, ADMIN_MISSING_LYRICS_MESSAGES.TEXT_TOO_LONG);
  assert.equal(validateLyricsDraft({ lyrics: 'a'.repeat(MAX_LYRICS_TEXT_LENGTH) }).ok, true);
});

test('13: normalizeMissingLyricsQueueResponse rejects bad envelopes', () => {
  assert.equal(normalizeMissingLyricsQueueResponse(null).ok, false);
  assert.equal(normalizeMissingLyricsQueueResponse({}).ok, false);
  assert.equal(normalizeMissingLyricsQueueResponse({ success: false }).ok, false);
  assert.equal(
    normalizeMissingLyricsQueueResponse({ success: true }).ok,
    false,
  );
  assert.equal(
    normalizeMissingLyricsQueueResponse({ success: true, data: { rows: 'x' } }).ok,
    false,
  );
  assert.equal(
    normalizeMissingLyricsQueueResponse({
      success: true,
      data: { rows: [], total: 0, page: 1, limit: 20, pages: 1 },
    }).ok,
    true,
  );
  assert.equal(
    normalizeMissingLyricsQueueResponse({
      success: true,
      data: { rows: [{}], total: 0, page: 1, limit: 0 },
    }).ok,
    false,
    'more rows than limit is invalid',
  );
});

test('14: normalizeMissingLyricsQueueResponse whitelists rows and never exposes lyrics', () => {
  const payload = {
    success: true,
    data: {
      state: 'ready',
      q: 'old town',
      language: 'hindi',
      missing: false,
      page: 2,
      limit: 20,
      total: 41,
      pages: 3,
      rows: [{
        songId: '64b64b64b64b64b64b64b642',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        duration: '3:30',
        language: 'hindi',
        lyricsLanguage: 'hi',
        regionalTag: 'hi-in',
        lyricsStatus: 'legacy',
        source: 'lrclib',
        lrclibStatus: 'stored',
        sourceUrl: 'https://example.test/lrclib/1',
        sourceCandidate: { url: 'https://example.test/1', provider: 'lrclib' },
        lyrics: 'SHOULD NOT LEAK',
        email: 'leak@example.com',
      }],
    },
  };
  const result = normalizeMissingLyricsQueueResponse(payload);
  assert.equal(result.ok, true);
  assert.equal(result.data.state, 'ready');
  assert.equal(result.data.q, 'old town');
  assert.equal(result.data.missing, false);
  assert.equal(result.data.page, 2);
  assert.equal(result.data.total, 41);
  assert.equal(result.data.pages, 3);
  assert.equal(result.data.rows.length, 1);
  const row = result.data.rows[0];
  assert.equal(row.lyricsStatus, 'legacy');
  assert.equal(row.lrclibStatus, 'stored');
  assert.equal(row.sourceCandidate.url, 'https://example.test/1');
  assert.equal(Object.hasOwn(row, 'lyrics'), false);
  assert.equal(Object.hasOwn(row, 'email'), false);
  assert.equal(JSON.stringify(row).includes('SHOULD NOT LEAK'), false);
});

test('15: normalizeMissingLyricsQueueResponse coerces unknown row statuses', () => {
  const result = normalizeMissingLyricsQueueResponse({
    success: true,
    data: {
      rows: [
        { songId: 'a', lyricsStatus: 'verified', lrclibStatus: 'stored' },
        { songId: 'b', lyricsStatus: 'invented', lrclibStatus: 'nope' },
        { songId: 7, lyricsStatus: null, lrclibStatus: null },
      ],
      total: 3,
      page: 1,
      limit: 20,
      pages: 1,
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.rows.map((row) => row.lyricsStatus), ['verified', 'missing', 'missing']);
  assert.deepEqual(result.data.rows.map((row) => row.lrclibStatus), ['stored', 'not-stored', 'not-stored']);
  assert.deepEqual(result.data.rows.map((row) => row.songId), ['a', 'b', '']);
});

test('16: normalizeAdminLyricsSaveResponse', () => {
  assert.equal(normalizeAdminLyricsSaveResponse(null).ok, false);
  assert.equal(normalizeAdminLyricsSaveResponse({ success: true, data: {} }).ok, false);
  assert.equal(
    normalizeAdminLyricsSaveResponse({ success: true, data: { saved: false, songId: 'x' } }).ok,
    false,
  );
  const result = normalizeAdminLyricsSaveResponse({
    success: true,
    data: {
      saved: true,
      songId: '64b64b64b64b64b64b64b642',
      replaced: true,
      format: 'lrc',
      lyricsVerified: true,
      lyricsSource: 'db_verified',
      presentation: { plain: 'a', synced: true },
      extra: 'drop',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replaced, true);
  assert.equal(result.data.format, 'lrc');
  assert.equal(result.data.lyricsVerified, true);
  assert.equal(result.data.lyricsSource, 'db_verified');
  assert.deepEqual(result.data.presentation, { plain: 'a', synced: true });
  assert.equal(normalizeAdminLyricsSaveResponse({
    success: true,
    data: { saved: true, songId: 'x', format: 'html' },
  }).data.format, 'plain');
});

test('17: normalizeBulkImportResponse', () => {
  assert.equal(normalizeBulkImportResponse(null).ok, false);
  assert.equal(normalizeBulkImportResponse({ success: true, data: {} }).ok, false);
  assert.equal(normalizeBulkImportResponse({
    success: true,
    data: { counts: { imported: 1 } },
  }).ok, false, 'missing count keys are invalid');

  const result = normalizeBulkImportResponse({
    success: true,
    data: {
      format: 'csv',
      counts: { imported: 2, rejected: 1, duplicate: 3, invalid: 0, total: 6 },
      invalid: [{ index: 0 }],
      rejected: [{ index: 1 }],
      importedSongIds: ['a', 'b'],
      lyrics: 'must not appear',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.format, 'csv');
  assert.equal(result.data.counts.imported, 2);
  assert.equal(result.data.counts.duplicate, 3);
  assert.equal(result.data.importedSongIds.length, 2);
  assert.equal(JSON.stringify(result.data).includes('must not appear'), false);
});

test('18: mapAdminLyricsError', () => {
  assert.equal(mapAdminLyricsError({ error: '  server says no ' }, 'fallback'), 'server says no');
  assert.equal(mapAdminLyricsError({ error: '' }, 'fallback'), 'fallback');
  assert.equal(mapAdminLyricsError({ error: 42 }, 'fallback'), 'fallback');
  assert.equal(mapAdminLyricsError(null, 'fallback'), 'fallback');
  assert.equal(mapAdminLyricsError(undefined, 'fallback'), 'fallback');
});

test('19: fetchMissingLyricsQueue uses injected client and normalizes', async () => {
  const calls = [];
  const apiClient = {
    async get(path) {
      calls.push(path);
      return {
        success: true,
        data: { rows: [{ songId: 'a', title: 'T' }], total: 1, page: 1, limit: 20, pages: 1 },
      };
    },
  };
  const result = await fetchMissingLyricsQueue({ language: 'hindi' }, apiClient);
  assert.equal(result.ok, true);
  assert.equal(result.data.rows.length, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('/api/admin/lyrics?'));
  assert.ok(calls[0].includes('language=hindi'));
  assert.ok(!calls[0].includes('userId'));
});

test('20: fetchMissingLyricsQueue failure paths', async () => {
  const failing = { async get() { throw new Error('network'); } };
  const failed = await fetchMissingLyricsQueue({}, failing);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_FAILED);

  const invalid = { async get() { return { success: true, data: { rows: 'nope' } }; } };
  const bad = await fetchMissingLyricsQueue({}, invalid);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_INVALID);
});

test('21: saveVerifiedLyrics posts the allowlisted body', async () => {
  const calls = [];
  const apiClient = {
    async post(path, body) {
      calls.push({ path, body });
      return {
        success: true,
        data: {
          saved: true,
          songId: '64b64b64b64b64b64b64b642',
          replaced: false,
          format: 'plain',
          lyricsVerified: true,
          lyricsSource: 'db_verified',
          presentation: { plain: 'a' },
        },
      };
    },
  };
  const result = await saveVerifiedLyrics('64b64b64b64b64b64b64b642', {
    lyrics: 'a',
    format: 'plain',
    language: 'hindi',
    sourceUrl: 'https://example.test/1',
    sourceProvider: 'lrclib',
    notes: 'checked',
    replaceVerified: false,
  }, apiClient);
  assert.equal(result.ok, true);
  assert.equal(result.data.saved, undefined);
  assert.equal(result.data.songId, '64b64b64b64b64b64b64b642');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/admin/lyrics/64b64b64b64b64b64b64b642');
  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    'format',
    'language',
    'lyrics',
    'notes',
    'replaceVerified',
    'sourceProvider',
    'sourceUrl',
  ]);
});

test('22: saveVerifiedLyrics surfaces server error and network failure', async () => {
  const server = {
    async post() { return { success: false, error: 'Verified lyrics already exist.' }; },
  };
  const conflicted = await saveVerifiedLyrics('a', { lyrics: 'x' }, server);
  assert.equal(conflicted.ok, false);
  assert.equal(conflicted.error, 'Verified lyrics already exist.');

  const throws = { async post() { throw new Error('boom'); } };
  const failed = await saveVerifiedLyrics('a', { lyrics: 'x' }, throws);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, ADMIN_MISSING_LYRICS_MESSAGES.SAVE_FAILED);
});

test('23: importVerifiedLyrics posts to the import path', async () => {
  const calls = [];
  const apiClient = {
    async post(path, body) {
      calls.push({ path, body });
      return {
        success: true,
        data: {
          format: 'json',
          counts: { imported: 1, rejected: 0, duplicate: 0, invalid: 0, total: 1 },
          invalid: [],
          rejected: [],
          importedSongIds: ['a'],
        },
      };
    },
  };
  const result = await importVerifiedLyrics({ text: '[]', fileName: 'a.json', replaceVerified: false }, apiClient);
  assert.equal(result.ok, true);
  assert.equal(result.data.format, 'json');
  assert.equal(calls[0].path, ADMIN_LYRICS_IMPORT_PATH);
  assert.equal(calls[0].body.fileName, 'a.json');

  const throwing = { async post() { throw new Error('x'); } };
  const failed = await importVerifiedLyrics({ text: 'x' }, throwing);
  assert.equal(failed.error, ADMIN_MISSING_LYRICS_MESSAGES.IMPORT_FAILED);
});

test('24: findSongLyricsSources hits the public sources endpoint with refresh', async () => {
  const paths = [];
  const apiClient = {
    async get(path) {
      paths.push(path);
      return { success: true, candidates: [{ url: 'https://example.test/1', provider: 'lrclib' }] };
    },
  };
  const result = await findSongLyricsSources('64b64b64b64b64b64b64b642', apiClient);
  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(paths[0], '/api/lyrics/64b64b64b64b64b64b64b642/sources?refresh=1');

  const missing = { async get() { return { success: false }; } };
  assert.equal((await findSongLyricsSources('a', missing)).ok, false);

  const throwing = { async get() { throw new Error('x'); } };
  const failed = await findSongLyricsSources('a', throwing);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_FAILED);
});

test('25: every message is a non-empty fixed string', () => {
  for (const [key, value] of Object.entries(ADMIN_MISSING_LYRICS_MESSAGES)) {
    assert.equal(typeof value, 'string', key);
    assert.ok(value.trim().length > 0, key);
    assert.equal(value.includes('undefined'), false, key);
    assert.equal(value.includes('[object'), false, key);
  }
});
