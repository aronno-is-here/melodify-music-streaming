import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dialogSource = readFileSync(join(__dirname, 'AddLyricsDialog.jsx'), 'utf8');
const uiSource = readFileSync(join(__dirname, 'missingLyricsUi.js'), 'utf8');
const serviceSource = readFileSync(
  join(__dirname, '..', '..', 'services', 'adminMissingLyrics.js'),
  'utf8',
);
const panelSource = readFileSync(
  join(__dirname, '..', 'Dashboard', 'LyricsChordsPanel.jsx'),
  'utf8',
);
const providerSource = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'server', 'services', 'lyricsProviderService.js'),
  'utf8',
);
const adminLyricsServiceSource = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'server', 'services', 'adminLyricsService.js'),
  'utf8',
);
const romanizationSource = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'server', 'utils', 'lyricsRomanization.js'),
  'utf8',
);

test('1: dialog uses the shared AppDialog shell', () => {
  assert.ok(dialogSource.includes("import AppDialog from '../../components/ui/AppDialog.jsx';"));
  assert.match(dialogSource, /<AppDialog/);
  assert.match(dialogSource, /labelledBy="add-lyrics-title"/);
  assert.match(dialogSource, /width="720px"/);
});

test('2: dialog renders Song, Artist, Language, Synced-Plain, Source URL, provider and Notes', () => {
  assert.ok(dialogSource.includes('ADD_LYRICS_FIELD_IDS.title'));
  assert.ok(dialogSource.includes('ADD_LYRICS_FIELD_IDS.artist'));
  assert.ok(dialogSource.includes('ADD_LYRICS_FIELD_IDS.language'));
  assert.ok(dialogSource.includes('ADD_LYRICS_FIELD_IDS.format'));
  assert.ok(dialogSource.includes('ADD_LYRICS_FIELD_IDS.sourceUrl'));
  assert.ok(dialogSource.includes('ADD_LYRICS_FIELD_IDS.sourceProvider'));
  assert.ok(dialogSource.includes('ADD_LYRICS_FIELD_IDS.notes'));
  assert.ok(dialogSource.includes('ADD_LYRICS_FIELD_IDS.lyrics'));
  assert.match(dialogSource, />Song</);
  assert.match(dialogSource, />Artist</);
  assert.match(dialogSource, /Synced-Plain/);
  assert.match(dialogSource, /Source URL/);
  assert.match(dialogSource, /Source provider/);
  assert.match(dialogSource, />Notes</);
});

test('3: Song and Artist are read-only', () => {
  assert.match(dialogSource, /value=\{initial\.title\} readOnly/);
  assert.match(dialogSource, /value=\{initial\.artist\} readOnly/);
  assert.match(dialogSource, /value=\{formatLabel\} readOnly/);
});

test('4: dialog never edits the song title or artist', () => {
  assert.equal(/onChange=\{[^}]*initial\.title/.test(dialogSource), false);
  assert.equal(/onChange=\{[^}]*initial\.artist/.test(dialogSource), false);
  assert.equal(dialogSource.includes('setTitle'), false);
  assert.equal(dialogSource.includes('setArtist'), false);
});

