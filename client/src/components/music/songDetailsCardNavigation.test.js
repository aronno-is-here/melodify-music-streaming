import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cardSrc = readFileSync(join(__dirname, 'SongCard.jsx'), 'utf8');
const rowSrc = readFileSync(join(__dirname, 'SongRow.jsx'), 'utf8');
const playSrc = readFileSync(join(__dirname, 'PlayButton.jsx'), 'utf8');
const favoriteSrc = readFileSync(join(__dirname, 'FavoriteButton.jsx'), 'utf8');
const detailsSrc = readFileSync(
  join(__dirname, '..', '..', 'pages', 'SongDetails', 'SongDetails.jsx'),
  'utf8',
);

test('song card and row open the song details route from the body click', () => {
  for (const src of [cardSrc, rowSrc]) {
    assert.match(src, /song\?\._id && song\?\.sourceType !== 'external'/);
    assert.match(src, /`\/song\/\$\{song\._id\}`/);
    assert.match(src, /navigate\(detailsPath\)/);
    assert.match(src, /if \(detailsPath\) navigate\(detailsPath\)/);
    assert.match(src, /to=\{detailsPath\}/);
    assert.match(src, /<Link/);
    assert.match(src, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.match(src, /aria-label=\{`View details for \$\{song\.title\}`\}/);
  }
});

test('song details link uses the viewed song id and no other identifier', () => {
  for (const src of [cardSrc, rowSrc]) {
    const routeLiterals = src.match(/`\/song\/[^`]+`/g) || [];
    assert.deepEqual(routeLiterals, ['`/song/${song._id}`']);
    assert.match(src, /song\?._id && song\?\.sourceType !== 'external' \? `\/song\/\$\{song\._id\}` : null/);
  }
});

test('play and favorite actions stop event propagation and never navigate', () => {
  for (const src of [cardSrc, rowSrc]) {
    assert.match(src, /music-card-actions" onClick=\{\(event\) => event\.stopPropagation\(\)\}|music-row-actions"[\s\S]{0,160}onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.equal(/navigate\((onPlay|onToggleFavorite)/.test(src), false);
  }
  assert.match(playSrc, /event\.stopPropagation\(\)/);
  assert.match(favoriteSrc, /event\.stopPropagation\(\)/);
  assert.match(playSrc, /<button\s+type="button"/);
  assert.match(favoriteSrc, /<button\s+type="button"/);
  assert.equal(playSrc.includes('useNavigate'), false);
  assert.equal(favoriteSrc.includes('useNavigate'), false);
});

test('card and row navigation emit no playback, queueing, or telemetry calls', () => {
  for (const src of [cardSrc, rowSrc]) {
    assert.equal(/playSong|togglePlay|usePlayer|listeningTelemetry|listening-events|api\.(post|put|delete)/.test(src), false);
    assert.equal(/onPlay\(/.test(src), false);
  }
});

test('song details page never autoplayed on arrival', () => {
  const playCalls = [...detailsSrc.matchAll(/player\.playSong\(/g)];
  assert.equal(playCalls.length, 2);
  for (const call of playCalls) {
    const context = detailsSrc.slice(Math.max(0, call.index - 320), call.index);
    assert.match(context, /playFromQueue|playPrimary/);
  }
  assert.match(detailsSrc, /const playPrimary = \(\) =>/);
  assert.match(detailsSrc, /const playFromQueue = \(index\) =>/);
  const effectStart = detailsSrc.indexOf('useEffect(() => {');
  assert.notEqual(effectStart, -1);
  const effectEnd = detailsSrc.indexOf('}, [id]);', effectStart);
  assert.notEqual(effectEnd, -1);
  const effectBody = detailsSrc.slice(effectStart, effectEnd);
  assert.equal(/playSong|togglePlay|play\(/.test(effectBody), false);
});

test('external catalog results without local ids do not render detail links', () => {
  assert.match(cardSrc, /const songDetailsPath = \(song\)/);
  assert.match(rowSrc, /const songDetailsPath = \(song\)/);
  assert.match(cardSrc, /: null/);
  assert.match(rowSrc, /: null/);
});
