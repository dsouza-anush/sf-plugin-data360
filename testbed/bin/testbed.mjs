#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { appendEvent, assertEvidenceSequences, closeOpenTraceEvents, eventsPath, readEvents } from '../lib/trace.mjs';
import { redactString } from '../lib/redactor.mjs';
import {
  assertLiveSessionOrg,
  currentSessionDirectory,
  endSession,
  readSession,
  startSession,
  updateSession,
  repositoryRoot,
} from '../lib/session.mjs';
import { runExploratoryCommand, runSuite } from '../lib/runner.mjs';
import { validateSessionDirectory } from '../lib/schemas.mjs';
import { generateReport } from '../lib/report.mjs';

const [command, ...argv] = process.argv.slice(2);

const value = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const has = (name) => argv.includes(name);

const active = async () => currentSessionDirectory();

const main = async () => {
  if (command === 'start') {
    const mode = value('--mode');
    const result = await startSession({
      agent: value('--agent'),
      model: value('--model'),
      mode,
      org: value('--org', process.env.D360_LIVE_ORG),
      label: value('--label'),
      force: has('--force'),
    });
    process.stdout.write(`${result.sessionDirectory}\n`);
    return;
  }
  if (command === 'run') {
    const suite = value('--suite');
    if (!suite) throw new Error('run requires --suite <name>');
    const result = await runSuite(await active(), suite, {
      step: value('--step'),
      resume: has('--resume'),
    });
    process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
    if (result.failed > 0) process.exitCode = 1;
    return;
  }
  if (command === 'exec') {
    const separator = argv.indexOf('--');
    const commandArgv = separator >= 0 ? argv.slice(separator + 1) : argv;
    const result = await runExploratoryCommand(await active(), commandArgv);
    process.stdout.write(redactString(result.stdout));
    process.stderr.write(redactString(result.stderr));
    process.exitCode = result.exitCode;
    return;
  }
  if (command === 'note') {
    const directory = await active();
    const session = await readSession(directory);
    const evidence = String(value('--evidence', ''))
      .split(',')
      .filter(Boolean)
      .map((entry) => Number.parseInt(entry, 10));
    if (evidence.length === 0) throw new Error('note requires --evidence with at least one event seq');
    if (evidence.some((entry) => !Number.isInteger(entry) || entry < 0))
      throw new Error('--evidence must be seq integers');
    assertEvidenceSequences(await readEvents(directory), evidence);
    const taxonomy = value('--taxonomy');
    const severity = value('--severity');
    const text = value('--text');
    if (!taxonomy || !severity || !text) throw new Error('note requires --taxonomy, --severity, and --text');
    const taxonomies = ['suspected-bug', 'suspected-misuse', 'docs-gap', 'dx-friction', 'question'];
    const severities = ['info', 'minor', 'major'];
    if (!taxonomies.includes(taxonomy)) throw new Error(`--taxonomy must be one of: ${taxonomies.join(', ')}`);
    if (!severities.includes(severity)) throw new Error(`--severity must be one of: ${severities.join(', ')}`);
    const seq = await appendEvent(directory, session.sid, {
      type: 'note',
      taxonomy,
      severity,
      text,
      evidence,
    });
    process.stdout.write(`${seq}\n`);
    return;
  }
  if (command === 'end') {
    const result = await endSession(await active());
    process.stdout.write(`${JSON.stringify(result.session.totals, undefined, 2)}\n`);
    return;
  }
  if (command === 'validate') {
    const directory = argv[0] ? resolve(argv[0]) : await active();
    const result = await validateSessionDirectory(directory);
    if (!result.valid) throw new Error(result.errors.join('; '));
    process.stdout.write(`PASS ${directory}\n`);
    return;
  }
  if (command === 'report') {
    const result = await generateReport({
      sessions: value('--sessions'),
      since: value('--since'),
      format: value('--format', 'md'),
      outputDirectory: value('--output-dir'),
    });
    process.stdout.write(`${result.paths.join('\n')}\n`);
    return;
  }
  if (command === 'live-verify') {
    const directory = await active();
    const session = await readSession(directory);
    if (session.mode !== 'live') throw new Error('live-verify requires an active live-mode session.');
    const separator = argv.indexOf('--');
    const forwarded = separator >= 0 ? argv.slice(separator + 1) : argv;
    const { parseArgs: parseLiveVerifyArgs } = await import('../../scripts/live-verify-all.mjs');
    const liveOptions = parseLiveVerifyArgs(forwarded);
    assertLiveSessionOrg(session, liveOptions.org);
    const safetyTags = [
      liveOptions.readOnly ? 'read-only' : 'mutation',
      ...(liveOptions.billable ? ['billable'] : []),
      ...(liveOptions.scenario ? [`scenario:${liveOptions.scenario}`] : []),
    ];
    const startedAt = performance.now();
    const startSequence = await appendEvent(directory, session.sid, {
      type: 'scenario.start',
      scenario: 'live-verify-all',
      suite: 'live-verify',
      tags: ['live', ...safetyTags],
    });
    const exitCode = await new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [resolve(repositoryRoot, 'scripts', 'live-verify-all.mjs'), ...forwarded], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          SF_DATA360_TRACE: eventsPath(directory),
          SF_DATA360_TRACE_ID: session.sid,
        },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('close', (code) => resolvePromise(code ?? 1));
    });
    await closeOpenTraceEvents(directory, session.sid, {
      afterSequence: startSequence,
      exitCode,
      durationMs: Math.max(0, performance.now() - startedAt),
      timedOut: exitCode !== 0,
    });
    await appendEvent(directory, session.sid, {
      type: 'scenario.end',
      scenario: 'live-verify-all',
      suite: 'live-verify',
      outcome: exitCode === 0 ? 'pass' : 'fail',
      durationMs: Math.max(0, performance.now() - startedAt),
      evidence: [startSequence],
    });
    await updateSession(directory, (value) => ({
      ...value,
      suites: [...new Set([...(value.suites ?? []), 'live-verify'])],
    }));
    process.exitCode = exitCode;
    return;
  }
  throw new Error('Usage: testbed <start|run|exec|note|end|validate|report|live-verify>');
};

main().catch((error) => {
  process.stderr.write(`ERROR ${error.message}\n`);
  process.exitCode = 1;
});
