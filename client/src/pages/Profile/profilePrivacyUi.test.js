import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_PRIVACY_FIELDS,
  PROFILE_PRIVACY_FIELD_LABELS,
  PROFILE_PRIVACY_OPTIONS,
  buildPrivacyRows,
  getProfilePrivacyTag,
  isProfilePrivacyValue,
  normalizeProfileVisibilityInput,
} from './profilePrivacyUi.js';

test('every profile field defaults to private', () => {
  assert.deepEqual(PROFILE_PRIVACY_FIELDS, ['email', 'phone', 'dob', 'gender', 'country', 'bio']);
  const visibility = normalizeProfileVisibilityInput(undefined);
  assert.deepEqual(visibility, {
    email: 'private',
    phone: 'private',
    dob: 'private',
    gender: 'private',
    country: 'private',
    bio: 'private',
  });
  assert.deepEqual(normalizeProfileVisibilityInput(null), visibility);
  assert.deepEqual(normalizeProfileVisibilityInput('private'), visibility);
  assert.deepEqual(normalizeProfileVisibilityInput([]), visibility);
});

test('only the two enum values are accepted', () => {
  assert.equal(isProfilePrivacyValue('public'), true);
  assert.equal(isProfilePrivacyValue('private'), true);
  assert.equal(isProfilePrivacyValue('Public'), false);
  assert.equal(isProfilePrivacyValue(true), false);
  assert.equal(isProfilePrivacyValue(1), false);
  assert.equal(isProfileVisibilityFallbackTest(), true);

  const visibility = normalizeProfileVisibilityInput({
    email: 'public',
    phone: 'PUBLIC',
    dob: null,
    gender: true,
    country: 'friends',
    bio: 'public',
    unexpected: 'public',
  });
  assert.equal(visibility.email, 'public');
  assert.equal(visibility.phone, 'private');
  assert.equal(visibility.dob, 'private');
  assert.equal(visibility.gender, 'private');
  assert.equal(visibility.country, 'private');
  assert.equal(visibility.bio, 'public');
  assert.equal('unexpected' in visibility, false);
});

test('privacy rows expose stable ids, labels, and normalized values', () => {
  const rows = buildPrivacyRows({ email: 'public', bio: 'nonsense' });
  assert.deepEqual(rows.map((row) => row.field), [...PROFILE_PRIVACY_FIELDS]);
  assert.deepEqual(
    rows.map((row) => row.id),
    PROFILE_PRIVACY_FIELDS.map((field) => `profile-privacy-${field}`),
  );
  assert.equal(rows[0].label, 'Email');
  assert.equal(rows[1].label, 'Phone');
  assert.equal(rows[2].label, 'Date of Birth');
  assert.equal(rows[3].label, 'Gender');
  assert.equal(rows[4].label, 'Country');
  assert.equal(rows[5].label, 'Bio');
  assert.equal(rows[0].value, 'public');
  assert.equal(rows[5].value, 'private');
  assert.equal(PROFILE_PRIVACY_FIELD_LABELS.bio, 'Bio');
});

test('the visibility tag reads Public or Private only', () => {
  assert.equal(getProfilePrivacyTag({ email: 'public' }, 'email'), 'Public');
  assert.equal(getProfilePrivacyTag({ email: 'private' }, 'email'), 'Private');
  assert.equal(getProfilePrivacyTag(undefined, 'email'), 'Private');
  assert.equal(getProfilePrivacyTag({ email: 'public' }, 'name'), '');
  assert.equal(getProfilePrivacyTag({ email: 'weird' }, 'email'), 'Private');
});

test('the dialog options spell out the exact visibility choices', () => {
  assert.deepEqual(PROFILE_PRIVACY_OPTIONS, [
    { value: 'private', label: 'Private - Only you can see this' },
    { value: 'public', label: 'Public - Anyone can see this' },
  ]);
});

function isProfileVisibilityFallbackTest() {
  const visibility = normalizeProfileVisibilityInput({ email: 'public' });
  return (
    visibility.phone === 'private'
    && visibility.dob === 'private'
    && visibility.gender === 'private'
    && visibility.country === 'private'
    && visibility.bio === 'private'
  );
}
