import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(srcRoot, ...parts), 'utf8');

const brandSrc = read('components', 'ui', 'MelodifyBrand.jsx');
const brandCss = read('styles', 'brand.css');
const mainSrc = read('main.jsx');
const waveformSrc = read('components', 'home', 'Waveform.jsx');
const homeSrc = read('pages', 'Home', 'Home.jsx');
const homeCss = read('pages', 'Home', 'Home.css');
const loginSrc = read('pages', 'Login', 'Login.jsx');
const signupSrc = read('pages', 'Signup', 'Signup.jsx');
const forgotSrc = read('pages', 'ForgotPassword', 'ForgotPassword.jsx');
const resetSrc = read('pages', 'ResetPassword', 'ResetPassword.jsx');
const shellSrc = read('components', 'app', 'AuthenticatedAppShell.jsx');
const premiumSrc = read('pages', 'Premium', 'Premium.jsx');
const premiumCss = read('pages', 'Premium', 'Premium.css');
const authCss = read('styles', 'auth-pages.css');
const appShellCss = read('styles', 'app-shell.css');
const adminSrc = read('pages', 'Admin', 'Admin.jsx');

const consumers = [
  ['Home.jsx', homeSrc],
  ['Login.jsx', loginSrc],
  ['Signup.jsx', signupSrc],
  ['ForgotPassword.jsx', forgotSrc],
  ['ResetPassword.jsx', resetSrc],
  ['AuthenticatedAppShell.jsx', shellSrc],
  ['Premium.jsx', premiumSrc],
];

