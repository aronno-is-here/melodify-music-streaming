import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Playlist.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Playlist.css'), 'utf8');

test('Playlist uses shared PlayerContext and avoids bespoke floating/footer players', () => {
  assert.match(src, /const player = usePlayer\(\)/);
  assert.match(src, /player\.playSong\(songs, 0\)/);
  assert.match(src, /player\.playSong\(songs, rowIndex\)/);
  assert.match(src, /player\.togglePlay\(\)/);
  assert.equal(src.includes('floating-player'), false);
  assert.equal(src.includes('footer-player'), false);
  assert.equal(src.includes('player.pause('), false);
});

test('Playlist play-all and row-play guard against unrelated pause behavior', () => {
  assert.match(src, /if \(playingId === String\(firstSong\._id\)\) \{/);
  assert.match(src, /if \(playingId === String\(song\._id\)\) \{/);
  assert.equal(src.includes('if (player.isPlaying && player.currentSong) player.togglePlay();'), false);
});

test('Playlist actions are touch visible and not hover-only critical controls', () => {
  assert.match(src, /className="playlist-row-actions"/);
  assert.match(src, /aria-label={`Remove \$\{song\.title\} from playlist`}/);
  assert.match(src, /aria-label={`Open source for \$\{song\.title\}`}/);
  assert.equal(css.includes(':hover .options-btn'), false);
});

test('Playlist replaces prompt/confirm/alert with dialog-based actions', () => {
  assert.match(src, /<AppDialog/);
  assert.equal(src.includes('window.prompt'), false);
  assert.equal(src.includes('window.confirm'), false);
  assert.equal(src.includes('window.alert'), false);
});

test('Playlist css is scoped and responsive for shell-safe mobile layouts', () => {
  assert.match(css, /\.playlist-page/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.equal(/(^|\n)\s*body\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*header\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*main\s*\{/.test(css), false);
});
