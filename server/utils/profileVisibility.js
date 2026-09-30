/**
 * Per-field profile privacy helpers.
 *
 * Six profile fields (email, phone, dob, gender, country, bio) are private by
 * default. Every read path MUST go through `projectProfileForViewer` (or
 * `isProfileFieldPublic`) so that a missing or malformed `profileVisibility`
 * document can never leak a field: unknown/invalid values fall back to
 * `private` (secure default). Writes are validated separately and strictly by
 * `parseProfileVisibilityUpdate`, which rejects unknown keys and invalid
 * values instead of silently coercing them.
 *
 * `_id`, `name`, and `avatar` are always public.
 */

export const PROFILE_VISIBILITY_FIELDS = Object.freeze([
  'email',
  'phone',
  'dob',
  'gender',
  'country',
  'bio',
]);

export const PROFILE_VISIBILITY_VALUES = Object.freeze(['public', 'private']);

export const ALWAYS_PUBLIC_PROFILE_FIELDS = Object.freeze(['_id', 'name', 'avatar']);

export const DEFAULT_PROFILE_VISIBILITY = Object.freeze({
  email: 'private',
  phone: 'private',
  dob: 'private',
  gender: 'private',
  country: 'private',
  bio: 'private',
});

export class ProfileVisibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileVisibilityError';
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isProfileVisibilityValue(value) {
  return value === 'public' || value === 'private';
}

export function normalizeProfileVisibility(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const visibility = {};
  for (const field of PROFILE_VISIBILITY_FIELDS) {
    visibility[field] = isProfileVisibilityValue(source[field]) ? source[field] : DEFAULT_PROFILE_VISIBILITY[field];
  }
  return visibility;
}

export function isProfileFieldPublic(user, field) {
  if (!PROFILE_VISIBILITY_FIELDS.includes(field)) return false;
  const visibility = normalizeProfileVisibility(user ? user.profileVisibility : null);
  return visibility[field] === 'public';
}

/**
 * Strict write-side validation: only known fields with `public`/`private`
 * values are accepted. Throws `ProfileVisibilityError` on anything else so
 * routes can reject the request instead of storing a silently-coerced value.
 */
export function parseProfileVisibilityUpdate(raw) {
  if (!isPlainObject(raw)) {
    throw new ProfileVisibilityError('profileVisibility must be an object');
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    throw new ProfileVisibilityError('profileVisibility must include at least one field');
  }
  const patch = {};
  for (const key of keys) {
    if (!PROFILE_VISIBILITY_FIELDS.includes(key)) {
      throw new ProfileVisibilityError(`Unknown profile visibility field: ${key}`);
    }
    if (!isProfileVisibilityValue(raw[key])) {
      throw new ProfileVisibilityError(`Invalid profile visibility value for ${key}`);
    }
    patch[key] = raw[key];
  }
  return patch;
}

/**
 * Project a user document for a viewer. Owners always receive their own
 * fields; everyone else only receives the fields that are explicitly public.
 * Private fields are omitted entirely (never returned as null/empty), so a
 * client can treat "present" as "public".
 */
export function projectProfileForViewer(user, viewerId) {
  if (!user) return null;

  const isOwner = viewerId !== undefined && viewerId !== null && String(user._id) === String(viewerId);
  const visibility = normalizeProfileVisibility(user.profileVisibility);

  const projected = {
    _id: user._id,
    name: user.name,
    avatar: user.avatar || '',
    libraryVisibility: user.libraryVisibility === 'public' ? 'public' : 'private',
    createdAt: user.createdAt,
  };

  for (const field of PROFILE_VISIBILITY_FIELDS) {
    const value = user[field];
    if (value === undefined || value === null) continue;
    if (isOwner || visibility[field] === 'public') {
      projected[field] = value;
    }
  }

  if (isOwner) {
    projected.profileVisibility = visibility;
  }

  return projected;
}
