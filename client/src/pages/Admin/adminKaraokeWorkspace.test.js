import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_KARAOKE_MESSAGES,
  selectAdminKaraokeView,
  selectAdminKaraokeViewMessage,
  selectKaraokeAvailability,
  selectKaraokeAvailabilityTone,
  selectKaraokeSource,
  selectKaraokeSourceTone,
} from './adminContentWorkspacesUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const formSource = readFileSync(join(__dirname, 'KaraokeForm.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8').replace(/\r\n/g, '\n');

const karaokeBlock = adminSource.slice(
  adminSource.indexOf("section === 'karaoke'"),
  adminSource.indexOf("section === 'moderation'"),
);

test('1: Karaoke page presents the Karaoke Management header and its two areas', () => {
  assert.match(adminSource, /<div id="karaoke" className="admin-page">/);
  assert.match(karaokeBlock, /<h2>Karaoke Management<\/h2>/);
  assert.equal(
    ADMIN_KARAOKE_MESSAGES.PAGE_SUBTITLE,
    'Manage karaoke tracks and content used by Melodify Studio.',
  );
  assert.equal(ADMIN_KARAOKE_MESSAGES.LIBRARY_TITLE, 'Karaoke Library');
  assert.equal(ADMIN_KARAOKE_MESSAGES.ADD_TITLE, 'Add Karaoke');
  assert.match(karaokeBlock, /\{ADMIN_KARAOKE_MESSAGES\.LIBRARY_TITLE\}/);
  assert.match(karaokeBlock, /\{ADMIN_KARAOKE_MESSAGES\.ADD_TITLE\}/);
  assert.match(karaokeBlock, /aria-labelledby="karaoke-library-heading"/);
  assert.match(karaokeBlock, /aria-labelledby="karaoke-add-heading"/);
  assert.ok(
    karaokeBlock.indexOf('karaoke-library-heading') < karaokeBlock.indexOf('karaoke-add-heading'),
    'library area renders before the add area',
  );
});

