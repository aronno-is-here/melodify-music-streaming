import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(clientSrc, ...parts), 'utf8');

const signupSrc = read('pages', 'Signup', 'Signup.jsx');
const authCss = read('styles', 'auth-pages.css');
const userModelSrc = read('..', '..', 'server', 'models', 'User.js');

const GENDER_BLOCK = signupSrc.slice(signupSrc.indexOf('role="radiogroup"'));

test('gender control is a single-select segmented radiogroup', () => {
  assert.match(GENDER_BLOCK, /role="radiogroup"/);
  assert.match(GENDER_BLOCK, /aria-labelledby="signup-gender-label"/);
  assert.match(GENDER_BLOCK, /type="radio"/);
  assert.match(GENDER_BLOCK, /name="gender"/);
  assert.match(GENDER_BLOCK, /checked=\{gender === option\.value\}/);
  assert.match(GENDER_BLOCK, /onChange=\{\(event\) => setGender\(event\.target\.value\)\}/);
  assert.equal(GENDER_BLOCK.includes('className="auth-radio"'), false);
});

test('gender options keep the exact backend-compatible values', () => {
  const values = [...signupSrc.matchAll(/value: '([a-z_]+)', label:/g)].map((match) => match[1]);
  assert.deepEqual(values, ['man', 'woman', 'prefer_not_to_say']);
  assert.match(userModelSrc, /gender: \{ type: String, enum: \['man', 'woman', 'prefer_not_to_say'\]/);
});

test('gender required validation is preserved on the group', () => {
  assert.match(GENDER_BLOCK, /required=\{index === 0\}/);
  assert.match(signupSrc, /<input\s+id="signup-name"[\s\S]*?required/);
  assert.match(signupSrc, /<input\s+id="signup-password"[\s\S]*?required/);
  assert.match(signupSrc, /<input\s+id="signup-email"[\s\S]*?required/);
});

test('signup still posts the unchanged step3 payload contract', () => {
  assert.match(signupSrc, /api\.post\('\/api\/auth\/signup\/step3', \{/);
  assert.match(signupSrc, /email,\s*password,\s*name,\s*day,\s*month,\s*year,\s*gender,\s*country,/);
});

test('DOB selects keep their values, labels, and required validation', () => {
  const day = signupSrc.match(/<select[^>]*aria-label="Birth day"[^>]*>/);
  const month = signupSrc.match(/<select[^>]*aria-label="Birth month"[^>]*>/);
  const year = signupSrc.match(/<select[^>]*aria-label="Birth year"[^>]*>/);
  for (const [name, markup] of [['day', day], ['month', month], ['year', year]]) {
    assert.ok(markup, `${name} select is present`);
    assert.match(markup[0], /className="auth-select"/, name);
    assert.match(markup[0], /required/, name);
  }
  assert.match(day[0], /value=\{day\}/);
  assert.match(month[0], /value=\{month\}/);
  assert.match(year[0], /value=\{year\}/);
  assert.match(signupSrc, /<option value="">Day<\/option>/);
  assert.match(signupSrc, /<option value="">Month<\/option>/);
  assert.match(signupSrc, /<option value="">Year<\/option>/);
  assert.match(signupSrc, /value=\{index \+ 1\}/);
});

test('country select keeps its id, required flag, and backend values', () => {
  const country = signupSrc.match(/<select[^>]*id="signup-country"[^>]*>/);
  assert.ok(country);
  assert.match(country[0], /className="auth-select"/);
  assert.match(country[0], /required/);
  assert.match(country[0], /value=\{country\}/);
  for (const value of ['Bangladesh', 'India', 'Pakistan', 'USA', 'UK', 'Canada', 'Australia', 'Germany', 'Japan', 'Brazil']) {
    assert.ok(signupSrc.includes(`value="${value}"`), `country value ${value} preserved`);
  }
  assert.match(signupSrc, /<option value="">Choose a country<\/option>/);
});

test('auth theme styles the selects with a readable control surface', () => {
  assert.match(authCss, /\.auth-form-group select \{[^}]*appearance: none;/s);
  assert.match(authCss, /background-image: url\("data:image\/svg\+xml/);
  assert.match(authCss, /background-position: right 16px center;/);
  assert.match(authCss, /padding: 0 42px 0 16px;/);
  assert.match(authCss, /color-scheme: dark;/);
  assert.match(authCss, /\.auth-form-group select:focus[^}]*box-shadow/s);
  assert.match(authCss, /\.auth-form-group select:required:invalid \{/);
  assert.match(authCss, /\.auth-form-group select option \{[^}]*background-color:/s);
});

test('auth theme replaces the oversized native radio styling with segmented options', () => {
  assert.equal(authCss.includes('.auth-radio {'), false);
  assert.equal(authCss.includes('.auth-radio-group'), false);
  assert.match(authCss, /\.auth-segmented \{/);
  assert.match(authCss, /\.auth-segmented-option input \{[^}]*opacity: 0;/s);
  assert.match(authCss, /\.auth-segmented-option input:checked \+ \.auth-segmented-label \{/);
  assert.match(authCss, /\.auth-segmented-option input:focus \+ \.auth-segmented-label \{/);
  assert.match(authCss, /min-height: 44px;/);
  assert.match(authCss, /flex-wrap: wrap;/);
});
