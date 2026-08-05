#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  argsForFoundationStep,
  buildFoundationPlan,
  cleanupResourceKey,
  createFoundationPrefix,
  externalFoundationInputs,
  orgForFoundationStep,
  parseFoundationOptions,
  runFoundationScenario,
  writeFoundationDefinitions,
} from './live-scenarios/foundation.mjs';
import {
  argsForP4Step,
  buildP4MatchedDmoDefinition,
  buildP4Plan,
  createP4Prefix,
  isP4CleanupVerifiable,
  isVerifiedAbsent,
  matchesP4ExpectedError,
  p4ExternalInputs,
  parseP4Options,
  runP4Scenario,
  selectP4MappingField,
  selectP4ResourceKey,
  shouldRecordP4Fixture,
  writeP4Definitions,
} from './live-scenarios/p4.mjs';
import {
  argsForP4StreamStep,
  buildP4StreamPlan,
  createP4StreamPrefix,
  hasExactResourceName,
  p4StreamNames,
  selectExactConnectionKey,
  selectExactStreamKey,
  writeP4StreamDefinitions,
} from './live-scenarios/p4-stream.mjs';
import {
  argsForP5Step,
  buildP5ContractProbePlan,
  buildP5IdentityCloneDefinition,
  buildP5Plan,
  createP5Prefix,
  deriveProfileLookup,
  executeP5Bounded,
  extractP5Identity,
  isP5CreateCollision,
  isP5RemoteAbsent,
  matchesP5ExpectedError,
  p5DataKitComponentDefinitions,
  p5CleanupKey,
  pendingQueryRequiredBlocker,
  parseP5Options,
  proveP5NameAvailable,
  runP5Scenario,
  selectP5DataKitComponent,
  selectReadySearchIndex,
  verifyP5Cleanup,
  writeP5Definitions,
} from './live-scenarios/p5.mjs';
import {
  argsForP6Step,
  buildP6Plan,
  classifyP6Evidence,
  createP6Prefix,
  p6DependencyBlocker,
  p6LedgerStatus,
  p6TtyChecklist,
  parseP6Options,
  runP6Scenario,
} from './live-scenarios/p6.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keep this aligned with src/shared/redact.ts. This copy is required because the
// live orchestrator runs before TypeScript build artifacts necessarily exist.
const secretKeys =
  /^(?:access_?token|authorization|bearer|client_?secret|consumer_?key|cookie|core_?token|id_?token|jwt|password|api_?key|private_?key|refresh_?token|secret|session|sid|subject_?token|token)$/iu;
const supportIdentifierKeys = /^(?:correlation|request|trace)(?:_|-)?id$|^x-client-trace-id$/iu;
const mutationKinds = new Set(['create', 'update', 'delete', 'action', 'job']);
const creditCommands = new Set([
  'data360 ingest',
  'data360 ingest bulk',
  'data360 ingest delete',
  'data360 query',
  'data360 query hybrid',
  'data360 query vector',
  'data360 segment publish',
  'data360 identity-resolution run',
  'data360 transform run',
  'data360 calculated-insight run',
  'data360 data-stream run',
  'data360 data-graph refresh',
]);
const sharedResourceBillableCommands = new Set([
  'data360 data-graph refresh',
  'data360 data-stream run',
  'data360 query hybrid',
  'data360 query vector',
  'data360 transform run',
]);
const safeStandalone = new Set([
  'data360 api request',
  'data360 doctor',
  'data360 metadata list',
  'data360 connection list',
  'data360 connector list',
  'data360 dlo list',
  'data360 dmo list',
  'data360 mapping list',
  'data360 data-stream list',
  'data360 transform list',
  'data360 data-space list',
  'data360 identity-resolution list',
  'data360 calculated-insight list',
  'data360 segment list',
  'data360 activation list',
  'data360 activation platforms',
  'data360 activation-target list',
  'data360 search-index list',
  'data360 data-graph list',
  'data360 profile describe',
  'data360 retriever list',
  'data360 docai describe',
  'data360 open',
  'data360 token display',
]);
const listDependency = new Map([
  ['data360 activation results', 'data360 activation list'],
  ['data360 metadata get', 'data360 metadata list'],
  ['data360 connection get', 'data360 connection list'],
  ['data360 connection describe', 'data360 connection list'],
  ['data360 connection validate', 'data360 connection list'],
  ['data360 connector get', 'data360 connector list'],
  ['data360 dlo get', 'data360 dlo list'],
  ['data360 dmo get', 'data360 dmo list'],
  ['data360 dmo relationship list', 'data360 dmo list'],
  ['data360 mapping list', 'data360 dmo list'],
  ['data360 mapping get', 'data360 mapping list'],
  ['data360 data-stream get', 'data360 data-stream list'],
  ['data360 data-stream run', 'data360 data-stream list'],
  ['data360 transform get', 'data360 transform list'],
  ['data360 transform report', 'data360 transform list'],
  ['data360 transform run', 'data360 transform list'],
  ['data360 transform schedule display', 'data360 transform list'],
  ['data360 transform validate', 'data360 transform list'],
  ['data360 data-space get', 'data360 data-space list'],
  ['data360 data-space member list', 'data360 data-space list'],
  ['data360 identity-resolution get', 'data360 identity-resolution list'],
  ['data360 calculated-insight get', 'data360 calculated-insight list'],
  ['data360 segment get', 'data360 segment list'],
  ['data360 activation get', 'data360 activation list'],
  ['data360 activation-target get', 'data360 activation-target list'],
  ['data360 search-index get', 'data360 search-index list'],
  ['data360 search-index describe', 'data360 search-index list'],
  ['data360 query hybrid', 'data360 search-index list'],
  ['data360 query vector', 'data360 search-index list'],
  ['data360 data-graph get', 'data360 data-graph list'],
  ['data360 data-graph refresh', 'data360 data-graph list'],
  ['data360 retriever get', 'data360 retriever list'],
  ['data360 retriever configuration list', 'data360 retriever list'],
]);

const phaseFor = (command) => {
  if (/^data360 (?:query(?: |$)|metadata |doctor$|open$|api request$)/u.test(command)) return 'p1';
  if (/^data360 token /u.test(command)) return 'p2';
  if (/^data360 ingest(?: |$)/u.test(command)) return 'p3';
  if (/^data360 (?:connection|connector|dlo|dmo|mapping|data-stream|transform|data-space)(?: |$)/u.test(command))
    return 'p4';
  if (/^data360 (?:retriever|docai)(?: |$)/u.test(command)) return 'p6';
  return 'p5';
};

const kindFor = (command) => {
  const leaf = command.split(' ').at(-1);
  if (leaf === 'create') return 'create';
  if (['update', 'set'].includes(leaf)) return 'update';
  if (['delete', 'cancel', 'deactivate', 'undeploy', 'generate-key'].includes(leaf)) return 'delete';
  if (command === 'data360 query' || command === 'data360 ingest' || ['bulk', 'vector', 'hybrid'].includes(leaf))
    return 'job';
  if (['run', 'publish', 'refresh', 'retry', 'deploy', 'validate'].includes(leaf)) return 'action';
  if (
    ['list', 'get', 'describe', 'display', 'results', 'report', 'lookup', 'platforms', 'query'].includes(leaf) ||
    ['data360 doctor', 'data360 open', 'data360 api request', 'data360 token display'].includes(command)
  )
    return 'read';
  return 'read';
};

const cleanupFor = (command, kind, inventory) => {
  if (!mutationKinds.has(kind)) return null;
  const parent = command.split(' ').slice(0, -1).join(' ');
  if (kind === 'create' && inventory.has(`${parent} delete`))
    return `${parent} delete --name <created-name> --no-prompt`;
  if (kind === 'update') return `restore ${parent} from the pre-update definition`;
  if (kind === 'delete') return `recreate ${parent} from the pre-delete definition`;
  return `remove disposable dependencies created for ${command}`;
};

export const buildPlan = async (repositoryRoot = root) => {
  const snapshot = JSON.parse(await readFile(resolve(repositoryRoot, 'command-snapshot.json'), 'utf8'));
  const inventory = new Set(snapshot.commands.map(({ id }) => id));
  return snapshot.commands.map(({ id }) => {
    const kind = kindFor(id);
    const schema = `schemas/${id.replaceAll(' ', '.')}.json`;
    return {
      command: id,
      kind,
      phase: phaseFor(id),
      args: [],
      expectedSchema: id === 'data360 api request' ? null : schema,
      dependencies: listDependency.has(id) ? [listDependency.get(id)] : [],
      cleanup: cleanupFor(id, kind, inventory),
      credit: creditCommands.has(id),
    };
  });
};

export const parseArgs = (argv) => {
  const options = {
    org: '',
    phase: 'all',
    readOnly: true,
    mutations: false,
    billable: false,
    billableCommands: [],
    sharedData: false,
    resume: false,
    retryFailed: false,
    retryBlocked: false,
    cleanup: false,
    scenario: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--org') options.org = argv[++index] ?? '';
    else if (flag === '--phase') options.phase = (argv[++index] ?? '').toLowerCase();
    else if (flag === '--read-only') options.readOnly = true;
    else if (flag === '--mutations') {
      options.mutations = true;
      options.readOnly = false;
    } else if (flag === '--billable') options.billable = true;
    else if (flag === '--billable-command') {
      const command = argv[++index]?.trim();
      if (!command) throw new Error('--billable-command requires a command ID');
      options.billableCommands.push(command);
    } else if (flag === '--resume') options.resume = true;
    else if (flag === '--retry-failed') options.retryFailed = true;
    else if (flag === '--retry-blocked') options.retryBlocked = true;
    else if (flag === '--cleanup') options.cleanup = true;
    else if (flag === '--scenario') options.scenario = argv[++index] ?? '';
    else throw new Error(`Unknown option: ${flag}`);
  }
  options.org ||= process.env.D360_LIVE_ORG ?? '';
  if (!options.org) {
    throw new Error(options.scenario ? '--org or D360_LIVE_ORG is required' : '--org is required');
  }
  if (options.scenario && !['foundation', 'p4', 'p4-stream', 'p5', 'p6'].includes(options.scenario))
    throw new Error('--scenario must be foundation, p4, p4-stream, p5, or p6');
  if (options.scenario === 'foundation') {
    parseFoundationOptions(process.env);
    options.mutations = true;
    options.billable = true;
    options.readOnly = false;
  }
  if (options.scenario === 'p4' || options.scenario === 'p4-stream') {
    parseP4Options(process.env);
    options.mutations = true;
    options.billable = false;
    options.readOnly = false;
  }
  if (options.scenario === 'p5') {
    Object.assign(options, parseP5Options(process.env, { cleanupOnly: options.cleanup }), { readOnly: false });
  }
  if (options.scenario === 'p6') {
    Object.assign(options, parseP6Options(process.env));
  }
  options.billableCommands = [...new Set(options.billableCommands)];
  if (options.billableCommands.length > 0 && options.scenario)
    throw new Error('--billable-command cannot be combined with --scenario');
  if (options.billableCommands.length > 0 && !options.billable)
    throw new Error('--billable-command requires --billable');
  const invalidBillableCommands = options.billableCommands.filter((command) => !creditCommands.has(command));
  if (invalidBillableCommands.length > 0)
    throw new Error(
      `--billable-command must name a known credit-bearing command: ${invalidBillableCommands.join(', ')}`
    );
  if (options.billable && !options.scenario && options.billableCommands.length === 0)
    throw new Error('--billable requires at least one explicit --billable-command');
  if (options.billableCommands.length > 0 && !options.mutations)
    throw new Error('billable command execution also requires --mutations');
  if (!['all', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'].includes(options.phase))
    throw new Error('--phase must be all or p1..p6');
  const commandsOutsidePhase = options.billableCommands.filter(
    (command) => options.phase !== 'all' && phaseFor(command) !== options.phase
  );
  if (commandsOutsidePhase.length > 0)
    throw new Error(
      `selected billable command is outside --phase ${options.phase}: ${commandsOutsidePhase.join(', ')}`
    );
  if (options.mutations && process.env.D360_LIVE_MUTATIONS !== '1')
    throw new Error('--mutations requires D360_LIVE_MUTATIONS=1');
  if (options.billable && process.env.D360_LIVE_BILLABLE !== '1')
    throw new Error('--billable requires D360_LIVE_BILLABLE=1');
  if (
    options.billableCommands.some((command) => sharedResourceBillableCommands.has(command)) &&
    process.env.D360_LIVE_SHARED_DATA !== '1'
  )
    throw new Error('selected billable command requires D360_LIVE_SHARED_DATA=1');
  options.sharedData = process.env.D360_LIVE_SHARED_DATA === '1';
  return options;
};

export const spawnCapture = async (command, args, options = {}) =>
  new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? root, env: options.env ?? process.env, stdio: 'pipe' });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let forceKill;
    const timeout =
      options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            forceKill = setTimeout(() => child.kill('SIGKILL'), 2_000);
          }, options.timeoutMs)
        : undefined;
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      if (timeout) clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      done({ exitCode: exitCode ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), timedOut });
    });
  });

