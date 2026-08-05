import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactString } from './redactor.mjs';
import { appendEvent, closeOpenTraceEvents, eventsPath, payloadReference } from './trace.mjs';
import { assertLiveSessionOrg, repositoryRoot, runtimeDirectoryForSession } from './session.mjs';

const executable = resolve(repositoryRoot, 'bin', 'run.js');
const preload = pathToFileURL(resolve(repositoryRoot, 'test', 'nut', 'mock-org-preload.mjs')).href;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const environmentSnapshot = (env) =>
  Object.fromEntries(
    ['CI', 'NODE_ENV', 'SF_API_VERSION', 'SF_TARGET_ORG', 'D360_LIVE_MUTATIONS', 'D360_LIVE_BILLABLE']
      .filter((name) => env[name] !== undefined)
      .map((name) => [name, redactString(env[name])])
  );

const normalizeArgv = (argv) => {
  const values = [...argv];
  if (values[0] === 'sf') values.shift();
  if (values[0] !== 'data360') throw new Error('Testbed commands must start with sf data360 or data360.');
  return values.map((value) =>
    value.replaceAll(/\$\{([A-Z][A-Z\d_]*)\}/gu, (_match, name) => {
      if (!/^(?:D360|SF)_[A-Z\d_]+$/u.test(name))
        throw new Error(`Suite environment placeholder is not allowed: ${name}`);
      const resolved = process.env[name];
      if (resolved === undefined || resolved === '') throw new Error(`Suite requires environment variable ${name}.`);
      return resolved;
    })
  );
};

export const assertLiveCommandOrg = (args, liveOrg) => {
  const selected = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--target-org' || argument === '-o') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires the pinned live org value.`);
      selected.push(value);
      index += 1;
    } else if (argument.startsWith('--target-org=') || argument.startsWith('-o=')) {
      const value = argument.slice(argument.indexOf('=') + 1);
      if (!value) throw new Error(`${argument.split('=')[0]} requires the pinned live org value.`);
      selected.push(value);
    }
  }
  if (selected.some((value) => value !== liveOrg)) {
    throw new Error('Live testbed commands may only target the org pinned by D360_LIVE_ORG.');
  }
};

const parseTiming = (stderr) => {
  const match = /Timing: parse ([\d.]+)ms .* connection ([\d.]+)ms .* request ([\d.]+)ms .* total ([\d.]+)ms/iu.exec(
    stderr
  );
  return match
    ? { parseMs: Number(match[1]), connMs: Number(match[2]), reqMs: Number(match[3]), totalMs: Number(match[4]) }
    : undefined;
};

const capture = async (command, args, options) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let forced;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forced = setTimeout(() => child.kill('SIGKILL'), 2_000);
    }, options.timeoutMs);
    const captureChunk = (chunks, chunk, stream) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - used);
      if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
      if (stream === 'stdout') stdoutBytes += Math.min(buffer.length, remaining);
      else stderrBytes += Math.min(buffer.length, remaining);
      if (buffer.length > remaining && !outputLimitExceeded) {
        outputLimitExceeded = true;
        child.kill('SIGTERM');
      }
    };
    child.stdout.on('data', (chunk) => captureChunk(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => captureChunk(stderr, chunk, 'stderr'));
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (forced) clearTimeout(forced);
      resolvePromise({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
        outputLimitExceeded,
      });
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });

export const executeCommand = async (
  sessionDirectory,
  session,
  argv,
  { stdin, env: commandEnvironment = {}, mockUrl, timeoutMs = 30_000 } = {}
) => {
  const args = normalizeArgv(argv);
  const liveOrg = assertLiveSessionOrg(session);
  if (liveOrg) assertLiveCommandOrg(args, liveOrg);
  const home = join(runtimeDirectoryForSession(session.sid), 'home');
  if (session.mode === 'mock') await mkdir(home, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    ...commandEnvironment,
    CI: '1',
    NODE_ENV: session.mode === 'mock' ? 'test' : process.env.NODE_ENV,
    SF_AUTOUPDATE_DISABLE: 'true',
    SF_DISABLE_TELEMETRY: 'true',
    SF_NO_COLOR: '1',
    SF_DATA360_TRACE: eventsPath(sessionDirectory),
    SF_DATA360_TRACE_ID: session.sid,
    SF_TARGET_ORG: session.mode === 'mock' ? 'testbed@example.invalid' : liveOrg,
    ...(session.mode === 'mock'
      ? {
          HOME: home,
          USERPROFILE: home,
          SF_USE_GENERIC_UNIX_KEYCHAIN: 'true',
        }
      : {}),
    ...(mockUrl
      ? {
          D360_NUT_MOCK_URL: mockUrl,
          SF_DATA360_TENANT_URL: mockUrl,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`.trim(),
        }
      : {}),
  };
  const stdinReference = await payloadReference(stdin ?? '', sessionDirectory, 'preview256');
  const execSequence = await appendEvent(sessionDirectory, session.sid, {
    type: 'command.exec',
    executable,
    argv: [executable, ...args],
    displayArgv: ['sf', ...args],
    cwd: repositoryRoot,
    envAllowlist: environmentSnapshot(env),
    stdin: stdinReference,
  });
  env.SF_DATA360_TRACE_COMMAND_SEQ = String(execSequence);
  const start = performance.now();
  const captured = await capture(executable, args, {
    cwd: repositoryRoot,
    env,
    stdin,
    timeoutMs,
  });
  const durationMs = Math.max(0, performance.now() - start);
  const stdout = captured.stdout.toString('utf8');
  const stderr = captured.stderr.toString('utf8');
  let jsonEnvelope;
  try {
    jsonEnvelope = JSON.parse(stdout);
  } catch {
    // Non-JSON output is a supported command result and remains available through the payload reference.
  }
  const stdoutReference = await payloadReference(stdout, sessionDirectory, 'preview4k');
  const resultSequence = await appendEvent(sessionDirectory, session.sid, {
    type: 'command.result',
    seqRef: execSequence,
    exitCode: captured.exitCode,
    durationMs,
    stdout: stdoutReference,
    stderr: { full: stderr },
    ...(jsonEnvelope && typeof jsonEnvelope === 'object' ? { jsonEnvelope } : {}),
    ...(parseTiming(stderr) ? { timing: parseTiming(stderr) } : {}),
    ...(captured.timedOut ? { timedOut: true } : {}),
    ...(captured.outputLimitExceeded ? { outputLimitExceeded: true } : {}),
  });
  await closeOpenTraceEvents(sessionDirectory, session.sid, {
    afterSequence: execSequence - 1,
    exitCode: captured.exitCode,
    durationMs,
    timedOut: captured.timedOut,
  });
  return {
    argv: ['sf', ...args],
    exitCode: captured.exitCode,
    durationMs,
    stdout,
    stderr,
    jsonEnvelope,
    timedOut: captured.timedOut,
    outputLimitExceeded: captured.outputLimitExceeded,
    execSequence,
    resultSequence,
  };
};
