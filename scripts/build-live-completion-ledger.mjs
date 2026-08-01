#!/usr/bin/env node

import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const completionSweepPendingCommands = [
  'data360 data-graph refresh',
  'data360 data-stream run',
  'data360 query hybrid',
  'data360 query vector',
  'data360 transform run',
];

const parseArgs = (argv) => {
  const options = {
    sessions: resolve(root, 'testbed', 'sessions'),
    output: resolve(root, '.tmp', 'live-completion-ledger.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--sessions') options.sessions = resolve(argv[++index] ?? '');
    else if (flag === '--output') options.output = resolve(argv[++index] ?? '');
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
};

const normalizeCommand = (command) =>
  typeof command === 'string' ? command.replaceAll(':', ' ').replaceAll(/\s+/gu, ' ').trim() : '';

const collectJsonFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsonFiles(path)));
    else if (entry.name.endsWith('.json')) files.push(path);
  }
  return files;
};

export const loadLatestInvocations = async (sessionsDirectory) => {
  const latest = new Map();
  const sessionEntries = await readdir(sessionsDirectory, { withFileTypes: true });
  for (const sessionEntry of sessionEntries) {
    if (!sessionEntry.isDirectory()) continue;
    const session = sessionEntry.name;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(resolve(sessionsDirectory, session, 'session.json'), 'utf8'));
    } catch {
      continue;
    }
    if (typeof manifest.endedAt !== 'string' || manifest.validation?.leakScanClean !== true) continue;
    const eventsPath = resolve(sessionsDirectory, session, 'events.jsonl');
    let events;
    try {
      events = (await readFile(eventsPath, 'utf8'))
        .split(/\r?\n/gu)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      continue;
    }
    const executions = new Map(
      events
        .filter(({ type, command, seq }) => type === 'command.exec' && command && Number.isInteger(seq))
        .map((event) => [event.seq, event])
    );
    const results = new Map(
      events
        .filter(({ type, seqRef }) => type === 'command.result' && Number.isInteger(seqRef))
        .map((event) => [event.seqRef, event])
    );
    for (const [sequence, execution] of executions) {
      const command = normalizeCommand(execution.command);
      const timestamp = execution.ts;
      if (!command || typeof timestamp !== 'string') continue;
      const prior = latest.get(command);
      const sessionSchemaValid = manifest.validation?.schemaValid === true;
      if (
        prior &&
        (prior.sessionSchemaValid === true
          ? !sessionSchemaValid || prior.timestamp >= timestamp
          : !sessionSchemaValid && prior.timestamp >= timestamp)
      )
        continue;
      const result = results.get(sequence);
      latest.set(command, {
        timestamp,
        date: timestamp.slice(0, 10),
        session,
        sequence,
        exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
        sessionSchemaValid,
      });
    }
  }
  return latest;
};

export const loadLatestErrorEvidence = async (fixturesDirectory) => {
  const latest = new Map();
  for (const path of await collectJsonFiles(fixturesDirectory)) {
    let fixture;
    try {
      fixture = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      continue;
    }
    const provenance = fixture?.__fixture;
    if (
      provenance?.source !== 'live-scrubbed' ||
      typeof provenance.command !== 'string' ||
      typeof provenance.recordedAt !== 'string'
    )
      continue;
    const evidence = {
      date: provenance.recordedAt,
      code:
        typeof fixture.name === 'string' && fixture.name
          ? fixture.name
          : typeof fixture.code === 'string' && fixture.code
            ? fixture.code
            : null,
    };
    const prior = latest.get(provenance.command);
    if (!prior || prior.date <= evidence.date) latest.set(provenance.command, evidence);
  }
  return latest;
};

const blockerCategory = (code) => {
  if (['D360_NAME_NOT_FOUND', 'D360_NOT_FOUND'].includes(code)) return 'missing_disposable_dependency';
  if (code === 'D360_INVALID_DEFINITION') return 'invalid_definition_contract';
  if (code === 'D360_UNSUPPORTED_OP') return 'platform_unsupported_operation';
  if (code === 'D360_LIVE_TIMEOUT') return 'platform_timeout';
  if (code === 'D360_TOKEN_EXCHANGE_FAILED') return 'org_auth_scope';
  if (code === 'D360_CONFIRMATION_REQUIRED') return 'confirmation_contract';
  if (code === 'D360_NAME_AMBIGUOUS') return 'ambiguous_org_resource';
  if (code === 'D360_API_ERROR') return 'platform_or_org_prerequisite';
  return 'expected_error_or_org_prerequisite';
};