export const validateTargetOrg = async (org, runner = async (command, args) => spawnCapture(command, args)) => {
  const result = await runner('sf', ['org', 'display', '--target-org', org, '--json']);
  if (result.exitCode !== 0) throw new Error(`Unknown or inaccessible org: ${org}`);
};

export const redactSecrets = (value) => {
  if (typeof value === 'string') {
    const scrubbed = scrubString(value);
    try {
      const nested = JSON.parse(scrubbed);
      if (nested && typeof nested === 'object') return JSON.stringify(redactSecrets(nested));
    } catch {}
    return scrubbed;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !secretKeys.test(key) && !supportIdentifierKeys.test(key))
      .map(([key, entry]) => [key, redactSecrets(entry)])
  );
};

export const summarizeLiveResults = (results = {}) =>
  Object.fromEntries(
    Object.entries(results).map(([id, result]) => [
      id,
      {
        status: result?.status,
        ...(result?.reason ? { reason: result.reason } : {}),
        ...(result?.evidence
          ? {
              schemaValid: result.evidence.schemaValid === true,
              ...(result.evidence.fixture ? { fixture: result.evidence.fixture } : {}),
            }
          : {}),
      },
    ])
  );

export const serializeLiveSummary = (value, org = '') => {
  let serialized = JSON.stringify(scrubFixture(redactSecrets(value), '', false), undefined, 2);
  if (org) serialized = serialized.replaceAll(org, '[REDACTED_ORG]');
  return `${serialized}\n`;
};

const stateReference = (path, org) => path.replace(`${root}/`, '').replaceAll(org, '[REDACTED_ORG]');
const writeLiveSummary = (value, org) => process.stdout.write(serializeLiveSummary(value, org));

export const writeState = async (path, state) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(scrubFixture(redactSecrets(state)), undefined, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
};

export const executePlan = async (plan, state, options, runner) => {
  state.results ??= {};
  for (const entry of plan) {
    const priorStatus = state.results[entry.command]?.status;
    if (
      options.resume &&
      priorStatus &&
      (priorStatus === 'passed' ||
        (priorStatus === 'failed' && !options.retryFailed) ||
        (priorStatus === 'blocked' && !options.retryBlocked) ||
        priorStatus === 'skipped')
    )
      continue;
    if (options.beforeRun) {
      const shouldRun = await options.beforeRun(entry, state);
      if (options.onProgress) await options.onProgress(state);
      if (shouldRun === false) continue;
    }
    const attemptCount = state.results[entry.command]?.attemptCount;
    const result = await runner(entry);
    state.results[entry.command] = { ...result, ...(attemptCount ? { attemptCount } : {}) };
    if (options.onProgress) await options.onProgress(state);
  }
  return state;
};

export const applySuccessfulVerification = (rows, results, date) => {
  const verified = new Set(
    results.filter(({ status, schemaValid }) => status === 'passed' && schemaValid).map(({ command }) => command)
  );
  return rows.map((row) => (verified.has(row.command) ? { ...row, live: date } : row));
};

export const prepareBillableAttempt = (entry, state) => {
  if (!entry.credit) return true;
  const prior = state.results[entry.command];
  if ((prior?.attemptCount ?? 0) >= 1) {
    state.results[entry.command] = {
      ...prior,
      status: prior?.status === 'passed' ? 'passed' : 'blocked',
      schemaValid: prior?.schemaValid === true,
      reason: 'one-attempt billable cap reached; a new approval and new ledger are required to retry',
    };
    return false;
  }
  state.results[entry.command] = {
    status: 'attempting',
    schemaValid: false,
    attemptCount: 1,
    reason: 'billable request dispatch recorded before execution',
  };
  return true;
};

const neutralResultStatuses = new Set(['passed', 'blocked', 'skipped']);
const resolvedCleanupStatuses = new Set(['passed', 'not-owned', 'skipped']);

export const liveRunRequiresFailureExit = (state, { ignoreResultFailures = false, additionalFailure = false } = {}) => {
  const results = state?.results;
  const unsafeResult =
    !results ||
    typeof results !== 'object' ||
    Array.isArray(results) ||
    Object.values(results).some((result) => {
      const status = result?.status;
      if (status === 'failed') return !ignoreResultFailures;
      return !neutralResultStatuses.has(status);
    });
  const unsafeCleanup = ['cleanupStack', 'cleanup'].some((key) => {
    const entries = state?.[key];
    if (entries === undefined) return false;
    if (!Array.isArray(entries)) return true;
    return entries.some((entry) => !resolvedCleanupStatuses.has(entry?.status));
  });
  return Boolean(additionalFailure || unsafeResult || unsafeCleanup);
};

export const scrubString = (value) =>
  value
    .replace(/([?&](?:sid|otp)=)[^&"'\s]+/giu, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z\d._~+/=-]+/giu, '$1 [REDACTED]')
    .replace(/\b[A-Za-z\d_-]{10,}\.[A-Za-z\d_-]{10,}\.[A-Za-z\d_-]{10,}\b/gu, '[REDACTED]')
    .replace(/\b00D[A-Za-z0-9]{8,}![A-Za-z0-9._~+/=-]{8,}\b/gu, '[REDACTED]')
    .replace(/\b00D[A-Za-z0-9]{12,15}%21[A-Za-z0-9._~+%/=-]{8,}\b/gu, '[REDACTED]')
    .replace(/(?<![A-Za-z0-9])00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?(?![A-Za-z0-9])/gu, 'LIVE_ID_ORG')
    .replace(/\ba360\/(?:prod|test)\/[a-f0-9]{16,}\b/giu, 'a360/[REDACTED_TENANT]')
    .replace(/ErrorId(?: if you contact support)?:?\s+[0-9-]+(?:\s+\([0-9-]+\))?/giu, 'ErrorId LIVE_ERROR_ID')
    .replace(/\b((?:correlation|request|trace)(?:[-_ ]?id)?\s*[:=]\s*)[a-f0-9-]{8,}\b/giu, '$1[REDACTED]')
    .replace(/\b(?:[a-z0-9-]+\.)*c360a\.salesforce\.com\b/giu, 'mock.c360a.example')
    .replace(
      /\b(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:cloudforce\.com|documentforce\.com|my\.salesforce\.com|my\.site\.com|salesforce-experience\.com|salesforce-hyperforce\.com|salesforce-sites\.com|salesforce-setup\.com|visualforce\.com)|(?:[a-z0-9-]+\.)+force\.com|[a-z]{2,5}\d{1,4}[a-z]?\.salesforce\.com)\b/giu,
      'mock.salesforce.example'
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, 'user@example.invalid')
    .replace(
      /\b(authorization|cookie|password|client_?secret|consumer_?key|api_?key|private_?key|session|sid|jwt|token)\s*["']?\s*[:=]\s*["']?([^\s,"';&}]+)/giu,
      '$1=[REDACTED]'
    );

const scrubCapturedText = (value) => {
  const scrubbed = scrubString(value);
  try {
    return `${JSON.stringify(redactSecrets(JSON.parse(scrubbed)), undefined, 2)}\n`;
  } catch {
    return scrubbed;
  }
};

const isSalesforce18 = (value) => {
  if (!/^[a-zA-Z0-9]{18}$/u.test(value)) return false;
  const suffix = [...Array(3).keys()]
    .map((chunk) => {
      let flags = 0;
      for (let index = 0; index < 5; index += 1) {
        const character = value[chunk * 5 + index];
        if (character >= 'A' && character <= 'Z') flags += 1 << index;
      }
      return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[flags];
    })
    .join('');
  return value.slice(15) === suffix;
};

const isSalesforce15 = (value) =>
  /^[a-zA-Z0-9]{15}$/u.test(value) && /[a-z]/u.test(value) && /[A-Z]/u.test(value) && /[0-9]/u.test(value);

