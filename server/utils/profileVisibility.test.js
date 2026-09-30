import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALWAYS_PUBLIC_PROFILE_FIELDS,
  DEFAULT_PROFILE_VISIBILITY,
  PROFILE_VISIBILITY_FIELDS,
  ProfileVisibilityError,
  isProfileFieldPublic,
  isProfileVisibilityValue,
  normalizeProfileVisibility,
  parseProfileVisibilityUpdate,
  projectProfileForViewer,
} from './profileVisibility.js';

const USER_ID = '64b64b64b64b64b64b64b701';
const VIEWER_ID = '64b64b64b64b64b64b64b702';

function makeUser(overrides = {}) {
  return {
    _id: USER_ID,
    name: 'Aronno',
    email: 'aronno@example.com',
    avatar: '',
    bio: 'Hello there',
    libraryVisibility: 'private',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    dob: new Date('2000-01-02'),
    gender: 'man',
    country: 'Bangladesh',
    phone: '+8801700000000',
    ...overrides,
  };
}

test('field vocabulary is exactly the six private profile fields', () => {
  assert.deepEqual([...PROFILE_VISIBILITY_FIELDS], ['email', 'phone', 'dob', 'gender', 'country', 'bio']);
  assert.deepEqual([...ALWAYS_PUBLIC_PROFILE_FIELDS], ['_id', 'name', 'avatar']);
  assert.deepEqual({ ...DEFAULT_PROFILE_VISIBILITY }, {
    email: 'private',
    phone: 'private',
    dob: 'private',
    gender: 'private',
    country: 'private',
    bio: 'private',
  });
});

test('normalizeProfileVisibility defaults every missing or invalid field to private', () => {
  for (const raw of [null, undefined, 'public', 42, ['email'], { email: 'yes' }, {}]) {
    assert.deepEqual(normalizeProfileVisibility(raw), { ...DEFAULT_PROFILE_VISIBILITY });
  }

  const partial = normalizeProfileVisibility({ email: 'public', country: 'secret', bio: 'private' });
  assert.equal(partial.email, 'public');
  assert.equal(partial.bio, 'private');
  assert.equal(partial.country, 'private', 'invalid stored value falls back to private');
  assert.equal(partial.phone, 'private');
});

test('isProfileVisibilityValue only accepts the two enum values', () => {
  assert.equal(isProfileVisibilityValue('public'), true);
  assert.equal(isProfileVisibilityValue('private'), true);
  assert.equal(isProfileVisibilityValue('Public'), false);
  assert.equal(isProfileVisibilityValue(''), false);
  assert.equal(isProfileVisibilityValue(undefined), false);
});

test('isProfileFieldPublic is secure by default for legacy documents', () => {
  const legacy = makeUser();
  delete legacy.profileVisibility;

  for (const field of PROFILE_VISIBILITY_FIELDS) {
    assert.equal(isProfileFieldPublic(legacy, field), false, `${field} must default to private`);
  }
  assert.equal(isProfileFieldPublic(makeUser({ profileVisibility: { email: 'public' } }), 'email'), true);
  assert.equal(isProfileFieldPublic(makeUser({ profileVisibility: { email: 'public' } }), 'phone'), false);
  assert.equal(isProfileFieldPublic(makeUser({ profileVisibility: { email: 'PUBLIC' } }), 'email'), false);
  assert.equal(isProfileFieldPublic(makeUser(), 'not_a_field'), false);
  assert.equal(isProfileFieldPublic(null, 'email'), false);
});

test('parseProfileVisibilityUpdate accepts a valid partial patch', () => {
  assert.deepEqual(
    parseProfileVisibilityUpdate({ email: 'public', bio: 'private' }),
    { email: 'public', bio: 'private' }
  );
  assert.deepEqual(parseProfileVisibilityUpdate({ country: 'public' }), { country: 'public' });
});

test('parseProfileVisibilityUpdate rejects every invalid payload shape', () => {
  const invalidPayloads = [
    null,
    undefined,
    'public',
    7,
    [],
    {},
    { unknown_field: 'public' },
    { email: 'yes' },
    { email: 'Public' },
    { email: 'public', nope: 'private' },
  ];
  for (const payload of invalidPayloads) {
    assert.throws(
      () => parseProfileVisibilityUpdate(payload),
      (error) => error instanceof ProfileVisibilityError,
      `expected rejection for ${JSON.stringify(payload)}`
    );
  }
});

test('projectProfileForViewer gives owners every personal field plus their visibility map', () => {
  const user = makeUser({ profileVisibility: { email: 'public' } });
  const projected = projectProfileForViewer(user, USER_ID);

  assert.equal(String(projected._id), USER_ID);
  assert.equal(projected.name, 'Aronno');
  assert.equal(projected.email, 'aronno@example.com');
  assert.equal(projected.phone, '+8801700000000');
  assert.equal(projected.dob.toISOString().slice(0, 10), '2000-01-02');
  assert.equal(projected.gender, 'man');
  assert.equal(projected.country, 'Bangladesh');
  assert.equal(projected.bio, 'Hello there');
  assert.deepEqual(projected.profileVisibility, { ...DEFAULT_PROFILE_VISIBILITY, email: 'public' });
});

test('projectProfileForViewer omits every private field from strangers (secure default)', () => {
  const user = makeUser();
  delete user.profileVisibility;

  const projected = projectProfileForViewer(user, VIEWER_ID);

  assert.deepEqual(
    Object.keys(projected).sort(),
    ['_id', 'avatar', 'createdAt', 'libraryVisibility', 'name']
  );
  for (const field of PROFILE_VISIBILITY_FIELDS) {
    assert.equal(field in projected, false, `${field} must be omitted`);
  }
  assert.equal('profileVisibility' in projected, false, 'visibility map is owner-only');
});

test('projectProfileForViewer only passes explicitly public fields to strangers', () => {
  const user = makeUser({
    profileVisibility: { email: 'public', dob: 'public', bio: 'public' },
  });
  const projected = projectProfileForViewer(user, VIEWER_ID);

  assert.equal(projected.email, 'aronno@example.com');
  assert.equal(projected.dob.toISOString().slice(0, 10), '2000-01-02');
  assert.equal(projected.bio, 'Hello there');
  assert.equal('phone' in projected, false);
  assert.equal('gender' in projected, false);
  assert.equal('country' in projected, false);
  assert.equal('profileVisibility' in projected, false);
});

test('projectProfileForViewer treats an invalid stored visibility value as private', () => {
  const user = makeUser({
    profileVisibility: { email: 'everyone', phone: 'public', bio: 'PUBLIC' },
  });
  const projected = projectProfileForViewer(user, VIEWER_ID);

  assert.equal('email' in projected, false);
  assert.equal(projected.phone, '+8801700000000');
  assert.equal('bio' in projected, false);
});

test('projectProfileForViewer returns null without a user and never marks a stranger as owner', () => {
  assert.equal(projectProfileForViewer(null, VIEWER_ID), null);
  assert.equal(projectProfileForViewer(undefined, VIEWER_ID), null);

  const withoutViewer = projectProfileForViewer(makeUser(), undefined);
  assert.equal('email' in withoutViewer, false);
  assert.equal('profileVisibility' in withoutViewer, false);
});
