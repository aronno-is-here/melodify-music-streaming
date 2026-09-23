export const isAccessTokenFreshAfterPasswordChange = (decoded, passwordChangedAt) => {
  if (passwordChangedAt === undefined || passwordChangedAt === null) {
    return true;
  }
  if (!(passwordChangedAt instanceof Date)) {
    return false;
  }
  const passwordChangedAtMs = passwordChangedAt.getTime();
  if (!Number.isFinite(passwordChangedAtMs)) {
    return false;
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return false;
  }
  const { iat } = decoded;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return false;
  }
  const passwordChangedAtSeconds = Math.floor(passwordChangedAtMs / 1000);
  return iat >= passwordChangedAtSeconds;
};