export const scrubFixture = (value, key = '', hashOpaqueIdFields = true) => {
  if (typeof value === 'string') {
    const scrubbed = scrubString(value)
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
        (id) => `LIVE_UUID_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`
      )
      .replace(/(?<![a-zA-Z0-9])(?:[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})(?![a-zA-Z0-9])/gu, (id) =>
        isSalesforce15(id) || isSalesforce18(id)
          ? `LIVE_ID_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`
          : id
      );
    if (
      (hashOpaqueIdFields && (/(?:^|_)id(?:__c|_c)?$/iu.test(key) || /id(?:__c|_c)?$/iu.test(key))) ||
      isSalesforce18(value)
    )
      return `LIVE_ID_${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
    return scrubbed;
  }
  if (Array.isArray(value)) return value.map((entry) => scrubFixture(entry, key, hashOpaqueIdFields));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !secretKeys.test(key) && !supportIdentifierKeys.test(key))
      .map(([entryKey, entry]) => [entryKey, scrubFixture(entry, entryKey, hashOpaqueIdFields)])
  );
};

const fixtureSlug = (command) => command.replace(/^data360 /u, '').replaceAll(' ', '-');

const rowBearingCommands = new Set([
  'data360 query',
  'data360 query hybrid',
  'data360 query results',
  'data360 query resume',
  'data360 query vector',
]);
const itemBearingCommands = new Set([
  'data360 activation results',
  'data360 calculated-insight query',
  'data360 data-graph query',
  'data360 profile get',
  'data360 profile lookup',
]);

const publicEvidenceRedactedKeys =
  /^(?:apiName|commandName|context|dataGraphName|description|detail|developerName|devName|displayName|endpoint|label|message|name|objectName|retrieverName|sourceName|warnings)$/u;
const PUBLIC_EVIDENCE_ARRAY_LIMIT = 3;

const minimizePublicEvidenceValue = (value, key = '') => {
  if (typeof value === 'string') {
    if (publicEvidenceRedactedKeys.test(key)) return '[REDACTED]';
    return value;
  }
  if (Array.isArray(value))
    return value.slice(0, PUBLIC_EVIDENCE_ARRAY_LIMIT).map((entry) => minimizePublicEvidenceValue(entry, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [entryKey, minimizePublicEvidenceValue(entry, entryKey)])
  );
};

export const minimizeLiveFixturePayload = (command, payload) => {
  const minimized = structuredClone(payload);
  if (rowBearingCommands.has(command) && minimized?.result && typeof minimized.result === 'object') {
    delete minimized.result.rows;
    delete minimized.result.columns;
  }
  if (itemBearingCommands.has(command) && minimized?.result && typeof minimized.result === 'object') {
    minimized.result.item = { redacted: true };
  }
  return minimizePublicEvidenceValue(minimized);
};

export const recordFixture = async (command, payload, date) => {
  const relativeFile = `live/${fixtureSlug(command)}.json`;
  const path = resolve(root, 'test', 'fixtures', relativeFile);
  const scrubbed = scrubFixture(redactSecrets(minimizeLiveFixturePayload(command, payload)));
  if (/^data360 query(?: |$)/u.test(command) && typeof scrubbed?.result?.queryId === 'string') {
    scrubbed.result.queryId = `LIVE_ID_QUERY_${date.replaceAll('-', '')}`;
  }
  const fixture = {
    __fixture: { source: 'live-scrubbed', recordedAt: date, command, outcome: 'success' },
    ...scrubbed,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(fixture, undefined, 2)}\n`);

  const metadata = JSON.parse(await readFile(resolve(root, 'test', 'command-metadata.json'), 'utf8'));
  const wire = metadata[command]?.wire;
  // Optional-path metadata describes several distinct routes. Without the concrete
  // request URL, attaching live evidence to one of those routes would be a guess.
  if (wire && !wire.path.includes('[')) {
    const manifestPath = resolve(root, 'test', 'fixtures', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const suffix = wire.path.replaceAll(/\{[^}]+\}/gu, ':');
    const route = manifest.find(
      (entry) =>
        entry.method === wire.method &&
        entry.path.replaceAll(/:[^/]+/gu, ':').endsWith(suffix.replaceAll(/:[^/]+/gu, ':'))
    );
    if (route) {
      route.liveEvidence ??= [];
      route.liveEvidence = route.liveEvidence.filter((entry) => entry.command !== command);
      route.liveEvidence.push({ command, recordedAt: date, file: relativeFile });
      await writeFile(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`);
    }
  }
  return relativeFile;
};

const schemaValidator = async (schemaPath, payload) => {
  if (!schemaPath) return true;
  try {
    await access(resolve(root, schemaPath));
    const schema = JSON.parse(await readFile(resolve(root, schemaPath), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    return ajv.validate(schema, payload);
  } catch {
    return false;
  }
};

const schemaForCommand = async (command) => {
  const plan = await buildPlan(root);
  return plan.find((entry) => entry.command === command)?.expectedSchema ?? null;
};

const outputItems = (payload) => {
  const result = payload?.result;
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  for (const key of ['items', 'entities', 'dataSpaces', 'records', 'results', 'retrievers', 'configurations']) {
    if (Array.isArray(result[key])) return result[key];
  }
  for (const value of Object.values(result)) if (Array.isArray(value)) return value;
  return [];
};

const dependencyFields = new Map([
  ['data360 activation results', ['id', 'developerName', 'name']],
  ['data360 activation get', ['id', 'developerName', 'name']],
  ['data360 activation-target get', ['id', 'developerName', 'name']],
  ['data360 calculated-insight get', ['developerName', 'name', 'id']],
  ['data360 connection describe', ['id', 'developerName', 'name']],
  ['data360 connection get', ['id', 'developerName', 'name']],
  ['data360 connection validate', ['id', 'developerName', 'name']],
  ['data360 connector get', ['name']],
  ['data360 data-graph get', ['developerName', 'name', 'id']],
  ['data360 data-graph refresh', ['dataGraphName', 'developerName', 'name']],
  ['data360 data-space get', ['name', 'developerName', 'id']],
  ['data360 data-space member list', ['name', 'developerName', 'id']],
  ['data360 data-stream get', ['name', 'developerName', 'id']],
  ['data360 data-stream run', ['name', 'developerName', 'id']],
  ['data360 dlo get', ['name', 'developerName', 'id']],
  ['data360 dmo get', ['name', 'developerName', 'id']],
  ['data360 dmo relationship list', ['name', 'developerName']],
  ['data360 identity-resolution get', ['developerName', 'name', 'id']],
  ['data360 mapping get', ['developerName', 'name', 'id']],
  ['data360 metadata get', ['name', 'apiName', 'developerName']],
  ['data360 retriever configuration list', ['name', 'retrieverName', 'developerName', 'id']],
  ['data360 retriever get', ['name', 'retrieverName', 'developerName', 'id']],
  ['data360 search-index describe', ['developerName', 'name', 'id']],
  ['data360 search-index get', ['developerName', 'name', 'id']],
  ['data360 query hybrid', ['developerName', 'name', 'id']],
  ['data360 query vector', ['developerName', 'name', 'id']],
  ['data360 segment get', ['developerName', 'name', 'id']],
  ['data360 transform get', ['developerName', 'name', 'id']],
  ['data360 transform report', ['developerName', 'name', 'id']],
  ['data360 transform run', ['name', 'developerName', 'id']],
  ['data360 transform schedule display', ['developerName', 'name', 'id']],
  ['data360 transform validate', ['developerName', 'name', 'id']],
]);
const dependencyOverrideEnvironment = new Map([
  ['data360 data-stream run', 'D360_STREAM_API_NAME'],
  ['data360 transform run', 'D360_TRANSFORM_NAME'],
]);
const longRunningActionTimeoutMs = 6 * 60_000;

const valuesForFields = (payload, fields) => {
  const values = [];
  for (const item of outputItems(payload)) {
    if (!item || typeof item !== 'object') continue;
    for (const field of fields) {
      const value = item[field];
      if (typeof value === 'string' && value && !values.includes(value)) {
        values.push(value);
        break;
      }
    }
  }
  return values;
};

export const dependencyCandidates = (command, dependencies, environment = process.env) => {
  if (command === 'data360 mapping list') {
    const dmos = valuesForFields(dependencies.get('data360 dmo list'), ['name', 'developerName']);
    const dlos = valuesForFields(dependencies.get('data360 dlo list'), ['name', 'developerName']);
    const attempts = [];
    if (dmos.includes('ssot__Account__dlm') && dlos.includes('Account_Home__dll')) {
      attempts.push({
        flags: ['--dmo', 'ssot__Account__dlm', '--source-object', 'Account_Home__dll'],
      });
    }
    for (const dmo of dmos) {
      const flags = ['--dmo', dmo];
      if (
        !attempts.some(
          (attempt) => attempt.flags.length === flags.length && attempt.flags.every((v, i) => v === flags[i])
        )
      )
        attempts.push({ flags });
    }
    return attempts;
  }

  const dependency = listDependency.get(command);
  if (!dependency) return [{ flags: [] }];
  const fields = dependencyFields.get(command) ?? ['developerName', 'name', 'id'];
  const dependencyPayload = dependencies.get(dependency);
  let eligibleItems = outputItems(dependencyPayload);
  if (command === 'data360 data-stream run') {
    eligibleItems = eligibleItems.filter(
      (item) => item?.isEnabled === true || ['ACTIVE', 'READY'].includes(String(item?.status ?? '').toUpperCase())
    );
  }
  if (command === 'data360 transform run') {
    eligibleItems = eligibleItems.filter((item) =>
      ['ACTIVE', 'READY'].includes(String(item?.status ?? '').toUpperCase())
    );
  }
  if (command === 'data360 query hybrid' || command === 'data360 query vector') {
    eligibleItems = eligibleItems.filter((item) => {
      const ready = ['ACTIVE', 'READY'].includes(String(item?.runtimeStatus ?? item?.status ?? '').toUpperCase());
      const searchType = String(item?.searchType ?? '').toUpperCase();
      return (
        ready &&
        (command === 'data360 query hybrid' ? searchType === 'HYBRID' : ['HYBRID', 'VECTOR'].includes(searchType))
      );
    });
  }
  const values = valuesForFields({ result: { items: eligibleItems } }, fields).filter(
    (value) => !/^LIVE_(?:ID|UUID)_[0-9a-f]+$/iu.test(value)
  );
  const override = environment[dependencyOverrideEnvironment.get(command)];
  if (typeof override === 'string' && override) {
    return values.includes(override) ? [{ flags: ['--name', override] }] : [];
  }
  if (command === 'data360 dmo relationship list' && values.includes('ssot__Account__dlm')) {
    return [{ flags: ['--name', 'ssot__Account__dlm'] }];
  }
  if (command === 'data360 query hybrid' || command === 'data360 query vector') {
    return values.slice(0, 5).map((value) => ({ flags: ['--index', value] }));
  }
  return values.slice(0, 5).map((value) => ({ flags: ['--name', value] }));
};

export const executionPolicy = (command) => {
  if (command === 'data360 api request')
    return { args: ['data-spaces'], captureStdout: true, recordFixture: true, json: false };
  if (command === 'data360 open') return { args: ['--url-only'], captureStdout: true, recordFixture: true, json: true };
  if (command === 'data360 connection describe')
    return { args: ['--endpoints'], captureStdout: true, recordFixture: true, json: true, timeoutMs: 30_000 };
  if (command === 'data360 connection validate')
    return { args: [], captureStdout: true, recordFixture: true, json: true, timeoutMs: 30_000 };
  if (command === 'data360 transform report' || command === 'data360 transform validate')
    return { args: [], captureStdout: true, recordFixture: true, json: true, timeoutMs: 30_000 };
  if (command === 'data360 calculated-insight run')
    return { args: ['--no-prompt'], captureStdout: true, recordFixture: true, json: true };
  if (command === 'data360 transform run')
    return {
      args: ['--no-prompt'],
      captureStdout: true,
      recordFixture: true,
      json: true,
      timeoutMs: longRunningActionTimeoutMs,
    };
  if (command === 'data360 data-graph refresh' || command === 'data360 data-stream run')
    return {
      args: ['--no-prompt'],
      captureStdout: true,
      recordFixture: true,
      json: true,
      timeoutMs: longRunningActionTimeoutMs,
    };
  if (command === 'data360 query hybrid' || command === 'data360 query vector')
    return {
      args: ['--text', 'Data 360 verification', '--top-k', '1', '--wait', '2', '--no-prompt'],
      captureStdout: true,
      recordFixture: true,
      json: true,
      timeoutMs: 180_000,
    };
  if (command === 'data360 token display') return { args: [], captureStdout: false, recordFixture: false, json: true };
  if (
    [
      'data360 data-space member set',
      'data360 ingest',
      'data360 ingest bulk',
      'data360 query',
      'data360 query cancel',
      'data360 transform retry',
      'data360 transform schedule set',
    ].includes(command)
  )
    return { args: ['--no-prompt'], captureStdout: true, recordFixture: true, json: true };
  return { args: [], captureStdout: true, recordFixture: true, json: true };
};

const loadResumeState = async (stateDirectory, org) => {
  try {
    const prefix = `${org.replaceAll(/[^a-zA-Z0-9_-]/gu, '_')}-`;
    const files = (await readdir(stateDirectory))
      .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
      .sort();
    if (files.length === 0) return null;
    const path = resolve(stateDirectory, files.at(-1));
    return { path, state: JSON.parse(await readFile(path, 'utf8')) };
  } catch {
    return null;
  }
};

const runCommand = async (entry, org, dependencies, runDirectory, date) => {
  const dependency = listDependency.get(entry.command);
  const candidates = dependencyCandidates(entry.command, dependencies);
  if (dependency && candidates.length === 0)
    return { status: 'blocked', schemaValid: false, reason: `No resource returned by ${dependency}` };

  const policy = executionPolicy(entry.command);
  const slug = fixtureSlug(entry.command);
  const stdoutPath = resolve(runDirectory, `${slug}.raw.json`);
  const stderrPath = resolve(runDirectory, `${slug}.stderr.log`);
  let lastFailure = null;

  const boundedCandidates = entry.credit ? candidates.slice(0, 1) : candidates;
  for (const candidate of boundedCandidates) {
    const args = [
      ...entry.command.split(' '),
      ...policy.args,
      ...candidate.flags,
      '--target-org',
      org,
      ...(policy.json ? ['--json'] : []),
    ];
    const stdoutHandle = policy.captureStdout ? await open(stdoutPath, 'w', 0o600) : null;
    const stderrHandle = await open(stderrPath, 'w', 0o600);
    const result = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve(root, 'bin', 'run.js'), ...args], {
        cwd: root,
        env: { ...process.env, SF_DISABLE_TELEMETRY: 'true' },
        stdio: ['ignore', stdoutHandle?.fd ?? 'ignore', stderrHandle.fd],
      });
      let timedOut = false;
      let forceKill;
      const timeout =
        policy.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGTERM');
              forceKill = setTimeout(() => child.kill('SIGKILL'), 2_000);
            }, policy.timeoutMs)
          : undefined;
      child.once('error', reject);
      child.once('close', (exitCode) => {
        if (timeout) clearTimeout(timeout);
        if (forceKill) clearTimeout(forceKill);
        done({ exitCode: exitCode ?? 1, timedOut });
      });
    });
    await stdoutHandle?.close();
    await stderrHandle.close();

    if (result.exitCode !== 0) {
      const stderr = scrubString(await readFile(stderrPath, 'utf8'));
      await writeFile(stderrPath, stderr, { mode: 0o600 });
      let detail = result.timedOut ? `timed out after ${policy.timeoutMs} ms` : `exit ${result.exitCode}`;
      if (policy.captureStdout) {
        try {
          const failure = JSON.parse(await readFile(stdoutPath, 'utf8'));
          detail += ` (${scrubString(String(failure.code ?? failure.name ?? 'command failure'))}: ${scrubString(
            String(failure.message ?? 'no message')
          )})`;
        } catch {}
      }
      lastFailure = `${detail}; see .tmp/live-verify/${slug}.stderr.log`;
      await rm(stdoutPath, { force: true });
      continue;
    }

    if (!policy.captureStdout) {
      return { status: 'passed', schemaValid: true };
    }

    let payload;
    try {
      payload = JSON.parse(await readFile(stdoutPath, 'utf8'));
    } catch {
      await rm(stdoutPath, { force: true });
      return { status: 'failed', schemaValid: false, reason: 'stdout was not valid JSON' };
    }
    const schemaValid = await schemaValidator(entry.expectedSchema, payload);
    if (!schemaValid) {
      await writeFile(stdoutPath, `${JSON.stringify(scrubFixture(redactSecrets(payload)), undefined, 2)}\n`, {
        mode: 0o600,
      });
      return {
        status: 'failed',
        schemaValid: false,
        reason: `response failed command schema validation; scrubbed evidence retained at ${stateReference(
          stdoutPath,
          org
        )}`,
      };
    }
    const fixture = policy.recordFixture ? await recordFixture(entry.command, payload, date) : null;
    dependencies.set(entry.command, payload);
    await rm(stdoutPath, { force: true });
    return { status: 'passed', schemaValid: true, ...(fixture ? { fixture } : {}) };
  }

  return { status: 'failed', schemaValid: false, reason: lastFailure ?? 'all dependency candidates failed' };
};

const firstStringField = (value, keys) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstStringField(entry, keys);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  for (const entry of Object.values(value)) {
    const found = firstStringField(entry, keys);
    if (found) return found;
  }
  return null;
};

export const commandPayloadExitCode = (command, payload) => {
  if (command === 'data360 api request') return 0;
  if (typeof payload?.exitCode === 'number') return payload.exitCode;
  if (typeof payload?.status === 'number') return payload.status;
  return 0;
};

export const scenarioErrorProvenance = (current, date, expectedFailure = false) => ({
  source: 'live-scrubbed',
  recordedAt: date,
  command: current.command,
  outcome: 'error',
  expectedFailure: Boolean(expectedFailure),
});

const scenarioErrorFixture = async (current, payload, date, scenario = 'foundation', expectedFailure = false) => {
  const relativeFile = `live/${scenario}-${current.id}-error.json`;
  const path = resolve(root, 'test', 'fixtures', relativeFile);
  await mkdir(dirname(path), { recursive: true });
  const safePayload =
    payload && typeof payload === 'object'
      ? Object.fromEntries(Object.entries(payload).filter(([key]) => !['stack', 'cause'].includes(key)))
      : { message: String(payload) };
  await writeFile(
    path,
    `${JSON.stringify(
      {
        __fixture: scenarioErrorProvenance(current, date, expectedFailure),
        ...scrubFixture(redactSecrets(safePayload)),
      },
      undefined,
      2
    )}\n`
  );
  return relativeFile;
};

const runScenarioCli = async ({
  args,
  org,
  runDirectory,
  current,
  date,
  expectedFailure = false,
  captureFailure = false,
  scenario = 'foundation',
}) => {
  const slug = `${scenario}-${current.id}`;
  const stdoutPath = resolve(runDirectory, `${slug}.raw.json`);
  const stderrPath = resolve(runDirectory, `${slug}.stderr.log`);
  const timeoutMs = current.timeoutMs ?? 120_000;
  const result = await spawnCapture(
    process.execPath,
    [
      resolve(root, 'bin', 'run.js'),
      ...args,
      ...(current.omitTargetOrg ? [] : ['--target-org', org]),
      ...(current.command === 'data360 api request' ? [] : ['--json']),
    ],
    {
      timeoutMs,
      env: {
        ...process.env,
        // Scenario jobs deliberately share a private cache with their own -r
        // continuations, never with the user's interactive query history.
        SF_DATA360_QUERY_CACHE_DIR: resolve(runDirectory, 'query-cache'),
      },
    }
  );
  await writeFile(stdoutPath, scrubCapturedText(result.stdout.toString('utf8')), { mode: 0o600 });
  await writeFile(stderrPath, scrubCapturedText(result.stderr.toString('utf8')), { mode: 0o600 });
  let payload;
  const stdout = result.stdout.toString('utf8');
  try {
    payload = stdout ? JSON.parse(stdout) : { status: result.exitCode, result: {} };
  } catch {
    payload = { message: 'stdout was not valid JSON', exitCode: result.exitCode };
  }
  if (result.timedOut) {
    payload = {
      name: 'D360_LIVE_TIMEOUT',
      message: `Live command exceeded ${timeoutMs} ms`,
      exitCode: result.exitCode,
    };
  }
  const payloadExitCode = commandPayloadExitCode(current.command, payload);
  if (result.exitCode !== 0 || payloadExitCode !== 0) {
    const fixtureCurrent = current.fixtureCommand ? { ...current, command: current.fixtureCommand } : current;
    const fixture = expectedFailure
      ? await scenarioErrorFixture(fixtureCurrent, payload, date, scenario, expectedFailure)
      : null;
    if (expectedFailure || captureFailure) {
      const matchesExpectedError =
        (result.timedOut && current.expectedTimeout === true) ||
        !current.expectedError ||
        (scenario.startsWith('p4')
          ? matchesP4ExpectedError(payload, current.expectedError)
          : scenario === 'p5'
            ? matchesP5ExpectedError(payload, current.expectedError)
            : JSON.stringify(payload).includes(current.expectedError));
      if (expectedFailure && current.expectedError && !matchesExpectedError) {
        throw new Error(
          `Expected ${JSON.stringify(current.expectedError)} but received ${String(payload.message ?? payload.name ?? 'error')}`
        );
      }
      return { payload: redactSecrets(payload), schemaValid: true, fixture };
    }
    throw new Error(
      `${scrubString(
        String(payload.message ?? payload.name ?? payload?.[0]?.message ?? `exit ${result.exitCode || payloadExitCode}`)
      )}`
    );
  }
  if (expectedFailure && !current.allowSuccess) throw new Error('Expected command failure but command succeeded');
  const schemaPath = await schemaForCommand(current.command);
  const schemaValid = await schemaValidator(schemaPath, payload);
  if (!schemaValid) throw new Error(`Response failed ${schemaPath} validation`);
  const fixture =
    (scenario.startsWith('p4') || scenario === 'p5') && !shouldRecordP4Fixture(current)
      ? null
      : await recordFixture(current.fixtureCommand ?? current.command, payload, date);
  await rm(stdoutPath, { force: true });
  return { payload: redactSecrets(payload), schemaValid, fixture };
};

const commandIdFromArgs = (args) => {
  const flagIndex = args.findIndex((entry) => entry.startsWith('-'));
  return args.slice(0, flagIndex < 0 ? args.length : flagIndex).join(' ');
};

const hasVisibleRows = (payload) => {
  if (typeof payload?.result?.rowCount === 'number' && payload.result.rowCount > 0) return true;
  if (Array.isArray(payload?.result?.rows) && payload.result.rows.length > 0) return true;
  return false;
};

const latestFoundationState = async (directory, org) => {
  try {
    const prefix = `${org.replaceAll(/[^a-zA-Z0-9_-]/gu, '_')}-lv_`;
    const files = (await readdir(directory)).filter((file) => file.startsWith(prefix) && file.endsWith('.json')).sort();
    if (files.length === 0) return null;
    const path = resolve(directory, files.at(-1));
    return { path, state: JSON.parse(await readFile(path, 'utf8')) };
  } catch {
    return null;
  }
};

export const plannedAbsenceProbeFor = (current) => {
  if (!current?.creates) return null;
  if (current.command === 'data360 data-stream create') {
    return { command: 'data360 data-stream list', args: ['data360', 'data-stream', 'list', '--all'] };
  }
  if (current.command === 'data360 dlo create') {
    return { command: 'data360 dlo list', args: ['data360', 'dlo', 'list', '--all'] };
  }
  return null;
};

export const plannedCleanupArgsFor = (current) => {
  if (
    !current?.creates ||
    !Array.isArray(current.cleanup) ||
    current.ownershipProof?.status !== 'absent' ||
    current.ownershipProof?.name !== current.creates
  ) {
    return null;
  }
  if (!['data360 data-stream create', 'data360 dlo create'].includes(current.command)) return null;
  return [...current.cleanup];
};

const runFoundationMain = async (options) => {
  const date = new Date().toISOString().slice(0, 10);
  const stateDirectory = resolve(root, '.tmp', 'live-verify', 'foundation');
  await mkdir(stateDirectory, { recursive: true });
  const latest = options.resume ? await latestFoundationState(stateDirectory, options.org) : null;
  const canResume =
    latest && latest.state.cleanupStack?.some(({ status }) => status !== 'passed' && status !== 'skipped');
  const resumed = canResume ? latest : null;
  const prefix = resumed?.state.prefix ?? createFoundationPrefix();
  const statePath = resumed?.path ?? resolve(stateDirectory, `${options.org}-${prefix}.json`);
  const definitionDirectory = resolve(root, '.tmp', 'live-verify', prefix, 'definitions');
  const files = await writeFoundationDefinitions(definitionDirectory, prefix);
  const runDirectory = resolve(root, '.tmp', 'live-verify', prefix);
  const external = externalFoundationInputs(process.env);
  if (external?.sample) files.streamRecord = resolve(root, external.sample);
  if (external?.invalidSample) files.invalidRecord = resolve(root, external.invalidSample);
  if (external?.csv) files.bulkRecords = resolve(root, external.csv);
  const preflightCommands = [
    'data360 connection list',
    'data360 data-stream list',
    'data360 dlo list',
    'data360 dmo list',
    'data360 mapping list',
    'data360 data-space list',
    'data360 transform list',
  ];
  const existingNames = new Set();
  for (const command of external ? [] : preflightCommands) {
    const current = { id: `preflight-${fixtureSlug(command)}`, command };
    try {
      const evidence = await runScenarioCli({
        args: command.split(' '),
        org: options.org,
        runDirectory,
        current,
        date,
      });
      for (const item of outputItems(evidence.payload)) {
        for (const key of ['name', 'developerName', 'label']) {
          if (typeof item?.[key] === 'string') existingNames.add(item[key]);
        }
      }
    } catch {}
  }
  const steps = buildFoundationPlan(prefix, resumed ? new Set() : existingNames, external);
  const dynamic = { connectorName: null, jobIds: {}, resourceKeys: {}, resourceNames: {}, resourceIds: {} };
  if (resumed?.state.results) {
    for (const [id, result] of Object.entries(resumed.state.results)) {
      if (id.includes('ingest-bulk') || id === 'ingest-cancel-job') {
        const jobId = firstStringField(result.evidence?.payload, ['jobId', 'id']);
        if (jobId) dynamic.jobIds[id] = jobId;
      }
      const item = result.evidence?.payload?.result?.item;
      if (item && typeof item === 'object') {
        if (typeof item.name === 'string') {
          dynamic.resourceNames[id] = item.name;
        }
        if (typeof item.id === 'string') {
          dynamic.resourceIds[id] = item.id;
          dynamic.resourceKeys[id] = item.id;
        } else if (typeof item.name === 'string') {
          dynamic.resourceKeys[id] = item.name;
        }
      }
    }
  }

  const state = await runFoundationScenario({
    prefix,
    statePath,
    steps,
    execute: async (current) => {
      if (current.external) {
        return {
          payload: { result: { item: { id: current.streamId, name: current.streamId, dloName: current.dloName } } },
          schemaValid: true,
          external: true,
        };
      }
      if (current.actualListItem && !dynamic.connectorName) {
        const list = await runScenarioCli({
          args: ['data360', 'connector', 'list'],
          org: options.org,
          runDirectory,
          current: { id: `${current.id}-source-list`, command: 'data360 connector list' },
          date,
        });
        dynamic.connectorName = firstStringField(outputItems(list.payload), ['name', 'type', 'connectorType']);
      }
      if (current.id === 'stream-create' && dynamic.resourceNames['connection-create']) {
        const definition = JSON.parse(await readFile(files.stream, 'utf8'));
        definition.datasource = dynamic.resourceNames['connection-create'];
        await writeFile(files.stream, `${JSON.stringify(definition, undefined, 2)}\n`, { mode: 0o600 });
      }
      const stepOrg = orgForFoundationStep(current, options.org);
      let evidence;
      if (current.waitForStatus) {
        const deadline = Date.now() + 10 * 60 * 1000;
        do {
          evidence = await runScenarioCli({
            args: argsForFoundationStep(current, files, dynamic),
            org: stepOrg,
            runDirectory,
            current,
            date,
          });
          if (firstStringField(evidence.payload, ['status']) === current.waitForStatus) break;
          if (Date.now() < deadline) await new Promise((done) => setTimeout(done, 10_000));
        } while (Date.now() < deadline);
        if (firstStringField(evidence.payload, ['status']) !== current.waitForStatus)
          throw new Error(`Resource did not reach ${current.waitForStatus} within 10 minutes`);
      } else if (current.boundedConsistencyWait) {
        const deadline = Date.now() + 10 * 60 * 1000;
        do {
          evidence = await runScenarioCli({
            args: argsForFoundationStep(current, files, dynamic),
            org: stepOrg,
            runDirectory,
            current,
            date,
          });
          if (hasVisibleRows(evidence.payload)) break;
          if (Date.now() < deadline) await new Promise((done) => setTimeout(done, 30_000));
        } while (Date.now() < deadline);
        if (!hasVisibleRows(evidence.payload))
          throw new Error('Ingested records were not query-visible within 10 minutes');
      } else {
        const attempts = current.retryAttempts ?? 1;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            evidence = await runScenarioCli({
              args: argsForFoundationStep(current, files, dynamic),
              org: stepOrg,
              runDirectory,
              current,
              date,
              expectedFailure: current.expectsFailure,
            });
            break;
          } catch (error) {
            if (attempt === attempts) throw error;
            await new Promise((done) => setTimeout(done, current.retryDelayMs ?? 1000));
          }
        }
      }
      if (stepOrg !== options.org) evidence.orgOverride = stepOrg;
      if (current.id === 'connector-list') {
        dynamic.connectorName = firstStringField(outputItems(evidence.payload), ['name', 'type', 'connectorType']);
      }
      if (current.command === 'data360 ingest bulk' || current.id === 'ingest-cancel-job') {
        const jobId = firstStringField(evidence.payload, ['jobId', 'id']);
        if (jobId) dynamic.jobIds[current.id] = jobId;
      }
      const item = evidence.payload?.result?.item;
      if (item && typeof item === 'object') {
        if (typeof item.name === 'string') {
          dynamic.resourceNames[current.id] = item.name;
        }
        if (typeof item.id === 'string') {
          dynamic.resourceIds[current.id] = item.id;
          dynamic.resourceKeys[current.id] = item.id;
        } else if (typeof item.name === 'string') {
          dynamic.resourceKeys[current.id] = item.name;
        }
      }
      return evidence;
    },
    cleanup: async (current) => {
      if (!current.cleanup) return { exitCode: 0, deletionConfirmed: true };
      const cleanupKey = cleanupResourceKey(current, current.createEvidence);
      if (!cleanupKey) {
        const absenceProbe = plannedAbsenceProbeFor(current);
        if (absenceProbe) {
          try {
            const listed = await runScenarioCli({
              args: absenceProbe.args,
              org: options.org,
              runDirectory,
              current: { id: `cleanup-${current.id}-verify-planned`, command: absenceProbe.command },
              date,
            });
            if (!hasExactResourceName(outputItems(listed.payload), current.creates)) {
              return { exitCode: 0, deletionConfirmed: true };
            }
            const plannedCleanup = plannedCleanupArgsFor(current);
            if (plannedCleanup) {
              await runScenarioCli({
                args: plannedCleanup,
                org: options.org,
                runDirectory,
                current: { id: `cleanup-${current.id}-planned`, command: commandIdFromArgs(plannedCleanup) },
                date,
              });
              const verified = await runScenarioCli({
                args: absenceProbe.args,
                org: options.org,
                runDirectory,
                current: { id: `cleanup-${current.id}-verify-planned-delete`, command: absenceProbe.command },
                date,
              });
              if (!hasExactResourceName(outputItems(verified.payload), current.creates)) {
                return { exitCode: 0, deletionConfirmed: true };
              }
            }
          } catch {}
        }
        return {
          exitCode: 1,
          deletionConfirmed: false,
          reason: 'Create produced no recorded resource ID or canonical key; cleanup retained for retry',
        };
      }
      const cleanupArgs = current.cleanupRawFamily
        ? [
            'data360',
            'api',
            'request',
            `${current.cleanupRawFamily}/${encodeURIComponent(cleanupKey)}`,
            ...(current.cleanupDirect ? ['--direct'] : []),
            '--method',
            'DELETE',
          ]
        : [...current.cleanup];
      for (const flag of ['--name', '--relationship-name']) {
        const index = cleanupArgs.indexOf(flag);
        if (index >= 0) cleanupArgs[index + 1] = cleanupKey;
      }
      try {
        await runScenarioCli({
          args: cleanupArgs,
          org: options.org,
          runDirectory,
          current: {
            id: `cleanup-${current.id}`,
            command: current.cleanupRawFamily ? 'data360 api request' : commandIdFromArgs(cleanupArgs),
          },
          date,
        });
      } catch (error) {
        if (isVerifiedAbsent(String(error))) return { exitCode: 0, deletionConfirmed: true };
        return { exitCode: 1, deletionConfirmed: false, reason: String(error) };
      }

      const families = new Map([
        ['data360 connection delete', 'connections'],
        ['data360 data-stream delete', 'data-streams'],
        ['data360 dlo delete', 'data-lake-objects'],
        ['data360 dmo delete', 'data-model-objects'],
        ['data360 dmo relationship delete', 'data-model-objects/relationships'],
        ['data360 mapping delete', 'data-model-object-mappings'],
      ]);
      const family = current.cleanupRawFamily ?? families.get(commandIdFromArgs(cleanupArgs));
      if (!family)
        return { exitCode: 1, deletionConfirmed: false, reason: 'No post-delete verification endpoint configured' };
      try {
        const absence = await runScenarioCli({
          args: [
            'data360',
            'api',
            'request',
            `${family}/${encodeURIComponent(cleanupKey)}`,
            ...(current.cleanupDirect ? ['--direct'] : []),
          ],
          org: options.org,
          runDirectory,
          current: { id: `cleanup-${current.id}-verify`, command: 'data360 api request' },
          date,
          expectedFailure: true,
        });
        if (isVerifiedAbsent(absence.payload)) {
          return { exitCode: 0, deletionConfirmed: true };
        }
        return {
          exitCode: 1,
          deletionConfirmed: false,
          reason: 'Post-delete verification failed without a not-found confirmation',
        };
      } catch (error) {
        return {
          exitCode: 1,
          deletionConfirmed: false,
          reason: String(error).includes('Expected command failure')
            ? `Resource ${cleanupKey} still exists after delete`
            : String(error),
        };
      }
    },
  });

  const verificationPath = resolve(root, 'test', 'verification.json');
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  const results = steps.map((current) => ({
    command: current.command,
    status: state.results[current.id]?.status,
    schemaValid: state.results[current.id]?.evidence?.schemaValid === true && !current.dryRun,
  }));
  for (const cleanupResult of state.cleanup) {
    const current = steps.find(({ id }) => id === cleanupResult.step);
    if (current?.cleanup && isP4CleanupVerifiable(current) && state.results[current.id]?.status === 'passed') {
      results.push({
        command: commandIdFromArgs(current.cleanup),
        status: cleanupResult.status,
        schemaValid: cleanupResult.status === 'passed',
      });
    }
  }
  if (state.cleanup.some(({ status }) => status === 'passed')) {
    results.push({ command: 'data360 api request', status: 'passed', schemaValid: true });
  }
  await writeFile(
    verificationPath,
    `${JSON.stringify(applySuccessfulVerification(verification, results, date), undefined, 2)}\n`
  );
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const result of Object.values(state.results)) counts[result.status] += 1;
  if (liveRunRequiresFailureExit(state)) process.exitCode = 1;
  writeLiveSummary(
    {
      scenario: 'foundation',
      prefix,
      state: stateReference(statePath, options.org),
      counts,
      billableCalls: state.billableCalls,
      billableAttempts: state.billableAttempts,
      billableOutcomes: state.billableOutcomes,
      cleanup: state.cleanup,
      results: summarizeLiveResults(state.results),
    },
    options.org
  );
};

const latestP4State = async (directory, org) => {
  try {
    const prefix = `${org.replaceAll(/[^a-zA-Z0-9_-]/gu, '_')}-lv_p4_`;
    const files = (await readdir(directory)).filter((file) => file.startsWith(prefix) && file.endsWith('.json')).sort();
    if (files.length === 0) return null;
    const path = resolve(directory, files.at(-1));
    return { path, state: JSON.parse(await readFile(path, 'utf8')) };
  } catch {
    return null;
  }
};

const runP4StreamMain = async (options) => {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = createP4StreamPrefix();
  const names = p4StreamNames(prefix);
  const stateDirectory = resolve(root, '.tmp', 'live-verify', 'p4-stream');
  const statePath = resolve(stateDirectory, `${options.org}-${prefix}.json`);
  const runDirectory = resolve(root, '.tmp', 'live-verify', prefix);
  await mkdir(stateDirectory, { recursive: true });
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const external = p4ExternalInputs();
  const templateEvidence = await runScenarioCli({
    args: ['data360', 'data-stream', 'get', '--name', external.streamId],
    org: options.org,
    runDirectory,
    current: { id: 'stream-template-bootstrap', command: 'data360 data-stream get' },
    date,
    scenario: 'p4-stream',
  });
  const template = templateEvidence.payload?.result?.item;
  if (!template || typeof template !== 'object') {
    throw new Error('Approved P4 stream template did not return a data stream item');
  }
  const templateConnectorType = firstStringField(template.connectorInfo, ['connectorType']);
  if (!templateConnectorType) throw new Error('Approved P4 stream template did not expose its connector type');
  const files = await writeP4StreamDefinitions(resolve(runDirectory, 'definitions'), prefix, template);
  const steps = buildP4StreamPlan(prefix, external, templateConnectorType);
  const dynamic = { resourceKeys: {} };
  const evidenceById = {};

  const executeCli = (current) =>
    runScenarioCli({
      args: argsForP4StreamStep(current, files, dynamic),
      org: options.org,
      runDirectory,
      current,
      date,
      expectedFailure: current.expectedFailure,
      scenario: 'p4-stream',
    });

  const state = await runFoundationScenario({
    prefix,
    statePath,
    steps,
    authorizeCreate: async (current) => {
      const command = current.id === 'stream-dlo-cleanup' ? 'data360 dlo list' : 'data360 data-stream list';
      const probe = {
        id: `ownership-${current.id}`,
        command,
        args: ['--all'],
      };
      const evidence = await executeCli(probe);
      if (hasExactResourceName(outputItems(evidence.payload), current.creates)) {
        throw new Error(`Disposable name is not provably absent: ${current.creates}`);
      }
      return { name: current.creates, status: 'absent', proof: 'exact full-list scan' };
    },
    execute: async (original) => {
      if (original.external) {
        return { payload: { result: { item: original.resource } }, schemaValid: true, external: true };
      }
      if (original.registerOnly) {
        return { payload: { result: { item: { name: original.creates } } }, schemaValid: true };
      }
      let current = original;
      if (current.selectConnectionLabel) {
        const items = outputItems(evidenceById['connection-list']?.payload);
        const key = selectExactConnectionKey(items, current.selectConnectionLabel, templateConnectorType);
        current = { ...current, name: key, selectConnectionLabel: undefined };
      }
      const evidence = await executeCli(current);
      if (current.expectedNotFound && !isVerifiedAbsent(evidence.payload)) {
        throw new Error(`Expected exact absence for ${current.name ?? names.stream}`);
      }
      if (current.exactName) {
        selectExactStreamKey(outputItems(evidence.payload), current.exactName);
      }
      if (current.exactAbsentName && hasExactResourceName(outputItems(evidence.payload), current.exactAbsentName)) {
        throw new Error(`Expected exact absence for ${current.exactAbsentName}`);
      }
      if (current.expectedLabel && firstStringField(evidence.payload, ['label']) !== current.expectedLabel) {
        throw new Error(`Expected restored stream label ${current.expectedLabel}`);
      }
      const item = evidence.payload?.result?.item ?? evidence.payload?.result;
      const key = firstStringField(item, ['recordId', 'id', 'name']);
      if (key) dynamic.resourceKeys[current.id] = key;
      evidenceById[current.id] = evidence;
      return evidence;
    },
    cleanup: async (current) => {
      const cleanupArgs = [...current.cleanup];
      const nameIndex = cleanupArgs.indexOf('--name');
      cleanupArgs[nameIndex + 1] = current.creates;
      let deletionError;
      try {
        await runScenarioCli({
          args: cleanupArgs,
          org: options.org,
          runDirectory,
          current: { id: `cleanup-${current.id}`, command: commandIdFromArgs(cleanupArgs) },
          date,
          scenario: 'p4-stream',
        });
      } catch (error) {
        deletionError = String(error);
      }
      const listCommand = current.id === 'stream-create' ? 'data360 data-stream list' : 'data360 dlo list';
      const absence = await runScenarioCli({
        args: [...listCommand.split(' '), '--all'],
        org: options.org,
        runDirectory,
        current: { id: `cleanup-${current.id}-verify`, command: listCommand },
        date,
        scenario: 'p4-stream',
      });
      return !hasExactResourceName(outputItems(absence.payload), current.creates)
        ? { exitCode: 0, deletionConfirmed: true }
        : {
            exitCode: 1,
            deletionConfirmed: false,
            reason: deletionError ?? `${current.creates} still exists after cleanup`,
          };
    },
  });

  const verificationPath = resolve(root, 'test', 'verification.json');
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  const results = steps
    .filter((current) => current.command.startsWith('data360 '))
    .map((current) => ({
      command: current.command,
      status: state.results[current.id]?.status,
      schemaValid:
        state.results[current.id]?.evidence?.schemaValid === true &&
        commandPayloadExitCode(current.command, state.results[current.id]?.evidence?.payload) === 0,
    }));
  await writeFile(
    verificationPath,
    `${JSON.stringify(applySuccessfulVerification(verification, results, date), undefined, 2)}\n`
  );
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const result of Object.values(state.results)) counts[result.status] += 1;
  if (liveRunRequiresFailureExit(state, { additionalFailure: counts.blocked > 0 })) process.exitCode = 1;
  writeLiveSummary(
    {
      scenario: 'p4-stream',
      prefix,
      state: stateReference(statePath, options.org),
      counts,
      billableCalls: state.billableCalls,
      billableAttempts: state.billableAttempts,
      cleanup: state.cleanup,
      results: summarizeLiveResults(state.results),
    },
    options.org
  );
};

const runP4Main = async (options) => {
  const date = new Date().toISOString().slice(0, 10);
  const stateDirectory = resolve(root, '.tmp', 'live-verify', 'p4');
  await mkdir(stateDirectory, { recursive: true });
  const latest = options.resume ? await latestP4State(stateDirectory, options.org) : null;
  const canResume = latest && latest.state.cleanupStack?.some(({ status }) => status !== 'passed');
  const resumed = canResume ? latest : null;
  const prefix = resumed?.state.prefix ?? createP4Prefix();
  const statePath = resumed?.path ?? resolve(stateDirectory, `${options.org}-${prefix}.json`);
  const runDirectory = resolve(root, '.tmp', 'live-verify', prefix);
  const external = p4ExternalInputs();
  const files = await writeP4Definitions(resolve(runDirectory, 'definitions'), prefix, external);
  const steps = buildP4Plan(prefix, external);
  const dynamic = { resourceKeys: {}, resourceNames: {}, mappingFields: {} };
  const evidenceById = {};

  if (resumed?.state.results) {
    for (const [id, result] of Object.entries(resumed.state.results)) {
      if (result.evidence) evidenceById[id] = result.evidence;
      const name = firstStringField(result.evidence?.payload?.result?.item, ['developerName', 'name', 'id']);
      if (name) {
        dynamic.resourceKeys[id] = name;
        dynamic.resourceNames[id] = name;
      }
      if (id === 'mapping-get') {
        const mappingField = selectP4MappingField(result.evidence?.payload);
        if (mappingField) dynamic.mappingFields[id] = mappingField.name;
      }
    }
  }

  const state = await runP4Scenario({
    prefix,
    statePath,
    steps,
    execute: async (current) => {
      if (current.external) {
        return { payload: { result: { item: current.resource } }, schemaValid: true, external: true };
      }

      if (current.id === 'dmo-create') {
        const definition = buildP4MatchedDmoDefinition(evidenceById['dlo-get']?.payload, prefix);
        await writeFile(files.dmo, `${JSON.stringify(definition, undefined, 2)}\n`, { mode: 0o600 });
        const primaryKey = definition.fields.find(({ isPrimaryKey }) => isPrimaryKey === true)?.name;
        if (!primaryKey) throw new Error('Matched DMO definition did not retain a primary key');
        const relationship = JSON.parse(await readFile(files.relationship, 'utf8'));
        relationship.relationships[0].sourceFieldName = primaryKey;
        await writeFile(files.relationship, `${JSON.stringify(relationship, undefined, 2)}\n`, { mode: 0o600 });
      }

      if (current.selectConnectorType) {
        const items = outputItems(evidenceById['connector-list']?.payload);
        const selected = items.find(
          (item) =>
            item?.connectorType === current.selectConnectorType ||
            item?.type === current.selectConnectorType ||
            item?.name === current.selectConnectorType
        );
        const key = firstStringField(selected, ['name', 'type', 'connectorType']);
        if (!key) throw new Error(`Connector ${current.selectConnectorType} was not returned by connector list`);
        current = { ...current, name: key, nameFrom: undefined };
      }
      if (current.selectFirstConnector) {
        const items = outputItems(evidenceById['connector-list']?.payload);
        const key = firstStringField(items[0], ['name', 'type', 'connectorType']);
        if (!key) throw new Error('Connector list returned no usable connector');
        current = { ...current, name: key, nameFrom: undefined };
      }
      if (current.selectConnectionLabel) {
        const items = outputItems(evidenceById['connection-list']?.payload);
        const key = selectP4ResourceKey(items, {
          label: current.selectConnectionLabel,
          connectorType: 'IngestApi',
        });
        if (!key) throw new Error(`Connection ${current.selectConnectionLabel} was not returned by connection list`);
        current = { ...current, name: key, nameFrom: undefined };
      }
      if (current.selectFirst) {
        const items = outputItems(evidenceById['data-space-list']?.payload);
        const key = firstStringField(items[0], ['name', 'developerName', 'id']);
        if (!key) throw new Error('Data-space list returned no usable item');
        current = { ...current, name: key, nameFrom: undefined };
      }

      let evidence;
      const executeOnce = () =>
        runScenarioCli({
          args: argsForP4Step(current, files, dynamic),
          org: options.org,
          runDirectory,
          current,
          date,
          expectedFailure: current.expectedFailure,
          scenario: 'p4',
        });
      if (current.waitForStatus) {
        const deadline = Date.now() + 10 * 60 * 1000;
        do {
          evidence = await executeOnce();
          if (firstStringField(evidence.payload, ['status']) === current.waitForStatus) break;
          if (Date.now() < deadline) await new Promise((done) => setTimeout(done, 10_000));
        } while (Date.now() < deadline);
        if (firstStringField(evidence.payload, ['status']) !== current.waitForStatus) {
          throw new Error(`Resource did not reach ${current.waitForStatus} within 10 minutes`);
        }
      } else {
        const attempts = current.retryAttempts ?? 1;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            evidence = await executeOnce();
            break;
          } catch (error) {
            if (attempt === attempts) throw error;
            await new Promise((done) => setTimeout(done, current.retryDelayMs ?? 1000));
          }
        }
      }

      const item = evidence.payload?.result?.item;
      const key = firstStringField(item ?? evidence.payload?.result, ['developerName', 'name', 'id']);
      if (key) {
        dynamic.resourceKeys[current.id] = key;
        dynamic.resourceNames[current.id] = key;
      }
      evidenceById[current.id] = evidence;
      if (current.id === 'mapping-get') {
        const mappingField = selectP4MappingField(evidence.payload);
        if (!mappingField)
          throw new Error('Mapping get returned no safe field mapping for update and delete verification');
        dynamic.mappingFields[current.id] = mappingField.name;
        await writeFile(files.mappingFields, `${JSON.stringify({ fieldMappings: [mappingField] }, undefined, 2)}\n`, {
          mode: 0o600,
        });
      }
      return evidence;
    },
    cleanup: async (current) => {
      const cleanupKey = cleanupResourceKey(current, current.createEvidence);
      if (!cleanupKey) {
        return {
          exitCode: 1,
          deletionConfirmed: false,
          reason: 'No exact disposable create name was registered; cleanup retained rather than guessing',
        };
      }
      const cleanupArgs = current.cleanupRawFamily
        ? [
            'data360',
            'api',
            'request',
            `${current.cleanupRawFamily}/${encodeURIComponent(cleanupKey)}`,
            '--method',
            'DELETE',
          ]
        : [...current.cleanup];
      for (const flag of ['--name', '--relationship-name']) {
        const index = cleanupArgs.indexOf(flag);
        if (index >= 0) cleanupArgs[index + 1] = cleanupKey;
      }
      let deleteError;
      try {
        await runScenarioCli({
          args: cleanupArgs,
          org: options.org,
          runDirectory,
          current: {
            id: `cleanup-${current.id}`,
            command: current.cleanupRawFamily ? 'data360 api request' : commandIdFromArgs(cleanupArgs),
          },
          date,
          scenario: 'p4',
        });
      } catch (error) {
        if (isVerifiedAbsent(String(error))) return { exitCode: 0, deletionConfirmed: true };
        return { exitCode: 1, deletionConfirmed: false, reason: String(error) };
      }

      if (current.cleanupParentName) {
        try {
          const listed = await runScenarioCli({
            args: ['data360', 'dmo', 'relationship', 'list', '--name', current.cleanupParentName],
            org: options.org,
            runDirectory,
            current: { id: `cleanup-${current.id}-verify`, command: 'data360 dmo relationship list' },
            date,
            scenario: 'p4',
          });
          return JSON.stringify(listed.payload).includes(cleanupKey)
            ? {
                exitCode: 1,
                deletionConfirmed: false,
                reason: `Relationship ${cleanupKey} still appears in ${current.cleanupParentName}`,
              }
            : { exitCode: 0, deletionConfirmed: true };
        } catch (error) {
          return { exitCode: 1, deletionConfirmed: false, reason: String(error) };
        }
      }

      const families = new Map([
        ['data360 dlo delete', 'data-lake-objects'],
        ['data360 dmo delete', 'data-model-objects'],
        ['data360 dmo relationship delete', 'data-model-objects/relationships'],
        ['data360 mapping delete', 'data-model-object-mappings'],
      ]);
      const family = current.cleanupRawFamily ?? families.get(commandIdFromArgs(cleanupArgs));
      try {
        const absence = await runScenarioCli({
          args: ['data360', 'api', 'request', `${family}/${encodeURIComponent(cleanupKey)}`],
          org: options.org,
          runDirectory,
          current: { id: `cleanup-${current.id}-verify`, command: 'data360 api request' },
          date,
          expectedFailure: true,
          scenario: 'p4',
        });
        if (isVerifiedAbsent(absence.payload)) {
          return { exitCode: 0, deletionConfirmed: true };
        }
        return {
          exitCode: 1,
          deletionConfirmed: false,
          reason: 'Post-delete verification failed without a not-found confirmation',
        };
      } catch (error) {
        return {
          exitCode: 1,
          deletionConfirmed: false,
          reason: String(error).includes('Expected command failure')
            ? `Resource ${cleanupKey} still exists after delete`
            : String(error),
        };
      }
    },
  });

  const verificationPath = resolve(root, 'test', 'verification.json');
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  const results = steps.map((current) => ({
    command: current.command,
    status: state.results[current.id]?.status,
    schemaValid:
      state.results[current.id]?.evidence?.schemaValid === true && !current.dryRun && !current.expectedFailure,
  }));
  for (const cleanupResult of state.cleanup) {
    const current = steps.find(({ id }) => id === cleanupResult.step);
    if (current?.cleanup && state.results[current.id]?.status === 'passed') {
      results.push({
        command: commandIdFromArgs(current.cleanup),
        status: cleanupResult.status,
        schemaValid: cleanupResult.status === 'passed',
      });
    }
  }
  if (state.cleanup.some(({ status }) => status === 'passed')) {
    results.push({ command: 'data360 api request', status: 'passed', schemaValid: true });
  }
  await writeFile(
    verificationPath,
    `${JSON.stringify(applySuccessfulVerification(verification, results, date), undefined, 2)}\n`
  );
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const result of Object.values(state.results)) counts[result.status] += 1;
  if (liveRunRequiresFailureExit(state)) process.exitCode = 1;
  writeLiveSummary(
    {
      scenario: 'p4',
      prefix,
      state: stateReference(statePath, options.org),
      counts,
      cleanup: state.cleanup,
      results: summarizeLiveResults(state.results),
    },
    options.org
  );
};

export const p5StateFileOrgKey = (org) => org.replaceAll(/[^a-zA-Z0-9_-]/gu, '_');

export const latestP5State = async (directory, org) => {
  const prefix = `${p5StateFileOrgKey(org)}-lv_p5_`;
  const files = (await readdir(directory)).filter((file) => file.startsWith(prefix) && file.endsWith('.json')).sort();
  const outstanding = [];
  for (const file of files) {
    const path = resolve(directory, file);
    let state;
    try {
      state = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot safely inspect P5 ledger ${file}: ${error instanceof Error ? error.message : error}`);
    }
    if (
      !state ||
      typeof state !== 'object' ||
      typeof state.prefix !== 'string' ||
      !Array.isArray(state.cleanupStack) ||
      state.cleanupStack.some((entry) => !entry || typeof entry !== 'object' || typeof entry.status !== 'string') ||
      (state.billableOutcomes !== undefined && !Array.isArray(state.billableOutcomes))
    ) {
      throw new Error(`Cannot safely inspect malformed P5 ledger ${file}`);
    }
    const cleanupOutstanding = state.cleanupStack.some(({ status }) => !['passed', 'not-owned'].includes(status));
    const billingOutstanding = state.billableOutcomes?.some(({ status }) => status === 'attempted') === true;
    if (cleanupOutstanding || billingOutstanding) {
      outstanding.push({ path, state });
    }
  }
  return outstanding.at(-1) ?? null;
};

