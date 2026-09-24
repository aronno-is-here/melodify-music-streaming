import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  RETRAIN_CLI_ERROR_MESSAGES,
  RETRAIN_CLI_USAGE,
  RetrainCliError,
  buildRetrainSummary,
  parseRetrainArgs,
  runRetrainCli,
} from './retrainRecommendations.js';

const readSource = () =>
  readFileSync(
    fileURLToPath(new URL('./retrainRecommendations.js', import.meta.url)),
    'utf8',
  );

const RUN_AT = '2026-09-15T12:00:00.000Z';

test('cli: parse requires --run-id and --run-at', () => {
  assert.throws(() => parseRetrainArgs([]), RetrainCliError);
  assert.throws(() => parseRetrainArgs(['--run-id', 'a']), (error) => {
    assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.missingRunAt);
    return true;
  });
  assert.throws(() => parseRetrainArgs(['--run-at', RUN_AT]), (error) => {
    assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.missingRunId);
    return true;
  });
});

test('cli: parse accepts valid run-id/run-at/snapshot-limit', () => {
  const parsed = parseRetrainArgs([
    '--run-id',
    'run-43-01',
    '--run-at',
    RUN_AT,
    '--snapshot-limit',
    '10',
  ]);
  assert.deepEqual(parsed, {
    runId: 'run-43-01',
    runAt: RUN_AT,
    snapshotLimit: 10,
  });
});

test('cli: parse defaults snapshot-limit to 20', () => {
  const parsed = parseRetrainArgs(['--run-id', 'run-43-01', '--run-at', RUN_AT]);
  assert.equal(parsed.snapshotLimit, 20);
});

test('cli: parse rejects unknown flags and bad values', () => {
  assert.throws(
    () => parseRetrainArgs(['--nope', 'x', '--run-id', 'a', '--run-at', RUN_AT]),
    (error) => {
      assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.unknownFlag);
      return true;
    },
  );
  assert.throws(
    () => parseRetrainArgs(['--run-id']),
    (error) => {
      assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.missingValue);
      return true;
    },
  );
  assert.throws(
    () => parseRetrainArgs(['--run-id', 'UPPER', '--run-at', RUN_AT]),
    (error) => {
      assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.invalidRunId);
      return true;
    },
  );
  assert.throws(
    () => parseRetrainArgs(['--run-id', 'ok', '--run-at', '2026-09-15']),
    (error) => {
      assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.invalidRunAt);
      return true;
    },
  );
  assert.throws(
    () =>
      parseRetrainArgs([
        '--run-id',
        'ok',
        '--run-at',
        RUN_AT,
        '--snapshot-limit',
        '0',
      ]),
    (error) => {
      assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.invalidSnapshotLimit);
      return true;
    },
  );
  assert.throws(
    () =>
      parseRetrainArgs([
        '--run-id',
        'ok',
        '--run-at',
        RUN_AT,
        '--snapshot-limit',
        '101',
      ]),
    (error) => {
      assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.invalidSnapshotLimit);
      return true;
    },
  );
  assert.throws(
    () =>
      parseRetrainArgs([
        '--run-id',
        'a',
        '--run-id',
        'b',
        '--run-at',
        RUN_AT,
      ]),
    (error) => {
      assert.equal(error.message, RETRAIN_CLI_ERROR_MESSAGES.unexpectedArgument);
      return true;
    },
  );
});

test('cli: buildRetrainSummary projects a fixed whitelist', () => {
  const summary = buildRetrainSummary({
    status: 'completed',
    attempt_id: 'run-43-01-abcd1234',
    run_id: 'run-43-01',
    pipeline_stage: 'policy',
    snapshot_limit: 20,
    duration_ms: 12,
    evaluation_created: true,
    snapshot_persisted_count: 3,
    snapshot_reused_count: 1,
    event_window_truncated: false,
    failure_code: null,
    secret_token: 'nope',
    email: 'a@b.c',
  });
  assert.deepEqual(Object.keys(summary).sort(), [
    'attempt_id',
    'duration_ms',
    'evaluation_created',
    'event_window_truncated',
    'pipeline_stage',
    'run_id',
    'snapshot_limit',
    'snapshot_persisted_count',
    'snapshot_reused_count',
    'status',
  ]);
  assert.equal(summary.secret_token, undefined);
  assert.equal(summary.email, undefined);
});

