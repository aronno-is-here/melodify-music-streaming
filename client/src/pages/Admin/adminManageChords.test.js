import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_IMPORT_EXTENSIONS } from '../../utils/chordSheet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Admin.css'), 'utf8');

const songTable = src.slice(src.indexOf('<th>Chords</th>'), src.indexOf("{section === 'missing-lyrics'}"));

test('each song row renders a visible Manage Chords action', () => {
  assert.ok(songTable.length > 0, 'song table must exist');
  assert.match(songTable, /className="btn admin-manage-chords"/);
  assert.match(
    songTable,
    /onClick=\{\(\) => manageSongChords\(song\)\}>Manage Chords<\/button>/,
  );
  assert.match(songTable, /<th>Chords<\/th>/);
  assert.match(songTable, /selectChordListStatus\(song\)/);
});

test('clicking Manage Chords selects that song and opens the chord editor', () => {
  const helper = src.slice(src.indexOf('const manageSongChords'), src.indexOf('const loadLyricsSources'));
  assert.ok(helper.length > 0, 'manageSongChords helper must exist');
  assert.match(helper, /openSongEditor\(song\)/);
  assert.match(helper, /getElementById\('song-chords-editor'\)/);
  assert.match(helper, /scrollIntoView/);

  const opener = src.slice(src.indexOf('const openSongEditor'), src.indexOf('const manageSongChords'));
  assert.ok(opener.length > 0, 'openSongEditor helper must exist');
  assert.match(opener, /setEditingSong\(song\)/);
  assert.match(opener, /setChordHasExisting\(hasChordContent\(song\)\)/);
  assert.match(opener, /setChordWorkflow\(CHORD_EDITOR_STATES\.EMPTY\)/);
});

test('chord editor shows the Manage Chords heading and current chord status', () => {
  assert.match(src, /<h4 className="admin-chord-heading">Manage Chords<\/h4>/);
  assert.match(src, /id="song-chords-editor"/);
  assert.match(src, /Current chord status: \{selectChordListStatus\(editingSong\)\}/);
  assert.match(css, /\.admin-chord-heading \{/);
  assert.match(css, /\.admin-manage-chords \{/);
});

test('JSON and TXT import options are visible under an explicit Import Chord File label', () => {
  assert.ok(CHORD_IMPORT_EXTENSIONS.includes('json'), 'json import option must exist');
  assert.ok(CHORD_IMPORT_EXTENSIONS.includes('txt'), 'txt import option must exist');
  const importGroup = src.slice(
    src.indexOf('className="admin-chord-import-group"'),
    src.indexOf('className="admin-chord-state"'),
  );
  assert.ok(importGroup.length > 0, 'import group must exist');
  assert.match(importGroup, />Import Chord File</);
  assert.match(importGroup, /Accepted: \{CHORD_IMPORT_EXTENSIONS\.map\(\(extension\) => `\.\$\{extension\}`\)\.join\(', '\)\}/);
  assert.match(importGroup, /CHORD_IMPORT_EXTENSIONS\.map\(\(extension\) => \(/);
  assert.match(importGroup, /\{`Import \.\$\{extension\}`\}/);
  assert.match(importGroup, /accept=\{\`\.\$\{extension\}\`\}/);
  assert.match(css, /\.admin-chord-import-group \{/);
});

test('Paste Chords, Preview and Save Chords controls are visible', () => {
  assert.match(src, /<label>Paste Chords<\/label>/);
  assert.match(src, /onClick=\{previewChords\}>Preview<\/button>/);
  assert.match(src, /disabled=\{chordSaveDisabled\} onClick=\{saveChordsOnly\}>Save Chords<\/button>/);
  assert.match(src, /<pre className="admin-chord-preview-body">/);
});

test('existing chords warning and replace confirmation remain', () => {
  assert.match(src, /\{chordHasExisting \? \(/);
  assert.match(src, /Existing chords will be replaced\./);
  assert.match(src, /Existing chords will be replaced\. Press Save Chords again to confirm\./);
});

test('no unrelated Admin section regression', () => {
  assert.match(songTable, />Edit<\/button>/);
  assert.match(songTable, />Delete<\/button>/);
  assert.match(songTable, /onClick=\{\(\) => openSongEditor\(song\)\}>Edit<\/button>/);
  assert.match(src, /<h2>Music Catalog<\/h2>/);
  assert.ok(src.includes("{section === 'missing-lyrics' && <MissingLyricsQueue />}"));
  assert.match(src, /Chords Verification/);
  assert.match(src, /Suggested Sources/);
  assert.equal(src.split('const saveChordsOnly').length - 1, 1, 'single chord save implementation');
  assert.equal(src.split('const manageSongChords').length - 1, 1, 'single manage chords implementation');
  assert.equal(src.split('<label>Paste Chords</label>').length - 1, 1, 'single paste chords control');
});
