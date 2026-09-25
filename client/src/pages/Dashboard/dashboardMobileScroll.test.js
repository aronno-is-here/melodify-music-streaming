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

test('Dashboard section order follows discovery-first structure', () => {
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

test('Dashboard uses scoped app classes and avoids unsafe global selectors', () => {
  for (const selector of ['html', 'body', 'header', 'main']) {
    const pattern = new RegExp(`(^|\\n)\\s*${selector}\\s*\\{`, 'm');
    assert.equal(pattern.test(dashboardCss), false, selector);
  }
  assert.match(dashboardSrc, /className="dashboard-page"/);
  assert.match(dashboardSrc, /className="dashboard-hero app-surface"/);
});

test('mobile shell reserves safe-area space for mini player and bottom nav', () => {
  assert.match(shellCss, /env\(safe-area-inset-bottom\)/);
  assert.match(shellCss, /--mel-mobile-nav-h/);
  assert.match(shellCss, /--mel-mini-player-h/);
  assert.match(shellCss, /\.app-player-mini/);
});

test('dashboard responsive breakpoints cover desktop, tablet, and phone', () => {
  assert.match(dashboardCss, /@media \(max-width: 1024px\)/);
  assert.match(dashboardCss, /@media \(max-width: 768px\)/);
  assert.match(shellCss, /@media \(max-width: 1024px\)/);
  assert.match(shellCss, /@media \(max-width: 768px\)/);
});

test('critical song actions are not hover-only in shared music UI', () => {
  assert.match(musicCss, /\.music-card-actions/);
  assert.equal(musicCss.includes('opacity: 0'), false);
  assert.equal(musicCss.includes('.music-song-card:hover .music-card-actions'), false);
  assert.match(musicCss, /min-height: 44px/);
});
