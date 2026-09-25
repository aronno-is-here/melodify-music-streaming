import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKaraokeDiscoveryQuery } from './karaokeDiscoveryRequest.js';

test('karaoke discovery query parser applies defaults', () => {
  const parsed = parseKaraokeDiscoveryQuery({});
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    query: '',
    regionTag: undefined,
    limit: 12,
    page: 1,
  });
});

test('karaoke discovery query parser accepts valid bounded values', () => {
  const parsed = parseKaraokeDiscoveryQuery({ q: 'arnob', region: 'bn-bd', limit: '20', page: '2' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.query, 'arnob');
  assert.equal(parsed.value.regionTag, 'bn-bd');
  assert.equal(parsed.value.limit, 20);
  assert.equal(parsed.value.page, 2);
});

test('karaoke discovery query parser rejects unknown keys and invalid ranges', () => {
  assert.equal(parseKaraokeDiscoveryQuery({ nope: 'x' }).ok, false);
  assert.equal(parseKaraokeDiscoveryQuery({ limit: '50' }).ok, false);
  assert.equal(parseKaraokeDiscoveryQuery({ page: '30' }).ok, false);
  assert.equal(parseKaraokeDiscoveryQuery({ region: 'xx' }).ok, false);
});
