import assert from 'node:assert/strict';
import test from 'node:test';
import { isSensitiveResetPath, getSafeResetError } from './resetSecurity.js';

for (const endpoint of ['/api/auth/forgot-password', '/api/auth/reset-password']) {
  test(`${endpoint}: identifies the mounted reset endpoint`, () => {
    assert.equal(isSensitiveResetPath(endpoint), true);
  });

  test(`${endpoint}: query strings do not bypass classification`, () => {
    for (const query of ['?', '?input=untrusted-input', '?next=/api/auth/login']) {
      assert.equal(isSensitiveResetPath(`${endpoint}${query}`), true);
    }
  });

  test(`${endpoint}: matches Express case and trailing-slash variants`, () => {
    for (const path of [endpoint.toUpperCase(), `${endpoint}/`, `${endpoint.toUpperCase()}/?input=untrusted-input`]) {
      assert.equal(isSensitiveResetPath(path), true);
    }
  });

  test(`${endpoint}: does not match prefixes, subpaths, or lookalike endpoints`, () => {
    for (const path of [`${endpoint}-other`, `${endpoint}/other`, `${endpoint}//`, `/other${endpoint}`, `${endpoint}\n`]) {
      assert.equal(isSensitiveResetPath(path), false);
    }
  });
}

test('unrelated auth and API paths keep their existing error handling', () => {
  for (const path of ['/api/auth/login', '/api/auth/me/password', '/api/songs', '/api/reset-password', '/reset-password', '/api/auth/login?next=/api/auth/reset-password']) {
    assert.equal(isSensitiveResetPath(path), false);
  }
});

test('malformed and non-string paths fail safely without coercion', () => {
  const noCoercion = { toString() { throw new Error('must not coerce'); } };
  for (const path of [undefined, null, '', 0, true, [], {}, noCoercion, Symbol('path'), 1n]) {
    assert.equal(isSensitiveResetPath(path), false);
  }
});

test('parser errors retain HTTP 400 without reflecting any supplied input', () => {
  const untrustedInput = 'untrusted-input-marker';
  const error = Object.assign(new SyntaxError(untrustedInput), {
    status: 400,
    statusCode: 400,
    body: untrustedInput,
    stack: untrustedInput,
    token: untrustedInput,
  });
  const response = getSafeResetError(error);
  assert.deepEqual(response, {
    status: 400,
    body: { success: false, error: 'Unable to process password reset request.' },
  });
  assert.equal(JSON.stringify(response).includes(untrustedInput), false);
});

test('safe classification never reads or serializes sensitive error details', () => {
  const error = { statusCode: 400 };
  for (const field of ['message', 'body', 'stack', 'token', 'headers', 'toJSON']) {
    Object.defineProperty(error, field, { get() { throw new Error('must not read error details'); } });
  }
  assert.deepEqual(getSafeResetError(error), {
    status: 400,
    body: { success: false, error: 'Unable to process password reset request.' },
  });
});

test('valid error statuses are preserved, including body-size and encoding errors', () => {
  for (const status of [400, 413, 415, 429, 500, 503]) {
    assert.equal(getSafeResetError({ statusCode: status }).status, status);
    assert.equal(getSafeResetError({ status }).status, status);
  }
});

test('unexpected errors and invalid status values use a safe HTTP 500 response', () => {
  for (const error of [undefined, null, 'untrusted-input', new Error('untrusted-input'), {}, { status: '400' }, { status: 200 }, { status: 600 }, { status: 400.5 }, { status: NaN }, { status: Infinity }]) {
    assert.deepEqual(getSafeResetError(error), {
      status: 500,
      body: { success: false, error: 'Unable to process password reset request.' },
    });
  }
});
