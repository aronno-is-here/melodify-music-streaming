import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_CHORD_MESSAGES,
  ADMIN_CHORD_STATUS_FILTERS,
  filterAdminChordSongs,
  selectAdminChordView,
  selectAdminChordViewMessage,
} from './adminContentWorkspacesUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8').replace(/\r\n/g, '\n');
const helperSource = readFileSync(join(__dirname, 'adminContentWorkspacesUi.js'), 'utf8');

const chordsBlock = adminSource.slice(
  adminSource.indexOf("section === 'chords'"),
  adminSource.indexOf("section === 'karaoke'"),
);

const musicBlock = adminSource.slice(
  adminSource.indexOf("section === 'music'"),
  adminSource.indexOf("section === 'missing-lyrics'"),
);

test('1: Chords section renders a dedicated Chord Management page header', () => {
  assert.match(adminSource, /<div id="chords" className="admin-page">/);
  assert.match(chordsBlock, /<h2>Chord Management<\/h2>/);
  assert.equal(
    ADMIN_CHORD_MESSAGES.PAGE_SUBTITLE,
    'Manage, import, verify, and update chord sheets for songs in the Melodify catalog.',
  );
  assert.match(chordsBlock, /\{ADMIN_CHORD_MESSAGES\.PAGE_SUBTITLE\}/);
  assert.match(chordsBlock, /admin-page-header/);
  assert.match(chordsBlock, /loadAll\(true\)/);
});

