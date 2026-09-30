import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_IMPORT_EXTENSIONS } from '../../utils/chordSheet.js';
import {
  CHORD_EDITOR_STATES,
  CHORD_EDITOR_STATE_LABELS,
  CHORD_LIST_STATUSES,
  buildChordPreview,
  evaluateChordDraftSave,
  hasChordContent,
  selectChordListStatus,
} from './chordEditorUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Admin.css'), 'utf8');

test('admin chord upload exposes json txt and paste chords surfaces', () => {
  assert.ok(CHORD_IMPORT_EXTENSIONS.includes('json'), 'json import option must exist');
  assert.ok(CHORD_IMPORT_EXTENSIONS.includes('txt'), 'txt import option must exist');
  assert.match(src, /CHORD_IMPORT_EXTENSIONS\.map\(\(extension\) => \(/);
  assert.match(src, /\{`Import \.\$\{extension\}`\}/);
  assert.match(src, /accept=\{\`\.\$\{extension\}\`\}/);
  assert.match(src, /<label>Paste Chords<\/label>/);
  assert.match(src, /name="chords"/);
});

test('admin chord upload reads files client side through the shared parser', () => {
  const importBody = src.slice(src.indexOf('const onChordImportChange'), src.indexOf('const clearChordDraft'));
  assert.match(importBody, /readChordImportFile\(file, extension\)/);
  assert.equal(/FormData\(\)|\.append\(|XMLHttpRequest|type="file"[^>]*multiple/.test(importBody), false);
});

test('admin chord import failures surface fixed errors without stack traces', () => {
  const importBody = src.slice(src.indexOf('const onChordImportChange'), src.indexOf('const clearChordDraft'));
  assert.ok(importBody.length > 0);
  assert.match(importBody, /if \(!result\.ok\) \{/);
  assert.match(importBody, /setChordNotice\(\{ text: result\.error, isError: true \}\)/);
  assert.match(importBody, /setChordWorkflow\(CHORD_EDITOR_STATES\.ERROR\)/);
  assert.equal(/\{error\.message\}|stack/.test(importBody), false);
});

test('valid imports build a preview and reach the preview ready state', () => {
  const importBody = src.slice(src.indexOf('const onChordImportChange'), src.indexOf('const clearChordDraft'));
  assert.match(importBody, /setChordPreview\(buildChordPreview\(/);
  assert.match(importBody, /setChordWorkflow\(CHORD_EDITOR_STATES\.PREVIEW_READY\)/);
  assert.match(src, /const previewChords = \(\) => \{/);
  assert.match(src, /const evaluation = evaluateChordDraftSave\(\{/);
});

test('preview renders a monospace preformatted block instead of raw json', () => {
  assert.match(src, /aria-label="Chord preview"/);
  assert.match(src, /className="admin-chord-preview-body"/);
  assert.match(src, /<pre className="admin-chord-preview-body">/);
  assert.match(src, /chordPreview\.kind === 'timeline' \? chordPreview\.lines\.join\('\\n'\) : chordPreview\.text/);
  assert.equal(/dangerouslySetInnerHTML|innerHTML|eval\(|new Function/.test(src), false);
});

test('save is disabled until the chord draft is valid and never double submits', () => {
  assert.match(src, /disabled=\{chordSaveDisabled\} onClick=\{saveChordsOnly\}>Save Chords<\/button>/);
  assert.match(src, /const chordSaveDisabled = !editingSong\?\._id/);
  assert.match(src, /\|\| !chordDraftEvaluation\.ok/);
  assert.match(src, /\|\| chordWorkflow === CHORD_EDITOR_STATES\.PARSING/);
  assert.match(src, /if \(!editingSong\?\._id \|\| chordSaving\) return;/);
  assert.match(src, /setChordSaving\(true\)/);
  assert.match(src, /finally \{\s*\n\s*setChordSaving\(false\);\s*\n\s*\}/);
});

test('existing chords are replaced only after an explicit confirmation', () => {
  assert.match(src, /Existing chords will be replaced\./);
  assert.match(src, /if \(chordHasExisting && !chordReplaceArmed\) \{/);
  assert.match(src, /Existing chords will be replaced\. Press Save Chords again to confirm\./);
  assert.match(src, /setChordReplaceArmed\(true\)/);
  assert.match(src, /setChordHasExisting\(hasChordContent\(song\)\)/);
});

test('save reports success and backend error states', () => {
  const saveBody = src.slice(src.indexOf('const saveChordsOnly'), src.indexOf('const saveSongEdits'));
  assert.ok(saveBody.length > 0);
  assert.match(saveBody, /if \(!song\) \{/);
  assert.match(saveBody, /setChordWorkflow\(CHORD_EDITOR_STATES\.ERROR\)/);
  assert.match(saveBody, /setChordWorkflow\(CHORD_EDITOR_STATES\.SUCCESS\)/);
  assert.match(saveBody, /setChordNotice\(\{ text: 'Chords saved\.', isError: false \}\)/);
  assert.match(saveBody, /updateSongContent\(editingSong\._id, buildChordDraftPayload\(evaluation\.timeline\)\)/);
});

test('chord saves go through the existing admin content endpoint only', () => {
  assert.match(src, /api\.put\(`\/api\/songs\/\$\{id\}\/content`/);
  assert.equal(/api\.(post|put|patch|del)\([^)]*chord/i.test(src), false);
});

test('song list surfaces a chord status column', () => {
  assert.match(src, /<th>Chords<\/th>/);
  assert.match(src, /<td>\{selectChordListStatus\(song\)\}<\/td>/);
});

test('editor workflow states and labels stay complete', () => {
  assert.deepEqual(Object.values(CHORD_EDITOR_STATES), [
    'empty',
    'file-selected',
    'parsing',
    'preview-ready',
    'saving',
    'success',
    'error',
  ]);
  for (const value of Object.values(CHORD_EDITOR_STATES)) {
    assert.equal(typeof CHORD_EDITOR_STATE_LABELS[value], 'string');
    assert.ok(CHORD_EDITOR_STATE_LABELS[value].length > 0);
  }
  assert.match(src, /CHORD_EDITOR_STATE_LABELS\[chordWorkflow\]/);
  assert.match(src, /setChordWorkflow\(CHORD_EDITOR_STATES\.PARSING\)/);
  assert.match(src, /setChordWorkflow\(CHORD_EDITOR_STATES\.SAVING\)/);
  assert.match(src, /setChordWorkflow\(CHORD_EDITOR_STATES\.EMPTY\)/);
});

test('chord status helper follows existing verification conventions', () => {
  assert.deepEqual(CHORD_LIST_STATUSES, ['Verified', 'Unverified', 'Missing']);
  assert.equal(selectChordListStatus({ chords: '', chords_verified: false }), 'Missing');
  assert.equal(selectChordListStatus({ chords: 'C G Am', chords_verified: false }), 'Unverified');
  assert.equal(selectChordListStatus({ chords: 'C G Am', chords_verified: true }), 'Verified');
  assert.equal(selectChordListStatus({ chords: '', chord_timeline: [{ time: 0, chord: 'C' }] }), 'Unverified');
  assert.equal(selectChordListStatus(null), 'Missing');
  assert.equal(hasChordContent({ chords: '   ' }), false);
});

test('draft evaluation blocks invalid and empty chord drafts', () => {
  assert.equal(evaluateChordDraftSave({ text: '', timelineText: '' }).ok, false);
  assert.equal(
    evaluateChordDraftSave({ text: '', timelineText: '' }).error,
    'Add chord text or a timeline before saving.',
  );
  assert.equal(evaluateChordDraftSave({ text: 'C G', timelineText: '{oops' }).error, 'Chord timeline must be a JSON array.');
  assert.equal(evaluateChordDraftSave({ text: 'C G', timelineText: '{}' }).error, 'Chord timeline must be a JSON array.');
  assert.equal(evaluateChordDraftSave({ text: 'just words', format: 'plain' }).ok, false);
  assert.equal(evaluateChordDraftSave({ text: 'Am   Dm\nlyrics', format: 'plain' }).ok, true);
  assert.equal(evaluateChordDraftSave({ text: '[C]Hi [G]there', format: 'chordpro' }).ok, true);
  const timed = evaluateChordDraftSave({ text: '', timelineText: '[{"time":4,"chord":"G"}]' });
  assert.equal(timed.ok, true);
  assert.deepEqual(timed.timeline, [{ time: 4, chord: 'G' }]);
});

test('preview builds readable timeline and sheet representations', () => {
  const timelinePreview = buildChordPreview({
    timeline: [{ time: 0, chord: 'Am' }, { time: 8, chord: 'Dm' }, { time: 65, chord: 'G' }],
  });
  assert.equal(timelinePreview.kind, 'timeline');
  assert.deepEqual(timelinePreview.lines, ['0:00  Am', '0:08  Dm', '1:05  G']);

  const sheetPreview = buildChordPreview({ text: 'Am   Dm\nlyric line\n\nG     C\nother' });
  assert.equal(sheetPreview.kind, 'sheet');
  assert.equal(sheetPreview.text.includes('\n\n'), true);
  assert.deepEqual(sheetPreview.lines[0], 'Am   Dm');

  assert.equal(buildChordPreview({ text: '', timeline: null }).kind, 'empty');
});

test('chord upload styles cover preview state and replacement warning', () => {
  assert.match(css, /\.admin-chord-preview \{/);
  assert.match(css, /\.admin-chord-preview-body \{/);
  assert.match(css, /\.admin-chord-state \{/);
  assert.match(css, /\.admin-chord-notice\.warn \{/);
});
