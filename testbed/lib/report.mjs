import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { redactValue } from './redactor.mjs';
import { readEvents, writeJson } from './trace.mjs';
import { repositoryRoot, sessionsRoot } from './session.mjs';

const defaultReportsRoot = join(repositoryRoot, 'internal', 'testbed', 'reports');

const percentile = (values, ratio) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

const commandKey = (argv = []) => {
  const values = argv[0] === 'sf' ? argv.slice(1) : argv;
  const flag = values.findIndex((value) => value.startsWith('-'));
  return (flag < 0 ? values : values.slice(0, flag)).join(' ');
};

const buildKey = (session) => session.plugin?.buildHash ?? 'unknown-build';
const clusterKey = ({ buildHash, mode, id }) => `${buildHash}:${mode}:${id}`;

const normalizeSession = (entry) => ({
  session: entry.session,
  events: entry.events,
  assertions: entry.events.filter(({ type }) => type === 'assertion'),
  outcomes: entry.events.filter(({ type }) => type === 'scenario.end'),
  commands: entry.events.filter(({ type }) => type === 'command.exec'),
  results: entry.events.filter(({ type }) => type === 'command.result'),
  notes: entry.events.filter(({ type }) => type === 'note'),
});

export const buildReport = (entries, previous) => {
  const sessions = entries.map(normalizeSession);
  const outcomes = [];
  for (const entry of sessions) {
    for (const event of entry.outcomes) {
      outcomes.push({
        sid: entry.session.sid,
        agent: entry.session.agent,
        model: entry.session.model,
        mode: entry.session.mode,
        buildHash: buildKey(entry.session),
        suite: event.suite,
        scenario: event.scenario,
        outcome: event.outcome,
        durationMs: event.durationMs,
      });
    }
  }

  const assertionGroups = new Map();
  for (const entry of sessions) {
    for (const assertion of entry.assertions) {
      const key = `${buildKey(entry.session)}:${entry.session.mode}:${assertion.id}`;
      const group = assertionGroups.get(key) ?? [];
      group.push({
        id: assertion.id,
        buildHash: buildKey(entry.session),
        mode: entry.session.mode,
        sid: entry.session.sid,
        agent: entry.session.agent,
        model: entry.session.model,
        pass: assertion.pass,
        criterion: assertion.criterion,
        evidence: assertion.evidence,
        expected: assertion.expected,
        actual: assertion.actual,
      });
      assertionGroups.set(key, group);
    }
  }
  const clusters = [...assertionGroups.entries()]
    .filter(([, values]) => values.some(({ pass }) => !pass))
    .map(([, values]) => {
      const failures = values.filter(({ pass }) => !pass);
      const identities = new Set(failures.map(({ agent, model }) => `${agent}:${model}`));
      const classification =
        identities.size >= 2
          ? 'suspected-cli-bug'
          : values.some(({ pass }) => pass)
            ? 'suspected-agent-usage'
            : 'untriaged';
      return {
        id: values[0].id,
        buildHash: values[0].buildHash,
        mode: values[0].mode,
        criterion: values[0].criterion,
        classification,
        failures,
      };
    });

  const commandResults = [];
  const errorCodes = {};
  const errorActions = {};
  const retrySequences = [];
  let failedCommands = 0;
  let recoveredCommands = 0;
  for (const entry of sessions) {
    const execBySeq = new Map(entry.commands.map((event) => [event.seq, event]));
    const orderedResults = [...entry.results].sort((left, right) => left.seq - right.seq);
    for (const result of entry.results) {
      const exec = execBySeq.get(result.seqRef);
      const command = commandKey(exec?.displayArgv ?? exec?.argv);
      commandResults.push({
        sid: entry.session.sid,
        agent: entry.session.agent,
        model: entry.session.model,
        mode: entry.session.mode,
        buildHash: buildKey(entry.session),
        command,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
      });
      const source = `${result.stderr?.full ?? ''}\n${JSON.stringify(result.jsonEnvelope ?? {})}`;
      const observedCodes = new Set([...source.matchAll(/\bD360_[A-Z_]+\b/gu)].map(([code]) => code));
      for (const code of observedCodes) errorCodes[code] = (errorCodes[code] ?? 0) + 1;
      for (const action of Array.isArray(result.jsonEnvelope?.actions) ? result.jsonEnvelope.actions : []) {
        if (typeof action === 'string' && action.trim()) errorActions[action] = (errorActions[action] ?? 0) + 1;
      }
      if (result.exitCode !== 0) {
        failedCommands += 1;
        const later = orderedResults.find(
          (candidate) =>
            candidate.seq > result.seq &&
            candidate.exitCode === 0 &&
            commandKey(execBySeq.get(candidate.seqRef)?.displayArgv ?? execBySeq.get(candidate.seqRef)?.argv) ===
              command
        );
        if (later) recoveredCommands += 1;
      }
    }
    const requests = entry.events.filter(({ type, root }) => type === 'http.request' && root !== 'mock');
    const responses = entry.events.filter(({ type, root }) => type === 'http.response' && root !== 'mock');
    const groups = new Map();
    for (const request of requests) {
      const key = `${request.seqRef}:${request.method}:${request.url}`;
      const values = groups.get(key) ?? [];
      values.push(request);
      groups.set(key, values);
    }
    for (const values of groups.values()) {
      if (values.length < 2) continue;
      const first = values[0];
      const exec = execBySeq.get(first.seqRef);
      retrySequences.push({
        sid: entry.session.sid,
        agent: entry.session.agent,
        model: entry.session.model,
        command: commandKey(exec?.displayArgv ?? exec?.argv),
        method: first.method,
        url: first.url,
        attempts: values
          .sort((left, right) => left.retryAttempt - right.retryAttempt)
          .map((request) => {
            const response = responses.find((candidate) => candidate.requestRef === request.seq);
            return {
              retryAttempt: request.retryAttempt,
              status: response?.status,
              durationMs: response?.durationMs,
            };
          }),
      });
    }
  }
  const durations = new Map();
  for (const result of commandResults) {
    const key = `${result.buildHash}\0${result.command}`;
    const values = durations.get(key) ?? [];
    values.push(result.durationMs);
    durations.set(key, values);
  }
  const performance = [...durations.entries()]
    .map(([key, values]) => {
      const [buildHash, command] = key.split('\0', 2);
      return {
        buildHash,
        command,
        samples: values.length,
        p50Ms: percentile(values, 0.5),
        p95Ms: percentile(values, 0.95),
      };
    })
    .sort((left, right) => right.p95Ms - left.p95Ms);

  const notes = sessions.flatMap((entry) =>
    entry.notes.map((note) => ({
      sid: entry.session.sid,
      agent: entry.session.agent,
      model: entry.session.model,
      taxonomy: note.taxonomy,
      severity: note.severity,
      text: note.text,
      evidence: note.evidence,
    }))
  );
  const failedIds = new Set(clusters.map(clusterKey));
  const previousIds = new Set(previous?.clusters?.map(clusterKey) ?? []);
  const outcomeGroups = new Map();
  for (const outcome of outcomes) {
    const session = sessions.find(({ session }) => session.sid === outcome.sid)?.session;
    const key = `${buildKey(session ?? {})}:${outcome.agent}:${outcome.model}:${outcome.mode}:${outcome.suite}:${outcome.scenario}`;
    const values = outcomeGroups.get(key) ?? [];
    values.push(outcome);
    outcomeGroups.set(key, values);
  }
  const trends = {
    newFailures: [...failedIds].filter((id) => !previousIds.has(id)),
    fixedFailures: [...previousIds].filter((id) => !failedIds.has(id)),
    flakes: [...outcomeGroups.entries()]
      .filter(([, values]) => {
        const observed = new Set(values.map(({ outcome }) => outcome));
        return observed.has('pass') && observed.has('fail');
      })
      .map(([id, values]) => ({ id, sessions: values.map(({ sid }) => sid) })),
  };
  return redactValue({
    generatedAt: new Date().toISOString(),
    sessions: sessions.map(({ session }) => ({
      sid: session.sid,
      agent: session.agent,
      model: session.model,
      mode: session.mode,
      suites: session.suites,
      totals: session.totals,
      plugin: session.plugin,
    })),
    summary: {
      sessions: sessions.length,
      scenarios: outcomes.length,
      passed: outcomes.filter(({ outcome }) => outcome === 'pass').length,
      failed: outcomes.filter(({ outcome }) => outcome === 'fail').length,
      blocked: outcomes.filter(({ outcome }) => outcome === 'blocked').length,
      assertions: sessions.reduce((total, entry) => total + entry.assertions.length, 0),
      failureClusters: clusters.length,
    },
    outcomes,
    clusters,
    errorCodes,
    errorActions,
    errorRecovery: {
      failedCommands,
      recoveredByLaterSameCommand: recoveredCommands,
      rate: failedCommands === 0 ? 1 : recoveredCommands / failedCommands,
    },
    retrySequences,
    performance,
    notes,
    trends,
  });
};

