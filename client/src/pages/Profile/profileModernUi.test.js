import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Profile.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Profile.css'), 'utf8');

test('Profile uses semantic button actions and removes dead href anchors', () => {
  assert.equal(src.includes('href="#"'), false);
  assert.match(src, /type="button" className="music-pill-btn" onClick=\{\(\) => setEditOpen\(true\)\}/);
  assert.match(src, /type="button" className="music-outline-btn" onClick=\{\(\) => setSettingsOpen\(true\)\}/);
});

test('Profile dialogs use AppDialog semantics with accessible close behavior', () => {
  assert.match(src, /<AppDialog/);
  assert.match(src, /open=\{editOpen\}/);
  assert.match(src, /open=\{passwordOpen\}/);
  assert.match(src, /open=\{settingsOpen\}/);
  assert.match(src, /open=\{deleteRecordingOpen\}/);
  assert.equal(src.includes('confirm('), false);
});

test('Profile keeps backend contracts for account, settings, password, and recordings', () => {
  assert.match(src, /api\.put\('\/api\/auth\/me'/);
  assert.match(src, /api\.put\('\/api\/users\/me\/settings'/);
  assert.match(src, /api\.post\('\/api\/auth\/me\/password'/);
  assert.match(src, /api\.get\('\/api\/recordings'/);
  assert.match(src, /api\.post\(`\/api\/recordings\/\$\{recordingId\}\/publish`/);
});

test('Profile css is scoped and responsive for mobile forms and cards', () => {
  assert.match(css, /\.profile-page/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.equal(/(^|\n)\s*body\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*header\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*main\s*\{/.test(css), false);
});
