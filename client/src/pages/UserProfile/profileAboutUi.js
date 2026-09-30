/**
 * Pure presentation helpers for the public "About" rows on a user profile.
 *
 * The server only ever sends the fields a viewer is allowed to see (private
 * fields are omitted entirely), so presence here means "shared". Owners also
 * receive their `profileVisibility` map, which is used to tag each row with
 * its current Public/Private state.
 */

export const PROFILE_DETAIL_FIELDS = Object.freeze(['email', 'phone', 'dob', 'gender', 'country']);

export const PROFILE_GENDER_LABELS = Object.freeze({
  man: 'Man',
  woman: 'Woman',
  prefer_not_to_say: 'Prefer not to say',
});

function formatDetailValue(field, value) {
  if (value === undefined || value === null) return '';
  if (field === 'dob') {
    const date = value instanceof Date ? value.toISOString() : String(value);
    return date.slice(0, 10);
  }
  return String(value).trim();
}

export function getProfileDetailVisibility(profile, field) {
  const visibility = profile ? profile.profileVisibility : null;
  if (!visibility || typeof visibility !== 'object') return null;
  const value = visibility[field];
  if (value === 'public') return 'Public';
  if (value === 'private') return 'Private';
  return null;
}

export function buildProfileDetailRows(profile) {
  if (!profile || typeof profile !== 'object') return [];

  const rows = [];
  const add = (field, label, raw) => {
    const value = formatDetailValue(field, raw);
    if (!value) return;
    rows.push({
      field,
      label,
      value: field === 'gender' ? (PROFILE_GENDER_LABELS[value] || value) : value,
    });
  };

  add('email', 'Email', profile.email);
  add('phone', 'Phone', profile.phone);
  add('dob', 'Date of Birth', profile.dob);
  add('gender', 'Gender', profile.gender);
  add('country', 'Country', profile.country);

  return rows;
}
