import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MISSING_LYRICS_MESSAGES,
  hasActiveQueueFilters,
  lyricsStatusBadgeTone,
  lrclibStatusBadgeTone,
} from './missingLyricsUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const queueSource = readFileSync(join(__dirname, 'MissingLyricsQueue.jsx'), 'utf8');
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8').replace(/\r\n/g, '\n');
const dialogSource = readFileSync(join(__dirname, 'AddLyricsDialog.jsx'), 'utf8');
const uiSource = readFileSync(join(__dirname, 'missingLyricsUi.js'), 'utf8');

test('1: Lyrics page presents the Lyrics Management header beside the queue', () => {
  assert.ok(adminSource.includes("{section === 'missing-lyrics' && <MissingLyricsQueue />}"));
  assert.match(queueSource, /className="admin-page missing-lyrics-panel"/);
  assert.match(queueSource, /<h2>Lyrics Management<\/h2>/);
  assert.match(
    queueSource,
    /Manage verified lyrics, review missing lyrics, and import lyric content\./,
  );
  assert.match(queueSource, /<h3 id="missing-lyrics-heading">Missing Lyrics<\/h3>/);
});

test('2: queue toolbar keeps search, language filter, missing-only toggle and submit', () => {
  assert.match(queueSource, /id="missing-lyrics-search"/);
  assert.match(queueSource, /id="missing-lyrics-language"/);
  assert.match(queueSource, /id="missing-lyrics-missing"/);
  assert.match(queueSource, /onSubmit=\{submitSearch\}/);
  assert.match(queueSource, /className="missing-lyrics-filters"/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.REFRESH/);
});

test('3: modern queue state messages are exact and rendered from the message map', () => {
  assert.equal(MISSING_LYRICS_MESSAGES.QUEUE_LOADING, 'Loading lyrics...');
  assert.equal(MISSING_LYRICS_MESSAGES.QUEUE_EMPTY, 'No missing lyrics found.');
  assert.equal(
    MISSING_LYRICS_MESSAGES.QUEUE_EMPTY_FILTERED,
    'No lyrics match the current filters.',
  );
  assert.equal(MISSING_LYRICS_MESSAGES.QUEUE_ERROR, 'Unable to load lyrics queue.');
  assert.equal(MISSING_LYRICS_MESSAGES.QUEUE_RETRY, 'Retry');
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.QUEUE_LOADING/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.QUEUE_EMPTY_FILTERED/);
  assert.match(queueSource, /: MISSING_LYRICS_MESSAGES\.QUEUE_EMPTY\}/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.QUEUE_ERROR/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.QUEUE_RETRY/);
});

