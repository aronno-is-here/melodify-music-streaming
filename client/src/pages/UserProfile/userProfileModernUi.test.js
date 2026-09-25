import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'UserProfile.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'UserProfile.css'), 'utf8');
const appSrc = readFileSync(join(__dirname, '..', '..', 'App.jsx'), 'utf8');

test('UserProfile is shell-routed and uses global PlayerContext via shared music components', () => {
  assert.match(appSrc, /<Route path="\/user\/:id" element=\{<UserProfile \/>\} \/>/);
  assert.match(src, /import usePlayer from '\.\.\/\.\.\/hooks\/usePlayer\.js';/);
  assert.match(src, /import SongCard from '\.\.\/\.\.\/components\/music\/SongCard\.jsx';/);
  assert.match(src, /import SongRow from '\.\.\/\.\.\/components\/music\/SongRow\.jsx';/);
  assert.match(src, /player\.playSong\(songs, index\)/);
  assert.equal(src.includes('new Audio('), false);
});

test('UserProfile preserves follow/list APIs with accessible tabs and dialogs', () => {
  assert.match(src, /api\.get\(`\/api\/users\/\$\{id\}`\)/);
  assert.match(src, /api\.post\(`\/api\/follows\/\$\{id\}`\)/);
  assert.match(src, /api\.del\(`\/api\/follows\/\$\{id\}`\)/);
  assert.match(src, /`\/api\/follows\/\$\{id\}\/followers`/);
  assert.match(src, /`\/api\/follows\/\$\{id\}\/following`/);
  assert.match(src, /api\.get\(path\)/);
  assert.match(src, /aria-pressed=\{activeTab === tab\.id\}/);
  assert.match(src, /<AppDialog/);
});

test('UserProfile avoids exposing email in follower/following lists and keeps scoped responsive css', () => {
  assert.equal(src.includes('listUser.email'), false);
  assert.equal(src.includes('up-modal-email'), false);
  assert.match(css, /\.user-profile-page/);
  assert.match(css, /\.up-tab-shell\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.equal(/(^|\n)\s*body\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*header\s*\{/.test(css), false);
});