test('2: library states use the exact messages with an explicit Retry', () => {
  assert.equal(ADMIN_KARAOKE_MESSAGES.LOADING, 'Loading karaoke...');
  assert.equal(ADMIN_KARAOKE_MESSAGES.EMPTY, 'No karaoke tracks available.');
  assert.equal(ADMIN_KARAOKE_MESSAGES.ERROR, 'Unable to load karaoke content.');
  assert.equal(ADMIN_KARAOKE_MESSAGES.RETRY, 'Retry');
  assert.match(karaokeBlock, /karaokeView === 'loading'/);
  assert.match(karaokeBlock, /karaokeView === 'error'/);
  assert.match(karaokeBlock, /karaokeView === 'empty'/);
  assert.match(karaokeBlock, /admin-error-state" role="alert"/);
  assert.match(karaokeBlock, /\{ADMIN_KARAOKE_MESSAGES\.RETRY\}/);
  assert.match(karaokeBlock, /onClick=\{\(\) => loadAll\(true\)\}/);
  assert.match(karaokeBlock, /role="status"/);
  assert.equal(selectAdminKaraokeViewMessage('ready'), '');
  assert.equal(selectAdminKaraokeViewMessage('loading'), 'Loading karaoke...');
});

test('3: library table shows artwork, metadata, source and availability badges', () => {
  assert.match(karaokeBlock, /<th>Artwork<\/th>/);
  assert.match(karaokeBlock, /<th>Title<\/th>/);
  assert.match(karaokeBlock, /<th>Artist<\/th>/);
  assert.match(karaokeBlock, /<th>Genre<\/th>/);
  assert.match(karaokeBlock, /<th>Duration<\/th>/);
  assert.match(karaokeBlock, /<th>Source<\/th>/);
  assert.match(karaokeBlock, /<th>Availability<\/th>/);
  assert.match(karaokeBlock, /<th>Actions<\/th>/);
  assert.match(karaokeBlock, /selectKaraokeSource\(k\)/);
  assert.match(karaokeBlock, /selectKaraokeAvailability\(k\)/);
  assert.match(karaokeBlock, /admin-badge \$\{selectKaraokeSourceTone\(source\)\}/);
  assert.match(karaokeBlock, /admin-badge \$\{selectKaraokeAvailabilityTone\(availability\)\}/);
  assert.match(karaokeBlock, /admin-table-art/);
});

test('4: hide, show and delete actions are preserved and success messaging is polished', () => {
  assert.match(karaokeBlock, /\{k\.available \? 'Hide' : 'Show'\}/);
  assert.match(karaokeBlock, /deleteKaraoke\(k\._id\)/);
  assert.match(karaokeBlock, /api\.put\(`\/api\/karaoke\/\$\{k\._id\}`/);
  assert.equal(ADMIN_KARAOKE_MESSAGES.ADDED, 'Karaoke added successfully.');
  assert.equal(ADMIN_KARAOKE_MESSAGES.UPLOAD_FAILED, 'Upload failed.');
  assert.match(karaokeBlock, /showMessage\(ADMIN_KARAOKE_MESSAGES\.ADDED\)/);
  assert.match(formSource, /ADMIN_KARAOKE_MESSAGES\.UPLOAD_FAILED/);
  assert.match(formSource, /ADMIN_KARAOKE_MESSAGES\.ADD_FAILED/);
});

test('5: add form keeps track information and source groups with labeled controls', () => {
  assert.match(formSource, /<legend>Track information<\/legend>/);
  assert.match(formSource, /<legend>Source<\/legend>/);
  for (const id of [
    'karaoke-title',
    'karaoke-artist',
    'karaoke-genre',
    'karaoke-duration',
    'karaoke-youtube-id',
    'karaoke-poster-url',
    'karaoke-audio-file',
    'karaoke-poster-file',
  ]) {
    assert.ok(formSource.includes(`htmlFor="${id}"`), `${id} label`);
    assert.ok(formSource.includes(`id="${id}"`), `${id} input`);
  }
  assert.match(formSource, />Title \*</);
  assert.match(formSource, />Artist \*</);
  assert.match(formSource, />YouTube Video ID</);
  assert.match(formSource, /Audio File \(MP3, WAV, WebM, M4A\) \*/);
  assert.match(formSource, />Poster Image \(optional\)</);
  assert.match(formSource, /\{submitting \? 'Adding\.\.\.' : 'Add Karaoke Track'\}/);
  assert.match(formSource, /disabled=\{submitting\}/);
});

test('6: source selector is a segmented control without legacy inline styling', () => {
  assert.match(formSource, /className="karaoke-source-toggle" role="group"/);
  assert.match(formSource, /aria-pressed=\{mode === 'youtube'\}/);
  assert.match(formSource, /aria-pressed=\{mode === 'upload'\}/);
  assert.match(formSource, /karaoke-source-option\$\{mode === 'youtube' \? ' is-active' : ''\}/);
  assert.ok(formSource.includes('>\n            YouTube ID\n'), 'YouTube ID option label');
  assert.ok(formSource.includes('>\n            Upload Audio File\n'), 'Upload Audio File option label');
  assert.equal(formSource.includes('style={{'), false, 'no inline styles in the modernized form');
  assert.equal(formSource.includes('btn-danger'), false, 'mode toggle is not a destructive action');
  assert.match(adminCss, /\.karaoke-source-option \{/);
  assert.match(adminCss, /\.karaoke-source-option\.is-active \{/);
});

test('7: existing karaoke API behavior is preserved', () => {
  assert.match(formSource, /api\.post\('\/api\/karaoke', \{/);
  assert.match(formSource, /fetch\('\/api\/karaoke\/upload'/);
  assert.match(adminSource, /api\.get\('\/api\/karaoke\/all'\)/);
  assert.match(karaokeBlock, /api\.put\(`\/api\/karaoke\/\$\{k\._id\}`/);
  assert.match(formSource, /getActiveAuthToken\(\)/);
  assert.equal(formSource.includes("ADMIN_KARAOKE_MESSAGES.ADDED"), false, 'form notifies through callbacks');
});

test('8: workspace helpers derive source, availability and view states', () => {
  assert.equal(selectKaraokeSource({ youtube_id: 'abc123' }), 'YouTube');
  assert.equal(selectKaraokeSource({ youtube_id: '  ', file_path: '/uploads/a.mp3' }), 'Uploaded');
  assert.equal(selectKaraokeSource({}), 'None');
  assert.equal(selectKaraokeSource(null), 'None');
  assert.equal(selectKaraokeSourceTone('YouTube'), 'info');
  assert.equal(selectKaraokeSourceTone('Uploaded'), 'ok');
  assert.equal(selectKaraokeSourceTone('None'), 'muted');
  assert.equal(selectKaraokeAvailability({ available: false }), 'Hidden');
  assert.equal(selectKaraokeAvailability({ available: true }), 'Available');
  assert.equal(selectKaraokeAvailability({}), 'Available');
  assert.equal(selectKaraokeAvailabilityTone('Available'), 'ok');
  assert.equal(selectKaraokeAvailabilityTone('Hidden'), 'muted');
  assert.equal(selectAdminKaraokeView({ status: 'loading', totalTracks: 0 }), 'loading');
  assert.equal(selectAdminKaraokeView({ status: 'error', totalTracks: 0 }), 'error');
  assert.equal(selectAdminKaraokeView({ status: 'ready', totalTracks: 0 }), 'empty');
  assert.equal(selectAdminKaraokeView({ status: 'ready', totalTracks: 2 }), 'ready');
  assert.equal(selectAdminKaraokeView({ status: 'error', totalTracks: 2 }), 'ready');
});

test('9: karaoke workspace does not touch studio recording flags or poll', () => {
  const haystack = adminSource + formSource;
  assert.equal(/KARAOKE_READY/.test(haystack), false);
  assert.equal(/SING_ALONG/.test(haystack), false);
  assert.equal(karaokeBlock.includes('setTimeout('), false);
  assert.equal(karaokeBlock.includes('setInterval'), false);
  assert.equal(formSource.includes('setInterval'), false);
  assert.equal(formSource.includes('setTimeout('), false);
  assert.match(adminSource, /const SECTIONS = \['dashboard', 'users', 'music', 'missing-lyrics', 'karaoke', 'moderation', 'subscriptions', 'ai-recommendation'\]/);
});

test('10: karaoke workspace reuses the shared shell styles and stays responsive', () => {
  assert.match(adminCss, /\.admin-panel-head \{/);
  assert.match(adminCss, /\.karaoke-source-toggle \{/);
  assert.match(adminCss, /\.karaoke-form-submit \{/);
  assert.match(adminCss, /@media \(max-width: 768px\)/);
  assert.match(karaokeBlock, /admin-page-header/);
  assert.match(karaokeBlock, /admin-table-shell/);
  assert.match(karaokeBlock, /admin-state-block/);
});
