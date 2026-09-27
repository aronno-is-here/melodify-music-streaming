import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(join(__dirname, 'LyricsChordsPanel.jsx'), 'utf8');
const panelCss = readFileSync(join(__dirname, 'LyricsChordsPanel.css'), 'utf8');

test('panel replaces the unavailable message copy', () => {
  assert.match(panelSource, /Lyrics not available in Melodify\./);
  assert.equal(/Lyrics not available for this song\./.test(panelSource), false);
});

test('panel offers a safe external link to the discovered source', () => {
  assert.match(panelSource, /Possible source found:/);
  assert.match(panelSource, /View Source/);
  assert.match(panelSource, /href=\{sourceCandidate\.url\}/);
  assert.match(panelSource, /target="_blank"/);
  assert.match(panelSource, /rel="noopener noreferrer"/);
});

test('panel hides the add-verified-lyrics control from non-admins', () => {
  assert.match(panelSource, /auth\?\.user\?\.role === 'admin'/);
  assert.match(panelSource, /Add Verified Lyrics/);
  assert.match(panelSource, /\{isAdmin \? \(/);
});

test('panel navigates admins into the music editor for the current song', () => {
  assert.match(panelSource, /navigate\('\/admin', \{ state: \{ section: 'music', editSongId: song\._id \} \}\)/);
  assert.match(panelSource, /const openAdminEditor = \(\) => \{/);
});

test('panel secondary source lookup requires an auth token', () => {
  assert.match(panelSource, /localStorage\.getItem\('melodify_token'\)/);
  assert.match(panelSource, /\/api\/lyrics\/\$\{song\._id\}\/sources/);
  const guardIndex = panelSource.indexOf("hasSourceFallbackStatus(data.status) && localStorage.getItem('melodify_token')");
  assert.ok(guardIndex > 0, 'sources fetch must be guarded by status and token');
});

test('panel only falls back for unavailable or ambiguous lyrics', () => {
  const fallbackBlock = panelSource.slice(
    panelSource.indexOf('SOURCE_FALLBACK_STATUSES'),
    panelSource.indexOf('export default'),
  );
  assert.match(fallbackBlock, /'unavailable'/);
  assert.match(fallbackBlock, /'ambiguous'/);
  assert.match(fallbackBlock, /hasSourceFallbackStatus/);
});

test('panel validates cached source candidates before rendering them', () => {
  assert.match(panelSource, /const toSourceCandidate = \(value\) => \(/);
  assert.match(panelSource, /typeof value\.url === 'string' && value\.url/);
  assert.match(panelSource, /: null/);
});

test('panel resets the source candidate whenever the song changes', () => {
  const resetCount = (panelSource.match(/setSourceCandidate\(null\)/g) || []).length;
  assert.ok(resetCount >= 2, `expected reset calls in both song branches, found ${resetCount}`);
});

test('panel source fallback styles are present', () => {
  assert.match(panelCss, /\.lc-source-fallback/);
  assert.match(panelCss, /\.lc-source-label/);
  assert.match(panelCss, /\.lc-source-link/);
  assert.match(panelCss, /\.lc-source-add/);
});

test('panel source fallback never renders raw html or stored lyric bodies', () => {
  assert.equal(/dangerouslySetInnerHTML|innerHTML|atob\(|base64/.test(panelSource), false);
  assert.match(panelSource, /lc-source-fallback/);
});
