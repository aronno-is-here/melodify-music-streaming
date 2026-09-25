import assert from 'node:assert/strict';
import test from 'node:test';
import { isAccessTokenFreshAfterPasswordChange } from './accessTokenFreshness.js';

const changedAt = new Date('2026-09-15T12:00:00.500Z');
const changedAtSeconds = Math.floor(changedAt.getTime() / 1000);

test('no passwordChangedAt: access tokens are accepted regardless of iat', () => {
  for (const passwordChangedAt of [undefined, null]) {
    assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds }, passwordChangedAt), true);
    assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds - 100000 }, passwordChangedAt), true);
    assert.equal(isAccessTokenFreshAfterPasswordChange({}, passwordChangedAt), true);
    assert.equal(isAccessTokenFreshAfterPasswordChange(null, passwordChangedAt), true);
  }
});

test('token issued before passwordChangedAt: rejected', () => {
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds - 1 }, changedAt), false);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds - 100 }, changedAt), false);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: 0 }, changedAt), false);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds - 1, id: 'u1', token_use: 'access' }, changedAt), false);
});

test('token issued after passwordChangedAt: accepted', () => {
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds + 1 }, changedAt), true);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds + 100 }, changedAt), true);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds + 1, id: 'u1', token_use: 'access' }, changedAt), true);
});

test('missing iat: rejected when passwordChangedAt exists', () => {
  for (const decoded of [{}, { id: 'u1', token_use: 'access' }, { iat: undefined }]) {
    assert.equal(isAccessTokenFreshAfterPasswordChange(decoded, changedAt), false);
  }
});

test('malformed decoded payloads: rejected when passwordChangedAt exists', () => {
  for (const decoded of [undefined, null, '', 'token', 42, true, false, [], ['access'], changedAt]) {
    assert.equal(isAccessTokenFreshAfterPasswordChange(decoded, changedAt), false);
  }
});

test('non-numeric and non-finite iat: rejected', () => {
  for (const iat of [NaN, Infinity, -Infinity, '1757937600', '1e9', true, false, null, undefined, [], {}, 1n]) {
    assert.equal(isAccessTokenFreshAfterPasswordChange({ iat }, changedAt), false);
  }
});

test('invalid passwordChangedAt: rejected even with a valid iat', () => {
  const decoded = { iat: changedAtSeconds };
  for (const passwordChangedAt of [new Date(NaN), new Date('invalid'), '2026-09-15T12:00:00.500Z', changedAt.getTime(), 0, {}, [], true, Number.NaN]) {
    assert.equal(isAccessTokenFreshAfterPasswordChange(decoded, passwordChangedAt), false);
  }
});

test('JWT iat seconds are compared against the Date milliseconds correctly', () => {
  const wholeSecond = new Date(changedAtSeconds * 1000);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds - 1 }, wholeSecond), false);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds }, wholeSecond), true);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds }, changedAt), true);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds - 1 }, changedAt), false);

  const withMilliseconds = new Date(changedAtSeconds * 1000 + 999);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds - 1 }, withMilliseconds), false);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds }, withMilliseconds), true);
});

test('same-second behavior: a token whose iat equals the passwordChangedAt second is accepted', () => {
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds }, changedAt), true);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds }, new Date(changedAtSeconds * 1000 + 999)), true);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds - 1 }, changedAt), false);
});

test('inputs are not mutated', () => {
  const decoded = Object.freeze({ iat: changedAtSeconds - 1, id: 'u1', token_use: 'access' });
  const passwordChangedAt = new Date(changedAt.getTime());
  const beforeDecoded = { ...decoded };
  const beforeChangedAtMs = passwordChangedAt.getTime();

  assert.equal(isAccessTokenFreshAfterPasswordChange(decoded, passwordChangedAt), false);
  assert.equal(isAccessTokenFreshAfterPasswordChange({ iat: changedAtSeconds + 1 }, passwordChangedAt), true);

  assert.deepEqual(decoded, beforeDecoded);
  assert.equal(passwordChangedAt.getTime(), beforeChangedAtMs);
});
