export const REGIONAL_TAGS = Object.freeze({
  BANGLA_BD: 'bn-bd',
  BENGALI_IN: 'bn-in',
  HINDI_IN: 'hi-in',
  ENGLISH: 'en',
});

export const REGIONAL_DISCOVERY = Object.freeze([
  { id: REGIONAL_TAGS.BANGLA_BD, label: 'Bangla', searchHints: ['bangla songs', 'বাংলা গান', 'dhaka music'] },
  { id: REGIONAL_TAGS.BENGALI_IN, label: 'Kolkata Bengali', searchHints: ['kolkata bengali songs', 'tollywood bengali songs'] },
  { id: REGIONAL_TAGS.HINDI_IN, label: 'Hindi', searchHints: ['hindi songs', 'bollywood songs', 'हिंदी गाने'] },
  { id: REGIONAL_TAGS.ENGLISH, label: 'English', searchHints: ['english songs', 'pop songs'] },
]);

const REGION_SET = new Set(REGIONAL_DISCOVERY.map((entry) => entry.id));

export function normalizeRegionTag(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!REGION_SET.has(normalized)) return null;
  return normalized;
}

export function inferLanguageFromRegion(regionTag) {
  switch (regionTag) {
    case REGIONAL_TAGS.BANGLA_BD:
    case REGIONAL_TAGS.BENGALI_IN:
      return 'bn';
    case REGIONAL_TAGS.HINDI_IN:
      return 'hi';
    case REGIONAL_TAGS.ENGLISH:
      return 'en';
    default:
      return null;
  }
}

export function getRegionSearchHints(regionTag) {
  const region = REGIONAL_DISCOVERY.find((entry) => entry.id === regionTag);
  return region ? [...region.searchHints] : [];
}