const queryRecordId = (payload) => {
  const result = payload?.result;
  if (!Array.isArray(result?.rows) || result.rows.length === 0) return null;
  if (!Array.isArray(result.rows[0])) {
    return extractP5Identity(result.rows[0], ['ssot__Id__c', 'Id__c', 'id']) ?? null;
  }
  const columns = Array.isArray(result.columns) ? result.columns : [];
  const index = columns.findIndex(({ name }) => ['ssot__Id__c', 'Id__c', 'id'].includes(name));
  return index >= 0 && typeof result.rows[0][index] === 'string' ? result.rows[0][index] : null;
};

const runP5Main = async (options) => {
  const date = new Date().toISOString().slice(0, 10);
  const stateDirectory = resolve(root, '.tmp', 'live-verify', 'p5');
  await mkdir(stateDirectory, { recursive: true });
  const outstanding = await latestP5State(stateDirectory, options.org);
  if (outstanding && !options.resume && !options.cleanup) {
    throw new Error(
      `An unresolved P5 ledger exists in ${outstanding.path}; re-run with --resume before another billable run`
    );
  }
  if (!outstanding && (options.resume || options.cleanup)) {
    throw new Error('No outstanding P5 cleanup ledger exists to resume');
  }
  const resumed = options.resume || options.cleanup ? outstanding : null;
  const prefix = resumed?.state.prefix ?? createP5Prefix();
  const statePath = resumed?.path ?? resolve(stateDirectory, `${p5StateFileOrgKey(options.org)}-${prefix}.json`);
  const runDirectory = resolve(root, '.tmp', 'live-verify', prefix);
  const files = await writeP5Definitions(resolve(runDirectory, 'definitions'), prefix);
  if (options.identityOnly === true && !options.cleanup) {
    const bootstrapList = await runScenarioCli({
      args: ['data360', 'identity-resolution', 'list'],
      org: options.org,
      runDirectory,
      current: { id: 'identity-clone-bootstrap-list', command: 'data360 identity-resolution list' },
      date,
      scenario: 'p5',
    });
    const sourceKey = extractP5Identity(outputItems(bootstrapList.payload)[0], ['id', 'rulesetId', 'name', 'label']);
    if (!sourceKey) throw new Error('No existing identity ruleset is available as a disposable clone template');
    const bootstrapGet = await runScenarioCli({
      args: ['data360', 'identity-resolution', 'get', '--name', sourceKey],
      org: options.org,
      runDirectory,
      current: { id: 'identity-clone-bootstrap-get', command: 'data360 identity-resolution get' },
      date,
      scenario: 'p5',
    });
    const sourceItem = bootstrapGet.payload?.result?.item;
    const identityDefinition = buildP5IdentityCloneDefinition(sourceItem, prefix);
    await writeFile(files.identity, `${JSON.stringify(identityDefinition, undefined, 2)}\n`, { mode: 0o600 });
  }
  const steps =
    options.contractProbesOnly === true
      ? buildP5ContractProbePlan(prefix)
      : buildP5Plan(prefix, {
          allowSharedData: options.sharedData === true,
          useExistingSearch: options.existingSearch === true,
          useProfileLookup: options.profileLookup === true,
          allowIdentity: options.identity === true || options.identityOnly === true,
          includeDataKit: options.dataKitMutations === true || options.dataKitOnly === true,
          allowBillable: options.billable === true,
          graphRefreshOnly: options.graphRefreshOnly === true,
          segmentOnly: options.segmentOnly === true,
          dataKitOnly: options.dataKitOnly === true,
          identityOnly: options.identityOnly === true,
        });
  const dynamic = { dataKitComponents: {}, profileLookups: {}, recordIds: {}, resourceKeys: {} };
  const evidenceById = {};
  const writeDataKitComponentDefinitions = async (component) => {
    const definitions = p5DataKitComponentDefinitions(component);
    await Promise.all([
      writeFile(files.dataKitUpdate, `${JSON.stringify(definitions.update, undefined, 2)}\n`),
      writeFile(files.dataKitDeploy, `${JSON.stringify(definitions.deploy, undefined, 2)}\n`),
      writeFile(files.dataKitUndeploy, `${JSON.stringify(definitions.undeploy, undefined, 2)}\n`),
    ]);
  };

  if (resumed?.state.results) {
    for (const [id, result] of Object.entries(resumed.state.results)) {
      if (!result.evidence) continue;
      evidenceById[id] = result.evidence;
      const key = extractP5Identity(result.evidence.payload?.result?.item ?? result.evidence.payload?.result, [
        'devName',
        'dataKitDevName',
        'developerName',
        'segmentApiName',
        'apiName',
        'dataGraphName',
        'name',
        'id',
        'marketSegmentId',
      ]);
      if (key) dynamic.resourceKeys[id] = key;
      const recordId = queryRecordId(result.evidence.payload);
      if (recordId) dynamic.recordIds[id] = recordId;
      const lookup = deriveProfileLookup(result.evidence.payload);
      if (lookup) dynamic.profileLookups[id] = lookup;
      if (id === 'data-kit-available-owned') {
        const component = selectP5DataKitComponent(result.evidence.payload);
        if (component) dynamic.dataKitComponents[id] = component;
      }
    }
    const resumedComponent = dynamic.dataKitComponents['data-kit-available-owned'];
    if (resumedComponent) await writeDataKitComponentDefinitions(resumedComponent);
    const resumedLookup = deriveProfileLookup(
      evidenceById['query-one-shot']?.payload,
      evidenceById['profile-describe']?.payload
    );
    if (resumedLookup) dynamic.profileLookups['query-one-shot'] = resumedLookup;
  }

  const state = await runP5Scenario({
    prefix,
    statePath,
    steps,
    cleanupOnly: options.cleanup,
    authorizeCreate: (current, scenarioState) => {
      if (current.absenceNotFoundFrom) {
        const payload = scenarioState.results[current.absenceNotFoundFrom]?.evidence?.payload;
        if (!payload) {
          throw new Error(`No successful ${current.absenceNotFoundFrom} evidence exists for ${current.id}`);
        }
        if (!isP5RemoteAbsent(payload)) {
          throw new Error(`${current.absenceNotFoundFrom} did not prove exact not-found for ${current.creates}`);
        }
        return {
          status: 'absent',
          name: current.creates,
          sourceStep: current.absenceNotFoundFrom,
          provedAt: new Date().toISOString(),
        };
      }
      const source = current.absenceFrom;
      const payload = source ? scenarioState.results[source]?.evidence?.payload : undefined;
      if (!payload) throw new Error(`No successful ${source ?? 'list'} evidence exists for ${current.id}`);
      return proveP5NameAvailable(current, payload);
    },
    isCreateCollision: isP5CreateCollision,
    blockerFor: (current, scenarioState) => {
      if (current.requiresPendingFrom) {
        return pendingQueryRequiredBlocker(
          scenarioState.results[current.requiresPendingFrom]?.evidence?.payload,
          current.command
        );
      }
      if (
        current.recordFrom &&
        scenarioState.results[current.recordFrom]?.status === 'passed' &&
        !dynamic.recordIds[current.recordFrom]
      ) {
        return `The bounded ${current.recordFrom} query succeeded but returned no rows; no record ID was invented`;
      }
      if (
        current.blockerUnlessProfilePath &&
        current.dependsOn.every((dependency) => scenarioState.results[dependency]?.status === 'passed') &&
        !dynamic.profileLookups[current.profileLookupFrom]
      ) {
        return 'The approved demo query returned no complete four-part profile lookup path; no values were invented';
      }
      return undefined;
    },
    execute: async (current) => {
      if (current.blockerUnlessProfilePath && !dynamic.profileLookups[current.profileLookupFrom]) {
        throw new Error(
          'All four profile lookup path IDs could not be derived from live metadata; no values were guessed'
        );
      }
      let evidence;
      const executeOnce = (remainingMs) =>
        runScenarioCli({
          args: argsForP5Step(current, files, dynamic),
          org: options.org,
          runDirectory,
          current:
            remainingMs === undefined
              ? current
              : { ...current, timeoutMs: Math.max(1, Math.min(current.timeoutMs ?? 120_000, remainingMs)) },
          date,
          expectedFailure: current.expectedFailure,
          scenario: 'p5',
        });
      if (current.waitForSegmentReady) {
        const deadline = Date.now() + (current.waitMs ?? 5 * 60 * 1000);
        let ready = false;
        do {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          evidence = await executeOnce(remaining);
          const status = extractP5Identity(evidence.payload, ['segmentStatus', 'status']);
          if (status === 'ACTIVE') {
            ready = true;
            break;
          }
          if (['ERROR', 'FAILED'].includes(status)) {
            throw new Error(`Segment entered terminal ${status} state before it could be updated`);
          }
          const sleepMs = Math.min(10_000, deadline - Date.now());
          if (sleepMs > 0) await new Promise((done) => setTimeout(done, sleepMs));
        } while (Date.now() < deadline);
        if (!ready) throw new Error('Segment did not become ACTIVE within 5 minutes');
      } else if (current.waitForSearchReady) {
        const deadline = Date.now() + (current.waitMs ?? 10 * 60 * 1000);
        let ready = false;
        do {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          const key = dynamic.resourceKeys[current.nameFrom ?? 'search-index-create'];
          evidence = await runScenarioCli({
            args: ['data360', 'search-index', 'get', '--name', key],
            org: options.org,
            runDirectory,
            current: {
              id: `${current.id}-readiness`,
              command: 'data360 search-index get',
              timeoutMs: Math.max(1, Math.min(120_000, remaining)),
            },
            date,
            scenario: 'p5',
          });
          const status = extractP5Identity(evidence.payload, ['runtimeStatus', 'status', 'indexStatus']);
          if (['ACTIVE', 'READY', 'COMPLETED'].includes(status)) {
            ready = true;
            evidence = await executeOnce(deadline - Date.now());
            break;
          }
          const sleepMs = Math.min(15_000, deadline - Date.now());
          if (sleepMs > 0) await new Promise((done) => setTimeout(done, sleepMs));
        } while (Date.now() < deadline);
        if (!ready) {
          throw new Error('Search index did not become query-ready within 10 minutes');
        }
      } else if (current.waitForDataKitComponent) {
        const deadline = Date.now() + (current.waitMs ?? 5 * 60 * 1000);
        let component;
        do {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          evidence = await executeOnce(remaining);
          component = selectP5DataKitComponent(evidence.payload, current.expectedComponent);
          if (component) break;
          const sleepMs = Math.min(10_000, deadline - Date.now());
          if (sleepMs > 0) await new Promise((done) => setTimeout(done, sleepMs));
        } while (Date.now() < deadline);
        if (!component) throw new Error('The scenario-owned DataLakeObject did not become available within 5 minutes');
      } else if (current.waitForDataKitActive) {
        const deadline = Date.now() + (current.waitMs ?? 10 * 60 * 1000);
        let active = false;
        do {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          try {
            evidence = await executeOnce(remaining);
          } catch (error) {
            const sleepMs = Math.min(10_000, deadline - Date.now());
            if (sleepMs <= 0) throw error;
            await new Promise((done) => setTimeout(done, sleepMs));
            continue;
          }
          const status = extractP5Identity(evidence.payload, ['code', 'status']);
          if (String(status).toUpperCase() === 'ACTIVE') {
            active = true;
            break;
          }
          if (['ERROR', 'FAILED'].includes(String(status).toUpperCase())) {
            throw new Error(`Data Kit component entered terminal ${status} state`);
          }
          const sleepMs = Math.min(10_000, deadline - Date.now());
          if (sleepMs > 0) await new Promise((done) => setTimeout(done, sleepMs));
        } while (Date.now() < deadline);
        if (!active) throw new Error('Data Kit component did not become ACTIVE within 10 minutes');
      } else if (current.boundedWait) {
        evidence = await executeP5Bounded(executeOnce, {
          waitMs: current.waitMs ?? 10 * 60 * 1000,
        });
      } else {
        evidence = await executeOnce();
      }
      const key = extractP5Identity(evidence.payload?.result?.item ?? evidence.payload?.result, [
        'devName',
        'dataKitDevName',
        'developerName',
        'segmentApiName',
        'apiName',
        'dataGraphName',
        'name',
        'id',
        'marketSegmentId',
      ]);
      if (key) dynamic.resourceKeys[current.id] = key;
      if (current.id === 'search-index-list' && options.existingSearch === true) {
        const readyIndex = selectReadySearchIndex(evidence.payload);
        if (!readyIndex) throw new Error('No READY search index exists in the approved demo org');
        dynamic.resourceKeys[current.id] = readyIndex;
      }
      if (current.id === 'data-kit-available-owned') {
        const component = selectP5DataKitComponent(evidence.payload, current.expectedComponent);
        if (!component) throw new Error('No available DataLakeObject component exists for the scenario-owned Data Kit');
        dynamic.dataKitComponents[current.id] = component;
        await writeDataKitComponentDefinitions(component);
      }
      const recordId = queryRecordId(evidence.payload);
      if (recordId) dynamic.recordIds[current.id] = recordId;
      const lookup = deriveProfileLookup(evidence.payload);
      if (lookup) dynamic.profileLookups[current.id] = lookup;
      evidenceById[current.id] = evidence;
      const combinedLookup = deriveProfileLookup(
        evidenceById['query-one-shot']?.payload,
        evidenceById['profile-describe']?.payload
      );
      if (combinedLookup) dynamic.profileLookups['query-one-shot'] = combinedLookup;
      return evidence;
    },
    cleanup: async (current) =>
      verifyP5Cleanup({
        current,
        isAbsent: isP5RemoteAbsent,
        remove: async (cleanupKey) => {
          if (!current.cleanupEndpoint) throw new Error(`No exact cleanup endpoint exists for ${current.id}`);
          const endpoint = current.cleanupEndpoint.replace('{key}', encodeURIComponent(cleanupKey));
          const cleanupArgs = ['data360', 'api', 'request', endpoint, '--method', 'DELETE', '--no-prompt'];
          await runScenarioCli({
            args: cleanupArgs,
            org: options.org,
            runDirectory,
            current: { id: `cleanup-${current.id}`, command: 'data360 api request' },
            date,
            scenario: 'p5',
          });
        },
        read: async (cleanupKey) => {
          if (!current.cleanupEndpoint) throw new Error(`No exact cleanup endpoint exists for ${current.id}`);
          const endpoint = current.cleanupEndpoint.replace('{key}', encodeURIComponent(cleanupKey));
          const absence = await runScenarioCli({
            args: ['data360', 'api', 'request', endpoint, '--method', 'GET'],
            org: options.org,
            runDirectory,
            current: { id: `cleanup-${current.id}-verify`, command: 'data360 api request' },
            date,
            expectedFailure: true,
            scenario: 'p5',
          });
          return absence.payload;
        },
      }),
  });

  if (!options.cleanup) {
    const verificationPath = resolve(root, 'test', 'verification.json');
    const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
    const results = steps.map((current) => {
      const evidence = state.results[current.id]?.evidence;
      return {
        command: current.command,
        status: state.results[current.id]?.status,
        schemaValid:
          evidence?.schemaValid === true &&
          commandPayloadExitCode(current.command, evidence.payload) === 0 &&
          !current.blocker,
      };
    });
    // P5 cleanup uses exact raw API endpoints to avoid name-resolution ambiguity. A successful raw
    // cleanup proves disposal, but it is not execution evidence for the user-facing delete command.
    const invalidatedContinuations = new Set(
      steps
        .filter(
          (current) =>
            current.requiresPendingFrom &&
            state.results[current.id]?.status === 'blocked' &&
            state.results[current.id]?.reason?.includes('was not invoked')
        )
        .map((current) => current.command)
    );
    const reconciledVerification = verification.map((row) =>
      invalidatedContinuations.has(row.command) ? { ...row, live: null } : row
    );
    await writeFile(
      verificationPath,
      `${JSON.stringify(applySuccessfulVerification(reconciledVerification, results, date), undefined, 2)}\n`
    );
  }
  const counts = { passed: 0, expectedError: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const [id, result] of Object.entries(state.results)) {
    const current = steps.find((entry) => entry.id === id);
    if (
      result.status === 'passed' &&
      current?.expectedFailure &&
      commandPayloadExitCode(current.command, result.evidence?.payload) !== 0
    )
      counts.expectedError += 1;
    else counts[result.status] += 1;
  }
  const resourceKeyForStep = (id) => {
    const current = steps.find((entry) => entry.id === id);
    if (!current) return `unknown:${id}`;
    return (
      p5CleanupKey({
        ...current,
        createEvidence: state.results[id]?.evidence,
        createFailureReason: state.results[id]?.reason,
        ownershipProof: state.ownershipProofs?.[id],
      }) ?? `unknown:${id}`
    );
  };
  const cleanupByStep = new Map(state.cleanup.map((entry) => [entry.step, entry]));
  const retainedOrUnknown = [
    ...new Set(
      state.cleanupStack
        .filter(
          ({ step: id, status }) => !resolvedCleanupStatuses.has(status) || cleanupByStep.get(id)?.status === 'failed'
        )
        .map(({ step: id }) => resourceKeyForStep(id))
    ),
  ];
  const unexpectedFailures = Object.entries(state.results).filter(([id, result]) => {
    if (result.status !== 'failed') return false;
    const current = steps.find((entry) => entry.id === id);
    return !(current?.expectedFailure && commandPayloadExitCode(current.command, result.evidence?.payload) !== 0);
  });
  const indeterminateBilling = state.billableOutcomes.some(({ status }) => status === 'attempted');
  const failed = liveRunRequiresFailureExit(state, {
    // P5 has structured expected-error steps, so its result-failure policy is
    // supplied explicitly after separating those from unexpected failures.
    ignoreResultFailures: true,
    additionalFailure:
      (!options.cleanup && unexpectedFailures.length > 0) || retainedOrUnknown.length > 0 || indeterminateBilling,
  });
  const summarizedResults = Object.fromEntries(
    Object.entries(state.results).map(([id, result]) => [
      id,
      {
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.evidence
          ? {
              fixture: result.evidence.fixture ?? null,
              schemaValid: result.evidence.schemaValid === true,
              outcome:
                commandPayloadExitCode(
                  steps.find((entry) => entry.id === id)?.command ?? '',
                  result.evidence.payload
                ) === 0
                  ? 'success'
                  : 'error',
            }
          : {}),
      },
    ])
  );
  if (failed) process.exitCode = 1;
  writeLiveSummary(
    {
      scenario: 'p5',
      status: failed ? 'failed' : 'complete',
      prefix,
      state: stateReference(statePath, options.org),
      counts,
      billing: {
        attempts: state.billableAttempts,
        successful: state.billableCalls,
        outcomes: state.billableOutcomes,
      },
      resources: {
        created: Object.entries(state.results)
          .filter(([, result]) => result.status === 'passed')
          .filter(([id]) => Boolean(steps.find((current) => current.id === id)?.creates))
          .map(([id]) => resourceKeyForStep(id)),
        cleaned: state.cleanup
          .filter(({ status }) => status === 'passed')
          .map(({ step: id }) => resourceKeyForStep(id)),
        retainedOrUnknown,
      },
      cleanup: state.cleanup,
      results: summarizedResults,
    },
    options.org
  );
};

