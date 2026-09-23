import assert from 'node:assert/strict';
import test from 'node:test';
import { hasTokenPurpose, TOKEN_USE_ACCESS, TOKEN_USE_PASSWORD_RESET } from './tokenPurpose.js';

for (const [purpose, otherPurpose] of [
  [TOKEN_USE_ACCESS, TOKEN_USE_PASSWORD_RESET],
  [TOKEN_USE_PASSWORD_RESET, TOKEN_USE_ACCESS],
]) {
  test(`${purpose}: accepts its own purpose`, () => {
    assert.equal(hasTokenPurpose({ token_use: purpose }, purpose), true);
  });

  test(`${purpose}: rejects cross-purpose use`, () => {
    assert.equal(hasTokenPurpose({ token_use: otherPurpose }, purpose), false);
  });

  test(`${purpose}: rejects missing purpose and the legacy reset claim`, () => {
    assert.equal(hasTokenPurpose({}, purpose), false);
    assert.equal(hasTokenPurpose({ purpose: 'password-reset' }, purpose), false);
  });

  test(`${purpose}: rejects unknown or non-exact purpose strings`, () => {
    for (const token_use of ['unknown', '', purpose.toUpperCase(), ` ${purpose}`, `${purpose} `]) {
      assert.equal(hasTokenPurpose({ token_use }, purpose), false);
    }
  });

  test(`${purpose}: rejects malformed purpose values without coercion`, () => {
    const noCoercion = { toString() { throw new Error('must not coerce'); } };
    for (const token_use of [undefined, null, true, 1, [], [purpose], {}, noCoercion, new String(purpose)]) {
      assert.equal(hasTokenPurpose({ token_use }, purpose), false);
    }
  });

  test(`${purpose}: malformed and non-object payloads fail safely`, () => {
    for (const payload of [undefined, null, purpose, 0, true, Symbol('payload'), 1n, () => purpose, [], [purpose], Object.assign([], { token_use: purpose })]) {
      assert.equal(hasTokenPurpose(payload, purpose), false);
    }
  });

  test(`${purpose}: requires an own purpose claim`, () => {
    assert.equal(hasTokenPurpose(Object.create({ token_use: purpose }), purpose), false);
    const payload = Object.assign(Object.create(null), { token_use: purpose });
    assert.equal(hasTokenPurpose(payload, purpose), true);
  });

  test(`${purpose}: does not mutate payloads`, () => {
    const payload = Object.freeze({ token_use: purpose });
    assert.equal(hasTokenPurpose(payload, purpose), true);
    assert.equal(hasTokenPurpose(payload, otherPurpose), false);
    assert.deepEqual(payload, { token_use: purpose });
  });
}

test('unknown or malformed expected purposes cannot authorize matching claims', () => {
  for (const expectedPurpose of [undefined, null, '', 'unknown', 'ACCESS', true, 1, [], {}]) {
    assert.equal(hasTokenPurpose({ token_use: expectedPurpose }, expectedPurpose), false);
  }
});
