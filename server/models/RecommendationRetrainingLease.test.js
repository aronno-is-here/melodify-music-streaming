import assert from 'node:assert/strict';
import test from 'node:test';

import RecommendationRetrainingLease, {
  RETRAINING_LEASE_GRACE_MS,
  RETRAINING_LEASE_SCHEMA_VERSION,
  RETRAINING_LEASE_SCOPE,
  retrainingLeaseSaveGuard,
} from '../models/RecommendationRetrainingLease.js';

const validToken = 'a'.repeat(64);

const validate = (fields) => {
  const doc = new RecommendationRetrainingLease(fields);
  const error = doc.validateSync();
  return { doc, error };
};

test('lease: schema version and default scope', () => {
  assert.equal(RETRAINING_LEASE_SCHEMA_VERSION, 1);
  assert.equal(RETRAINING_LEASE_SCOPE, 'global');
  assert.equal(RETRAINING_LEASE_GRACE_MS, 60000);
});

test('lease: accepts a valid payload', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  const expires = new Date('2026-09-15T12:10:00.000Z');
  const { doc, error } = validate({
    token: validToken,
    run_id: 'run-43-01',
    acquired_at: now,
    expires_at: expires,
  });
  assert.equal(error, undefined);
  assert.equal(doc.scope, 'global');
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.token, validToken);
});

test('lease: rejects invalid token', () => {
  for (const token of ['', 'short', 'g'.repeat(64), validToken + 'a', 1, null]) {
    const { error } = validate({
      token,
      run_id: 'run-43-01',
      acquired_at: new Date(),
      expires_at: new Date(Date.now() + 60000),
    });
    assert.ok(error, String(token));
  }
});

test('lease: rejects invalid run_id', () => {
  for (const run_id of ['', 'UPPER', '.hidden', 'a'.repeat(65), ' ', null]) {
    const { error } = validate({
      token: validToken,
      run_id,
      acquired_at: new Date(),
      expires_at: new Date(Date.now() + 60000),
    });
    assert.ok(error, String(run_id));
  }
});

test('lease: requires acquired_at and expires_at', () => {
  const { error: missingAcquired } = validate({
    token: validToken,
    run_id: 'run-43-01',
    expires_at: new Date(),
  });
  assert.ok(missingAcquired);
  const { error: missingExpires } = validate({
    token: validToken,
    run_id: 'run-43-01',
    acquired_at: new Date(),
  });
  assert.ok(missingExpires);
});

test('lease: unique scope index exists', () => {
  const indexes = RecommendationRetrainingLease.schema.indexes();
  const scopeIndex = indexes.find(([keys]) => keys.scope === 1);
  assert.ok(scopeIndex);
  assert.equal(scopeIndex[1].unique, true);
});

test('lease: TTL index on expires_at', () => {
  const indexes = RecommendationRetrainingLease.schema.indexes();
  const ttl = indexes.find(([keys]) => keys.expires_at === 1);
  assert.ok(ttl);
  assert.equal(ttl[1].expireAfterSeconds, 0);
});

test('lease: strict schema rejects unknown paths', () => {
  const options = RecommendationRetrainingLease.schema.options;
  assert.equal(options.strict, true);
  assert.equal(options.versionKey, false);
});

test('lease: pre-save rejects non-new documents', () => {
  let captured = null;
  retrainingLeaseSaveGuard.call({ isNew: false }, (error) => {
    captured = error;
  });
  assert.ok(captured);
  assert.match(captured.message, /immutable after creation/);

  let allowed = null;
  retrainingLeaseSaveGuard.call({ isNew: true }, (error) => {
    allowed = error;
  });
  assert.equal(allowed, undefined);
});

test('lease: update middleware rejects updates', async () => {
  const query = RecommendationRetrainingLease.updateOne({}, { run_id: 'x' });
  await assert.rejects(() => query.exec(), /immutable/);
  const findOneAndUpdate = RecommendationRetrainingLease.findOneAndUpdate(
    {},
    { run_id: 'x' },
  );
  await assert.rejects(() => findOneAndUpdate.exec(), /immutable/);
});

test('lease: no email/password/token leak fields in schema paths', () => {
  const paths = Object.keys(RecommendationRetrainingLease.schema.paths);
  for (const forbidden of ['email', 'password', 'jwt', 'secret']) {
    assert.equal(
      paths.some((path) => path.includes(forbidden)),
      false,
      forbidden,
    );
  }
});
