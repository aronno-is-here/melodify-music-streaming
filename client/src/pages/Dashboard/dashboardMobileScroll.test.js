import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(join(__dirname, 'Dashboard.jsx'), 'utf8');
const dashboardCss = readFileSync(join(__dirname, 'Dashboard.css'), 'utf8');
const shellCss = readFileSync(join(__dirname, '..', '..', 'styles', 'app-shell.css'), 'utf8');
const musicCss = readFileSync(join(__dirname, '..', '..', 'styles', 'music-ui.css'), 'utf8');

test('mobile/new shell section order follows discovery-first structure', () => {
  const labels = [
    'Continue Listening',
    'Trending Now',
    'Recommended For You',
    'Recently Added',
    'Quick Picks',
    'Discover by Genre',
    'Discover by Artist',
    'Your Playlists / Liked Songs',
  ];
  let previous = -1;
  for (const label of labels) {
    const at = dashboardSrc.indexOf(label);
    assert.ok(at > previous, `${label} appears in order`);
    previous = at;
  }
});

test('mobile/new shell keeps all key discovery/library sections reachable by source order', () => {
  for (const label of [
    'Continue Listening',
    'Trending Now',
    'Recommended For You',
    'Recently Added',
    'Discover by Genre',
    'Discover by Artist',
    'Your Playlists / Liked Songs',
  ]) {
    assert.ok(dashboardSrc.includes(label), label);
  }
  assert.match(dashboardSrc, /Open Library/);
});

test('Dashboard uses scoped classes and avoids global html/body/main overflow locks', () => {
  for (const selector of ['html', 'body', 'header', 'main']) {
    const pattern = new RegExp(`(^|\\n)\\s*${selector}\\s*\\{`, 'm');
    assert.equal(pattern.test(dashboardCss), false, selector);
    assert.equal(pattern.test(shellCss), false, `${selector} in shell`);
  }
  assert.match(dashboardSrc, /className="dashboard-page"/);
  assert.match(dashboardSrc, /className="dashboard-hero app-surface"/);
});

test('Dashboard CSS avoids fixed viewport-height traps from legacy mobile layout', () => {
  assert.equal(/100vh/.test(dashboardCss), false);
  assert.equal(/calc\(100vh/.test(dashboardCss), false);
  assert.equal(/overflow:\s*hidden/.test(dashboardCss), false);
});

test('mobile authenticated shell reserves safe-area space for mini player and bottom nav', () => {
  assert.match(shellCss, /env\(safe-area-inset-bottom\)/);
  assert.match(shellCss, /--mel-mobile-nav-h/);
  assert.match(shellCss, /--mel-mini-player-h/);
  assert.match(shellCss, /padding-bottom:\s*calc\(/);
  assert.match(shellCss, /\.app-player-mini/);
  assert.match(shellCss, /\.app-mobile-nav/);
});

test('mobile mini-player is positioned above bottom nav to keep content reachable', () => {
  assert.match(shellCss, /bottom:\s*calc\(var\(--mel-mobile-nav-h\) \+ env\(safe-area-inset-bottom\) \+ 8px\)/);
  assert.match(shellCss, /min-height:\s*var\(--mel-mini-player-h\)/);
});

test('bottom navigation uses fixed safe-area height and does not collapse content space', () => {
  assert.match(shellCss, /height:\s*calc\(var\(--mel-mobile-nav-h\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(shellCss, /padding:\s*0 10px env\(safe-area-inset-bottom\)/);
  assert.match(shellCss, /position:\s*fixed/);
});

test('responsive breakpoints cover desktop, tablet, and phone shell behaviors', () => {
  assert.match(dashboardCss, /@media \(max-width: 1024px\)/);
  assert.match(dashboardCss, /@media \(max-width: 768px\)/);
  assert.match(shellCss, /@media \(max-width: 1024px\)/);
  assert.match(shellCss, /@media \(max-width: 768px\)/);
});

test('desktop library layout still exists and is progressively reduced for tablet/mobile', () => {
  assert.match(dashboardCss, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(dashboardCss, /@media \(max-width: 1024px\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(dashboardCss, /@media \(max-width: 768px\)[\s\S]*grid-template-columns:\s*1fr/);
});

test('critical song actions remain touch-reachable and not hover-gated', () => {
  assert.match(musicCss, /\.music-card-actions/);
  assert.equal(musicCss.includes('opacity: 0'), false);
  assert.equal(musicCss.includes('.music-song-card:hover .music-card-actions'), false);
  assert.match(musicCss, /min-height: 44px/);
  assert.match(shellCss, /\.app-mini-controls \.music-icon-control/);
  assert.match(shellCss, /min-width:\s*38px/);
});

test('mobile player controls and recommendation actions remain present in source', () => {
  assert.match(dashboardSrc, /onPlay=\{\(\) => playSongQueue\(queue, index\)\}/);
  assert.match(shellCss, /\.app-mini-controls/);
  assert.match(shellCss, /\.app-player-mini/);
});

test('new shell keeps scrolling surfaces free from global overflow hidden traps', () => {
  const globalOverflowTrap = /(html|body|#root)[\s\S]{0,80}overflow:\s*hidden/;
  assert.equal(globalOverflowTrap.test(shellCss), false);
  assert.equal(globalOverflowTrap.test(dashboardCss), false);
});

test('no fixed 380px-width overflow trap is reintroduced in shell/dashboard styles', () => {
  assert.equal(shellCss.includes('380px'), false);
  assert.equal(dashboardCss.includes('380px'), false);
});

test('dashboard and shell rely on min-height 100dvh sizing rather than locked viewport heights', () => {
  assert.match(shellCss, /min-height:\s*100dvh/);
  assert.equal(shellCss.includes('height: 100vh'), false);
  assert.equal(shellCss.includes('calc(100vh'), false);
});

test('recommendation/trending sections are rendered with app-surface wrappers for scrollable flow', () => {
  assert.match(dashboardSrc, /<section className="music-section app-surface"/);
  assert.match(dashboardSrc, /title="Trending Now"/);
  assert.match(dashboardSrc, /title="Recommended For You"/);
});