test('cli: runRetrainCli success path writes one JSON summary and disconnects', async () => {
  const out = [];
  const err = [];
  const events = [];
  const exitCode = await runRetrainCli(
    ['--run-id', 'run-43-01', '--run-at', RUN_AT],
    {
      connect: async () => {
        events.push('connect');
      },
      createService: () => ({
        async runRecommendationRetraining(options) {
          events.push('run');
          assert.equal(options.runId, 'run-43-01');
          assert.equal(options.runAt, RUN_AT);
          assert.equal(options.snapshotLimit, 20);
          return {
            status: 'completed',
            attempt_id: 'run-43-01-ffffffff',
            run_id: 'run-43-01',
            pipeline_stage: 'policy',
            snapshot_limit: 20,
            duration_ms: 5,
            evaluation_created: true,
            snapshot_persisted_count: 2,
            snapshot_reused_count: 0,
            event_window_truncated: false,
          };
        },
      }),
      disconnect: async () => {
        events.push('disconnect');
      },
      writeOut: (line) => out.push(line),
      writeErr: (line) => err.push(line),
    },
  );
  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['connect', 'run', 'disconnect']);
  assert.equal(err.length, 0);
  assert.equal(out.length, 1);
  const payload = JSON.parse(out[0]);
  assert.equal(payload.status, 'completed');
  assert.equal(payload.run_id, 'run-43-01');
});

test('cli: runRetrainCli validation failure never connects', async () => {
  const err = [];
  let connected = false;
  const exitCode = await runRetrainCli(['--run-id', 'UPPER', '--run-at', RUN_AT], {
    connect: async () => {
      connected = true;
    },
    createService: () => ({}),
    disconnect: async () => {},
    writeOut: () => {},
    writeErr: (line) => err.push(line),
  });
  assert.equal(exitCode, 2);
  assert.equal(connected, false);
  assert.equal(err[0], RETRAIN_CLI_ERROR_MESSAGES.invalidRunId);
  assert.equal(err[1], RETRAIN_CLI_USAGE);
});

test('cli: runRetrainCli service failure returns 1, disconnects, writes failure JSON', async () => {
  const err = [];
  const events = [];
  const exitCode = await runRetrainCli(
    ['--run-id', 'run-43-01', '--run-at', RUN_AT],
    {
      connect: async () => {
        events.push('connect');
      },
      createService: () => ({
        async runRecommendationRetraining() {
          const failure = new Error('a retraining run is already in progress');
          failure.name = 'RecommendationRetrainingConflictError';
          failure.failureCode = 'RETRAIN_ALREADY_RUNNING';
          throw failure;
        },
      }),
      disconnect: async () => {
        events.push('disconnect');
      },
      writeOut: () => {},
      writeErr: (line) => err.push(line),
    },
  );
  assert.equal(exitCode, 1);
  assert.deepEqual(events, ['connect', 'disconnect']);
  const payload = JSON.parse(err[0]);
  assert.equal(payload.success, false);
  assert.equal(payload.failure_code, 'RETRAIN_ALREADY_RUNNING');
});

test('cli: source has no express/http retrain endpoint surface', () => {
  const source = readSource();
  for (const token of [
    'express',
    'Router(',
    'app.get',
    'app.post',
    'createServer',
    'listen(',
    'fetch(',
    'axios',
    'exec(',
    'execSync(',
    'spawnSync(',
    'shell: true',
    'shell:true',
  ]) {
    assert.equal(source.includes(token), false, `unexpected: ${token}`);
  }
  assert.equal(source.includes('connectDB'), true);
  assert.equal(source.includes('runRecommendationRetraining'), true);
  assert.equal(source.includes('--run-id'), true);
  assert.equal(source.includes('--run-at'), true);
  assert.equal(source.includes('child_process'), false);
});
