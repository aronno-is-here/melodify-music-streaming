import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  createRecommendationPythonRunner,
  MAX_RETRAIN_STDERR_BYTES,
  MAX_RETRAIN_STDOUT_BYTES,
  RETRAIN_PYTHON_ARGS,
  RETRAIN_PYTHON_COMMAND,
  RETRAIN_PYTHON_TIMEOUT_MS,
} from './recommendationPythonRunner.js';

const makeChild = ({ exitCode = 0, stdout = '', stderr = '', signal = null, failSpawn = false } = {}) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {
    process.nextTick(() => child.emit('close', null, 'SIGKILL'));
  };
  process.nextTick(() => {
    if (failSpawn) {
      child.emit('error', new Error('spawn ENOENT'));
      return;
    }
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.stdin.end();
    process.nextTick(() => child.emit('close', exitCode, signal));
  });
  return child;
};

test('runner: constants match contract', () => {
  assert.equal(RETRAIN_PYTHON_COMMAND, 'python');
  assert.deepEqual([...RETRAIN_PYTHON_ARGS], [
    '-m',
    'ml.recommender.cli',
    'retrain-json',
  ]);
  assert.equal(RETRAIN_PYTHON_TIMEOUT_MS, 600000);
  assert.equal(MAX_RETRAIN_STDOUT_BYTES, 256 * 1024 * 1024);
  assert.equal(MAX_RETRAIN_STDERR_BYTES, 64 * 1024);
});

test('runner: spawn uses shell false and injectable impl', async () => {
  const calls = [];
  const runner = createRecommendationPythonRunner({
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return makeChild({
        stdout: JSON.stringify({ schema_version: 1, ok: true }),
      });
    },
  });
  const result = await runner.runRetrainingPython({ schema_version: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'python');
  assert.deepEqual(calls[0].args, ['-m', 'ml.recommender.cli', 'retrain-json']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(result.output.schema_version, 1);
});

test('runner: success resolves parsed JSON output', async () => {
  const payload = { schema_version: 1, run_id: 'run-43-01' };
  const runner = createRecommendationPythonRunner({
    spawnImpl: () =>
      makeChild({ stdout: `${JSON.stringify(payload)}\n` }),
  });
  const result = await runner.runRetrainingPython(payload);
  assert.deepEqual(result.output, payload);
  assert.equal(result.exitCode, 0);
});

test('runner: invalid JSON stdout becomes PYTHON_OUTPUT_INVALID', async () => {
  const runner = createRecommendationPythonRunner({
    spawnImpl: () => makeChild({ stdout: 'not-json' }),
  });
  await assert.rejects(
    () => runner.runRetrainingPython({}),
    (error) => {
      assert.equal(error.name, 'RecommendationPythonOutputError');
      assert.equal(error.failureCode, 'PYTHON_OUTPUT_INVALID');
      return true;
    },
  );
});

test('runner: empty stdout becomes PYTHON_OUTPUT_INVALID', async () => {
  const runner = createRecommendationPythonRunner({
    spawnImpl: () => makeChild({ stdout: '' }),
  });
  await assert.rejects(
    () => runner.runRetrainingPython({}),
    (error) => {
      assert.equal(error.failureCode, 'PYTHON_OUTPUT_INVALID');
      return true;
    },
  );
});

test('runner: stderr insufficient marker maps to INSUFFICIENT_TRAINING_DATA', async () => {
  const runner = createRecommendationPythonRunner({
    spawnImpl: () =>
      makeChild({
        exitCode: 2,
        stderr: 'INSUFFICIENT_TRAINING_DATA: insufficient training data\n',
      }),
  });
  await assert.rejects(
    () => runner.runRetrainingPython({}),
    (error) => {
      assert.equal(error.failureCode, 'INSUFFICIENT_TRAINING_DATA');
      return true;
    },
  );
});

test('runner: stderr artifact conflict marker maps correctly', async () => {
  const runner = createRecommendationPythonRunner({
    spawnImpl: () =>
      makeChild({
        exitCode: 2,
        stderr: 'ARTIFACT_VERSION_CONFLICT: artifact version already exists\n',
      }),
  });
  await assert.rejects(
    () => runner.runRetrainingPython({}),
    (error) => {
      assert.equal(error.failureCode, 'ARTIFACT_VERSION_CONFLICT');
      return true;
    },
  );
});

test('runner: stderr input limit marker maps correctly', async () => {
  const runner = createRecommendationPythonRunner({
    spawnImpl: () =>
      makeChild({
        exitCode: 2,
        stderr: 'TRAINING_INPUT_LIMIT_EXCEEDED: too many songs\n',
      }),
  });
  await assert.rejects(
    () => runner.runRetrainingPython({}),
    (error) => {
      assert.equal(error.failureCode, 'TRAINING_INPUT_LIMIT_EXCEEDED');
      return true;
    },
  );
});

test('runner: non-zero exit without marker maps to PYTHON_FAILED', async () => {
  const runner = createRecommendationPythonRunner({
    spawnImpl: () => makeChild({ exitCode: 1, stderr: 'boom\n' }),
  });
  await assert.rejects(
    () => runner.runRetrainingPython({}),
    (error) => {
      assert.equal(error.failureCode, 'PYTHON_FAILED');
      return true;
    },
  );
});

test('runner: spawn error maps to PYTHON_FAILED', async () => {
  const runner = createRecommendationPythonRunner({
    spawnImpl: () => makeChild({ failSpawn: true }),
  });
  await assert.rejects(
    () => runner.runRetrainingPython({}),
    (error) => {
      assert.equal(error.failureCode, 'PYTHON_FAILED');
      return true;
    },
  );
});

test('runner: timeout maps to PYTHON_TIMEOUT', async () => {
  const runner = createRecommendationPythonRunner({
    timeoutMs: 10,
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => {
        process.nextTick(() => child.emit('close', null, 'SIGKILL'));
      };
      return child;
    },
  });
  await assert.rejects(
    () => runner.runRetrainingPython({}),
    (error) => {
      assert.equal(error.name, 'RecommendationPythonTimeoutError');
      assert.equal(error.failureCode, 'PYTHON_TIMEOUT');
      return true;
    },
  );
});

test('runner: source contains only spawn (no exec/execSync/spawnSync/shell true)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(
    fileURLToPath(new URL('./recommendationPythonRunner.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('execSync'), false);
  assert.equal(source.includes('exec('), false);
  assert.equal(source.includes('spawnSync'), false);
  assert.equal(source.includes('shell: true'), false);
  assert.equal(source.includes('shell:true'), false);
  assert.equal(source.includes('from \'node:child_process\''), true);
  assert.equal(source.includes('spawnImpl'), true);
  assert.match(source, /shell:\s*false/);
  assert.equal((source.match(/shell:\s*true/gi) || []).length, 0);
});
