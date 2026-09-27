import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRICS_DISCOVERY_CATEGORY,
  buildLyricsSourceClassificationInput,
  classifyLyricsSource,
} from './lyricsSourceClassification.js';

const CATEGORY_VALUES = new Set(Object.values(LYRICS_DISCOVERY_CATEGORY));

test('devanagari metadata classifies as Hindi', () => {
  const result = classifyLyricsSource({ title: 'तुम ही हो', artist: 'Arijit Singh' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.HINDI);
  assert.equal(result.language, 'hindi');
  assert.equal(result.combinedBengali, false);
  assert.ok(result.reasons.includes('devanagari-script'));
});

test('explicit hindi language classifies as Hindi with high confidence', () => {
  const result = classifyLyricsSource({ title: 'Khamoshiyan', artist: 'Arijit Singh', language: 'hi' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.HINDI);
  assert.equal(result.confidence, 'high');
  assert.ok(result.reasons.includes('explicit-language'));
});

test('hi-in regional tag classifies as Hindi', () => {
  const result = classifyLyricsSource({ title: 'Tum Hi Ho', artist: 'Arijit Singh', regionalTag: 'hi-in' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.HINDI);
  assert.ok(result.reasons.includes('regional-tag'));
});

test('bengali language with bangladesh region classifies as Bangladeshi Bengali', () => {
  const result = classifyLyricsSource({
    title: 'Keno Hothat Tumi Ele',
    artist: 'Tahsan',
    language: 'bn',
    region: 'Bangladesh',
  });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.BENGALI_BANGLADESH);
  assert.equal(result.region, 'bangladesh');
  assert.equal(result.combinedBengali, false);
});

test('bn-bd regional tag classifies as Bangladeshi Bengali', () => {
  const result = classifyLyricsSource({ title: 'Song', artist: 'Artist', regionalTag: 'bn-bd' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.BENGALI_BANGLADESH);
  assert.equal(result.region, 'bangladesh');
});

test('bn-in regional tag classifies as Kolkata Bengali', () => {
  const result = classifyLyricsSource({ title: 'Song', artist: 'Artist', regionalTag: 'bn-in' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.BENGALI_INDIA);
  assert.equal(result.region, 'india');
});

test('bengali language without region keeps the combined bengali pool', () => {
  const result = classifyLyricsSource({ title: 'Song', artist: 'Artist', language: 'bn' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.BENGALI);
  assert.equal(result.combinedBengali, true);
  assert.equal(result.region, 'unknown');
  assert.ok(result.reasons.includes('combined-bengali'));
});

test('bengali script without region keeps the combined bengali pool', () => {
  const result = classifyLyricsSource({ title: 'কেন হঠাৎ তুমি এলে', artist: 'তাহসান' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.BENGALI);
  assert.equal(result.combinedBengali, true);
  assert.ok(result.reasons.includes('bengali-script'));
});

test('bengali script with kolkata region hint classifies as Indian Bengali', () => {
  const result = classifyLyricsSource({
    title: 'কেন হঠাৎ তুমি এলে',
    artist: 'তাহসান',
    region: 'Kolkata',
  });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.BENGALI_INDIA);
  assert.equal(result.region, 'india');
  assert.equal(result.combinedBengali, false);
});

test('explicit english language classifies as English', () => {
  const result = classifyLyricsSource({ title: 'Hello', artist: 'Adele', language: 'en' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.ENGLISH);
  assert.equal(result.confidence, 'high');
});

test('latin metadata without language falls back to English with low confidence', () => {
  const result = classifyLyricsSource({ title: 'Comfortably Numb', artist: 'Pink Floyd' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.ENGLISH);
  assert.equal(result.confidence, 'low');
  assert.ok(result.reasons.includes('latin-script-default'));
});

test('explicit non supported language classifies as OTHER', () => {
  const result = classifyLyricsSource({ title: 'Vaadi Pulla Vaadi', artist: 'Santhosh Narayanan', language: 'ta' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.OTHER);
  assert.equal(result.language, 'other');
});

test('bengali genre hint classifies into the combined bengali pool', () => {
  const result = classifyLyricsSource({ title: 'Song', artist: 'Artist', genre: 'Bengali' });
  assert.equal(result.category, LYRICS_DISCOVERY_CATEGORY.BENGALI);
  assert.equal(result.combinedBengali, true);
  assert.equal(result.confidence, 'low');
});

test('classification always returns a supported category and bounded confidence', () => {
  const samples = [
    { title: 'a', artist: 'b' },
    { title: 'कोई', artist: 'कोई' },
    { title: 'ক', artist: 'অ' },
    { title: 'Hello', artist: 'Adele', language: 'en' },
    { title: 'x', artist: 'y', language: 'fr' },
    {},
  ];
  for (const sample of samples) {
    const result = classifyLyricsSource(sample);
    assert.ok(CATEGORY_VALUES.has(result.category), `unexpected category ${result.category}`);
    assert.ok(['high', 'medium', 'low'].includes(result.confidence));
    assert.ok(Array.isArray(result.reasons));
    assert.ok(result.reasons.length > 0);
    assert.equal(typeof result.combinedBengali, 'boolean');
  }
});

test('empty metadata classifies without throwing', () => {
  const result = classifyLyricsSource();
  assert.ok(CATEGORY_VALUES.has(result.category));
  assert.equal(result.language, 'unknown');
});

test('classification input builder maps song metadata fields', () => {
  const input = buildLyricsSourceClassificationInput({
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    language: 'bn',
    lyrics_language: 'bn',
    regional_tag: 'bn-bd',
    genre: 'Pop',
    source_provider: 'youtube',
  });
  assert.deepEqual(input, {
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    language: 'bn',
    lyricsLanguage: 'bn',
    regionalTag: 'bn-bd',
    genre: 'Pop',
    region: undefined,
    catalogSource: 'youtube',
  });
  assert.deepEqual(buildLyricsSourceClassificationInput(null), {});
});
