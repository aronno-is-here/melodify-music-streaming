import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(__dirname, '..', '..', 'App.jsx'), 'utf8');
const shellSrc = readFileSync(join(__dirname, 'AuthenticatedAppShell.jsx'), 'utf8');
const shellCss = readFileSync(join(__dirname, '..', '..', 'styles', 'app-shell.css'), 'utf8');
const homeSrc = readFileSync(join(__dirname, '..', '..', 'pages', 'Home', 'Home.jsx'), 'utf8');

test('App routes include authenticated shell routes for modernized authenticated pages', () => {
  assert.match(appSrc, /AuthenticatedAppShell/);
  assert.match(appSrc, /<Route path="\/dashboard" element=\{<Dashboard \/>\} \/>/);
  assert.match(appSrc, /<Route path="\/search" element=\{<SearchView \/>\} \/>/);
  assert.match(appSrc, /<Route path="\/library" element=\{<LibraryView \/>\} \/>/);
  assert.match(appSrc, /<Route path="\/feed" element=\{<Feed \/>\} \/>/);
  assert.match(appSrc, /<Route path="\/studio" element=\{<MelodifyStudio \/>\} \/>/);
  assert.match(appSrc, /<Route path="\/user\/:id" element=\{<UserProfile \/>\} \/>/);
});

test('desktop navigation contains required destinations and labels', () => {
  for (const label of [
    'Home / Dashboard',
    'Search',
    'Liked Songs',
    'Playlists / Library',
    'Feed',
    'Melodify Studio',
    'Premium',
    'Profile',
  ]) {
    assert.ok(shellSrc.includes(label), label);
  }
  assert.equal(shellSrc.includes('href="#"'), false);
});

test('mobile bottom navigation keeps primary destinations only', () => {
  for (const label of ['Home', 'Search', 'Library', 'Profile']) {
    assert.ok(shellSrc.includes(`label: '${label}'`), label);
  }
  assert.match(shellSrc, /className="app-mobile-nav"/);
});

test('shell css includes safe-area support and mini-player spacing', () => {
  assert.match(shellCss, /env\(safe-area-inset-bottom\)/);
  assert.match(shellCss, /--mel-mobile-nav-h/);
  assert.match(shellCss, /--mel-mini-player-h/);
  assert.match(shellCss, /\.app-player-mini/);
});

test('logo links to dashboard and profile menu contains logout action', () => {
  assert.match(shellSrc, /to="\/dashboard" className="app-brand"/);
  assert.match(shellSrc, /logout\(\);/);
  assert.match(shellSrc, /navigate\('\/login'\)/);
});

test('authenticated navigation exposes Home to the homepage', () => {
  assert.match(shellSrc, /\{ key: 'site-home', label: 'Home', path: '\/', icon: 'fa-globe' \}/);
  assert.match(shellSrc, /<NavLink to="\/" role="menuitem">/);
  assert.match(shellSrc, /<span className="app-nav-label">\{item\.label\}<\/span>/);
});

test('Home navigation never logs out or clears the auth token', () => {
  const homeMenuItems = [...shellSrc.matchAll(/<NavLink to="\/" role="menuitem">[\s\S]*?<\/NavLink>/g)];
  assert.equal(homeMenuItems.length, 1);
  assert.equal(/logout|localStorage|sessionStorage|removeItem/.test(homeMenuItems[0][0]), false);
  assert.equal(shellSrc.includes('localStorage.removeItem'), false);
  assert.equal(shellSrc.includes('sessionStorage'), false);
  const homeNavConfig = shellSrc.match(/\{ key: 'site-home',[^}]*\}/)[0];
  assert.equal(/logout|removeItem|navigate\(/.test(homeNavConfig), false);
});

test('homepage keeps logged-in visitors linked to the dashboard', () => {
  assert.match(homeSrc, /to=\{user \? '\/dashboard' : '\/signup'\}/);
  assert.equal(/logout|localStorage|removeItem|melodify_token/.test(homeSrc), false);
});