const markdown = (report) => {
  const lines = [
    '# Agent Testbed report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    '| Sessions | Scenarios | Passed | Failed | Blocked | Assertions | Failure clusters |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${report.summary.sessions} | ${report.summary.scenarios} | ${report.summary.passed} | ${report.summary.failed} | ${report.summary.blocked} | ${report.summary.assertions} | ${report.summary.failureClusters} |`,
    '',
    '## Builds under test',
    '',
    '| Session | Version | Commit | Build hash | Dirty |',
    '| --- | --- | --- | --- | --- |',
    ...report.sessions.map(
      (entry) =>
        `| ${entry.sid} | ${entry.plugin?.version ?? '?'} | ${(entry.plugin?.commit ?? '?').slice(0, 12)} | ${(entry.plugin?.buildHash ?? '?').slice(0, 19)} | ${entry.plugin?.dirtyTree === true ? 'yes' : 'no'} |`
    ),
    '',
    '## Outcome matrix',
    '',
    '| Suite | Scenario | Mode | Agent / model | Outcome | Duration ms |',
    '| --- | --- | --- | --- | --- | ---: |',
    ...report.outcomes.map(
      (entry) =>
        `| ${entry.suite} | ${entry.scenario} | ${entry.mode} | ${entry.agent} / ${entry.model} | ${entry.outcome} | ${Math.round(entry.durationMs)} |`
    ),
    '',
    '## Triangulated failures',
    '',
  ];
  if (report.clusters.length === 0) lines.push('No failing assertion clusters.');
  else {
    lines.push(
      '| Assertion | Build | Mode | Criterion | Classification | Independent failures |',
      '| --- | --- | --- | --- | --- | ---: |'
    );
    for (const cluster of report.clusters)
      lines.push(
        `| ${cluster.id} | ${cluster.buildHash.slice(0, 19)} | ${cluster.mode} | ${cluster.criterion} | ${cluster.classification} | ${cluster.failures.length} |`
      );
  }
  lines.push(
    '',
    '## Performance',
    '',
    '| Build | Command | Samples | p50 ms | p95 ms |',
    '| --- | --- | ---: | ---: | ---: |'
  );
  for (const entry of report.performance)
    lines.push(
      `| ${entry.buildHash.slice(0, 19)} | ${entry.command} | ${entry.samples} | ${Math.round(entry.p50Ms)} | ${Math.round(entry.p95Ms)} |`
    );
  lines.push('', '## Error codes', '');
  const codes = Object.entries(report.errorCodes);
  if (codes.length === 0) lines.push('No `D360_*` errors observed.');
  else for (const [code, count] of codes.sort()) lines.push(`- ${code}: ${count}`);
  lines.push('', '## Suggested error actions', '');
  const actions = Object.entries(report.errorActions);
  if (actions.length === 0) lines.push('No structured error actions observed.');
  else
    for (const [action, count] of actions.sort((left, right) => right[1] - left[1]))
      lines.push(`- ${count}× ${action}`);
  lines.push(
    '',
    '## Retry sequences',
    '',
    `Observed ${report.retrySequences.length} multi-attempt request sequence(s).`,
    ''
  );
  if (report.retrySequences.length > 0) {
    lines.push('| Command | Method / URL | Attempts (status, duration ms) |', '| --- | --- | --- |');
    for (const sequence of report.retrySequences) {
      const attempts = sequence.attempts
        .map(
          ({ retryAttempt, status, durationMs }) => `${retryAttempt}: ${status ?? '?'} / ${Math.round(durationMs ?? 0)}`
        )
        .join('; ');
      lines.push(`| ${sequence.command} | ${sequence.method} ${sequence.url} | ${attempts} |`);
    }
  }
  lines.push(
    '',
    '## Error-action recovery',
    '',
    `Later same-command success followed ${report.errorRecovery.recoveredByLaterSameCommand} of ${report.errorRecovery.failedCommands} nonzero command results (${Math.round(report.errorRecovery.rate * 100)}%). This is a mechanical signal; scenario intent determines whether a retry was appropriate.`
  );
  lines.push('', '## Notes', '');
  if (report.notes.length === 0) lines.push('No agent notes.');
  else
    for (const note of report.notes)
      lines.push(
        `- [${note.severity}] ${note.taxonomy}: ${note.text} (session ${note.sid}; evidence ${note.evidence.join(', ')})`
      );
  lines.push(
    '',
    '## Trend delta',
    '',
    `- New failures: ${report.trends.newFailures.length}`,
    `- Fixed failures: ${report.trends.fixedFailures.length}`,
    `- Flakes: ${report.trends.flakes.length}`
  );
  return `${lines.join('\n')}\n`;
};

const loadDirectories = async (pattern) => {
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  let directories = entries.filter((entry) => entry.isDirectory()).map((entry) => join(sessionsRoot, entry.name));
  if (pattern) {
    if (!pattern.includes('*')) directories = [resolve(pattern)];
    else {
      const expression = new RegExp(
        `^${basename(pattern)
          .replaceAll(/[.+?^${}()|[\]\\]/gu, '\\$&')
          .replaceAll('*', '.*')}$`,
        'u'
      );
      directories = directories.filter((directory) => expression.test(basename(directory)));
    }
  }
  return directories;
};

const sinceThreshold = (since) => {
  if (!since) return undefined;
  const match = /^(\d+)([dh])$/u.exec(since);
  if (!match) throw new Error('--since must use Nd or Nh, for example 7d');
  const milliseconds = Number(match[1]) * (match[2] === 'd' ? 86_400_000 : 3_600_000);
  return Date.now() - milliseconds;
};

const previousReport = async (reportsRoot, currentName) => {
  const files = (await readdir(reportsRoot).catch(() => []))
    .filter((name) => name.endsWith('.json') && name !== currentName)
    .sort();
  if (files.length === 0) return undefined;
  return JSON.parse(await readFile(join(reportsRoot, files.at(-1)), 'utf8'));
};

export const generateReport = async ({ sessions, since, format = 'md', outputDirectory } = {}) => {
  const reportsRoot = outputDirectory ? resolve(outputDirectory) : defaultReportsRoot;
  const directories = await loadDirectories(sessions);
  const threshold = sinceThreshold(since);
  const entries = [];
  for (const directory of directories) {
    const session = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'));
    if (!session.endedAt || session.validation?.schemaValid !== true) continue;
    if (threshold !== undefined && Date.parse(session.startedAt) < threshold) continue;
    entries.push({ session, events: await readEvents(directory) });
  }
  if (entries.length === 0) throw new Error('No ended, schema-valid sessions matched the report selection.');
  const date = new Date().toISOString().slice(0, 10);
  const jsonName = `${date}_weekly.json`;
  const report = buildReport(entries, await previousReport(reportsRoot, jsonName));
  const paths = [];
  if (format === 'json' || format === 'both') {
    const path = join(reportsRoot, jsonName);
    await writeJson(path, report, 0o600);
    paths.push(path);
  }
  if (format === 'md' || format === 'both') {
    const path = join(reportsRoot, `${date}_weekly.md`);
    await mkdir(reportsRoot, { recursive: true, mode: 0o700 });
    await writeFile(path, markdown(report), { mode: 0o600 });
    paths.push(path);
  }
  return { report, paths };
};
