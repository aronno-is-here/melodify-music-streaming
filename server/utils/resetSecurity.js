export const RESET_ERROR_MESSAGE = 'Unable to process password reset request.';

export const isSensitiveResetPath = (originalUrl) => {
  if (typeof originalUrl !== 'string') return false;
  const pathname = originalUrl.split('?', 1)[0].toLowerCase();
  // Match Express's default case-insensitive, optional-trailing-slash routing.
  return ['/api/auth/forgot-password', '/api/auth/reset-password'].some(
    (endpoint) => pathname === endpoint || pathname === `${endpoint}/`
  );
};

export const getSafeResetError = (error) => {
  const candidate = error?.statusCode ?? error?.status;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate
    : 500;
  return { status, body: { success: false, error: RESET_ERROR_MESSAGE } };
};
