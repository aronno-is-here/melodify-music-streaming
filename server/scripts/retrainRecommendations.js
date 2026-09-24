import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import connectDB from '../config/db.js';
import {
  DEFAULT_RETRAIN_SNAPSHOT_LIMIT,
  MAX_RETRAIN_SNAPSHOT_LIMIT,
  RecommendationRetrainingError,
  createRecommendationRetrainingService,
  normalizeRetrainRunAt,
  normalizeRetrainRunId,
  normalizeRetrainSnapshotLimit,
} from '../services/recommendationRetrainingService.js';

export const RETRAIN_CLI_USAGE =
  'node server/scripts/retrainRecommendations.js --run-id <safe-run-id> --run-at <timezone-aware-ISO8601> [--snapshot-limit <1-100>]';

export const RETRAIN_CLI_ERROR_MESSAGES = Object.freeze({
  missingRunId: 'missing required --run-id',
  missingRunAt: 'missing required --run-at',
  unknownFlag: 'unknown retrain argument',
  missingValue: 'missing value for retrain argument',
  invalidRunId: 'invalid retrain run id',
  invalidRunAt: 'invalid retrain timestamp',
  invalidSnapshotLimit: 'invalid snapshot limit',
  unexpectedArgument: 'unexpected retrain argument',
});

export class RetrainCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RetrainCliError';
  }
}

const KNOWN_FLAGS = Object.freeze(['--run-id', '--run-at', '--snapshot-limit']);

export function parseRetrainArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.unexpectedArgument);
  }

  let runId = null;
  let runAt = null;
  let snapshotLimitRaw = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (typeof token !== 'string') {
      throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.unexpectedArgument);
    }
    if (!KNOWN_FLAGS.includes(token)) {
      throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.unknownFlag);
    }
    if (i + 1 >= argv.length) {
      throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.missingValue);
    }
    const value = argv[i + 1];
    if (typeof value !== 'string' || value.startsWith('--')) {
      throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.missingValue);
    }
    i += 1;

    if (token === '--run-id') {
      if (runId !== null) {
        throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.unexpectedArgument);
      }
      runId = value;
    } else if (token === '--run-at') {
      if (runAt !== null) {
        throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.unexpectedArgument);
      }
      runAt = value;
    } else if (token === '--snapshot-limit') {
      if (snapshotLimitRaw !== null) {
        throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.unexpectedArgument);
      }
      snapshotLimitRaw = value;
    }
  }

  if (runId === null) {
    throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.missingRunId);
  }
  if (runAt === null) {
    throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.missingRunAt);
  }

  let normalizedRunId;
  try {
    normalizedRunId = normalizeRetrainRunId(runId);
  } catch {
    throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.invalidRunId);
  }

  let normalizedRunAt;
  try {
    normalizedRunAt = normalizeRetrainRunAt(runAt);
  } catch {
    throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.invalidRunAt);
  }

  let snapshotLimit = DEFAULT_RETRAIN_SNAPSHOT_LIMIT;
  if (snapshotLimitRaw !== null) {
    if (!/^[0-9]{1,3}$/.test(snapshotLimitRaw)) {
      throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.invalidSnapshotLimit);
    }
    try {
      snapshotLimit = normalizeRetrainSnapshotLimit(Number(snapshotLimitRaw));
    } catch {
      throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.invalidSnapshotLimit);
    }
  }

  return {
    runId: normalizedRunId,
    runAt: normalizedRunAt,
    snapshotLimit,
  };
}

export function buildRetrainSummary(summary) {
  if (summary === null || typeof summary !== 'object') {
    throw new RetrainCliError(RETRAIN_CLI_ERROR_MESSAGES.unexpectedArgument);
  }
  return {
    status: summary.status === 'completed' ? 'completed' : 'failed',
    attempt_id: typeof summary.attempt_id === 'string' ? summary.attempt_id : null,
    run_id: typeof summary.run_id === 'string' ? summary.run_id : null,
    pipeline_stage: summary.pipeline_stage === 'policy' ? 'policy' : null,
    snapshot_limit:
      typeof summary.snapshot_limit === 'number'
      && Number.isInteger(summary.snapshot_limit)
      && summary.snapshot_limit >= 1
      && summary.snapshot_limit <= MAX_RETRAIN_SNAPSHOT_LIMIT
        ? summary.snapshot_limit
        : null,
    duration_ms:
      typeof summary.duration_ms === 'number' && Number.isFinite(summary.duration_ms)
        ? summary.duration_ms
        : null,
    evaluation_created: summary.evaluation_created === true,
    snapshot_persisted_count:
      typeof summary.snapshot_persisted_count === 'number'
      && Number.isInteger(summary.snapshot_persisted_count)
        ? summary.snapshot_persisted_count
        : null,
    snapshot_reused_count:
      typeof summary.snapshot_reused_count === 'number'
      && Number.isInteger(summary.snapshot_reused_count)
        ? summary.snapshot_reused_count
        : null,
    event_window_truncated: summary.event_window_truncated === true,
  };
}

export async function runRetrainCli(argv, {
  connect = connectDB,
  createService = createRecommendationRetrainingService,
  disconnect = () => mongoose.disconnect(),
  writeOut = (line) => process.stdout.write(`${line}\n`),
  writeErr = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  let options;
  try {
    options = parseRetrainArgs(argv);
  } catch (error) {
    writeErr(error.message);
    writeErr(RETRAIN_CLI_USAGE);
    return 2;
  }

  let connected = false;
  try {
    await connect();
    connected = true;
    const service = createService();
    const summary = await service.runRecommendationRetraining({
      runId: options.runId,
      runAt: options.runAt,
      snapshotLimit: options.snapshotLimit,
    });
    writeOut(JSON.stringify(buildRetrainSummary(summary)));
    return 0;
  } catch (error) {
    const message =
      error instanceof RecommendationRetrainingError ||
      error instanceof RetrainCliError
        ? error.message
        : 'retraining failed';
    const failureCode =
      error && typeof error.failureCode === 'string' ? error.failureCode : null;
    writeErr(
      JSON.stringify({
        success: false,
        error: message,
        failure_code: failureCode,
      }),
    );
    return 1;
  } finally {
    if (connected) {
      try {
        await disconnect();
      } catch {
        // ignore disconnect failures after a bounded CLI run
      }
    }
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const exitCode = await runRetrainCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

export default runRetrainCli;
