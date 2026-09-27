import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8');

test('admin music editor exposes a suggested sources section', () => {
  assert.match(adminSource, /Suggested Sources/);
  assert.match(adminSource, /className="admin-sources-panel"/);
  assert.match(adminSource, /Find Sources/);
  assert.match(adminSource, /Refresh Sources/);
});

test('admin source discovery calls the authenticated sources endpoint', () => {
  assert.match(adminSource, /\/api\/lyrics\/\$\{editingSong\._id\}\/sources/);
  assert.match(adminSource, /refresh \? '\?refresh=1' : ''/);
  assert.match(adminSource, /api\.get\(/);
});

test('admin source discovery renders explicit states', () => {
  assert.match(adminSource, /status === 'idle'/);
  assert.match(adminSource, /status === 'loading'/);
  assert.match(adminSource, /status === 'error'/);
  assert.match(adminSource, /status === 'ready'/);
  assert.match(adminSource, /Finding source pages/);
  assert.match(adminSource, /No source pages found for this song yet\./);
  assert.match(adminSource, /Unable to load suggested sources\./);
});

test('admin source rows open links safely and can adopt the discovered url', () => {
  assert.match(adminSource, /target="_blank"/);
  assert.match(adminSource, /rel="noopener noreferrer"/);
  assert.match(adminSource, /href=\{candidate\.url\}/);
  assert.match(adminSource, /Use URL/);
  assert.match(adminSource, /setSourceUrlDraft\(candidate\.url\)/);
  assert.match(adminSource, /Open Source/);
});

test('admin lyrics editor persists source url and notes through the content payload', () => {
  assert.match(adminSource, /lyrics_source_url: sourceUrlDraft\.trim\(\)/);
  assert.match(adminSource, /lyrics_notes: toTrimmedText\(formData\.get\('lyrics_notes'\)\)/);
  assert.match(adminSource, /name="lyrics_source_url"/);
  assert.match(adminSource, /name="lyrics_notes"/);
  assert.match(adminSource, /maxLength=\{1000\}/);
});

test('admin opens the music editor from a deep-linked song id', () => {
  assert.match(adminSource, /location\.state\.editSongId/);
  assert.match(adminSource, /openSongEditor\(target\)/);
  assert.match(adminSource, /navigate\('\/admin', \{ replace: true, state: \{ section: 'music' \} \}\)/);
});

test('admin resets source discovery state whenever the editor opens', () => {
  const openEditor = adminSource.slice(
    adminSource.indexOf('const openSongEditor'),
    adminSource.indexOf('const loadLyricsSources'),
  );
  assert.ok(openEditor.length > 0, 'openSongEditor helper must exist');
  assert.match(openEditor, /setSourceUrlDraft\(/);
  assert.match(openEditor, /status: 'idle'/);
  assert.match(openEditor, /candidates: \[\]/);
});

test('admin suggested sources styles are present', () => {
  assert.match(adminCss, /\.admin-sources-panel/);
  assert.match(adminCss, /\.admin-source-list/);
  assert.match(adminCss, /\.admin-source-row/);
  assert.match(adminCss, /\.admin-source-label/);
  assert.match(adminCss, /\.admin-source-actions/);
  assert.match(adminCss, /\.admin-sources-hint/);
});

test('admin suggested sources section never stores fetched lyric bodies', () => {
  const sourcesPanel = adminSource.slice(
    adminSource.indexOf('Suggested Sources'),
    adminSource.indexOf('Chords Verification'),
  );
  assert.ok(sourcesPanel.length > 0);
  assert.equal(/innerHTML|dangerouslySetInnerHTML|atob\(|base64/.test(sourcesPanel), false);
  assert.match(sourcesPanel, /Open Source/);
});
