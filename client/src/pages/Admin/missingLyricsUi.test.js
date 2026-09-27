import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSING_LYRICS_VIEWS,
  MISSING_LYRICS_MESSAGES,
  LYRICS_STATUS_LABELS,
  LRCLIB_STATUS_LABELS,
  MISSING_LYRICS_DEFAULT_LIMIT,
  MISSING_LYRICS_PAGE_SIZE_OPTIONS,
  LYRICS_FILE_INPUT_ACCEPT,
  BULK_IMPORT_FILE_INPUT_ACCEPT,
  ADD_LYRICS_FIELD_IDS,
  selectMissingLyricsView,
  lyricsStatusLabel,
  lrclibStatusLabel,
  formatLanguageLabel,
  buildPagination,
  selectAddLyricsInitialValues,
  validateAddLyricsDraft,
  refreshLyricsFormat,
  buildImportCountCards,
  buildQueueRowActions,
  ADMIN_MISSING_LYRICS_MESSAGES,
} from './missingLyricsUi.js';

test('1: view vocabulary is exactly four stable literals', () => {
  assert.deepEqual(Object.values(MISSING_LYRICS_VIEWS).sort(), ['empty', 'error', 'loading', 'ready']);
  assert.equal(MISSING_LYRICS_VIEWS.LOADING, 'loading');
  assert.equal(MISSING_LYRICS_VIEWS.ERROR, 'error');
  assert.equal(MISSING_LYRICS_VIEWS.EMPTY, 'empty');
  assert.equal(MISSING_LYRICS_VIEWS.READY, 'ready');
});

test('2: exact user-facing messages', () => {
  assert.equal(MISSING_LYRICS_MESSAGES.LOADING, 'Loading the missing lyrics queue…');
  assert.equal(MISSING_LYRICS_MESSAGES.EMPTY, 'No songs match this filter.');
  assert.equal(MISSING_LYRICS_MESSAGES.REFRESH, 'Refresh');
  assert.equal(MISSING_LYRICS_MESSAGES.IMPORT, 'Import CSV/JSON');
  assert.equal(MISSING_LYRICS_MESSAGES.ADD_LYRICS, 'Add Lyrics');
  assert.equal(MISSING_LYRICS_MESSAGES.FIND_SOURCES, 'Find Sources');
  assert.equal(MISSING_LYRICS_MESSAGES.OPEN_SOURCE, 'Open Source');
  assert.equal(MISSING_LYRICS_MESSAGES.OPEN_SONG, 'Open Song');
  assert.equal(MISSING_LYRICS_MESSAGES.PREVIOUS, 'Previous');
  assert.equal(MISSING_LYRICS_MESSAGES.NEXT, 'Next');
  assert.equal(MISSING_LYRICS_MESSAGES.SAVE, 'Save verified lyrics');
  assert.equal(MISSING_LYRICS_MESSAGES.CANCEL, 'Cancel');
  assert.equal(MISSING_LYRICS_MESSAGES.REPLACE_HINT, 'Replace verified lyrics');
  assert.equal(MISSING_LYRICS_MESSAGES.SAVED, 'Verified lyrics saved.');
  assert.equal(MISSING_LYRICS_MESSAGES.IMPORTED, 'Import complete.');
});

test('3: status label vocabulary', () => {
  assert.deepEqual(LYRICS_STATUS_LABELS, { missing: 'Missing', legacy: 'Unverified', verified: 'Verified' });
  assert.deepEqual(LRCLIB_STATUS_LABELS, { stored: 'Stored', 'not-stored': 'Not stored' });
  assert.equal(lyricsStatusLabel('missing'), 'Missing');
  assert.equal(lyricsStatusLabel('legacy'), 'Unverified');
  assert.equal(lyricsStatusLabel('verified'), 'Verified');
  assert.equal(lyricsStatusLabel('anything-else'), 'Missing');
  assert.equal(lyricsStatusLabel(undefined), 'Missing');
  assert.equal(lrclibStatusLabel('stored'), 'Stored');
  assert.equal(lrclibStatusLabel('not-stored'), 'Not stored');
  assert.equal(lrclibStatusLabel('weird'), 'Not stored');
});