test('2: chord toolbar searches songs or artists and filters by chord status', () => {
  assert.equal(ADMIN_CHORD_MESSAGES.SEARCH_PLACEHOLDER, 'Search songs or artists...');
  assert.match(chordsBlock, /placeholder=\{ADMIN_CHORD_MESSAGES\.SEARCH_PLACEHOLDER\}/);
  assert.match(chordsBlock, /className="admin-toolbar"/);
  assert.match(chordsBlock, /value=\{chordSearch\}/);
  assert.match(chordsBlock, /value=\{chordStatusFilter\}/);
  assert.deepEqual(
    ADMIN_CHORD_STATUS_FILTERS.map((entry) => entry.value),
    ['all', 'available', 'missing', 'verified', 'unverified'],
  );
  assert.deepEqual(
    ADMIN_CHORD_STATUS_FILTERS.map((entry) => entry.label),
    ['All', 'Available', 'Missing', 'Verified', 'Unverified'],
  );
  assert.match(chordsBlock, /ADMIN_CHORD_STATUS_FILTERS\.map\(\(option\) => \(/);
});

test('3: chord workspace states use polished messages with an explicit Retry', () => {
  assert.equal(ADMIN_CHORD_MESSAGES.LOADING, 'Loading chords...');
  assert.equal(ADMIN_CHORD_MESSAGES.ERROR, 'Unable to load chords.');
  assert.equal(ADMIN_CHORD_MESSAGES.EMPTY, 'No songs in the catalog.');
  assert.equal(ADMIN_CHORD_MESSAGES.NO_MATCHES, 'No songs match the current filters.');
  assert.equal(ADMIN_CHORD_MESSAGES.RETRY, 'Retry');
  assert.match(chordsBlock, /chordView === 'loading'/);
  assert.match(chordsBlock, /chordView === 'error'/);
  assert.match(chordsBlock, /chordView === 'empty'/);
  assert.match(chordsBlock, /chordView === 'no-matches'/);
  assert.match(chordsBlock, /admin-error-state" role="alert"/);
  assert.match(chordsBlock, /\{ADMIN_CHORD_MESSAGES\.RETRY\}/);
  assert.equal(
    selectAdminChordViewMessage('loading'),
    'Loading chords...',
  );
  assert.equal(selectAdminChordViewMessage('unknown'), '');
});

test('4: chord list shows song, artist, format, status and actions columns', () => {
  assert.match(chordsBlock, /<th>Song<\/th>/);
  assert.match(chordsBlock, /<th>Artist<\/th>/);
  assert.match(chordsBlock, /<th>Format<\/th>/);
  assert.match(chordsBlock, /<th>Chord Status<\/th>/);
  assert.match(chordsBlock, /<th>Actions<\/th>/);
  assert.match(chordsBlock, /selectChordListStatus\(song\)/);
  assert.match(chordsBlock, /CHORD_FORMATS\.includes\(song\.chords_format\)/);
  assert.match(chordsBlock, /admin-badge \$\{selectAdminBadgeTone\(selectChordListStatus\(song\)\)\}/);
  assert.match(chordsBlock, /admin-table-shell/);
});

test('5: Manage Chords on the chords page opens the existing editor in Music', () => {
  assert.match(
    chordsBlock,
    /onClick=\{\(\) => \{ handleNavClick\('music'\); manageSongChords\(song\); \}\}/,
  );
  assert.ok(chordsBlock.includes('Manage Chords'), 'Manage Chords action label');
  assert.match(chordsBlock, /admin-manage-chords/);
  assert.equal(adminSource.split('const manageSongChords').length - 1, 1, 'single manage chords implementation');
  assert.match(musicBlock, /onClick=\{\(\) => manageSongChords\(song\)\}>Manage Chords<\/button>/);
  assert.match(adminSource, /id="song-chords-editor"/);
  assert.match(adminSource, /disabled=\{chordSaveDisabled\} onClick=\{saveChordsOnly\}>Save Chords<\/button>/);
});

test('6: the chords page never duplicates the chord editor or its save path', () => {
  assert.equal(chordsBlock.includes('<label>Paste Chords</label>'), false);
  assert.equal(chordsBlock.includes('Save Chords'), false);
  assert.equal(chordsBlock.includes('saveChordsOnly'), false);
  assert.equal(chordsBlock.includes('setChordWorkflow'), false);
  assert.equal(chordsBlock.includes('admin-chord-import-group'), false);
  assert.equal(adminSource.split('<label>Paste Chords</label>').length - 1, 1, 'editor stays unique');
  assert.equal(adminSource.split('const saveChordsOnly').length - 1, 1, 'single chord save implementation');
});

test('7: chords reference links open safely in a new tab when available', () => {
  assert.match(chordsBlock, /song\.chords_reference_url \? \(/);
  assert.match(chordsBlock, /target="_blank"/);
  assert.match(chordsBlock, /rel="noopener noreferrer"/);
  assert.equal(ADMIN_CHORD_MESSAGES.OPEN_SOURCE, 'Open Source');
});

test('8: filter helper applies chord status and text matching', () => {
  const verified = { title: 'Clocks', artist: 'Coldplay', chords: 'Am F', chords_verified: true };
  const unverified = { title: 'Yellow', artist: 'Coldplay', chords: 'G D' };
  const missing = { title: 'Hymn', artist: 'Avril', chords: '' };
  const songs = [verified, unverified, missing];

  assert.deepEqual(filterAdminChordSongs(songs, { query: '', status: 'all' }), songs);
  assert.deepEqual(filterAdminChordSongs(songs, { query: 'clocks', status: 'all' }), [verified]);
  assert.deepEqual(filterAdminChordSongs(songs, { query: 'coldplay', status: 'all' }), [verified, unverified]);
  assert.deepEqual(filterAdminChordSongs(songs, { query: '', status: 'missing' }), [missing]);
  assert.deepEqual(filterAdminChordSongs(songs, { query: '', status: 'available' }), [verified, unverified]);
  assert.deepEqual(filterAdminChordSongs(songs, { query: '', status: 'verified' }), [verified]);
  assert.deepEqual(filterAdminChordSongs(songs, { query: '', status: 'unverified' }), [unverified]);
  assert.deepEqual(filterAdminChordSongs(songs, { query: 'yellow', status: 'missing' }), []);
  assert.deepEqual(filterAdminChordSongs(null, {}), []);
  assert.deepEqual(filterAdminChordSongs('not-a-list', { status: 'all' }), []);
});

test('9: chord view helper mirrors the music workspace state machine', () => {
  assert.equal(selectAdminChordView({ status: 'loading', totalSongs: 0, matchCount: 0 }), 'loading');
  assert.equal(selectAdminChordView({ status: 'error', totalSongs: 0, matchCount: 0 }), 'error');
  assert.equal(selectAdminChordView({ status: 'ready', totalSongs: 0, matchCount: 0 }), 'empty');
  assert.equal(selectAdminChordView({ status: 'ready', totalSongs: 3, matchCount: 0 }), 'no-matches');
  assert.equal(selectAdminChordView({ status: 'ready', totalSongs: 3, matchCount: 2 }), 'ready');
  assert.equal(selectAdminChordView({ status: 'error', totalSongs: 3, matchCount: 2 }), 'ready');
});

test('10: chords workspace stays client-side and reuses the shared shell styles', () => {
  assert.equal(/child_process|spawn\(|execSync/.test(helperSource), false);
  assert.equal(/child_process|spawn\(|execSync/.test(chordsBlock), false);
  assert.equal(/\bfetch\(/.test(chordsBlock), false, 'chords page reads through the existing loader');
  assert.match(adminCss, /\.admin-toolbar \{/);
  assert.match(adminCss, /\.admin-table-shell \{/);
  assert.match(adminCss, /\.admin-state-block \{/);
  assert.match(adminCss, /@media \(max-width: 768px\)/);
  assert.match(adminCss, /\.admin-page-header \{/);
});
