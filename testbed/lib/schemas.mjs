import { access, lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { assertLeakFree } from './redactor.mjs';
import { readEvents } from './trace.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDirectory = join(root, 'schema');

let validators;

const loadValidators = async () => {
  if (validators) return validators;
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  const entries = await Promise.all(
    ['session', 'event', 'results', 'suite'].map(async (name) => [
      name,
      ajv.compile(JSON.parse(await readFile(join(schemaDirectory, `${name}.schema.json`), 'utf8'))),
    ])
  );
  validators = Object.fromEntries(entries);
  return validators;
};

const formatErrors = (validate) =>
  (validate.errors ?? []).map(({ instancePath, message }) => `${instancePath || '/'} ${message}`).join('; ');

const totalsForEvents = (events) => {
  const outcomes = events.filter(({ type }) => type === 'scenario.end').map(({ outcome }) => outcome);
  return {
    steps: outcomes.length,
    passed: outcomes.filter((value) => value === 'pass').length,
    failed: outcomes.filter((value) => value === 'fail').length,
    blocked: outcomes.filter((value) => value === 'blocked').length,
    skipped: outcomes.filter((value) => value === 'skipped').length,
    notes: events.filter(({ type }) => type === 'note').length,
    assertions: events.filter(({ type }) => type === 'assertion').length,
    httpEvents: events.filter(({ type }) => type === 'http.request' || type === 'http.response').length,
  };
};

const totalsMatch = (actual, expected) =>
  actual !== undefined && Object.entries(expected).every(([key, value]) => actual[key] === value);

export const validateSuite = async (suite) => {
  const { suite: validate } = await loadValidators();
  if (!validate(suite)) throw new Error(`Suite schema validation failed: ${formatErrors(validate)}`);
  for (const step of suite.steps) {
    for (const command of step.commands) {
      for (const condition of Object.values(command.expect.jsonPath ?? {})) {
        if (condition.matches !== undefined) {
          try {
            new RegExp(condition.matches, 'u');
          } catch (error) {
            throw new Error(`Suite schema validation failed: invalid jsonPath regex: ${error.message}`);
          }
        }
      }
    }
  }
  return suite;
};

export const validateSessionDirectory = async (sessionDirectory) => {
  const loaded = await loadValidators();
  const sessionPath = join(sessionDirectory, 'session.json');
  const sessionText = await readFile(sessionPath, 'utf8');
  const session = JSON.parse(sessionText);
  const errors = [];
  if (!loaded.session(session)) errors.push(`session.json: ${formatErrors(loaded.session)}`);
  const events = await readEvents(sessionDirectory);
  const resultsText = await readFile(join(sessionDirectory, 'results.json'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  let results;
  if (resultsText) {
    try {
      results = JSON.parse(resultsText);
      if (!loaded.results(results)) errors.push(`results.json: ${formatErrors(loaded.results)}`);
    } catch (error) {
      errors.push(`results.json: invalid JSON: ${error.message}`);
    }
  }
  const sequences = new Set();
  const eventsBySequence = new Map();
  const commandResults = new Map();
  const httpResponses = new Map();
  const openScenarios = new Map();
  let previous = -1;
  for (const [index, event] of events.entries()) {
    if (!loaded.event(event)) errors.push(`events.jsonl:${index + 1}: ${formatErrors(loaded.event)}`);
    if (event.sid !== session.sid) errors.push(`events.jsonl:${index + 1}: sid does not match session.json`);
    if (event.seq !== index)
      errors.push(`events.jsonl:${index + 1}: seq must be consecutive from zero (expected ${index})`);
    if (sequences.has(event.seq) || event.seq <= previous)
      errors.push(`events.jsonl:${index + 1}: seq must be unique and strictly increasing`);
    sequences.add(event.seq);
    eventsBySequence.set(event.seq, event);
    previous = event.seq;
  }
  for (const [index, event] of events.entries()) {
    if (['assertion', 'note'].includes(event.type)) {
      for (const evidence of event.evidence ?? []) {
        if (!sequences.has(evidence)) errors.push(`events.jsonl:${index + 1}: missing evidence seq ${evidence}`);
      }
    }
    if (event.type === 'command.result') {
      const command = eventsBySequence.get(event.seqRef);
      if (!command || command.type !== 'command.exec')
        errors.push(`events.jsonl:${index + 1}: seqRef must identify a command.exec`);
      const results = commandResults.get(event.seqRef) ?? [];
      results.push(event.seq);
      commandResults.set(event.seqRef, results);
    }
    if (event.type === 'http.request') {
      const command = eventsBySequence.get(event.seqRef);
      if (!command || command.type !== 'command.exec')
        errors.push(`events.jsonl:${index + 1}: seqRef must identify a command.exec`);
    }
    if (event.type === 'http.response') {
      const request = eventsBySequence.get(event.requestRef);
      if (!request || request.type !== 'http.request')
        errors.push(`events.jsonl:${index + 1}: requestRef must identify an http.request`);
      else if (
        request.seqRef !== event.seqRef ||
        request.root !== event.root ||
        request.retryAttempt !== event.retryAttempt
      )
        errors.push(`events.jsonl:${index + 1}: response does not match its referenced request`);
      const responses = httpResponses.get(event.requestRef) ?? [];
      responses.push(event.seq);
      httpResponses.set(event.requestRef, responses);
    }
    if (event.type === 'scenario.start') {
      const key = `${event.suite}\0${event.scenario}`;
      if (openScenarios.has(key)) errors.push(`events.jsonl:${index + 1}: scenario already has an open start event`);
      else openScenarios.set(key, event.seq);
    }
    if (event.type === 'scenario.end') {
      const key = `${event.suite}\0${event.scenario}`;
      if (!openScenarios.has(key)) errors.push(`events.jsonl:${index + 1}: scenario.end has no matching start`);
      else openScenarios.delete(key);
    }
    for (const payload of [event.stdin, event.stdout]) {
      if (payload?.rawFile) {
        const rawPath = resolve(sessionDirectory, payload.rawFile);
        const rawRelative = relative(resolve(sessionDirectory), rawPath);
        if (rawRelative.startsWith('..') || isAbsolute(rawRelative)) {
          errors.push(`events.jsonl:${index + 1}: rawFile escapes session directory`);
        } else {
          try {
            await access(rawPath);
            if ((await lstat(rawPath)).isSymbolicLink())
              errors.push(`events.jsonl:${index + 1}: rawFile must not be a symlink`);
          } catch {
            errors.push(`events.jsonl:${index + 1}: missing rawFile ${payload.rawFile}`);
          }
        }
      }
    }
  }
  for (const event of events.filter(({ type }) => type === 'command.exec')) {
    const results = commandResults.get(event.seq) ?? [];
    if (results.length !== 1)
      errors.push(`events.jsonl: command.exec seq ${event.seq} must have exactly one command.result`);
  }
  for (const event of events.filter(({ type }) => type === 'http.request')) {
    const responses = httpResponses.get(event.seq) ?? [];
    if (responses.length !== 1)
      errors.push(`events.jsonl: http.request seq ${event.seq} must have exactly one http.response`);
  }
  for (const [key, sequence] of openScenarios)
    errors.push(`events.jsonl: scenario starting at seq ${sequence} has no matching end (${key.replace('\0', '/')})`);

  if (results?.suites && typeof results.suites === 'object') {
    for (const [suite, steps] of Object.entries(results.suites)) {
      if (!steps || typeof steps !== 'object') continue;
      for (const [scenario, result] of Object.entries(steps)) {
        if (!result || typeof result !== 'object') continue;
        const outcome = events
          .filter((event) => event.type === 'scenario.end' && event.suite === suite && event.scenario === scenario)
          .at(-1);
        if (!outcome) errors.push(`results.json: ${suite}/${scenario} has no matching scenario.end event`);
        else if (outcome.outcome !== result.outcome)
          errors.push(`results.json: ${suite}/${scenario} outcome does not match its scenario.end event`);
        const commands = Array.isArray(result.commands) ? result.commands : [];
        for (const [commandIndex, command] of commands.entries()) {
          const [execSequence, resultSequence] = command.evidence ?? [];
          const execution = eventsBySequence.get(execSequence);
          const commandResult = eventsBySequence.get(resultSequence);
          if (
            execution?.type !== 'command.exec' ||
            commandResult?.type !== 'command.result' ||
            commandResult.seqRef !== execution.seq
          ) {
            errors.push(`results.json: ${suite}/${scenario} command ${commandIndex} has invalid evidence`);
            continue;
          }
          if (JSON.stringify(execution.displayArgv ?? execution.argv) !== JSON.stringify(command.argv))
            errors.push(`results.json: ${suite}/${scenario} command ${commandIndex} argv does not match evidence`);
          if (commandResult.exitCode !== command.exitCode)
            errors.push(`results.json: ${suite}/${scenario} command ${commandIndex} exitCode does not match evidence`);
        }
      }
    }
  }

  const starts = events.filter(({ type }) => type === 'session.start');
  const ends = events.filter(({ type }) => type === 'session.end');
  if (events[0]?.type !== 'session.start' || starts.length !== 1)
    errors.push('events.jsonl: session must contain exactly one session.start as its first event');
  if (session.endedAt) {
    if (events.at(-1)?.type !== 'session.end' || ends.length !== 1)
      errors.push('events.jsonl: ended session must contain exactly one session.end as its final event');
    const expectedTotals = totalsForEvents(events);
    if (!totalsMatch(session.totals, expectedTotals)) errors.push('session.json: totals do not match recorded events');
    if (!totalsMatch(ends[0]?.totals, expectedTotals))
      errors.push('events.jsonl: session.end totals do not match recorded events');
  } else if (ends.length > 0) {
    errors.push('events.jsonl: active session must not contain session.end');
  }
  try {
    const recordedSequence = Number.parseInt(await readFile(join(sessionDirectory, 'events.jsonl.seq'), 'utf8'), 10);
    if (!Number.isInteger(recordedSequence) || recordedSequence !== events.at(-1)?.seq)
      errors.push('events.jsonl.seq: sequence does not match the final event');
  } catch (error) {
    if (error.code === 'ENOENT') errors.push('events.jsonl.seq: missing sequence ledger');
    else throw error;
  }
  const allowedFiles = new Set(['events.jsonl', 'events.jsonl.seq', 'results.json', 'session.json']);
  const rootEntries = await readdir(sessionDirectory, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.name === 'raw' && entry.isDirectory()) continue;
    if (!entry.isFile() || !allowedFiles.has(entry.name))
      errors.push(`session directory contains unexpected artifact: ${entry.name}`);
  }
  const rawFiles = [];
  const rawEntries = await readdir(join(sessionDirectory, 'raw'), { withFileTypes: true }).catch(() => []);
  for (const entry of rawEntries) {
    if (!entry.isFile() || !/^sha256-[a-f0-9]{64}\.txt$/u.test(entry.name))
      errors.push(`raw directory contains unexpected artifact: ${entry.name}`);
    else rawFiles.push(join(sessionDirectory, 'raw', entry.name));
  }
  try {
    assertLeakFree(sessionText, 'session.json');
    assertLeakFree(JSON.stringify(events), 'events.jsonl');
    if (resultsText) assertLeakFree(resultsText, 'results.json');
    for (const rawFile of rawFiles)
      assertLeakFree(await readFile(rawFile, 'utf8'), relative(sessionDirectory, rawFile));
  } catch (error) {
    errors.push(error.message);
  }
  return { valid: errors.length === 0, errors, session, events };
};