test('4: pagination defaults and accept attributes', () => {
  assert.equal(MISSING_LYRICS_DEFAULT_LIMIT, 20);
  assert.deepEqual([...MISSING_LYRICS_PAGE_SIZE_OPTIONS], [10, 20, 50]);
  assert.equal(LYRICS_FILE_INPUT_ACCEPT, '.txt,.lrc');
  assert.equal(BULK_IMPORT_FILE_INPUT_ACCEPT, '.csv,.json');
  assert.equal(ADD_LYRICS_FIELD_IDS.lyrics, 'add-lyrics-text');
  assert.equal(ADD_LYRICS_FIELD_IDS.replace, 'add-lyrics-replace');
  assert.equal(ADD_LYRICS_FIELD_IDS.file, 'add-lyrics-file');
});

test('5: selectMissingLyricsView precedence', () => {
  assert.equal(selectMissingLyricsView({ loading: true, rows: [{ songId: 'a' }], total: 1 }), 'loading');
  assert.equal(selectMissingLyricsView({ error: 'boom', rows: [{ songId: 'a' }], total: 1 }), 'error');
  assert.equal(selectMissingLyricsView({ loading: true, error: 'boom' }), 'loading');
  assert.equal(selectMissingLyricsView({ rows: [{ songId: 'a' }], total: 1 }), 'ready');
  assert.equal(selectMissingLyricsView({ rows: [], total: 0 }), 'empty');
  assert.equal(selectMissingLyricsView({ rows: [], total: 40 }), 'empty');
  assert.equal(selectMissingLyricsView({ rows: [{ songId: 'a' }], total: 0 }), 'empty');
  assert.equal(selectMissingLyricsView({ rows: 'nope', total: 10 }), 'empty');
  assert.equal(selectMissingLyricsView({}), 'empty');
});

test('6: formatLanguageLabel', () => {
  assert.equal(formatLanguageLabel({ regionalTag: 'hi-in', language: 'hindi' }), 'hi-in · hindi');
  assert.equal(formatLanguageLabel({ regionalTag: 'bn-in' }), 'bn-in');
  assert.equal(formatLanguageLabel({ lyricsLanguage: 'bn', language: 'bengali' }), 'bn');
  assert.equal(formatLanguageLabel({ language: 'english' }), 'english');
  assert.equal(formatLanguageLabel({ regionalTag: 'hi-in', lyricsLanguage: 'hi-in' }), 'hi-in');
  assert.equal(formatLanguageLabel({}), 'Unknown');
  assert.equal(formatLanguageLabel(null), 'Unknown');
  assert.equal(formatLanguageLabel('string'), 'Unknown');
});

test('7: buildPagination', () => {
  assert.deepEqual(buildPagination(1, 1), {
    page: 1, pages: 1, canPrev: false, canNext: false, label: 'Page 1 of 1', show: false,
  });
  const middle = buildPagination(2, 5);
  assert.equal(middle.canPrev, true);
  assert.equal(middle.canNext, true);
  assert.equal(middle.label, 'Page 2 of 5');
  assert.equal(middle.show, true);
  assert.equal(buildPagination(99, 3).page, 3, 'clamped past the end');
  assert.equal(buildPagination(0, 3).page, 1);
  assert.equal(buildPagination('x', 3).page, 1);
  assert.equal(buildPagination(2, 0).pages, 1);
  assert.equal(buildPagination(2, -4).show, false);
  assert.equal(buildPagination(1, 10).canNext, true);
  assert.equal(buildPagination(10, 10).canNext, false);
});

test('8: selectAddLyricsInitialValues defaults', () => {
  const values = selectAddLyricsInitialValues(undefined);
  assert.equal(values.songId, '');
  assert.equal(values.title, '');
  assert.equal(values.lyrics, '');
  assert.equal(values.format, 'plain');
  assert.equal(values.replaceVerified, false);
  assert.equal(values.hasVerifiedLyrics, false);
  assert.equal(values.candidateUrl, '');
  assert.equal(values.sourceUrl, '');
});

test('9: selectAddLyricsInitialValues maps row + candidate', () => {
  const values = selectAddLyricsInitialValues({
    songId: '64b64b64b64b64b64b64b642',
    title: 'Song',
    artist: 'Artist',
    language: 'hindi',
    lyricsLanguage: 'hi',
    lyricsStatus: 'missing',
    sourceCandidate: { url: 'https://example.test/1', provider: 'lrclib' },
  });
  assert.equal(values.language, 'hi', 'lyricsLanguage wins over language');
  assert.equal(values.sourceUrl, 'https://example.test/1');
  assert.equal(values.sourceProvider, 'lrclib');
  assert.equal(values.candidateUrl, 'https://example.test/1');
  assert.equal(values.hasVerifiedLyrics, false);
});

