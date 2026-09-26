import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'MelodifyStudio.css'), 'utf8');

const ruleBody = (text, selector) => {
  const index = text.indexOf(`${selector} {`);
  assert.notEqual(index, -1, `expected rule ${selector}`);
  const start = text.indexOf('{', index);
  const end = text.indexOf('}', start);
  return text.slice(start + 1, end);
};

test('studio track grid uses bounded responsive tracks with a clean gap', () => {
  const grid = ruleBody(css, '.studio-song-grid');
  assert.match(grid, /repeat\(auto-fill,\s*minmax\(\d+px,\s*1fr\)\)/);
  assert.match(grid, /gap:\s*\d+px/);
  assert.equal((css.match(/\.studio-song-grid\s*\{/g) || []).length, 2);
});

test('studio track grid keeps cards inside their own column on small screens', () => {
  const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
  const grid = ruleBody(mobile, '.studio-song-grid');
  assert.match(grid, /repeat\(auto-fill,\s*minmax\(\d+px,\s*1fr\)\)/);
  assert.match(css, /minmax\(0,\s*1fr\)/);
});

test('studio track card contains poster width inside the card cell', () => {
  const card = ruleBody(css, '.studio-song-card');
  assert.match(card, /min-width:\s*0/);
  assert.match(card, /max-width:\s*100%/);
  assert.match(card, /overflow:\s*hidden/);
  assert.match(card, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(card, /display:\s*grid/);
});

test('studio track card never overlaps neighbouring cards', () => {
  const card = ruleBody(css, '.studio-song-card');
  assert.doesNotMatch(card, /z-index/);
  assert.doesNotMatch(card, /transform/);
  assert.doesNotMatch(card, /position:\s*absolute/);
  assert.doesNotMatch(css, /\.studio-song-card[^{]*\{[^}]*z-index/);
});

test('studio track poster clips artwork and keeps a fixed square box', () => {
  const poster = ruleBody(css, '.studio-song-poster');
  assert.match(poster, /position:\s*relative/);
  assert.match(poster, /min-width:\s*0/);
  assert.match(poster, /max-width:\s*100%/);
  assert.match(poster, /overflow:\s*hidden/);
  assert.match(poster, /aspect-ratio:\s*1/);
});

test('studio track poster image cannot exceed the poster width', () => {
  const image = ruleBody(css, '.studio-song-card img');
  assert.match(image, /display:\s*block/);
  assert.match(image, /width:\s*100%/);
  assert.match(image, /max-width:\s*100%/);
  assert.match(image, /object-fit:\s*cover/);
});

test('studio track info column shrinks instead of widening the card', () => {
  const info = ruleBody(css, '.studio-song-info');
  assert.match(info, /min-width:\s*0/);
  const selectorStart = css.indexOf('.studio-song-info h3,');
  assert.notEqual(selectorStart, -1, 'expected track info text rule');
  const bodyStart = css.indexOf('{', selectorStart);
  const body = css.slice(bodyStart + 1, css.indexOf('}', bodyStart));
  assert.match(body, /white-space:\s*nowrap/);
  assert.match(body, /text-overflow:\s*ellipsis/);
});

test('studio track cards render stable structural classes and selection handler', () => {
  assert.match(source, /className="studio-song-card"/);
  assert.match(source, /className="studio-song-poster"/);
  assert.match(source, /className="studio-song-info"/);
  assert.match(source, /<div className="studio-song-grid" aria-label="Karaoke tracks">/);
  assert.match(source, /onClick=\{\(\) => selectSong\(song\)\}/);
  assert.ok(source.includes('event.currentTarget.src = DEFAULT_POSTER'));
});