test('shared component renders Waveform plus split Melod/ify wordmark', () => {
  assert.match(brandSrc, /import Waveform from '\.\.\/home\/Waveform\.jsx';/);
  assert.match(brandSrc, /export default function MelodifyBrand\(\{ variant = 'header' \}\)/);
  assert.match(brandSrc, /<Waveform size=\{footer \? 26 : 34\} \/>/);
  assert.match(brandSrc, /<span className="melodify-wordmark-main">Melod<\/span>/);
  assert.match(brandSrc, /<span className="melodify-wordmark-accent">ify<\/span>/);
  assert.match(brandSrc, /melodify-brand--footer/);
  assert.match(brandSrc, /melodify-wordmark--footer/);
  assert.equal(brandSrc.includes('>Melodify<'), false);
  assert.equal(/font-family|color\s*:|#[0-9a-fA-F]{3,6}/.test(brandSrc), false);
});

test('brand.css defines the universal homepage-matched wordmark', () => {
  assert.match(brandCss, /\.melodify-wordmark\s*\{/);
  assert.match(brandCss, /font-family:\s*'Segoe UI',\s*sans-serif;/);
  assert.match(brandCss, /font-weight:\s*700;/);
  assert.match(brandCss, /letter-spacing:\s*-0\.6px;/);
  assert.match(brandCss, /white-space:\s*nowrap;/);
  assert.match(brandCss, /\.melodify-wordmark-main\s*\{\s*color:\s*#ffffff;/);
  assert.match(brandCss, /\.melodify-wordmark-accent\s*\{\s*color:\s*#00b4d8;/);
  assert.match(brandCss, /\.melodify-wordmark--footer\s*\{[^}]*font-size:\s*16px;/);
  assert.match(brandCss, /\.melodify-brand\s*\{[^}]*gap:\s*6px;/);
  assert.match(brandCss, /\.melodify-brand--footer\s*\{\s*gap:\s*4px;/);
  assert.equal(/Segoe UI.*Merienda|Merienda/.test(brandCss), false);
  const colors = [...brandCss.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase());
  assert.deepEqual([...new Set(colors)].sort(), ['#00b4d8', '#ffffff']);
});

test('brand.css is imported globally by main.jsx', () => {
  assert.match(mainSrc, /import '\.\/styles\/brand\.css';/);
});

test('Waveform icon source is unchanged and reused', () => {
  assert.match(waveformSrc, /export default function Waveform\(\{ size = 34 \}\)/);
  assert.match(waveformSrc, /className="home-logo-icon"/);
  assert.match(waveformSrc, /#386bff/);
  assert.match(waveformSrc, /#b85aff/);
  assert.match(waveformSrc, /aria-hidden="true"/);
});

test('every visible logo/wordmark lockup uses the shared component', () => {
  for (const [name, source] of consumers) {
    assert.match(source, /<MelodifyBrand/, name);
    const imports = [...source.matchAll(/import MelodifyBrand from '([^']+)';/g)].map((m) => m[1]);
    assert.equal(imports.length, 1, `${name} imports MelodifyBrand exactly once`);
  }
  const total = consumers.reduce((count, [, source]) => count + (source.match(/<MelodifyBrand/g) || []).length, 0);
  assert.equal(total, 8);
});

test('homepage header and footer lockups are converted', () => {
  assert.match(homeSrc, /className="home-logo">\s*<MelodifyBrand \/>/);
  assert.match(homeSrc, /className="home-logo home-logo--footer">\s*<MelodifyBrand variant="footer" \/>/);
  assert.equal(homeSrc.includes('home-logo-text'), false);
  assert.equal(homeSrc.includes("components/home/Waveform.jsx'"), false);
  assert.equal(homeCss.includes('home-logo-text'), false);
  assert.match(homeCss, /\.home-logo\s*\{/);
  assert.match(homeCss, /\.home-logo--footer\s*\{/);
  assert.match(homeCss, /\.home-logo:focus-visible/);
});

test('auth pages send their brand link to the dashboard while using the shared component', () => {
  for (const [name, source] of [
    ['Login', loginSrc],
    ['Signup', signupSrc],
    ['ForgotPassword', forgotSrc],
    ['ResetPassword', resetSrc],
  ]) {
    assert.match(source, /<Link to="\/dashboard" className="auth-brand" aria-label="Go to dashboard">\s*<MelodifyBrand \/>/, name);
  }
});

test('brand destinations follow the homepage versus dashboard rule', () => {
  assert.match(homeSrc, /<Link to="\/" className="home-logo">/);
  assert.match(homeSrc, /<Link to="\/" className="home-logo home-logo--footer">/);
  for (const [name, source] of [
    ['Login', loginSrc],
    ['Signup', signupSrc],
    ['ForgotPassword', forgotSrc],
    ['ResetPassword', resetSrc],
    ['AuthenticatedAppShell', shellSrc],
    ['Premium', premiumSrc],
  ]) {
    assert.match(source, /<Link to="\/dashboard"[^>]*>\s*<MelodifyBrand \/>/, name);
    assert.equal(/<Link to="\/"[^>]*>\s*<MelodifyBrand \/>/.test(source), false, `${name} keeps its brand off "/"`);
  }
});

test('app shell keeps its dashboard link contract while using the shared component', () => {
  assert.match(shellSrc, /to="\/dashboard" className="app-brand" aria-label="Go to dashboard">\s*<MelodifyBrand \/>/);
  assert.equal(shellSrc.includes('app-brand-mark'), false);
  assert.equal(shellSrc.includes('app-brand-name'), false);
  assert.equal(shellSrc.includes('fa-wave-square'), false);
});

test('premium lockup gains the shared component and keeps its aria label', () => {
  assert.match(premiumSrc, /className="premium-brand" aria-label="Go to Melodify dashboard">\s*<MelodifyBrand \/>/);
  assert.equal(premiumSrc.includes('Melod<span>ify</span>'), false);
});

test('obsolete per-page brand CSS rules are removed', () => {
  assert.equal(authCss.includes('auth-brand-mark'), false);
  assert.equal(authCss.includes('auth-brand-name'), false);
  assert.match(authCss, /\.auth-brand\s*\{/);
  assert.equal(appShellCss.includes('app-brand-mark'), false);
  assert.equal(appShellCss.includes('app-brand-name'), false);
  assert.match(appShellCss, /\.app-brand\s*\{/);
  assert.equal(premiumCss.includes('.premium-brand span'), false);
  assert.match(premiumCss, /\.premium-brand\s*\{/);
  assert.equal(/\.premium-brand\s*\{[^}]*font-family/.test(premiumCss), false);
  assert.equal(/\.premium-brand\s*\{[^}]*font-size/.test(premiumCss), false);
});

test('auth and shell pages no longer render the old tile/fa-wave-square mark', () => {
  for (const [name, source] of consumers) {
    assert.equal(source.includes('fa-wave-square'), false, name);
    assert.equal(source.includes('Melod<span>ify</span>'), false, name);
  }
});

test('admin page title is plain text and is not converted into a lockup', () => {
  assert.match(adminSrc, /<h1>Melodify Admin Panel<\/h1>/);
  assert.equal(adminSrc.includes('MelodifyBrand'), false);
  assert.equal(adminSrc.includes('Melod<span>'), false);
});

test('wordmark color and typography cannot vary per page', () => {
  for (const [name, source] of consumers) {
    assert.equal(/#[0-9a-fA-F]{3,6}/.test(source), false, `${name} defines no raw colors`);
    assert.equal(source.includes('font-family'), false, `${name} defines no font-family`);
  }
  assert.equal(brandSrc.includes('color='), false);
  assert.equal(brandSrc.includes('style='), false);
});