test('5: paste from file accepts only .txt and .lrc', () => {
  assert.match(dialogSource, /accept=\{LYRICS_FILE_INPUT_ACCEPT\}/);
  assert.match(uiSource, /LYRICS_FILE_INPUT_ACCEPT = '\.txt,\.lrc'/);
  assert.match(serviceSource, /LYRICS_FILE_EXTENSIONS = Object\.freeze\(\['\.txt', '\.lrc'\]\)/);
  assert.match(dialogSource, /validateLyricsFileSelection\(\{ name: file\.name, size: file\.size, type: file\.type \}\)/);
  assert.match(dialogSource, /MISSING_LYRICS_MESSAGES\.PASTE_FILE|Paste from file/);
  assert.equal(/accept="\.csv/.test(dialogSource), false, 'dialog is not a bulk import surface');
});

test('6: dialog rejects disallowed lyric file types and oversized files', () => {
  assert.match(serviceSource, /BAD_FILE_TYPE: 'Only \.txt and \.lrc lyric files are allowed\.'/);
  assert.match(serviceSource, /FILE_TOO_LARGE: 'That file is too large\.'|FILE_TOO_LARGE/);
  assert.match(serviceSource, /MAX_LYRICS_FILE_BYTES = 262144/);
  assert.match(serviceSource, /if \(size > MAX_LYRICS_FILE_BYTES\)/);
  assert.match(serviceSource, /if \(!LYRICS_FILE_EXTENSIONS\.includes\(extension\)\)/);
});

test('7: file read failure surfaces a fixed message', () => {
  assert.match(dialogSource, /setError\(ADMIN_MISSING_LYRICS_MESSAGES\.PASTE_FAILED\)/);
  assert.match(serviceSource, /PASTE_FAILED: 'That file could not be read as UTF-8 text\.'/
  );
});

test('8: synced-vs-plain indicator derives from the text', () => {
  assert.match(dialogSource, /setFormat\(detectLyricsFormat\(value\)\)/);
  assert.match(dialogSource, /setFormat\(detectLyricsFormat\(text\)\)/);
  assert.match(dialogSource, /format === 'lrc' \? 'Synced \(LRC\)' : 'Plain text'/);
  assert.match(serviceSource, /\? 'lrc' : 'plain'/);
});

test('9: dialog validates the draft and caps lyrics length', () => {
  assert.match(dialogSource, /validateAddLyricsDraft\(\{ lyrics, format \}\)/);
  assert.match(dialogSource, /MAX_LYRICS_TEXT_LENGTH/);
  assert.match(serviceSource, /MAX_LYRICS_TEXT_LENGTH = 100000/);
  assert.match(serviceSource, /if \(text\.length > MAX_LYRICS_TEXT_LENGTH\)/);
});

test('10: replace-verified confirmation appears only for verified songs', () => {
  assert.match(dialogSource, /\{initial\.hasVerifiedLyrics && \(/);
  assert.match(dialogSource, /ADD_LYRICS_FIELD_IDS\.replace/);
  assert.match(dialogSource, /if \(initial\.hasVerifiedLyrics && !replaceVerified\) \{/);
  assert.match(uiSource, /hasVerifiedLyrics: record\.lyricsStatus === 'verified'/);
  assert.match(uiSource, /REPLACE_HINT: 'Replace verified lyrics'/);
});

test('11: save posts only the allowlisted body fields', () => {
  const bodyBlock = dialogSource.slice(
    dialogSource.indexOf('const body = {'),
    dialogSource.indexOf('};', dialogSource.indexOf('const body = {')) + 2,
  );
  const keys = [...bodyBlock.matchAll(/^\s*([A-Za-z]+)(?=[,:])/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), [
    'format',
    'language',
    'lyrics',
    'notes',
    'replaceVerified',
    'sourceProvider',
    'sourceUrl',
  ]);
  assert.equal(keys.includes('songId'), false);
  assert.equal(keys.includes('lyrics_verified'), false);
  assert.equal(keys.includes('email'), false);
});

test('12: save is single-flight and cannot double-submit', () => {
  assert.match(dialogSource, /if \(inFlightRef\.current\) return;/);
  assert.match(dialogSource, /inFlightRef\.current = true;/);
  assert.match(dialogSource, /inFlightRef\.current = false;/);
  assert.match(dialogSource, /disabled=\{saving\}/);
  assert.match(dialogSource, /setSaving\(true\)/);
  assert.match(dialogSource, /setSaving\(false\)/);
  assert.match(dialogSource, /onClick=\{handleSave\} disabled=\{saving\}/);
});

test('13: save errors render inline with role=alert and aria-live', () => {
  assert.match(dialogSource, /aria-live="polite"/);
  assert.match(dialogSource, /role="alert"/);
  assert.match(dialogSource, /setError\(result\.error\)/);
  assert.match(dialogSource, /setError\(validated\.error\)/);
});

test('14: open source link is a new-tab anchor with noopener', () => {
  assert.match(dialogSource, /href=\{initial\.candidateUrl\}/);
  assert.match(dialogSource, /target="_blank"/);
  assert.match(dialogSource, /rel="noopener noreferrer"/);
  assert.match(dialogSource, /MISSING_LYRICS_MESSAGES\.OPEN_SOURCE/);
});

test('15: dialog renders nothing without a song id', () => {
  assert.match(dialogSource, /if \(!initial\.songId\) return null;/);
});

test('16: saved verified lyrics are read back by the lyrics panel immediately', () => {
  assert.match(providerSource, /song\.lyrics_verified === true && typeof song\.lyrics === 'string' && song\.lyrics\.trim\(\)/);
  assert.match(adminLyricsServiceSource, /lyrics_verified: true/);
  assert.match(adminLyricsServiceSource, /lyrics_source: ADMIN_LYRICS_VERIFIED_SOURCE/);
  assert.match(adminLyricsServiceSource, /lyrics_match_status: ADMIN_LYRICS_MATCH_STATUS/);
  assert.match(panelSource, /api\.get\(`\/api\/lyrics\/\$\{song\._id\}`\)/);
  assert.match(panelSource, /setLyricsLines\(data\.lines \|\| \[\]\)/);
});

test('17: verified-db status wins over provider lookups', () => {
  assert.match(providerSource, /source === 'verified-db' \? LYRICS_RESOLUTION_STATUS\.VERIFIED/);
  assert.match(providerSource, /resolveLegacyLyrics\(song, \{ source: 'verified-db' \}\)/);
});

test('18: saved lyrics receive a script presentation (romanization) server-side', () => {
  assert.match(adminLyricsServiceSource, /withScriptPresentation/);
  assert.match(adminLyricsServiceSource, /romanizedLines: presentation\.romanizedLines/);
  assert.match(adminLyricsServiceSource, /displayLines: presentation\.displayLines/);
  assert.match(romanizationSource, /export function withScriptPresentation/);
  assert.match(panelSource, /setRomanizedLines\(romanized\)/);
  assert.match(panelSource, /script === 'devanagari' && romanized \? 'romanized' : 'original'/);
});

test('19: no external lyric-site scraping or raw network calls in the dialog', () => {
  const haystack = [dialogSource, uiSource, serviceSource].join('\n');
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

test('20: dialog state resets when the target song changes', () => {
  const effect = dialogSource.slice(
    dialogSource.indexOf('useEffect(() => {'),
    dialogSource.indexOf('}, [initial.songId'),
  );
  assert.ok(effect.includes("setLyrics('')"));
  assert.ok(effect.includes("setNotes('')"));
  assert.ok(effect.includes("setReplaceVerified(false)"));
  assert.ok(effect.includes("setError('')"));
  assert.ok(effect.includes("setFormat('plain')"));
  assert.match(dialogSource, /\}, \[initial\.songId, initial\.language, initial\.sourceUrl, initial\.sourceProvider\]\);/);
});