export const buildCompletionLedger = ({
  inventory,
  verification,
  invocations,
  errorEvidence,
  pendingCommands = completionSweepPendingCommands,
  generatedAt = new Date().toISOString(),
}) => {
  const liveByCommand = new Map(verification.map(({ command, live }) => [command, live]));
  const pending = new Set(pendingCommands);
  const commands = inventory.map(({ id: command }) => {
    const invocation = invocations.get(command);
    const live = liveByCommand.get(command) ?? null;
    const latestInvocation = invocation
      ? {
          date: invocation.date,
          session: invocation.session,
          sequence: invocation.sequence,
          exitCode: invocation.exitCode,
          sessionSchemaValid: invocation.sessionSchemaValid,
        }
      : undefined;
    if (pending.has(command)) {
      if (live && invocation && live > invocation.date) {
        return {
          command,
          state: 'live_success',
          evidenceDate: live,
          blockerCategory: null,
          ...(latestInvocation ? { latestInvocation } : {}),
        };
      }
      if (invocation?.exitCode === 0) {
        return {
          command,
          state: 'live_success',
          evidenceDate: invocation.date,
          blockerCategory: null,
          latestInvocation,
        };
      }
      if (invocation) {
        const error = errorEvidence.get(command);
        return {
          command,
          state: 'live_failure',
          evidenceDate: invocation.date,
          blockerCategory: error?.code ? blockerCategory(error.code) : 'action_outcome_unknown',
          ...(error?.code ? { contractCode: error.code } : {}),
          ...(live ? { priorLiveSuccessDate: live } : {}),
          latestInvocation,
        };
      }
      return {
        command,
        state: 'credit_gated',
        evidenceDate: null,
        blockerCategory: 'explicit_credit_approval',
        ...(live ? { priorLiveSuccessDate: live } : {}),
      };
    }
    if (live) {
      return {
        command,
        state: 'live_success',
        evidenceDate: live,
        blockerCategory: null,
        ...(latestInvocation ? { latestInvocation } : {}),
      };
    }
    if (invocation) {
      const error = errorEvidence.get(command);
      return {
        command,
        state: 'contract_observed',
        evidenceDate: invocation.date,
        blockerCategory: blockerCategory(error?.code),
        ...(error?.code ? { contractCode: error.code } : {}),
        latestInvocation,
      };
    }
    return {
      command,
      state: 'not_invoked',
      evidenceDate: null,
      blockerCategory: 'missing_live_trace',
    };
  });
  const count = (state) => commands.filter((entry) => entry.state === state).length;
  return {
    version: 2,
    generatedAt,
    scope: 'authorized non-production org evidence; org identifiers omitted',
    summary: {
      inventory: commands.length,
      invoked: commands.filter(({ state }) => state !== 'credit_gated' && state !== 'not_invoked').length,
      liveSuccess: count('live_success'),
      liveFailure: count('live_failure'),
      contractObserved: count('contract_observed'),
      creditGated: count('credit_gated'),
      notInvoked: count('not_invoked'),
      unvalidatedTraceObservations: commands.filter(
        ({ state, latestInvocation }) =>
          ['contract_observed', 'live_failure'].includes(state) && latestInvocation?.sessionSchemaValid === false
      ).length,
    },
    commands,
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const inventory = JSON.parse(await readFile(resolve(root, 'command-snapshot.json'), 'utf8')).commands;
  const verification = JSON.parse(await readFile(resolve(root, 'test', 'verification.json'), 'utf8'));
  const invocations = await loadLatestInvocations(options.sessions);
  const errorEvidence = await loadLatestErrorEvidence(resolve(root, 'test', 'fixtures', 'live'));
  const ledger = buildCompletionLedger({ inventory, verification, invocations, errorEvidence });
  if (ledger.summary.notInvoked !== 0)
    throw new Error(`Completion ledger has ${ledger.summary.notInvoked} unclassified commands`);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(ledger, undefined, 2)}\n`, { mode: 0o600 });
  await chmod(options.output, 0o600);
  process.stdout.write(
    `Wrote sanitized live completion ledger: ${options.output}\n${JSON.stringify(ledger.summary)}\n`
  );
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
