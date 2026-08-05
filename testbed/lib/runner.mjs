import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { appendEvent, readEvents, writeJson } from './trace.mjs';
import { evaluateExpectations } from './assertions.mjs';
import { executeCommand } from './execute.mjs';
import { readSession, repositoryRoot, runtimeDirectoryForSession, testbedRoot, updateSession } from './session.mjs';
import { validateSuite } from './schemas.mjs';

const suitePath = (name) => {
  if (!/^[a-z\d][a-z\d._/-]*$/u.test(name) || name.includes('..')) throw new Error(`Invalid suite name: ${name}`);
  return resolve(testbedRoot, 'suites', `${name}.json`);
};

export const loadSuite = async (name) => validateSuite(JSON.parse(await readFile(suitePath(name), 'utf8')));

const startMockServer = async (sessionDirectory, session) => {
  const child = spawn(process.execPath, ['--loader', 'ts-node/esm', 'test/mock/server.ts'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SF_DATA360_TRACE: join(sessionDirectory, 'events.jsonl'),
      SF_DATA360_TRACE_ID: session.sid,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const address = await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Mock server did not start within 15s. ${stderr}`));
    }, 15_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const match = /DATA360_MOCK_SERVER=(https?:\/\/[^\s]+)/u.exec(stdout);
      if (match) {
        clearTimeout(timeout);
        resolvePromise(match[1]);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!/DATA360_MOCK_SERVER=/u.test(stdout)) {
        clearTimeout(timeout);
        reject(new Error(`Mock server exited ${code}. ${stderr}`));
      }
    });
  });
  return {
    address,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolvePromise) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          resolvePromise();
        }, 2_000);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolvePromise();
        });
      });
    },
  };
};

const criterionFor = (tags, suite, step) => tags.find((tag) => /^[ULGMDAJ]\d+$/u.test(tag)) ?? `suite:${suite}/${step}`;

const LIVE_READ_ONLY_COMMANDS = new Set([
  'data360 connection list',
  'data360 connector get',
  'data360 data-action list',
  'data360 data-action-target list',
  'data360 data-kit available',
  'data360 data-kit component dependencies',
  'data360 data-kit component status',
  'data360 data-kit list',
  'data360 data-kit manifest',
  'data360 data-graph list',
  'data360 data-space list',
  'data360 data-stream get',
  'data360 data-stream list',
  'data360 dlo get',
  'data360 dlo list',
  'data360 docai describe',
  'data360 docai config list',
  'data360 doctor',
  'data360 identity-resolution list',
  'data360 metadata get',
  'data360 metadata list',
  'data360 retriever list',
  'data360 retriever get',
  'data360 retriever configuration list',
  'data360 search-index list',
  'data360 semantic model list',
  'data360 transform list',
]);
const LIVE_EXPLORATORY_TIMEOUT_MS = 120_000;

const commandId = (argv) => {
  const values = argv[0] === 'sf' ? argv.slice(1) : argv;
  const flag = values.findIndex((value) => value.startsWith('-'));
  return (flag < 0 ? values : values.slice(0, flag)).join(' ');
};

export const liveSuiteCommandGate = (session, tags, commands) => {
  if (session.mode !== 'live') return undefined;
  if (tags.some((tag) => ['mutation', 'destructive', 'billable'].includes(tag)))
    return 'Declarative live suites are read-only; use testbed live-verify for gated mutation or billable scenarios.';
  const unsafe = commands.map(({ argv }) => commandId(argv)).find((id) => !LIVE_READ_ONLY_COMMANDS.has(id));
  if (unsafe) return `Live suite command is not in the reviewed read-only allowlist: ${unsafe}`;
  return undefined;
};

const readResults = async (sessionDirectory) => {
  try {
    return JSON.parse(await readFile(join(sessionDirectory, 'results.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { suites: {} };
    throw error;
  }
};

const appendAssertion = async (sessionDirectory, session, details) =>
  appendEvent(sessionDirectory, session.sid, { type: 'assertion', ...details });

export const runSuite = async (sessionDirectory, suiteName, options = {}) => {
  const runLock = join(sessionDirectory, '.run.lock');
  try {
    await mkdir(runLock);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const age = await stat(runLock)
        .then(({ mtimeMs }) => Date.now() - mtimeMs)
        .catch(() => 0);
      if (age > 5 * 60_000) {
        await rm(runLock, { recursive: true, force: true });
        await mkdir(runLock);
      } else throw new Error('Another suite is already running in this session.');
    } else throw error;
  }
  let mock;
  try {
    const session = await readSession(sessionDirectory);
    if (session.endedAt) throw new Error('Cannot run a suite in an ended session.');
    const suite = await loadSuite(suiteName);
    if (suite.mode !== session.mode)
      throw new Error(`Suite ${suiteName} is ${suite.mode}, session is ${session.mode}.`);
    if (options.step && !suite.steps.some(({ id }) => id === options.step))
      throw new Error(`Suite ${suiteName} has no step ${options.step}.`);
    if (session.mode === 'mock') {
      await rm(join(runtimeDirectoryForSession(session.sid), 'home', '.sf', 'data360-token-cache.json'), {
        force: true,
      });
    }
    mock = session.mode === 'mock' ? await startMockServer(sessionDirectory, session) : undefined;
    const results = await readResults(sessionDirectory);
    results.suites[suiteName] ??= {};
    let failed = 0;
    let blocked = 0;
    for (const step of suite.steps) {
      if (options.step && step.id !== options.step) continue;
      if (options.resume && results.suites[suiteName][step.id]?.outcome === 'pass') continue;
      const tags = step.tags ?? [];
      const started = performance.now();
      const scenarioStart = await appendEvent(sessionDirectory, session.sid, {
        type: 'scenario.start',
        scenario: step.id,
        suite: suiteName,
        tags,
      });
      const gate = liveSuiteCommandGate(session, tags, step.commands);
      const commands = [];
      let outcome = gate ? 'blocked' : 'pass';
      if (gate) {
        blocked += 1;
        await appendEvent(sessionDirectory, session.sid, {
          type: 'note',
          taxonomy: 'question',
          severity: 'info',
          text: gate,
          evidence: [scenarioStart],
        });
      } else {
        for (const [commandIndex, command] of step.commands.entries()) {
          const execution = await executeCommand(sessionDirectory, session, command.argv, {
            stdin: command.stdin,
            env: command.env,
            mockUrl: mock?.address,
          });
          commands.push(execution);
          const checks = evaluateExpectations(command.expect, execution);
          const criterion = criterionFor(tags, suiteName, step.id);
          for (const check of checks) {
            await appendAssertion(sessionDirectory, session, {
              id: `${suiteName}/${step.id}/${commandIndex}/${check.name}`,
              criterion,
              pass: check.pass,
              expected: check.expected,
              actual: check.actual,
              evidence: [execution.execSequence, execution.resultSequence],
            });
          }
          if (command.httpExpect) {
            const events = await readEvents(sessionDirectory);
            const matching = events.filter(
              (event) =>
                event.type === 'http.request' &&
                event.root !== 'mock' &&
                event.seqRef === execution.execSequence &&
                event.url.includes(command.httpExpect.path) &&
                (!command.httpExpect.method || event.method === command.httpExpect.method)
            );
            const pass = matching.length === command.httpExpect.count;
            await appendAssertion(sessionDirectory, session, {
              id: `${suiteName}/${step.id}/${commandIndex}/httpExpect`,
              criterion,
              pass,
              expected: command.httpExpect,
              actual: { count: matching.length },
              evidence: [execution.execSequence, execution.resultSequence, ...matching.map(({ seq }) => seq)],
            });
            checks.push({ pass });
          }
          if (checks.some(({ pass }) => !pass)) outcome = 'fail';
          if (outcome === 'fail' && step.haltOnFail) break;
        }
        if (outcome === 'fail') failed += 1;
      }
      await appendEvent(sessionDirectory, session.sid, {
        type: 'scenario.end',
        scenario: step.id,
        suite: suiteName,
        outcome,
        durationMs: Math.max(0, performance.now() - started),
      });
      results.suites[suiteName][step.id] = {
        title: step.title,
        outcome,
        commands: commands.map(({ argv, exitCode, durationMs, execSequence, resultSequence }) => ({
          argv,
          exitCode,
          durationMs,
          evidence: [execSequence, resultSequence],
        })),
      };
      await writeJson(join(sessionDirectory, 'results.json'), results);
      if (outcome === 'fail' && step.haltOnFail) break;
    }
    await updateSession(sessionDirectory, (value) => ({
      ...value,
      suites: [...new Set([...(value.suites ?? []), suiteName])],
    }));
    return { suite: suiteName, failed, blocked, results: results.suites[suiteName] };
  } finally {
    await mock?.stop();
    await rm(runLock, { recursive: true, force: true });
  }
};

export const runExploratoryCommand = async (sessionDirectory, argv, options = {}) => {
  const session = await readSession(sessionDirectory);
  const gate = liveSuiteCommandGate(session, [], [{ argv }]);
  if (gate) throw new Error(gate);
  if (session.mode === 'mock') {
    await rm(join(runtimeDirectoryForSession(session.sid), 'home', '.sf', 'data360-token-cache.json'), {
      force: true,
    });
  }
  const mock = session.mode === 'mock' ? await startMockServer(sessionDirectory, session) : undefined;
  try {
    return await executeCommand(sessionDirectory, session, argv, {
      ...options,
      timeoutMs: options.timeoutMs ?? (session.mode === 'live' ? LIVE_EXPLORATORY_TIMEOUT_MS : undefined),
      mockUrl: mock?.address,
    });
  } finally {
    await mock?.stop();
  }
};
