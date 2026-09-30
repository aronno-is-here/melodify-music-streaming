import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'Profile.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'Profile.css'), 'utf8');
const helperSrc = readFileSync(join(__dirname, 'profilePrivacyUi.js'), 'utf8');

const personalSection = src.match(/title="Personal Information"[\s\S]*?<\/section>/);
assert.ok(personalSection, 'Personal Information section exists');
const SECTION = personalSection[0];

const INLINE_FIELDS = [
  { field: 'email', label: 'Email' },
  { field: 'phone', label: 'Phone' },
  { field: 'dob', label: 'Date of Birth' },
  { field: 'gender', label: 'Gender' },
  { field: 'country', label: 'Country' },
  { field: 'bio', label: 'Bio' },
];

function cardBlock(label) {
  const match = SECTION.match(
    new RegExp(`<label>${label}<\\/label>[\\s\\S]*?<ProfilePrivacyToggle[\\s\\S]*?<\\/article>`),
  );
  assert.ok(match, `${label} card owns an inline privacy toggle`);
  return match[0];
}

test('1-6. Email/Phone/DOB/Gender/Country/Bio each have their own inline Public/Private control', () => {
  for (const { field, label } of INLINE_FIELDS) {
    const card = cardBlock(label);
    assert.match(card, new RegExp(`<ProfilePrivacyToggle field="${field}"`));
    assert.match(card, new RegExp(`value=\\{privacy\\.${field}\\}`));
    assert.match(card, /onChange=\{saveFieldPrivacy\}/);
    assert.match(card, /<ProfilePrivacyToggle[\s\S]*?\/>/);
  }
  // The owner always sees their own value right beside the control.
  assert.match(cardBlock('Email'), /<strong>\{user\.email\}<\/strong>/);
  assert.match(cardBlock('Phone'), /<strong>\{user\.phone \|\| '-'\}<\/strong>/);
  assert.match(cardBlock('Date of Birth'), /<strong>\{user\.dob \? String\(user\.dob\)\.slice\(0, 10\) : '-'\}<\/strong>/);
  assert.match(cardBlock('Gender'), /<strong>\{user\.gender \|\| '-'\}<\/strong>/);
  assert.match(cardBlock('Country'), /<strong>\{user\.country \|\| '-'\}<\/strong>/);
  assert.match(cardBlock('Bio'), /<strong>\{user\.bio \|\| 'No bio yet'\}<\/strong>/);
  // Full Name is always public and gets no privacy control.
  assert.equal(/<label>Full Name<\/label>[\s\S]{0,120}ProfilePrivacyToggle/.test(SECTION), false);
});

test('7. selected state reflects profileVisibility', () => {
  assert.match(src, /const privacy = normalizeProfileVisibilityInput\(profileVisibility\);/);
  for (const { field } of INLINE_FIELDS) {
    assert.match(SECTION, new RegExp(`value=\\{privacy\\.${field}\\}`));
  }
  assert.match(src, /function ProfilePrivacyToggle\(\{ field, value, onChange \}\)/);
  assert.match(src, /buildPrivacyToggle\(value\)/);
  assert.match(src, /option\.selected \? ' is-active' : ''/);
  assert.match(src, /aria-pressed=\{option\.selected\}/);
  assert.match(src, /role="group" aria-label=\{`\$\{PROFILE_PRIVACY_FIELD_LABELS\[field\]\} visibility`\}/);
  assert.match(css, /\.profile-privacy-seg-btn\.is-active \{/);
});

test('8. changing a field updates only that field', () => {
  assert.match(src, /const next = updateProfileVisibilityField\(previous, field, value\);/);
  assert.match(src, /if \(next\[field\] === previous\[field\]\) return;/);
  assert.match(src, /setProfileVisibility\(next\);/);
  assert.match(helperSrc, /return \{ \.\.\.visibility, \[field\]: value \};/);
  assert.equal(/setProfileVisibility\(\(prev\) => \(\{ \.\.\.prev/.test(src), false);
  // Other cards never share state writes: one shared handler, one field key.
  assert.equal((src.match(/const saveFieldPrivacy = async/g) || []).length, 1);
  assert.equal((src.match(/onChange=\{saveFieldPrivacy\}/g) || []).length, 6);
});

test('9. privacy values are saved through the existing settings API', () => {
  assert.match(src, /api\.put\('\/api\/users\/me\/settings', \{ profileVisibility: next \}\)/);
  const putPaths = [...src.matchAll(/api\.put\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(putPaths)].sort(), [
    '/api/auth/me',
    '/api/users/me/avatar',
    '/api/users/me/settings',
  ]);
  assert.equal(src.includes('fetch('), false);
  assert.equal(/privacy-visibility|visibility-settings|\/api\/profile-visibility/.test(src), false);
  // Failed saves roll back to the previous value.
  assert.match(src, /if \(!data\.success\) \{\s*setProfileVisibility\(previous\);/);
});

test('10. the duplicate settings-form privacy fieldset no longer exists', () => {
  assert.equal(src.includes('profile-privacy-fieldset'), false);
  assert.equal(src.includes('Profile field visibility'), false);
  assert.equal(src.includes('buildPrivacyRows'), false);
  assert.equal(src.includes('getProfilePrivacyTag'), false);
  assert.equal(src.includes('profile-privacy-tag'), false);
  assert.equal(src.includes('PROFILE_PRIVACY_OPTIONS'), false);
  assert.match(src, /api\.put\('\/api\/users\/me\/settings', \{ bio, libraryVisibility \}\)/);
  assert.equal(helperSrc.includes('export function buildPrivacyRows'), false);
  assert.equal(helperSrc.includes('export function getProfilePrivacyTag'), false);
  assert.equal(css.includes('.profile-privacy-fieldset'), false);
  assert.equal(css.includes('.profile-privacy-row'), false);
  assert.equal(css.includes('.profile-privacy-tag'), false);
});

test('inline controls are compact, themed, keyboard friendly, and not native radios', () => {
  assert.equal(src.includes('type="radio"'), false);
  assert.match(src, /type="button"\s*className=\{`profile-privacy-seg-btn/);
  assert.match(css, /\.profile-privacy-seg \{/);
  assert.match(css, /\.profile-privacy-seg-btn \{/);
  assert.match(css, /color: var\(--mel-text-soft\);/);
  assert.match(css, /\.profile-privacy-seg-btn\.is-active \{\s*background: var\(--mel-cyan\);/);
  assert.match(css, /\.profile-privacy-seg-btn:focus-visible \{/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.profile-privacy-seg-btn \{/);
  assert.match(css, /flex-wrap: wrap;/);
});
