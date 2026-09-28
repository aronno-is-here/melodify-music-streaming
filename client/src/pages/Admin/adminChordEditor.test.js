import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Admin.css'), 'utf8');

test('chord editor keeps the Chords Verification section and shared grid', () => {
  assert.match(src, /Chords Verification/);
  assert.match(src, /admin-verify-grid/);
  assert.match(src, /admin-multiline-input/);
  assert.match(src, /admin-checkbox-row/);
});

test('chord editor exposes save clear and three typed import buttons', () => {
  assert.match(src, /onClick=\{saveChordsOnly\}>Save Chords<\/button>/);
  assert.match(src, /onClick=\{clearChordDraft\}>Clear Chords<\/button>/);
  assert.match(src, /CHORD_IMPORT_EXTENSIONS\.map\(\(extension\) => \(/);
  assert.match(src, /\{`Import \.\$\{extension\}`\}/);
  assert.match(src, /readChordImportFile\(file, extension\)/);
  assert.match(src, /accept=\{\`\.\$\{extension\}\`\}/);
});

test('chord editor covers format key capo tuning notes verifier and timeline', () => {
  for (const name of ['chords_format', 'chords_key', 'chords_capo', 'chords_tuning', 'chords_notes', 'chords_verified_by', 'chord_timeline']) {
    assert.ok(src.includes(`name="${name}"`), `missing ${name}`);
  }
  assert.match(src, /CHORD_FORMATS\.map\(\(value\) => <option key=\{value\} value=\{value\}>\{value\}<\/option>\)/);
  assert.match(src, /type="number" min="0" max="12" name="chords_capo"/);
  assert.match(src, /value=\{chordTimelineDraft\}/);
});

test('chord editor fields are controlled by the draft so imports render immediately', () => {
  assert.match(src, /value=\{toText\(editingSong\.chords\)\}/);
  assert.match(src, /value=\{toText\(editingSong\.chords_key\)\}/);
  assert.match(src, /value=\{toCapoDraft\(editingSong\.chords_capo\)\}/);
  assert.match(src, /checked=\{editingSong\.chords_verified === true\}/);
  assert.match(src, /value=\{CHORDS_SOURCE_OPTIONS\.includes\(editingSong\.chords_source\)/);
  assert.equal(/name="chords" defaultValue=/.test(src), false);
});

test('both save paths share one bounded chord payload builder', () => {
  assert.match(src, /const buildChordDraftPayload = \(timeline\) => \(\{/);
  assert.ok(src.split('buildChordDraftPayload(').length - 1 >= 2);
  assert.match(src, /chords_capo: toCapoPayload\(editingSong\.chords_capo\)/);
  assert.match(src, /chord_timeline: timeline/);
});

test('chord timeline drafts are validated JSON arrays before any write', () => {
  assert.match(src, /const parseTimelineDraft = \(value\) => \{/);
  assert.match(src, /if \(!Array\.isArray\(parsed\)\) return \{ ok: false, value: null \};/);
  assert.match(src, /'Chord timeline must be a JSON array\.'|Chord timeline must be a JSON array\./);
  assert.match(src, /setChordNotice\(\{ text: 'Chord timeline must be a JSON array\.', isError: true \}\)/);
});

test('imported chord sheets are validated before they replace the draft', () => {
  assert.match(src, /if \(!result\.ok\) \{/);
  assert.match(src, /setChordNotice\(\{ text: result\.error, isError: true \}\)/);
  assert.match(src, /patchChordDraft\(\{ chords: result\.text, chords_format: result\.format, chords_verified: false \}\)/);
});

test('clearing chords only touches the local draft until saved', () => {
  assert.match(src, /const clearChordDraft = \(\) => \{/);
  assert.match(src, /setChordNotice\(\{ text: 'Chords cleared\. Save to keep the change\.', isError: false \}\)/);
  assert.equal(/api\.(del|delete)\([^)]*chord/.test(src), false);
});

test('chord editor renders an inline status notice with safe roles', () => {
  assert.match(src, /className=\{`admin-chord-notice\$\{chordNotice\.isError \? ' error' : ''\}`\}/);
  assert.match(src, /role=\{chordNotice\.isError \? 'alert' : 'status'\}/);
  assert.equal(/dangerouslySetInnerHTML|innerHTML/.test(src), false);
});

test('chord editor styles are present', () => {
  assert.match(css, /\.admin-chord-actions \{/);
  assert.match(css, /\.admin-chord-import \{/);
  assert.match(css, /\.admin-chord-file \{/);
  assert.match(css, /\.admin-chord-notice \{/);
  assert.match(css, /\.admin-chord-notice\.error \{/);
});
