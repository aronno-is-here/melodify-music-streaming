import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Premium.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Premium.css'), 'utf8');

test('Premium keeps subscription API contracts and avoids native confirm prompts', () => {
  assert.match(src, /api\.get\('\/api\/subscriptions\/me'\)/);
  assert.match(src, /api\.post\('\/api\/subscriptions', \{ plan \}\)/);
  assert.match(src, /api\.put\('\/api\/subscriptions\/cancel', \{\}\)/);
  assert.match(src, /<AppDialog/);
  assert.equal(src.includes('confirm('), false);
  assert.equal(src.includes('prompt('), false);
  assert.equal(src.includes('alert('), false);
});

test('Premium navigation, CTA, and FAQ interactions use accessible buttons', () => {
  assert.match(src, /aria-controls="premium-nav"/);
  assert.match(src, /className="premium-menu-btn music-icon-control"/);
  assert.match(src, /className="music-pill-btn"\s*onClick=\{\(\) => subscribe\('Individual'\)\}/);
  assert.match(src, /className="premium-faq-trigger"/);
  assert.match(src, /aria-expanded=\{expanded\}/);
});

test('Premium css is scoped, responsive, and keeps comparison content viewport-safe', () => {
  assert.match(css, /\.premium-page/);
  assert.match(css, /\.premium-table-wrap\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.equal(/(^|\n)\s*body\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*header\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*nav\s*\{/.test(css), false);
  assert.equal(src.includes('href="#"'), false);
});

test('Premium sticky topbar sits flush at the viewport top without a top gap', () => {
  assert.match(css, /\.premium-page \{[^}]*padding: 0 12px 12px/);
  assert.match(css, /\.premium-topbar \{[^}]*top: 0/);
  assert.equal(css.includes('top: 10px'), false);
  assert.equal(css.includes('top: 8px'), false);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.premium-page \{[^}]*padding: 0 10px 10px/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.premium-page \{[^}]*padding: 0 8px 8px/);
});

test('Premium nav items are flex-centered with no magic alignment offsets', () => {
  assert.match(css, /\.premium-nav a,\s*\.premium-nav button \{[^}]*display: inline-flex/);
  assert.match(css, /\.premium-nav a,\s*\.premium-nav button \{[^}]*align-items: center/);
  assert.match(css, /\.premium-nav a,\s*\.premium-nav button \{[^}]*justify-content: center/);
  assert.equal(/padding-top:\s*-?\d+px/.test(css), false);
  assert.equal(/(?:margin|padding)[a-z-]*:\s*-\d+px/.test(css), false);
});