test('4: queue failure renders a compact alert with Retry, never a raw error box', () => {
  assert.match(queueSource, /admin-state-block admin-error-state" role="alert"/);
  assert.match(queueSource, /onClick=\{retryQueue\}/);
  assert.equal(queueSource.includes('catalog-sync-feedback is-error'), false);
  assert.equal(queueSource.includes('{error ||'), false);
  assert.equal(queueSource.includes('setError('), false);
});

test('5: Retry reuses the explicit reload mechanism and never polls', () => {
  const retry = queueSource.slice(
    queueSource.indexOf('const retryQueue'),
    queueSource.indexOf('const submitSearch'),
  );
  assert.ok(retry.length > 0, 'retryQueue helper must exist');
  assert.match(retry, /setRefreshToken\(\(token\) => token \+ 1\)/);
  assert.equal(retry.includes('setInterval'), false);
  assert.equal(retry.includes('setTimeout('), false);
  assert.equal(queueSource.includes('setInterval'), false);
  assert.equal(queueSource.includes('setTimeout('), false);
  assert.equal(/refresh\(\)/.test(queueSource), false);
  assert.equal(/auto.*refresh/i.test(queueSource), false);
});

test('6: empty state distinguishes filtered queues from untouched queues', () => {
  assert.match(queueSource, /hasActiveQueueFilters\(\{ query, language \}\)/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.QUEUE_EMPTY_FILTERED/);
  assert.ok(uiSource.includes("QUEUE_EMPTY: 'No missing lyrics found.'"));
  assert.ok(uiSource.includes("QUEUE_EMPTY_FILTERED: 'No lyrics match the current filters.'"));
  assert.equal(hasActiveQueueFilters({ query: '  ', language: '' }), false);
  assert.equal(hasActiveQueueFilters({ query: '', language: '' }), false);
  assert.equal(hasActiveQueueFilters({ query: 'abc', language: '' }), true);
  assert.equal(hasActiveQueueFilters({ query: '   ', language: 'hindi' }), true);
  assert.equal(hasActiveQueueFilters(null), false);
});

test('7: lyrics and LRCLIB columns render status badges, never a lyrics body', () => {
  assert.match(queueSource, /lyricsStatusBadgeTone\(row\.lyricsStatus\)/);
  assert.match(queueSource, /lrclibStatusBadgeTone\(row\.lrclibStatus\)/);
  assert.match(queueSource, /admin-badge \$\{lyricsStatusBadgeTone/);
  assert.equal(/\{row\.lyrics\b/.test(queueSource), false, 'queue never renders stored lyrics');
  assert.equal(lyricsStatusBadgeTone('verified'), 'ok');
  assert.equal(lyricsStatusBadgeTone('missing'), 'warn');
  assert.equal(lyricsStatusBadgeTone('legacy'), 'info');
  assert.equal(lyricsStatusBadgeTone('unknown'), 'muted');
  assert.equal(lrclibStatusBadgeTone('stored'), 'ok');
  assert.equal(lrclibStatusBadgeTone('not-stored'), 'muted');
  assert.equal(lrclibStatusBadgeTone('other'), 'muted');
});

test('8: batch import stays a separate labeled panel outside the queue table', () => {
  assert.match(queueSource, /className="admin-panel missing-lyrics-import"/);
  assert.match(queueSource, /admin-panel-subheading">Batch import</);
  assert.match(queueSource, /id="missing-lyrics-import-file"/);
  assert.match(queueSource, /id="missing-lyrics-import-replace"/);
  const importIdx = queueSource.indexOf('admin-panel missing-lyrics-import');
  const queueCloseIdx = queueSource.indexOf('</section>', queueSource.indexOf('missing-lyrics-queue'));
  const dialogIdx = queueSource.indexOf('<AddLyricsDialog');
  assert.ok(importIdx > queueCloseIdx, 'import panel renders after the queue section closes');
  assert.ok(dialogIdx > importIdx, 'dialog stays after the import panel');
});

test('9: loading and error views expose accessible live regions', () => {
  assert.match(queueSource, /MISSING_LYRICS_VIEWS\.LOADING/);
  assert.match(queueSource, /MISSING_LYRICS_VIEWS\.ERROR/);
  assert.match(queueSource, /MISSING_LYRICS_VIEWS\.EMPTY/);
  assert.match(queueSource, /MISSING_LYRICS_VIEWS\.READY/);
  assert.match(queueSource, /aria-live="polite"/);
  assert.match(queueSource, /role="status"/);
  assert.match(queueSource, /role="alert"/);
});

test('10: Add Lyrics dialog keeps the verified-replace workflow with scoped errors', () => {
  assert.match(dialogSource, /<AppDialog/);
  assert.match(dialogSource, /\{initial\.hasVerifiedLyrics && \(/);
  assert.match(dialogSource, /ADD_LYRICS_FIELD_IDS\.replace/);
  assert.match(dialogSource, /admin-inline-notice admin-inline-notice--error/);
  assert.match(dialogSource, /role="alert"/);
  assert.match(dialogSource, /aria-live="polite"/);
});

test('11: lyrics workspace CSS keeps shell-safe responsive rules', () => {
  assert.match(adminCss, /\.missing-lyrics-panel|\.missing-lyrics-filters/);
  assert.match(adminCss, /\.missing-lyrics-table \{/);
  assert.match(adminCss, /\.missing-lyrics-table-wrap \{\n\s*overflow-x: auto;/);
  assert.match(adminCss, /@media \(max-width: 768px\)/);
  assert.match(adminCss, /\.admin-inline-notice\.admin-inline-notice--error \{/);
  assert.match(adminCss, /\.admin-panel-subheading \{/);
  assert.match(adminCss, /\.admin-panel-head \{/);
});

test('12: no scraping or raw network patterns in the lyrics workspace', () => {
  const haystack = [queueSource, dialogSource, uiSource].join('\n');
  assert.equal(/genius\.com/i.test(haystack), false);
  assert.equal(/azlyrics/i.test(haystack), false);
  assert.equal(/musixmatch/i.test(haystack), false);
  assert.equal(/lyricsify/i.test(haystack), false);
  assert.equal(/\bfetch\(/.test(haystack), false, 'no raw fetch — use the api client');
  assert.equal(/axios/.test(haystack), false);
  assert.equal(/new XMLHttpRequest/.test(haystack), false);
  assert.equal(/child_process/.test(haystack), false);
  assert.equal(/cheerio|puppeteer|playwright/i.test(haystack), false);
});
