import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const queueSource = readFileSync(join(__dirname, 'MissingLyricsQueue.jsx'), 'utf8');
const dialogSource = readFileSync(join(__dirname, 'AddLyricsDialog.jsx'), 'utf8');
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8');
const uiSource = readFileSync(join(__dirname, 'missingLyricsUi.js'), 'utf8');
const serviceSource = readFileSync(
  join(__dirname, '..', '..', 'services', 'adminMissingLyrics.js'),
  'utf8',
);

test('1: Admin declares the missing-lyrics section in the expected order', () => {
  const sectionsLine = adminSource.match(/const SECTIONS = \[([^\]]+)\]/);
  assert.ok(sectionsLine);
  const ids = sectionsLine[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(ids, [
    'dashboard',
    'users',
    'music',
    'missing-lyrics',
    'karaoke',
    'moderation',
    'subscriptions',
    'ai-recommendation',
  ]);
});

test('2: Admin recognises the section id in EXISTING_SECTIONS', () => {
  const match = adminSource.match(/const EXISTING_SECTIONS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(match);
  const ids = match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.equal(ids.includes('missing-lyrics'), true);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate section ids');
});

test('3: Admin labels the section exactly Missing Lyrics', () => {
  assert.ok(adminSource.includes("if (s === 'missing-lyrics') return 'Missing Lyrics';"));
  assert.equal(adminSource.includes("sectionLabel(s)"), true);
});

test('4: Admin renders the queue component for the section', () => {
  assert.match(adminSource, /\{section === 'missing-lyrics' && <MissingLyricsQueue \/>\}/);
  assert.ok(adminSource.includes("import MissingLyricsQueue from './MissingLyricsQueue.jsx';"));
});

test('5: queue is reachable from the sidebar through the shared section loop', () => {
  const sidebar = adminSource.slice(adminSource.indexOf('<nav'), adminSource.indexOf('</nav>'));
  assert.ok(sidebar.includes('{sectionLabel(s)}'));
  assert.ok(sidebar.includes('SECTIONS.map'));
});

test('6: queue renders search, language filter and missing-only toggle', () => {
  assert.match(queueSource, /type="search"/);
  assert.match(queueSource, /missing-lyrics-search/);
  assert.match(queueSource, /missing-lyrics-language/);
  assert.match(queueSource, /<select/);
  assert.match(queueSource, /missing-lyrics-missing/);
  assert.match(queueSource, /type="checkbox"/);
  assert.match(queueSource, /Missing only/);
  assert.match(queueSource, /onSubmit=\{submitSearch\}/);
  assert.match(queueSource, /onChange=\{\(event\) => \{ setNotice\(''\); setLanguage/);
});

test('7: language options are exactly the documented regional filters', () => {
  const block = queueSource.slice(
    queueSource.indexOf('const LANGUAGE_OPTIONS'),
    queueSource.indexOf('];', queueSource.indexOf('const LANGUAGE_OPTIONS')) + 2,
  );
  assert.ok(block.includes("'All languages'"));
  assert.ok(block.includes("'Hindi'"));
  assert.ok(block.includes("'Bangladeshi Bengali'"));
  assert.ok(block.includes("'Kolkata/Indian Bengali'"));
  assert.ok(block.includes("'English'"));
  assert.ok(block.includes("value: 'hindi'"));
  assert.ok(block.includes("value: 'bn-bd'"));
  assert.ok(block.includes("value: 'bn-in'"));
  assert.ok(block.includes("value: 'english'"));
  assert.equal(block.includes("'tamil'"), false, 'no undocumented language filters');
});

test('8: queue table exposes only metadata columns, never a lyrics body', () => {
  const header = queueSource.slice(queueSource.indexOf('<thead>'), queueSource.indexOf('</thead>'));
  assert.ok(header.includes('<th scope="col">Song</th>'));
  assert.ok(header.includes('<th scope="col">Artist</th>'));
  assert.ok(header.includes('<th scope="col">Language</th>'));
  assert.ok(header.includes('<th scope="col">Lyrics</th>'));
  assert.ok(header.includes('<th scope="col">LRCLIB</th>'));
  assert.ok(header.includes('<th scope="col">Source</th>'));
  assert.ok(header.includes('<th scope="col">Actions</th>'));
  assert.equal(/\{row\.lyrics\b/.test(queueSource), false, 'queue never renders stored lyrics');
  assert.equal(/row\.lyrics\s*[})]/.test(queueSource), false);
});

test('9: row actions are Open Song / Find Sources / Add Lyrics', () => {
  assert.ok(queueSource.includes('MISSING_LYRICS_MESSAGES.OPEN_SONG'));
  assert.ok(queueSource.includes('MISSING_LYRICS_MESSAGES.FIND_SOURCES'));
  assert.ok(queueSource.includes('MISSING_LYRICS_MESSAGES.ADD_LYRICS'));
  assert.match(queueSource, /href=\{actions\.openSongHref\}/);
  assert.match(queueSource, /onClick=\{\(\) => handleFindSources\(row\)\}/);
  assert.match(queueSource, /onClick=\{\(\) => setDialogRow\(row\)\}/);
  assert.equal(uiSource.includes('openSongHref: record.songId ? `/song/${record.songId}`'), true);
});

test('10: external source links open safely in a new tab', () => {
  assert.match(queueSource, /target="_blank"/);
  assert.match(queueSource, /rel="noopener noreferrer"/);
  assert.match(queueSource, /href=\{actions\.openSourceUrl\}/);
  assert.equal(queueSource.includes('rel="noopener noreferrer"'), true);
});

test('11: find sources uses the authenticated lyrics sources endpoint', () => {
  assert.match(serviceSource, /client\.get\(`\/api\/lyrics\/\$\{encodeURIComponent\(songId\)\}\/sources\?refresh=1`\)/);
  assert.match(queueSource, /findSongLyricsSources\(row\.songId\)/);
  assert.equal(serviceSource.includes('apiClient'), true, 'requests go through an injected api client');
});

test('12: queue shows loading, error and empty states with aria-live', () => {
  assert.match(queueSource, /MISSING_LYRICS_VIEWS\.LOADING/);
  assert.match(queueSource, /MISSING_LYRICS_VIEWS\.ERROR/);
  assert.match(queueSource, /MISSING_LYRICS_VIEWS\.EMPTY/);
  assert.match(queueSource, /MISSING_LYRICS_VIEWS\.READY/);
  assert.match(queueSource, /aria-live="polite"/);
  assert.match(queueSource, /role="status"/);
  assert.match(queueSource, /role="alert"/);
});

test('13: pagination exposes Previous / Next with a page label', () => {
  assert.ok(uiSource.includes("PREVIOUS: 'Previous'"));
  assert.ok(uiSource.includes("NEXT: 'Next'"));
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.PREVIOUS/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.NEXT/);
  assert.match(queueSource, /aria-label="Missing lyrics pages"/);
  assert.match(queueSource, /pagination\.label/);
});

test('14: queue issues one request per explicit filter change and never polls', () => {
  assert.match(queueSource, /useEffect\(\(\) => \{/);
  assert.match(queueSource, /load\(\{ q: query, language, missing: missingOnly, page \}\)/);
  assert.match(queueSource, /const generation = generationRef\.current \+ 1;/);
  assert.match(queueSource, /if \(generation !== generationRef\.current\) return;/);
  assert.equal(queueSource.includes('setInterval('), false, 'no polling');
  assert.equal(queueSource.includes('setTimeout('), false, 'no debounced polling');
  assert.equal(queueSource.includes('setInterval'), false);
  assert.equal(/refresh\(\)/.test(queueSource), false, 'no auto-retry loop');
  assert.equal(/auto.*refresh/i.test(queueSource), false);
});

test('15: search applies only on explicit submit, not per keystroke', () => {
  assert.match(queueSource, /onChange=\{\(event\) => setSearchDraft\(event\.target\.value\)\}/);
  assert.match(queueSource, /setQuery\(searchDraft\.trim\(\)\)/);
  assert.equal(/load\(\{ q: searchDraft/.test(queueSource), false, 'typing must not fire requests');
  assert.match(queueSource, /event\.preventDefault\(\)/);
});

test('16: bulk import accepts only csv/json and is size bounded', () => {
  assert.match(queueSource, /BULK_IMPORT_FILE_INPUT_ACCEPT/);
  assert.match(uiSource, /BULK_IMPORT_FILE_INPUT_ACCEPT = '\.csv,\.json'/);
  assert.match(serviceSource, /BULK_IMPORT_FILE_EXTENSIONS = Object\.freeze\(\['\.csv', '\.json'\]\)/);
  assert.match(serviceSource, /MAX_BULK_IMPORT_BYTES = 786432/);
  assert.match(serviceSource, /MAX_BULK_LYRICS_ENTRIES = 500/);
  assert.match(queueSource, /validateBulkFileSelection\(\{ name: file\.name, size: file\.size \}\)/);
  assert.match(queueSource, /MAX_BULK_LYRICS_ENTRIES/);
});

test('17: bulk import surfaces counts and the replace-verified confirmation', () => {
  assert.match(queueSource, /buildImportCountCards\(importResult\.counts\)/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.REPLACE_HINT/);
  assert.match(queueSource, /type="checkbox"/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.IMPORTED/);
  assert.match(uiSource, /label: 'Imported'/);
  assert.match(uiSource, /label: 'Duplicate'/);
  assert.match(uiSource, /label: 'Rejected'/);
  assert.match(uiSource, /label: 'Invalid'/);
  assert.equal(/label: 'Total'/.test(uiSource), false, 'total is not a count card');
});

test('18: bulk import requires a selected file before posting', () => {
  assert.match(queueSource, /if \(!importFile\) \{/);
  assert.match(queueSource, /ADMIN_MISSING_LYRICS_MESSAGES\.NO_FILE_SELECTED/);
  assert.match(serviceSource, /NO_FILE_SELECTED: 'Select at least one file\.'/
);
});

test('19: queue refreshes after a verified save and after a successful import', () => {
  assert.match(queueSource, /onSaved=\{\(\) => \{/);
  assert.match(queueSource, /setNotice\(MISSING_LYRICS_MESSAGES\.SAVED\)/);
  assert.match(queueSource, /setRefreshToken\(\(token\) => token \+ 1\)/);
  assert.match(queueSource, /MISSING_LYRICS_MESSAGES\.SAVED/);
});

test('20: queue panel has responsive shell-safe styles', () => {
  assert.match(adminCss, /\.missing-lyrics-panel|\.missing-lyrics-filters/);
  assert.match(adminCss, /\.missing-lyrics-table \{/);
  assert.match(adminCss, /@media \(max-width: 768px\)/);
  assert.match(adminCss, /\.missing-lyrics-table-wrap \{\n\s*overflow-x: auto;/);
});

test('21: no third-party lyric-site scraping in the queue workflow', () => {
  const haystack = [queueSource, dialogSource, uiSource, serviceSource].join('\n');
  assert.equal(/genius\.com/i.test(haystack), false);
  assert.equal(/azlyrics/i.test(haystack), false);
  assert.equal(/musixmatch/i.test(haystack), false);
  assert.equal(/lyricsify/i.test(haystack), false);
  assert.equal(/google\.com\/search/i.test(haystack), false);
  assert.equal(/\bfetch\(/.test(haystack), false, 'no raw fetch — use the api client');
  assert.equal(/axios/.test(haystack), false);
  assert.equal(/new XMLHttpRequest/.test(haystack), false);
  assert.equal(/child_process/.test(haystack), false);
  assert.equal(/cheerio|puppeteer|playwright/i.test(haystack), false);
});
