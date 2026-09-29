import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(clientSrc, ...parts), 'utf8');

const playlistSrc = read('pages', 'Playlist', 'Playlist.jsx');
const librarySrc = read('pages', 'Dashboard', 'LibraryView.jsx');
const routesSrc = read('..', '..', 'server', 'routes', 'playlistRoutes.js');

test('playlist management page is reachable from the Library', () => {
  assert.match(librarySrc, /to=\{`\/playlist\/\$\{activePlaylist\._id\}`\}/);
  assert.match(librarySrc, /Open Playlist/);
  assert.match(librarySrc, /className="library-playlist-actions"/);
});

test('rename action calls the existing rename endpoint', () => {
  assert.match(playlistSrc, /const renamePlaylist = async \(\) => \{/);
  assert.match(playlistSrc, /api\.put\(`\/api\/playlists\/\$\{id\}`, \{ title: nextTitle \}\)/);
  assert.match(routesSrc, /router\.put\('\/:id', protect/);
});

test('remove song calls the existing remove endpoint with the exact song id', () => {
  assert.match(playlistSrc, /const removeSong = async \(songId\) => \{/);
  assert.match(playlistSrc, /const targetId = String\(songId\);/);
  assert.match(playlistSrc, /api\.del\(`\/api\/playlists\/\$\{id\}\/songs\/\$\{targetId\}`\)/);
  assert.match(playlistSrc, /songs\.find\(\(song\) => String\(song\._id\) === targetId\)/);
  assert.match(routesSrc, /router\.delete\('\/:id\/songs\/:songId', protect/);
});

test('remove action is exposed per playlist row for the owner', () => {
  assert.match(playlistSrc, /aria-label=\{`Remove \$\{song\.title\} from playlist`\}/);
  assert.match(playlistSrc, /onClick=\{\(\) => removeSong\(song\._id\)\}/);
  assert.match(playlistSrc, /\{isOwner \? \(\s*<button/);
  assert.match(playlistSrc, /title="Remove from playlist"/);
});

test('successful removal refreshes the rendered playlist without a reload', () => {
  assert.match(playlistSrc, /if \(data\.success\) \{\s*setPlaylist\(data\.playlist\);\s*setStatus\(\{ tone: 'success', text: `Removed \$\{target\.title\} from this playlist\.` \}\);/);
  assert.match(playlistSrc, /await syncLibrary\(\);/);
  assert.equal(playlistSrc.includes('window.location.reload'), false);
  assert.equal(playlistSrc.includes('window.location.href ='), false);
});

test('rename and add actions also refresh the rendered playlist', () => {
  assert.match(playlistSrc, /api\.post\(`\/api\/playlists\/\$\{id\}\/songs`, \{ songId: targetId \}\)/);
  assert.match(playlistSrc, /setPlaylist\(data\.playlist\);\s*setSearchResults/);
  assert.match(routesSrc, /router\.post\('\/:id\/songs', protect/);
});

test('delete playlist stays functional through the existing endpoint', () => {
  assert.match(playlistSrc, /const deletePlaylist = async \(\) => \{/);
  assert.match(playlistSrc, /api\.del\(`\/api\/playlists\/\$\{id\}`\)/);
  assert.match(playlistSrc, /navigate\('\/library'\)/);
  assert.match(routesSrc, /router\.delete\('\/:id', protect/);
});

test('playlist mutations are owner-only in the UI', () => {
  assert.match(playlistSrc, /const isOwner = Boolean\(/);
  assert.match(playlistSrc, /user\.email === playlist\.user_email/);
  assert.match(playlistSrc, /if \(!isOwner \|\| pendingAction\) return;/);
  assert.match(playlistSrc, /onClick=\{openRenameDialog\}/);
  assert.match(playlistSrc, /onClick=\{\(\) => setDeleteOpen\(true\)\}/);
  assert.match(playlistSrc, /\{isOwner \? \(/);
  assert.match(routesSrc, /user_email: req\.user\.email/g);
});

test('failed operations surface a safe error without leaking internals', () => {
  assert.match(playlistSrc, /setStatus\(\{ tone: 'error', text: data\.error \|\| 'Unable to remove this song right now\.' \}\)/);
  assert.match(playlistSrc, /setStatus\(\{ tone: 'error', text: data\.error \|\| 'Unable to rename this playlist right now\.' \}\)/);
  assert.match(playlistSrc, /setStatus\(\{ tone: 'error', text: data\.error \|\| 'Unable to delete this playlist right now\.' \}\)/);
  assert.match(playlistSrc, /role="status" aria-live="polite"/);
  assert.equal(playlistSrc.includes('{error.message}'), false);
  assert.equal(playlistSrc.includes('stack'), false);
});

test('playlist mutations guard against duplicate in-flight operations', () => {
  assert.match(playlistSrc, /const \[pendingAction, setPendingAction\] = useState\(''\);/);
  assert.match(playlistSrc, /if \(pendingAction\) return;/);
  assert.match(playlistSrc, /finally \{\s*setPendingAction\(''\);\s*\}/);
  assert.match(playlistSrc, /disabled=\{Boolean\(pendingAction\)\}/);
});

test('playlist management keeps AppDialog instead of browser prompts', () => {
  assert.match(playlistSrc, /<AppDialog/);
  assert.equal(playlistSrc.includes('window.prompt'), false);
  assert.equal(playlistSrc.includes('window.confirm'), false);
  assert.equal(playlistSrc.includes('window.alert'), false);
});
