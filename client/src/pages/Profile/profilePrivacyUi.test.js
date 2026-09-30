import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_PRIVACY_FIELDS,
  PROFILE_PRIVACY_FIELD_LABELS,
  PROFILE_PRIVACY_SHORT_LABELS,
  buildPrivacyToggle,
  isProfilePrivacyValue,
  normalizeProfileVisibilityInput,
  updateProfileVisibilityField,
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

test('field labels stay stable for the inline controls', () => {
  assert.deepEqual(PROFILE_PRIVACY_FIELD_LABELS, {
    email: 'Email',
    phone: 'Phone',
    dob: 'Date of Birth',
    gender: 'Gender',
    country: 'Country',
    bio: 'Bio',
  });
  assert.equal(PROFILE_PRIVACY_SHORT_LABELS.public, 'Public');
  assert.equal(PROFILE_PRIVACY_SHORT_LABELS.private, 'Private');
});

test('the inline toggle is public-first with a selected flag per value', () => {
  const publicState = buildPrivacyToggle('public');
  assert.deepEqual(publicState.map((option) => option.value), ['public', 'private']);
  assert.deepEqual(publicState.map((option) => option.label), ['Public', 'Private']);
  assert.equal(publicState[0].selected, true);
  assert.equal(publicState[1].selected, false);

  const privateState = buildPrivacyToggle('private');
  assert.equal(privateState[0].selected, false);
  assert.equal(privateState[1].selected, true);

  // Unknown/corrupt values fail closed to Private.
  const fallback = buildPrivacyToggle('weird');
  assert.equal(fallback[0].selected, false);
  assert.equal(fallback[1].selected, true);
});

test('changing one field updates only that field', () => {
  const base = normalizeProfileVisibilityInput({ email: 'public', phone: 'public' });

  const next = updateProfileVisibilityField(base, 'dob', 'public');
  assert.equal(next.dob, 'public');
  assert.equal(next.email, 'public');
  assert.equal(next.phone, 'public');
  assert.equal(next.gender, 'private');
  assert.equal(next.country, 'private');
  assert.equal(next.bio, 'private');

  const flipped = updateProfileVisibilityField(next, 'email', 'private');
  assert.equal(flipped.email, 'private');
  assert.equal(flipped.phone, 'public');
  assert.equal(flipped.dob, 'public');

  // Invalid field/value input never mutates anything.
  assert.deepEqual(updateProfileVisibilityField(base, 'email', 'Public'), base);
  assert.deepEqual(updateProfileVisibilityField(base, 'name', 'public'), base);
  assert.deepEqual(updateProfileVisibilityField(base, 'bio', null), base);
  assert.deepEqual(updateProfileVisibilityField(undefined, 'email', 'public'), {
    email: 'public',
    phone: 'private',
    dob: 'private',
    gender: 'private',
    country: 'private',
    bio: 'private',
  });
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
