export const VERCEL_ROUTING_METADATA_KEYS = Object.freeze(['path']);

export function stripTransportQueryMetadata(query) {
  if (query === undefined || query === null) {
    return query;
  }
  if (typeof query !== 'object' || Array.isArray(query)) {
    return query;
  }

  const keys = Object.keys(query);
  const hasTransportMetadata = keys.some((key) =>
    VERCEL_ROUTING_METADATA_KEYS.includes(key),
  );
  if (!hasTransportMetadata) {
    return query;
  }

  const sanitized = {};
  for (const key of keys) {
    if (VERCEL_ROUTING_METADATA_KEYS.includes(key)) {
      continue;
    }
    sanitized[key] = query[key];
  }
  return sanitized;
}

export default stripTransportQueryMetadata;
