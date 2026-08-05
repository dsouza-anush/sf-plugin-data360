import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from 'chai';

type RedactorModule = {
  assertLeakFree: (value: unknown, label?: string) => void;
  findLeaks: (value: unknown) => string[];
  redactValue: (value: unknown) => unknown;
};
type SchemasModule = {
  validateSessionDirectory: (directory: string) => Promise<{ valid: boolean; errors: string[] }>;
  validateSuite: (suite: unknown) => Promise<unknown>;
};
type RunnerModule = {
  liveSuiteCommandGate: (
    session: { mode: string },
    tags: string[],
    commands: Array<{ argv: string[] }>
  ) => string | undefined;
};
type ExecuteModule = {
  assertLiveCommandOrg: (args: string[], liveOrg: string) => void;
};
type ReportModule = {
  buildReport: (entries: Array<{ session: Record<string, unknown>; events: Array<Record<string, unknown>> }>) => {
    clusters: Array<{ id: string; classification: string }>;
    errorActions: Record<string, number>;
    performance: Array<{ buildHash: string; command: string; samples: number; p95Ms: number }>;
    trends: { flakes: Array<{ id: string }> };
  };
};

const root = resolve(import.meta.dirname, '..');

describe('Agent Testbed framework contracts', () => {
  it('closes command and HTTP trace pairs when a live child is terminated', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { appendEvent, closeOpenTraceEvents, readEvents } = await import('../testbed/lib/trace.mjs');
    const directory = await mkdtemp(join(tmpdir(), 'd360-testbed-recovery-'));
    const sid = 'recovery-session';
    try {
      await appendEvent(directory, sid, { type: 'session.start', manifest: {} });
      const command = await appendEvent(directory, sid, {
        type: 'command.exec',
        executable: process.execPath,
        argv: ['sf', 'data360', 'doctor'],
        cwd: root,
        envAllowlist: {},
      });
      await appendEvent(directory, sid, {
        type: 'http.request',
        seqRef: command,
        method: 'GET',
        url: '/metadata',
        root: 'direct',
        retryAttempt: 0,
      });
      expect(await closeOpenTraceEvents(directory, sid, { afterSequence: 0, exitCode: 1 })).to.deep.equal({
        commands: 1,
        requests: 1,
      });
      const events = await readEvents(directory);
      expect(events.filter(({ type }: { type: string }) => type === 'command.result')).to.have.length(1);
      expect(events.filter(({ type }: { type: string }) => type === 'http.response')).to.have.length(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects notes that reference missing event sequences', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { assertEvidenceSequences } = await import('../testbed/lib/trace.mjs');
    expect(() => assertEvidenceSequences([{ seq: 0 }, { seq: 2 }], [0, 2])).not.to.throw();
    expect(() => assertEvidenceSequences([{ seq: 0 }, { seq: 2 }], [1, 2])).to.throw(
      '--evidence references unknown event seq: 1'
    );
  });

  it('validates every committed suite against the published schema', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { validateSuite } = (await import('../testbed/lib/schemas.mjs')) as SchemasModule;
    const suitesRoot = join(root, 'testbed', 'suites');
    const files = [];
    for (const entry of await readdir(suitesRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) files.push(join(suitesRoot, entry.name));
      if (entry.isDirectory()) {
        for (const nested of await readdir(join(suitesRoot, entry.name)))
          if (nested.endsWith('.json')) files.push(join(suitesRoot, entry.name, nested));
      }
    }
    expect(files).to.have.length.greaterThan(4);
    for (const file of files) await validateSuite(JSON.parse(await readFile(file, 'utf8')));
  });

  it('redacts a dirty corpus and makes the second-pass leak scan fail closed', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { assertLeakFree, findLeaks, redactValue } = (await import('../testbed/lib/redactor.mjs')) as RedactorModule;
    const dirty = {
      authorization: 'Bearer secret-value', // secret-scan: synthetic-fixture
      access_token: 'secret-access-token', // secret-scan: synthetic-fixture
      org: '00D000000000001AAA', // secret-scan: synthetic-fixture
      user: 'agent@example.com',
      host: 'fixture.my.salesforce.com', // secret-scan: synthetic-fixture
      frontdoor: 'https://na123.salesforce.com/secur/frontdoor.jsp?sid=opaque-frontdoor-session', // secret-scan: synthetic-fixture
      cookie: 'opaque-cookie-secret',
      'x-custom-token': 'opaque-custom-token',
      argv: ['--header', 'Cookie: opaque-cli-cookie'],
      privateKey: '-----BEGIN PRIVATE KEY-----\nopaque-key-material\n-----END PRIVATE KEY-----', // secret-scan: synthetic-fixture
    };
    expect(findLeaks(dirty)).not.to.be.empty;
    expect(() => assertLeakFree(dirty, 'dirty fixture')).to.throw('failed leak scan');
    const redacted = redactValue(dirty);
    expect(findLeaks(redacted)).to.deep.equal([]);
    expect(() => assertLeakFree(redacted)).not.to.throw();
    const encryptedMarker = [
      ['-----BEGIN ENCRYPTED ', 'PRIVATE KEY-----'].join(''),
      'synthetic-marker-only',
      ['-----END ENCRYPTED ', 'PRIVATE KEY-----'].join(''),
    ].join('\n');
    expect(findLeaks({ artifact: encryptedMarker })).to.include('private key');
    expect(JSON.stringify(redactValue({ artifact: encryptedMarker }))).not.to.include('synthetic-marker-only');

    const executable = await readFile(join(root, 'testbed', 'bin', 'testbed.mjs'), 'utf8');
    expect(executable).to.include('process.stdout.write(redactString(result.stdout))');
    expect(executable).to.include('process.stderr.write(redactString(result.stderr))');
    expect(executable).to.include("outputDirectory: value('--output-dir')");

    const reportSource = await readFile(join(root, 'testbed', 'lib', 'report.mjs'), 'utf8');
    expect(reportSource).to.include("join(repositoryRoot, 'internal', 'testbed', 'reports')");
    expect(reportSource).not.to.include('0o644');
    const workflow = await readFile(join(root, '.github', 'workflows', 'testbed.yml'), 'utf8');
    expect(workflow).not.to.include('if: always()');
    expect(workflow).not.to.include('testbed/sessions/*/raw/**');
  });

  it('rejects assertion-free or unknown suite fields and structurally blocks unsafe live commands', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { validateSuite } = (await import('../testbed/lib/schemas.mjs')) as SchemasModule;
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { liveSuiteCommandGate } = (await import('../testbed/lib/runner.mjs')) as RunnerModule;
    const unsafe = {
      name: 'unsafe',
      mode: 'live',
      steps: [
        {
          id: 'delete',
          title: 'unsafe delete',
          commands: [{ argv: ['data360', 'data-stream', 'delete', '--name', 'fixture', '--no-prompt'] }],
          cleanup: [{ ignored: true }],
        },
      ],
    };
    let message = '';
    try {
      await validateSuite(unsafe);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).to.include('Suite schema validation failed');
    expect(
      liveSuiteCommandGate(
        { mode: 'live' },
        [],
        [{ argv: ['data360', 'data-stream', 'delete', '--name', 'fixture', '--no-prompt'] }]
      )
    ).to.include('not in the reviewed read-only allowlist');
    expect(liveSuiteCommandGate({ mode: 'live' }, [], [{ argv: ['data360', 'doctor', '--json'] }])).to.equal(undefined);
    expect(
      liveSuiteCommandGate(
        { mode: 'live' },
        [],
        [{ argv: ['data360', 'metadata', 'get', '--name', 'ssot__Individual__dlm', '--json'] }]
      )
    ).to.equal(undefined);
    for (const family of ['data-graph', 'data-stream', 'search-index', 'transform']) {
      expect(liveSuiteCommandGate({ mode: 'live' }, [], [{ argv: ['data360', family, 'list', '--json'] }])).to.equal(
        undefined
      );
    }
  });

  it('prevents live testbed commands from overriding the pinned org', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { assertLiveCommandOrg } = (await import('../testbed/lib/execute.mjs')) as ExecuteModule;
    expect(() => assertLiveCommandOrg(['data360', 'doctor'], 'approved-org')).not.to.throw();
    expect(() => assertLiveCommandOrg(['data360', 'doctor', '-o', 'approved-org'], 'approved-org')).not.to.throw();
    expect(() =>
      assertLiveCommandOrg(['data360', 'metadata', 'list', '--target-org=approved-org'], 'approved-org')
    ).not.to.throw();
    expect(() => assertLiveCommandOrg(['data360', 'doctor', '--target-org', 'other-org'], 'approved-org')).to.throw(
      'only target the org pinned'
    );
    expect(() => assertLiveCommandOrg(['data360', 'doctor', '-o=other-org'], 'approved-org')).to.throw(
      'only target the org pinned'
    );
    expect(() => assertLiveCommandOrg(['data360', 'doctor', '--target-org'], 'approved-org')).to.throw(
      'requires the pinned live org value'
    );
  });

  it('rejects incomplete event lifecycles and totals drift in ended sessions', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { validateSessionDirectory } = (await import('../testbed/lib/schemas.mjs')) as SchemasModule;
    const directory = await mkdtemp(join(tmpdir(), 'data360-testbed-schema-'));
    const totals = {
      steps: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      skipped: 0,
      notes: 0,
      assertions: 1,
      httpEvents: 2,
    };
    const session = {
      sid: 'fixture-session',
      startedAt: '2026-07-12T00:00:00.000Z',
      endedAt: '2026-07-12T00:00:01.000Z',
      agent: 'fixture-persona',
      model: 'fixture-model',
      mode: 'mock',
      plugin: {
        version: '0.0.0',
        commit: 'fixture',
        dirtyTree: false,
        buildHash: `sha256:${'a'.repeat(64)}`,
      },
      environment: {
        sfVersion: 'fixture',
        nodeVersion: process.version,
        os: 'fixture',
        ci: true,
        executionMode: 'direct-compiled-plugin',
      },
      suites: ['fixture'],
      totals,
      validation: { schemaValid: true, leakScanClean: true },
    };
    const base = { ts: '2026-07-12T00:00:00.000Z', sid: session.sid };
    const events: Array<Record<string, unknown>> = [
      { ...base, seq: 0, type: 'session.start', manifest: { sid: session.sid } },
      { ...base, seq: 1, type: 'scenario.start', suite: 'fixture', scenario: 'lifecycle', tags: [] },
      {
        ...base,
        seq: 2,
        type: 'command.exec',
        executable: '/fixture/bin/run.js',
        argv: ['data360', 'doctor'],
        displayArgv: ['sf', 'data360', 'doctor'],
        cwd: '/fixture',
        envAllowlist: {},
      },
      {
        ...base,
        seq: 3,
        type: 'http.request',
        seqRef: 2,
        method: 'GET',
        url: 'https://example.invalid/fixture',
        root: 'ssot',
        retryAttempt: 0,
      },
      {
        ...base,
        seq: 4,
        type: 'http.response',
        seqRef: 2,
        requestRef: 3,
        status: 200,
        statusInferred: false,
        durationMs: 1,
        root: 'ssot',
        retryAttempt: 0,
      },
      { ...base, seq: 5, type: 'command.result', seqRef: 2, exitCode: 0, durationMs: 2 },
      {
        ...base,
        seq: 6,
        type: 'assertion',
        id: 'fixture/lifecycle',
        criterion: 'suite:fixture/lifecycle',
        pass: true,
        evidence: [2, 5],
      },
      {
        ...base,
        seq: 7,
        type: 'scenario.end',
        suite: 'fixture',
        scenario: 'lifecycle',
        outcome: 'pass',
        durationMs: 3,
      },
      { ...base, seq: 8, type: 'session.end', totals },
    ];
    const writeFixture = async (
      selectedEvents: Array<Record<string, unknown>>,
      selectedTotals: typeof totals = totals
    ): Promise<void> => {
      const sequenceMap = new Map(selectedEvents.map((event, index) => [event.seq as number, index]));
      const normalized = selectedEvents.map((event, seq) => ({
        ...event,
        seq,
        ...(typeof event.seqRef === 'number' ? { seqRef: sequenceMap.get(event.seqRef) } : {}),
        ...(typeof event.requestRef === 'number' ? { requestRef: sequenceMap.get(event.requestRef) } : {}),
        ...(Array.isArray(event.evidence)
          ? { evidence: event.evidence.map((value) => sequenceMap.get(value as number)).filter(Number.isInteger) }
          : {}),
        ...(event.type === 'session.end' ? { totals: selectedTotals } : {}),
      }));
      await Promise.all([
        writeFile(join(directory, 'session.json'), `${JSON.stringify({ ...session, totals: selectedTotals })}\n`),
        writeFile(join(directory, 'events.jsonl'), `${normalized.map((event) => JSON.stringify(event)).join('\n')}\n`),
        writeFile(join(directory, 'events.jsonl.seq'), `${normalized.length - 1}\n`),
      ]);
    };
    try {
      await writeFixture(events);
      const validResults = {
        suites: {
          fixture: {
            lifecycle: {
              title: 'Lifecycle fixture',
              outcome: 'pass',
              commands: [
                {
                  argv: ['sf', 'data360', 'doctor'],
                  exitCode: 0,
                  durationMs: 2,
                  evidence: [2, 5],
                },
              ],
            },
          },
        },
      };
      await writeFile(join(directory, 'results.json'), `${JSON.stringify(validResults)}\n`);
      expect(await validateSessionDirectory(directory)).to.include({ valid: true });

      await writeFile(
        join(directory, 'results.json'),
        `${JSON.stringify({
          ...validResults,
          suites: {
            fixture: {
              lifecycle: {
                ...validResults.suites.fixture.lifecycle,
                commands: [{ ...validResults.suites.fixture.lifecycle.commands[0], exitCode: 1 }],
              },
            },
          },
        })}\n`
      );
      const driftedResult = await validateSessionDirectory(directory);
      expect(driftedResult.valid).to.equal(false);
      expect(driftedResult.errors.join('\n')).to.include('exitCode does not match evidence');
      await rm(join(directory, 'results.json'), { force: true });

      await writeFixture(
        events.filter(({ type }) => type !== 'http.response'),
        { ...totals, httpEvents: 1 }
      );
      const missingResponse = await validateSessionDirectory(directory);
      expect(missingResponse.valid).to.equal(false);
      expect(missingResponse.errors.join('\n')).to.include('must have exactly one http.response');

      await writeFixture(events.filter(({ type }) => type !== 'command.result'));
      const missingResult = await validateSessionDirectory(directory);
      expect(missingResult.valid).to.equal(false);
      expect(missingResult.errors.join('\n')).to.include('must have exactly one command.result');

      await writeFixture(events, { ...totals, passed: 0 });
      const driftedTotals = await validateSessionDirectory(directory);
      expect(driftedTotals.valid).to.equal(false);
      expect(driftedTotals.errors.join('\n')).to.include('totals do not match recorded events');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('splits shared versus agent-unique failures during triangulation', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { buildReport } = (await import('../testbed/lib/report.mjs')) as ReportModule;
    const event = (seq: number, id: string, pass: boolean): Record<string, unknown> => ({
      ts: '2026-07-12T00:00:00.000Z',
      seq,
      sid: 'fixture-session',
      type: 'assertion',
      id,
      criterion: 'suite:fixture',
      pass,
      evidence: [],
    });
    const entries = [
      {
        session: { sid: 'session-a', agent: 'persona-a', model: 'model-a', mode: 'mock', suites: [] },
        events: [event(1, 'shared', false), event(2, 'unique', false)],
      },
      {
        session: { sid: 'session-b', agent: 'persona-b', model: 'model-b', mode: 'mock', suites: [] },
        events: [event(1, 'shared', false), event(2, 'unique', true)],
      },
    ];
    const report = buildReport(entries);
    expect(report.clusters.find(({ id }) => id === 'shared')?.classification).to.equal('suspected-cli-bug');
    expect(report.clusters.find(({ id }) => id === 'unique')?.classification).to.equal('suspected-agent-usage');
  });

  it('reports structured actions and pass/fail flakes without inferring intent', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { buildReport } = (await import('../testbed/lib/report.mjs')) as ReportModule;
    const base = { ts: '2026-07-12T00:00:00.000Z', sid: 'fixture-session' };
    const report = buildReport([
      {
        session: { sid: 'session-a', agent: 'persona-a', model: 'model-a', mode: 'mock', suites: ['fixture'] },
        events: [
          {
            ...base,
            seq: 1,
            type: 'scenario.end',
            suite: 'fixture',
            scenario: 'retry',
            outcome: 'fail',
            durationMs: 1,
          },
          {
            ...base,
            seq: 2,
            type: 'scenario.end',
            suite: 'fixture',
            scenario: 'retry',
            outcome: 'pass',
            durationMs: 1,
          },
          { ...base, seq: 3, type: 'command.exec', argv: ['data360', 'query'], cwd: '.', envAllowlist: {} },
          {
            ...base,
            seq: 4,
            type: 'command.result',
            seqRef: 3,
            exitCode: 1,
            durationMs: 1,
            jsonEnvelope: { actions: ['Correct the input and retry.'] },
          },
        ],
      },
    ]);
    expect(report.errorActions).to.deep.equal({ 'Correct the input and retry.': 1 });
    expect(report.trends.flakes).to.have.length(1);
  });

  it('keeps performance samples isolated by deterministic build hash', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { buildReport } = (await import('../testbed/lib/report.mjs')) as ReportModule;
    const entries = ['a', 'b'].map((value, index) => ({
      session: {
        sid: `session-${value}`,
        agent: `persona-${value}`,
        model: 'fixture-model',
        mode: 'mock',
        suites: ['fixture'],
        plugin: { buildHash: `sha256:${value.repeat(64)}` },
      },
      events: [
        {
          ts: '2026-07-12T00:00:00.000Z',
          seq: 1,
          sid: `session-${value}`,
          type: 'command.exec',
          argv: ['data360', 'doctor'],
          cwd: '.',
          envAllowlist: {},
        },
        {
          ts: '2026-07-12T00:00:00.000Z',
          seq: 2,
          sid: `session-${value}`,
          type: 'command.result',
          seqRef: 1,
          exitCode: 0,
          durationMs: index + 1,
        },
      ],
    }));
    const report = buildReport(entries);
    expect(report.performance).to.have.length(2);
    expect(report.performance.map(({ buildHash }) => buildHash).sort()).to.deep.equal([
      `sha256:${'a'.repeat(64)}`,
      `sha256:${'b'.repeat(64)}`,
    ]);
    expect(report.performance.every(({ samples }) => samples === 1)).to.equal(true);
  });
});
