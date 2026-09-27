export const LYRICS_SOURCE_MAX_ANCHORS = 200;
export const LYRICS_SOURCE_MAX_HTML_CHARS = 400000;
export const LYRICS_SOURCE_MAX_ANCHOR_TEXT_LENGTH = 300;

const ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|nbsp|#39|#34);/gi;
const ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#34': '"',
});

const ANCHOR_PATTERN = /<a\b[^>]*?href\s*=\s*(?:"([^"]{1,2048})"|'([^']{1,2048})')[^>]*>([\s\S]{0,4000}?)<\/a>/gi;

function decodeEntities(value) {
  return value.replace(ENTITY_PATTERN, (match, key) => ENTITIES[key.toLowerCase()] ?? match);
}

function normalizeAnchorText(rawText) {
  const withoutTags = String(rawText || '').replace(/<[^>]*>/g, ' ');
  const decoded = decodeEntities(withoutTags);
  const collapsed = decoded.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, LYRICS_SOURCE_MAX_ANCHOR_TEXT_LENGTH);
}

/**
 * Extract link metadata from a discovery search page.
 * Only anchor href + anchor text are collected: page bodies and lyric content
 * are never captured, returned, or persisted.
 */
export function extractSourceAnchors(html, options = {}) {
  const maxAnchors = options.maxAnchors ?? LYRICS_SOURCE_MAX_ANCHORS;
  const maxHtmlChars = options.maxHtmlChars ?? LYRICS_SOURCE_MAX_HTML_CHARS;
  if (typeof html !== 'string' || !html || maxAnchors <= 0) return [];

  const scanTarget = html.length > maxHtmlChars ? html.slice(0, maxHtmlChars) : html;
  const anchors = [];
  ANCHOR_PATTERN.lastIndex = 0;
  let match = ANCHOR_PATTERN.exec(scanTarget);
  while (match !== null && anchors.length < maxAnchors) {
    const href = String(match[1] || match[2] || '').trim();
    if (href) {
      anchors.push({ href, text: normalizeAnchorText(match[3]) });
    }
    match = ANCHOR_PATTERN.exec(scanTarget);
  }
  return anchors;
}
