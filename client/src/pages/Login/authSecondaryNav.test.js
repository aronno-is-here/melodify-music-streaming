import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '..', '..');
const loginSrc = readFileSync(join(srcRoot, 'pages', 'Login', 'Login.jsx'), 'utf8');
const signupSrc = readFileSync(join(srcRoot, 'pages', 'Signup', 'Signup.jsx'), 'utf8');
const authCss = readFileSync(join(srcRoot, 'styles', 'auth-pages.css'), 'utf8');

const ruleBody = (selector) => {
  const index = authCss.indexOf(`${selector} {`);
  assert.notEqual(index, -1, `expected rule ${selector}`);
  const start = authCss.indexOf('{', index);
  const end = authCss.indexOf('}', start);
  return authCss.slice(start + 1, end);
};

const secondaryClasses = (source) => [...source.matchAll(/className="(auth-secondary-link[^"]*)"/g)]
  .map((entry) => entry[1]);

const introBlock = (source) => {
  const start = source.indexOf('auth-intro-links');
  assert.notEqual(start, -1, 'expected intro navigation block');
  return source.slice(start, start + 400);
};

test('auth secondary actions keep their existing navigation destinations', () => {
  assert.match(loginSrc, /<Link to="\/" className="auth-secondary-link">Home<\/Link>/);
  assert.match(loginSrc, /<Link to="\/signup" className="auth-secondary-link auth-secondary-link--primary">Create Account<\/Link>/);
  assert.match(signupSrc, /<Link to="\/" className="auth-secondary-link">Home<\/Link>/);
  assert.match(signupSrc, /<Link to="\/login" className="auth-secondary-link auth-secondary-link--primary">Log In Instead<\/Link>/);
});

test('login and signup use the same secondary navigation class family', () => {
  const loginClasses = secondaryClasses(loginSrc);
  const signupClasses = secondaryClasses(signupSrc);
  assert.equal(loginClasses.length, 2);
  assert.deepEqual(loginClasses, signupClasses);
});

test('auth secondary actions stop reusing generic button classes', () => {
  for (const source of [loginSrc, signupSrc]) {
    const block = introBlock(source);
    assert.equal(block.includes('music-outline-btn'), false);
    assert.equal(block.includes('music-pill-btn'), false);
    assert.equal(block.includes('style={'), false);
  }
});

test('auth secondary links have no underline in any link state', () => {
  const base = ruleBody('.auth-secondary-link');
  assert.match(base, /text-decoration:\s*none/);
  assert.match(
    authCss,
    /\.auth-secondary-link:link[\s\S]*?\{\s*text-decoration:\s*none;\s*\}/,
  );
  assert.equal(authCss.includes('text-decoration: underline'), false);
});

test('auth secondary links use the project font stack and type scale', () => {
  const base = ruleBody('.auth-secondary-link');
  assert.match(base, /font-family:\s*var\(--mel-font-ui\)/);
  assert.match(base, /font-size:\s*1[34]px/);
  assert.match(base, /font-weight:\s*(500|600)/);
  assert.match(base, /line-height:\s*1/);
  assert.match(base, /min-height:\s*44px/);
  assert.match(base, /border-radius:\s*var\(--mel-pill\)/);
  assert.match(base, /letter-spacing:/);
  assert.equal(/serif/i.test(base), false);
});

test('auth secondary links keep an accessible keyboard focus style', () => {
  const base = ruleBody('.auth-secondary-link');
  assert.equal(/\boutline:/.test(base), false);
  assert.match(
    authCss,
    /\.auth-secondary-link:focus-visible \{[^}]*outline: 2px solid var\(--mel-cyan\)/,
  );
  assert.equal(/\boutline:\s*none/.test(authCss), false);
});

test('auth secondary primary variant follows the shared design language', () => {
  const primary = ruleBody('.auth-secondary-link--primary');
  assert.match(primary, /background:\s*rgba\(0, 180, 216, 0\.16\)/);
  assert.match(primary, /border-color:\s*rgba\(0, 180, 216, 0\.6\)/);
  assert.match(primary, /color:\s*#d7f8ff/);
  assert.match(authCss, /\.auth-secondary-link--primary:hover\s*\{/);
  assert.match(ruleBody('.auth-secondary-link:hover'), /background:/);
});

test('auth secondary links stay comfortable on small screens', () => {
  const mobile = authCss.slice(authCss.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /\.auth-intro-links\s*\{[^}]*gap:\s*8px/);
  assert.match(mobile, /\.auth-secondary-link\s*\{[^}]*padding:\s*0 14px/);
  assert.match(ruleBody('.auth-intro-links'), /flex-wrap:\s*wrap/);
  assert.match(ruleBody('.auth-intro-links'), /align-items:\s*center/);
});