export const latestP6State = async (directory, org) => {
  const prefix = `${p5StateFileOrgKey(org)}-lv_p6_`;
  const files = (await readdir(directory)).filter((file) => file.startsWith(prefix) && file.endsWith('.json')).sort();
  if (files.length === 0) return null;
  const path = resolve(directory, files.at(-1));
  let state;
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot safely inspect P6 ledger ${path}: ${error instanceof Error ? error.message : error}`);
  }
  if (!state || typeof state !== 'object' || typeof state.prefix !== 'string' || !state.results) {
    throw new Error(`Cannot safely inspect malformed P6 ledger ${path}`);
  }
  return { path, state };
};

const runP6Main = async (options) => {
  const date = new Date().toISOString().slice(0, 10);
  const stateDirectory = resolve(root, '.tmp', 'live-verify', 'p6');
  await mkdir(stateDirectory, { recursive: true });
  const resumed = options.resume ? await latestP6State(stateDirectory, options.org) : null;
  if (options.resume && !resumed) throw new Error('No P6 probe ledger exists to resume');
  const prefix = resumed?.state.prefix ?? createP6Prefix();
  const statePath = resumed?.path ?? resolve(stateDirectory, `${p5StateFileOrgKey(options.org)}-${prefix}.json`);
  const runDirectory = resolve(root, '.tmp', 'live-verify', prefix);
  await mkdir(runDirectory, { recursive: true });
  const steps = buildP6Plan(prefix);
  const evidenceById = {};
  for (const [id, result] of Object.entries(resumed?.state.results ?? {})) {
    if (result.evidence) evidenceById[id] = result.evidence;
  }

  const state = await runP6Scenario({
    prefix,
    statePath,
    steps,
    blockerFor: (current) => p6DependencyBlocker(current, evidenceById),
    execute: async (current) => {
      const fixtureCommand = current.probeCommand ?? current.command;
      const evidence = await runScenarioCli({
        args: argsForP6Step(current, evidenceById),
        org: options.org,
        runDirectory,
        current: { ...current, fixtureCommand, allowSuccess: true },
        date,
        expectedFailure: Boolean(current.expectedError),
        captureFailure: true,
        scenario: 'p6',
      });
      const payloadExitCode = commandPayloadExitCode(current.command, evidence.payload);
      const classification = classifyP6Evidence({
        operation: current.operation,
        payload: evidence.payload,
        fixture: evidence.fixture,
        ...(payloadExitCode === 0 ? {} : { error: evidence.payload }),
        timedOut: evidence.payload?.name === 'D360_LIVE_TIMEOUT',
        expectedError: Boolean(current.expectedError),
      });
      const result = { ...evidence, classification };
      evidenceById[current.id] = result;
      return result;
    },
    cleanup: async () => ({ exitCode: 0, deletionConfirmed: true }),
  });

  const verificationPath = resolve(root, 'test', 'verification.json');
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  const successful = steps.map((current) => ({
    command: current.probeCommand ?? current.command,
    status: state.results[current.id]?.evidence?.classification?.status === 'verified' ? 'passed' : 'blocked',
    schemaValid:
      state.results[current.id]?.evidence?.schemaValid === true &&
      state.results[current.id]?.evidence?.classification?.commandEligible === true,
  }));
  await writeFile(
    verificationPath,
    `${JSON.stringify(applySuccessfulVerification(verification, successful, date), undefined, 2)}\n`
  );

  const counts = { passed: 0, expectedError: 0, failed: 0, blocked: 0, skipped: 0, timedOut: 0 };
  const probeLedger = [];
  for (const current of steps) {
    const result = state.results[current.id];
    const classification = result?.evidence?.classification;
    let status = p6LedgerStatus(result?.status ?? 'failed', classification?.status);
    if (!(status in counts)) status = 'failed';
    counts[status] += 1;
    probeLedger.push({
      id: current.id,
      command: current.probeCommand ?? current.command,
      status,
      fixture: result?.evidence?.fixture,
      reason: classification?.reason ?? result?.reason ?? current.blocker,
    });
  }
  if (liveRunRequiresFailureExit(state, { additionalFailure: counts.failed > 0 || counts.timedOut > 0 })) {
    process.exitCode = 1;
  }
  writeLiveSummary(
    {
      scenario: 'p6',
      prefix,
      state: stateReference(statePath, options.org),
      counts,
      probeLedger,
      resources: { created: [], cleaned: [], retained: [] },
      repl: p6TtyChecklist().map(({ id }) => ({ id, status: 'blocked', evidence: 'manual-tty required' })),
    },
    options.org
  );
};

export const genericPlanDisposition = (entry, options) => {
  const explicitBillableSelection = new Set(options.billableCommands ?? []);
  const selectedDependencies = new Set(
    [...explicitBillableSelection].map((command) => listDependency.get(command)).filter(Boolean)
  );
  if (
    explicitBillableSelection.size > 0 &&
    !explicitBillableSelection.has(entry.command) &&
    !selectedDependencies.has(entry.command)
  ) {
    return {
      runnable: false,
      result: {
        status: 'skipped',
        schemaValid: false,
        reason: 'outside explicit billable command selection',
      },
    };
  }
  if (options.phase !== 'all' && entry.phase !== options.phase && !selectedDependencies.has(entry.command)) {
    return {
      runnable: false,
      result: { status: 'skipped', schemaValid: false, reason: 'outside selected phase' },
    };
  }
  if (entry.credit && (!options.billable || !explicitBillableSelection.has(entry.command))) {
    return {
      runnable: false,
      result: { status: 'skipped', schemaValid: false, reason: 'billable operations disabled' },
    };
  }
  if (mutationKinds.has(entry.kind) && !options.mutations) {
    return {
      runnable: false,
      result: { status: 'skipped', schemaValid: false, reason: 'mutations disabled' },
    };
  }
  if (safeStandalone.has(entry.command) || listDependency.has(entry.command)) return { runnable: true };
  return {
    runnable: false,
    result: {
      status: 'blocked',
      schemaValid: false,
      reason: 'safe read requires an unavailable disposable or prior-run dependency',
    },
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  await validateTargetOrg(options.org);
  if (options.scenario === 'foundation') {
    await runFoundationMain(options);
    return;
  }
  if (options.scenario === 'p4') {
    await runP4Main(options);
    return;
  }
  if (options.scenario === 'p4-stream') {
    await runP4StreamMain(options);
    return;
  }
  if (options.scenario === 'p5') {
    await runP5Main(options);
    return;
  }
  if (options.scenario === 'p6') {
    await runP6Main(options);
    return;
  }
  const plan = await buildPlan(root);
  const date = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/gu, '');
  const stateDirectory = resolve(root, '.tmp', 'live-verify');
  await mkdir(stateDirectory, { recursive: true });
  const resumed = options.resume ? await loadResumeState(stateDirectory, options.org) : null;
  const statePath =
    resumed?.path ?? resolve(stateDirectory, `${options.org.replaceAll(/[^a-zA-Z0-9_-]/gu, '_')}-${timestamp}.json`);
  const state = resumed?.state ?? {
    version: 1,
    org: options.org,
    startedAt: new Date().toISOString(),
    options,
    results: {},
  };

  const runnable = [];
  for (const entry of plan) {
    const disposition = genericPlanDisposition(entry, options);
    if (disposition.runnable) runnable.push(entry);
    else state.results[entry.command] ??= disposition.result;
  }
  runnable.sort((left, right) => {
    const leftPriority = safeStandalone.has(left.command) ? 0 : 1;
    const rightPriority = safeStandalone.has(right.command) ? 0 : 1;
    return leftPriority - rightPriority || left.command.localeCompare(right.command);
  });

  const dependencies = new Map();
  for (const [command, result] of Object.entries(state.results)) {
    if (result.status !== 'passed' || !result.fixture) continue;
    try {
      dependencies.set(command, JSON.parse(await readFile(resolve(root, 'test', 'fixtures', result.fixture), 'utf8')));
    } catch {}
  }
  await executePlan(
    runnable,
    state,
    {
      resume: options.resume,
      retryFailed: options.retryFailed,
      retryBlocked: options.retryBlocked,
      beforeRun: async (entry, current) => prepareBillableAttempt(entry, current),
      onProgress: async (current) => writeState(statePath, current),
    },
    (entry) => runCommand(entry, options.org, dependencies, stateDirectory, date)
  );

  const verificationPath = resolve(root, 'test', 'verification.json');
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
  const results = Object.entries(state.results).map(([command, result]) => ({ command, ...result }));
  const updated = applySuccessfulVerification(verification, results, date);
  await writeFile(verificationPath, `${JSON.stringify(updated, undefined, 2)}\n`);
  state.completedAt = new Date().toISOString();
  await writeState(statePath, state);

  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const result of Object.values(state.results)) counts[result.status] += 1;
  if (liveRunRequiresFailureExit(state)) process.exitCode = 1;
  writeLiveSummary(
    { state: stateReference(statePath, options.org), counts, results: summarizeLiveResults(state.results) },
    options.org
  );
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${scrubString(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  });
}
