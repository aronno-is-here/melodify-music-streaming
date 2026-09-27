export const MAX_DISCOVERED_URL_LENGTH = 2048;

function isHostAllowed(host, allowedHosts) {
  return allowedHosts.some((entry) => {
    const allowed = String(entry || '').trim().toLowerCase();
    if (!allowed) return false;
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

/**
 * Sanitize a discovered external lyric source URL.
 * Only http/https URLs without credentials are accepted, and when an allowlist
 * is provided the host must belong to an expected provider domain (SSRF guard).
 */
export function sanitizeDiscoveredSourceUrl(rawUrl, { allowedHosts = [] } = {}) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_DISCOVERED_URL_LENGTH) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') return null;

  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;

  const hosts = Array.isArray(allowedHosts) ? allowedHosts : [];
  if (hosts.length > 0 && !isHostAllowed(host, hosts)) return null;

  parsed.hash = '';
  return parsed.toString();
}

export function isExpectedSourceHost(url, allowedHosts) {
  if (typeof url !== 'string' || !Array.isArray(allowedHosts) || allowedHosts.length === 0) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return isHostAllowed(host, allowedHosts);
  } catch {
    return false;
  }
}
