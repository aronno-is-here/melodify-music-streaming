export const TOKEN_USE_ACCESS = 'access';
export const TOKEN_USE_PASSWORD_RESET = 'password-reset';

export const hasTokenPurpose = (payload, expectedPurpose) => {
  if (expectedPurpose !== TOKEN_USE_ACCESS && expectedPurpose !== TOKEN_USE_PASSWORD_RESET) {
    return false;
  }
  return payload !== null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Object.hasOwn(payload, 'token_use')
    && payload.token_use === expectedPurpose;
};