test('10: selectAddLyricsInitialValues flags verified and ignores bad candidates', () => {
  const verified = selectAddLyricsInitialValues({ songId: 'a', lyricsStatus: 'verified' });
  assert.equal(verified.hasVerifiedLyrics, true);

  const legacy = selectAddLyricsInitialValues({ songId: 'a', lyricsStatus: 'legacy' });
  assert.equal(legacy.hasVerifiedLyrics, false);

  const badCandidate = selectAddLyricsInitialValues({
    songId: 'a',
    lyricsStatus: 'missing',
    sourceCandidate: { url: 42, provider: 'x' },
  });
  assert.equal(badCandidate.sourceUrl, '');
  assert.equal(badCandidate.candidateUrl, '');

  const fallbackLanguage = selectAddLyricsInitialValues({ songId: 'a', lyricsLanguage: '', language: 'bn-bd' });
  assert.equal(fallbackLanguage.language, 'bn-bd');
});

test('11: validateAddLyricsDraft', () => {
  assert.equal(validateAddLyricsDraft().ok, false);
  assert.equal(validateAddLyricsDraft({ lyrics: '   ' }).ok, false);
  assert.equal(validateAddLyricsDraft({ lyrics: '   ' }).format, 'plain');
  const ok = validateAddLyricsDraft({ lyrics: '  hello  ', format: 'plain' });
  assert.equal(ok.ok, true);
  assert.equal(ok.text, 'hello');
  assert.equal(ok.error, '');
  const lrc = validateAddLyricsDraft({ lyrics: '[00:01.00]line', format: 'lrc' });
  assert.equal(lrc.format, 'lrc');
});

test('12: refreshLyricsFormat', () => {
  assert.equal(refreshLyricsFormat('[00:12.40]line'), 'lrc');
  assert.equal(refreshLyricsFormat('plain line'), 'plain');
  assert.equal(refreshLyricsFormat(undefined), 'plain');
});

test('13: buildImportCountCards uses fixed labels and coerces bad counts', () => {
  const cards = buildImportCountCards({ imported: 3, duplicate: 2, rejected: 1, invalid: 0, total: 6 });
  assert.deepEqual(cards, [
    { key: 'imported', label: 'Imported', value: 3 },
    { key: 'duplicate', label: 'Duplicate', value: 2 },
    { key: 'rejected', label: 'Rejected', value: 1 },
    { key: 'invalid', label: 'Invalid', value: 0 },
  ]);

  const coerced = buildImportCountCards(undefined);
  assert.deepEqual(coerced.map((card) => card.value), [0, 0, 0, 0]);
  const weird = buildImportCountCards({ imported: -5, duplicate: 'x', rejected: 1.5, invalid: null });
  assert.deepEqual(weird.map((card) => card.value), [0, 0, 0, 0]);
  assert.equal(cards.some((card) => card.label === 'Total'), false);
});

test('14: buildQueueRowActions', () => {
  const actions = buildQueueRowActions({
    songId: '64b64b64b64b64b64b64b642',
    lyricsStatus: 'missing',
    sourceUrl: 'https://example.test/legacy',
  });
  assert.equal(actions.openSongHref, '/song/64b64b64b64b64b64b64b642');
  assert.equal(actions.canFindSources, true);
  assert.equal(actions.canAddLyrics, true);
  assert.equal(actions.openSourceUrl, 'https://example.test/legacy');
  assert.equal(actions.canOpenSource, true);
  assert.equal(actions.isVerified, false);

  const withCandidate = buildQueueRowActions({
    songId: 'a',
    sourceCandidate: { url: 'https://example.test/candidate' },
    sourceUrl: 'https://example.test/legacy',
  });
  assert.equal(withCandidate.openSourceUrl, 'https://example.test/candidate', 'candidate wins');

  const empty = buildQueueRowActions(undefined);
  assert.equal(empty.songId, '');
  assert.equal(empty.openSongHref, '');
  assert.equal(empty.canFindSources, false);
  assert.equal(empty.canAddLyrics, false);
  assert.equal(empty.canOpenSource, false);

  const verified = buildQueueRowActions({ songId: 'a', lyricsStatus: 'verified' });
  assert.equal(verified.isVerified, true);
});

test('15: re-exports the shared message map', () => {
  assert.equal(ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_FAILED, 'Unable to load the missing lyrics queue.');
  assert.equal(MISSING_LYRICS_MESSAGES.SAVED, 'Verified lyrics saved.');
});
