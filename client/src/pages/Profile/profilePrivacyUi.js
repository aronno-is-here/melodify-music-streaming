/**
 * Pure helpers for the per-field privacy controls on the own Profile page.
 *
 * Every field defaults to `private` (also for legacy accounts that predate the
 * `profileVisibility` document), and only the two enum values are accepted.
 */

export const PROFILE_PRIVACY_FIELDS = Object.freeze([
  'email',
  'phone',
  'dob',
  'gender',
  'country',
  'bio',
]);

export const PROFILE_PRIVACY_FIELD_LABELS = Object.freeze({
  email: 'Email',
  phone: 'Phone',
  dob: 'Date of Birth',
  gender: 'Gender',
  country: 'Country',
  bio: 'Bio',
});

export const PROFILE_PRIVACY_OPTIONS = Object.freeze([
  { value: 'private', label: 'Private - Only you can see this' },
  { value: 'public', label: 'Public - Anyone can see this' },
]);

export function isProfilePrivacyValue(value) {
  return value === 'public' || value === 'private';
}

export function normalizeProfileVisibilityInput(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const visibility = {};
  for (const field of PROFILE_PRIVACY_FIELDS) {
    visibility[field] = isProfilePrivacyValue(source[field]) ? source[field] : 'private';
  }
  return visibility;
}

export function buildPrivacyRows(rawVisibility) {
  const visibility = normalizeProfileVisibilityInput(rawVisibility);
  return PROFILE_PRIVACY_FIELDS.map((field) => ({
    field,
    id: `profile-privacy-${field}`,
    label: PROFILE_PRIVACY_FIELD_LABELS[field],
    value: visibility[field],
  }));
}

export function getProfilePrivacyTag(rawVisibility, field) {
  const visibility = normalizeProfileVisibilityInput(rawVisibility);
  if (!PROFILE_PRIVACY_FIELDS.includes(field)) return '';
  return visibility[field] === 'public' ? 'Public' : 'Private';
}
