import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dialogSrc = readFileSync(join(__dirname, 'CreatePlaylistDialog.jsx'), 'utf8');
const librarySrc = readFileSync(
  join(__dirname, '..', '..', 'pages', 'Dashboard', 'LibraryView.jsx'),
  'utf8',
);
const libraryCss = readFileSync(
  join(__dirname, '..', '..', 'pages', 'Dashboard', 'LibraryView.css'),
  'utf8',
);

test('library view exposes a visible Create Playlist entry in the playlists tab', () => {
  assert.match(librarySrc, /import CreatePlaylistDialog from '\.\.\/\.\.\/components\/music\/CreatePlaylistDialog\.jsx'/);
  assert.match(librarySrc, /onClick=\{\(\) => setCreateOpen\(true\)\}/);
  assert.match(librarySrc, />[\s\n]*Create Playlist[\s\n]*</);
  assert.match(librarySrc, /<CreatePlaylistDialog/);
  assert.match(librarySrc, /open=\{createOpen\}/);
  assert.match(librarySrc, /onCreated=\{handlePlaylistCreated\}/);
  assert.match(librarySrc, /detail="Create a playlist to see it here\."/);
});

test('library view refreshes shell data and selects the new playlist after creation', () => {
  assert.match(librarySrc, /refreshCoreData/);
  assert.match(librarySrc, /const handlePlaylistCreated = async \(playlist, result = \{\}\) =>/);
  assert.match(librarySrc, /await refreshCoreData\(\)/);
  assert.match(librarySrc, /setActivePlaylistId\(String\(playlist\._id\)\)/);
  assert.match(librarySrc, /Playlist "\$\{playlist\?\.title \|\| 'playlist'\}" created\./);
  assert.match(librarySrc, /Playlist created, but \$\{failed\} song\$\{failed === 1 \? '' : 's'\} could not be added\./);
});

test('create dialog is a shared AppDialog with validation-gated create action', () => {
  assert.match(dialogSrc, /import AppDialog from '\.\.\/ui\/AppDialog\.jsx'/);
  assert.match(dialogSrc, /title="Create playlist"/);
  assert.match(dialogSrc, /labelledBy="create-playlist-title"/);
  assert.match(dialogSrc, /const trimmed = title\.trim\(\)/);
  assert.match(dialogSrc, /disabled=\{!trimmedTitle \|\| submitting\}/);
  assert.match(dialogSrc, /maxLength=\{80\}/);
  assert.match(dialogSrc, /onClose=\{onClose\}/);
});

test('create dialog runs the two-step playlist create then add flow', () => {
  assert.match(dialogSrc, /await api\.post\('\/api\/playlists', \{ title: trimmed \}\)/);
  assert.match(dialogSrc, /for \(const songId of ids\)/);
  assert.match(dialogSrc, /await api\.post\(`\/api\/playlists\/\$\{playlistId\}\/songs`, \{ songId \}\)/);
  assert.match(dialogSrc, /created\?\.success && !created\?\.playlist\?._id|!created\?\.success \|\| !created\?\.playlist\?._id/);
  assert.match(dialogSrc, /if \(typeof onCreated === 'function'\)/);
});

test('create dialog counts partial add failures and reports them', () => {
  const failureBlocks = dialogSrc.match(/failed \+= 1;/g) || [];
  assert.equal(failureBlocks.length, 2);
  assert.match(dialogSrc, /if \(!added\?\.success\) failed \+= 1;/);
  assert.match(dialogSrc, /catch \{\s*\n\s*failed \+= 1;\s*\n\s*\}/);
  assert.match(dialogSrc, /onCreated\(created\.playlist, \{ failed \}\)/);
  assert.match(dialogSrc, /Unable to create the playlist right now\./);
});

test('create dialog provides debounced search with loading and empty states', () => {
  assert.match(dialogSrc, /const SEARCH_DEBOUNCE_MS = 240/);
  assert.match(dialogSrc, /const SEARCH_LIMIT = 20/);
  assert.match(dialogSrc, /setTimeout\(async \(\) =>/);
  assert.match(dialogSrc, /api\.get\(`\/api\/songs\?q=\$\{encodeURIComponent\(term\)\}&limit=\$\{SEARCH_LIMIT\}`\)/);
  assert.match(dialogSrc, /Searching songs\.\.\./);
  assert.match(dialogSrc, /No songs match your search\./);
  assert.match(dialogSrc, /setSearching\(true\)/);
  assert.match(dialogSrc, /clearTimeout\(timer\)/);
});

test('create dialog maintains a selected song list with per-song selection state', () => {
  assert.match(dialogSrc, /const \[selectedSongs, setSelectedSongs\] = useState\(\[\]\)/);
  assert.match(dialogSrc, /create-playlist-selected/);
  assert.match(dialogSrc, /aria-pressed=\{selected\}/);
  assert.match(dialogSrc, /aria-label=\{`Remove \$\{song\.title\} from selection`\}/);
  assert.match(dialogSrc, /const toggleSelect = \(song\) =>/);
});

test('create dialog opening resets state and loads initial suggestions without playback coupling', () => {
  assert.match(dialogSrc, /api\.get\(`\/api\/songs\?limit=\$\{INITIAL_SUGGESTION_LIMIT\}`\)/);
  assert.match(dialogSrc, /if \(!open\) return/);
  assert.match(dialogSrc, /setSelectedSongs\(\[\]\)/);
  assert.equal(/usePlayer|playSong|togglePlay|listeningTelemetry|PlayerContext/.test(dialogSrc), false);
});

test('library dialog styles cover toolbar, status, fields, chips, and song rows', () => {
  assert.match(libraryCss, /\.library-playlists-toolbar \{/);
  assert.match(libraryCss, /\.library-status\.is-error \{/);
  assert.match(libraryCss, /\.library-status\.is-success \{/);
  assert.match(libraryCss, /\.create-playlist-field \{/);
  assert.match(libraryCss, /\.create-playlist-chip \{/);
  assert.match(libraryCss, /\.create-playlist-song \{/);
  assert.match(libraryCss, /\.create-playlist-song\.is-selected \{/);
  assert.match(libraryCss, /\.create-playlist-suggestions \{/);
});
