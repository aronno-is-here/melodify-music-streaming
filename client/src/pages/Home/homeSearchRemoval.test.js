import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(clientSrc, ...parts), 'utf8');

const homeSrc = read('pages', 'Home', 'Home.jsx');
const homeCss = read('pages', 'Home', 'Home.css');
const appSrc = read('App.jsx');
const shellSrc = read('components', 'app', 'AuthenticatedAppShell.jsx');
const searchSrc = read('pages', 'Dashboard', 'SearchView.jsx');
const homeComponentsSrc = readdirSync(join(clientSrc, 'components', 'home'))
  .filter((file) => /\.(jsx|js)$/.test(file) && !file.endsWith('.test.js'))
  .map((file) => readFileSync(join(clientSrc, 'components', 'home', file), 'utf8'))
  .join('\n');

test('public homepage no longer renders the nonfunctional search control', () => {
  assert.equal(homeSrc.includes('home-search'), false);
  assert.equal(homeSrc.includes('home-search-input'), false);
  assert.equal(homeSrc.includes('home-search-icon'), false);
  assert.equal(homeSrc.includes('fa-search'), false);
  assert.equal(homeSrc.includes('type="search"'), false);
  assert.equal(homeSrc.includes('aria-label="Search songs, artists, or albums"'), false);
  assert.equal(homeSrc.includes('Search songs, artists, or albums...'), false);
});

test('homepage no longer carries dead search CSS', () => {
  assert.equal(homeCss.includes('home-search'), false);
  assert.equal(homeCss.includes('.home-search-input'), false);
  assert.equal(homeCss.includes('.home-search-icon'), false);
});

test('homepage source and its home components contain zero search controls', () => {
  assert.equal(/<input/i.test(homeSrc), false);
  assert.equal(/fa-(search|magnifying)/i.test(homeSrc), false);
  assert.equal(/type="search"/i.test(homeSrc), false);
  assert.equal(/\bsearch\b/i.test(homeComponentsSrc), false);
  assert.equal(/<input/i.test(homeComponentsSrc), false);
});

test('responsive and mobile homepage styles carry no search trigger', () => {
  assert.equal(/\bsearch\b/i.test(homeCss), false);
  assert.equal(homeCss.includes('magnifying'), false);
});

test('homepage still renders its navigation and hero', () => {
  assert.match(homeSrc, /id="home-navigation"/);
  assert.match(homeSrc, /className=\{`home-navigation/);
  assert.match(homeSrc, /<Link to="\/premium" className="home-nav-link">Premium<\/Link>/);
  assert.match(homeSrc, /<HeroSection \/>/);
  assert.match(homeCss, /\.home-nav\s*\{/);
  assert.match(homeCss, /\.home-right\s*\{/);
});

test('authenticated /search route remains registered for the app shell', () => {
  assert.match(appSrc, /import SearchView from '\.\/pages\/Dashboard\/SearchView\.jsx';/);
  assert.match(appSrc, /<Route path="\/search" element=\{<SearchView \/>\} \/>/);
  assert.match(shellSrc, /navigate\('\/search'\)/);
});

test('authenticated Search page keeps its own search input', () => {
  assert.match(searchSrc, /type="search"/);
  assert.match(searchSrc, /aria-label=\{isSongsMode \? 'Search songs, artists, albums' : 'Search people'\}/);
});
