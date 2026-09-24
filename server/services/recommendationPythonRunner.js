import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETRAIN_PYTHON_TIMEOUT_MS = 600000;
export const MAX_RETRAIN_STDIN_BYTES = 256 * 1024 * 1024;
export const MAX_RETRAIN_STDOUT_BYTES = 256 * 1024 * 1024;
export const MAX_RETRAIN_STDERR_BYTES = 64 * 1024;

export const RETRAIN_PYTHON_COMMAND = 'python';
export const RETRAIN_PYTHON_ARGS = Object.freeze([
  '-m',
  'ml.recommender.cli',
  'retrain-json',
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RETRAIN_PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export const RETRAIN_STDERR_MARKERS = Object.freeze({
  INSUFFICIENT: 'INSUFFICIENT_TRAINING_DATA:',
  ARTIFACT_CONFLICT: 'ARTIFACT_VERSION_CONFLICT:',
  INPUT_LIMIT: 'TRAINING_INPUT_LIMIT_EXCEEDED:',
});

export class RecommendationPythonRunnerError extends Error {
  constructor(message, { failureCode = null } = {}) {
    super(message);
    this.name = 'RecommendationPythonRunnerError';
    this.failureCode = failureCode;
  }
}

export class RecommendationPythonTimeoutError extends RecommendationPythonRunnerError {
  constructor(message) {
    super(message, { failureCode: 'PYTHON_TIMEOUT' });
    this.name = 'RecommendationPythonTimeoutError';
  }
}

export class RecommendationPythonExitError extends RecommendationPythonRunnerError {
  constructor(message, { failureCode } = {}) {
    super(message, { failureCode });
    this.name = 'RecommendationPythonExitError';
  }
}

export class RecommendationPythonOutputError extends RecommendationPythonRunnerError {
  constructor(message) {
    super(message, { failureCode: 'PYTHON_OUTPUT_INVALID' });
    this.name = 'RecommendationPythonOutputError';
  }
}

const mapStderrToFailureCode = (stderrText) => {
  if (stderrText.includes(RETRAIN_STDERR_MARKERS.INSUFFICIENT)) {
    return 'INSUFFICIENT_TRAINING_DATA';
  }
  if (stderrText.includes(RETRAIN_STDERR_MARKERS.ARTIFACT_CONFLICT)) {
    return 'ARTIFACT_VERSION_CONFLICT';
  }
  if (stderrText.includes(RETRAIN_STDERR_MARKERS.INPUT_LIMIT)) {
    return 'TRAINING_INPUT_LIMIT_EXCEEDED';
  }
  return 'PYTHON_FAILED';
};

const encodeInput = (payload) => {
  let json;
  try {
    json = JSON.stringify(payload);
  } catch {
    throw new RecommendationPythonOutputError(
      'retrain input is not JSON serializable',
    );
  }
  const buffer = Buffer.from(json, 'utf8');
  if (buffer.length > MAX_RETRAIN_STDIN_BYTES) {
    throw new RecommendationPythonOutputError('retrain input exceeds size limit');
  }
  return buffer;
};

export function createRecommendationPythonRunner({
  spawnImpl = spawn,
  command = RETRAIN_PYTHON_COMMAND,
  args = RETRAIN_PYTHON_ARGS,
  cwd = RETRAIN_PROJECT_ROOT,
  timeoutMs = RETRAIN_PYTHON_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const runRetrainingPython = (payload) =>
    new Promise((resolve, reject) => {
      const input = encodeInput(payload);
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      let child;
      try {
        child = spawnImpl(command, [...args], {
          cwd,
          env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        finish(reject, new RecommendationPythonExitError(
          'failed to start retraining python',
          { failureCode: 'PYTHON_FAILED' },
        ));
        return;
      }

      const stdoutChunks = [];
      const stderrChunks = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutOverflow = false;
      let stderrOverflow = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // process may already be gone
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_RETRAIN_STDOUT_BYTES) {
          stdoutOverflow = true;
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          return;
        }
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_RETRAIN_STDERR_BYTES) {
          if (!stderrOverflow) {
            stderrOverflow = true;
            stderrChunks.push(
              Buffer.from('\n[stderr truncated]\n', 'utf8'),
            );
          }
          return;
        }
        stderrChunks.push(chunk);
      });

      child.on('error', (error) => {
        finish(
          reject,
          new RecommendationPythonExitError(
            error?.message || 'failed to start retraining python',
            { failureCode: 'PYTHON_FAILED' },
          ),
        );
      });

      child.on('close', (code, signal) => {
        if (timedOut || signal === 'SIGKILL') {
          if (timedOut) {
            finish(
              reject,
              new RecommendationPythonTimeoutError('retraining python timed out'),
            );
            return;
          }
        }
        if (stdoutOverflow) {
          finish(
            reject,
            new RecommendationPythonOutputError('retrain output exceeds size limit'),
          );
          return;
        }

        const stderrText = Buffer.concat(stderrChunks).toString('utf8');

        if (code === 0) {
          const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
          if (stdoutText.length === 0) {
            finish(
              reject,
              new RecommendationPythonOutputError('retrain output was empty'),
            );
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(stdoutText);
          } catch {
            finish(
              reject,
              new RecommendationPythonOutputError('retrain output was invalid JSON'),
            );
            return;
          }
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            finish(
              reject,
              new RecommendationPythonOutputError('retrain output was invalid'),
            );
            return;
          }
          finish(resolve, {
            output: parsed,
            stderr: stderrText,
            exitCode: code,
          });
          return;
        }

        const failureCode = mapStderrToFailureCode(stderrText);
        finish(
          reject,
          new RecommendationPythonExitError('retraining python failed', {
            failureCode,
          }),
        );
      });

      child.stdin.on('error', () => {
        // child may exit before stdin is fully consumed
      });
      child.stdin.end(input);
    });

  return { runRetrainingPython };
}

export default createRecommendationPythonRunner;
