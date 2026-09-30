/**
 * Pure helpers for the inline per-field privacy controls on the own Profile
 * page (Personal Information cards).
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

export const PROFILE_PRIVACY_SHORT_LABELS = Object.freeze({
  public: 'Public',
  private: 'Private',
});

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

/**
 * Segmented [ Public | Private ] options for one field, in stable public-first
 * order, with the selected flag derived from the current visibility value.
 */
export function buildPrivacyToggle(value) {
  const current = isProfilePrivacyValue(value) ? value : 'private';
  return ['public', 'private'].map((option) => ({
    value: option,
    label: PROFILE_PRIVACY_SHORT_LABELS[option],
    selected: current === option,
  }));
}

/**
 * Returns a full normalized visibility object with ONLY `field` changed.
 * Unknown fields or non-enum values never modify anything (fail closed).
 */
export function updateProfileVisibilityField(current, field, value) {
  const visibility = normalizeProfileVisibilityInput(current);
  if (!PROFILE_PRIVACY_FIELDS.includes(field) || !isProfilePrivacyValue(value)) {
    return visibility;
  }
  return { ...visibility, [field]: value };
}
