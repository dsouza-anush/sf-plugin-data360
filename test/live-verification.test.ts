import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';

type PlanEntry = {
  command: string;
  kind: string;
  phase: string;
  args: string[];
  expectedSchema: string | null;
  cleanup: string | null;
  credit: boolean;
};

type Orchestrator = {
  applySuccessfulVerification: (
    rows: Array<{ command: string; live: string | null }>,
    results: Array<{ command: string; status: string; schemaValid: boolean }>,
    date: string
  ) => Array<{ command: string; live: string | null }>;
  buildPlan: (root: string) => Promise<PlanEntry[]>;
  commandPayloadExitCode: (command: string, payload: unknown) => number;
  executePlan: (
    plan: PlanEntry[],
    state: { results: Record<string, { status: string; attemptCount?: number }> },
    options: {
      resume: boolean;
      retryFailed?: boolean;
      retryBlocked?: boolean;
      beforeRun?: (
        entry: PlanEntry,
        state: { results: Record<string, { status: string; attemptCount?: number }> }
      ) => Promise<boolean>;
      onProgress?: (state: { results: Record<string, { status: string; attemptCount?: number }> }) => Promise<void>;
    },
    runner: (entry: PlanEntry) => Promise<{ status: string; schemaValid: boolean }>
  ) => Promise<{ results: Record<string, { status: string }> }>;
  dependencyCandidates: (
    command: string,
    dependencies: Map<string, unknown>,
    environment?: Record<string, string | undefined>
  ) => Array<{ flags: string[]; reason?: string }>;
  executionPolicy: (command: string) => {
    args: string[];
    captureStdout: boolean;
    recordFixture: boolean;
    json: boolean;
  };
  genericPlanDisposition: (
    entry: PlanEntry,
    options: {
      phase: string;
      mutations: boolean;
      billable: boolean;
      billableCommands: string[];
    }
  ) => { runnable: boolean; result?: { status: string; reason: string } };
  latestP5State: (
    directory: string,
    org: string
  ) => Promise<{ path: string; state: { prefix: string; cleanupStack: Array<{ status: string }> } } | null>;
  minimizeLiveFixturePayload: (command: string, payload: unknown) => unknown;
  liveRunRequiresFailureExit: (
    state: {
      results?: Record<string, { status?: string }>;
      cleanupStack?: Array<{ status?: string }>;
      cleanup?: Array<{ status?: string }>;
    },
    options?: { ignoreResultFailures?: boolean; additionalFailure?: boolean }
  ) => boolean;
  p5StateFileOrgKey: (org: string) => string;
  parseArgs: (argv: string[]) => {
    org: string;
    readOnly: boolean;
    mutations: boolean;
    billable: boolean;
    retryFailed: boolean;
    retryBlocked: boolean;
    billableCommands: string[];
    sharedData?: boolean;
  };
  prepareBillableAttempt: (
    entry: PlanEntry,
    state: {
      results: Record<string, { status: string; schemaValid?: boolean; attemptCount?: number; reason?: string }>;
    }
  ) => boolean;
  plannedAbsenceProbeFor: (current: {
    command: string;
    creates?: string;
  }) => { command: string; args: string[] } | null;
  plannedCleanupArgsFor: (current: {
    command: string;
    creates?: string;
    cleanup?: string[];
    ownershipProof?: { name: string; status: string };
  }) => string[] | null;
  rawCleanupArgsFor: (current: { cleanupRawFamily: string; cleanupDirect?: boolean }, cleanupKey: string) => string[];
  redactSecrets: (value: unknown) => unknown;
  serializeLiveSummary: (value: unknown, org?: string) => string;
  scrubFixture: (value: unknown, key?: string) => unknown;
  scrubString: (value: string) => string;
  summarizeLiveResults: (
    results: Record<
      string,
      {
        status: string;
        reason?: string;
        evidence?: { fixture?: string; payload?: unknown; schemaValid?: boolean };
      }
    >
  ) => Record<string, unknown>;
  scenarioErrorProvenance: (
    current: { command: string },
    date: string,
    expectedFailure?: boolean
  ) => { command: string; expectedFailure: boolean; outcome: string; recordedAt: string; source: string };
  liveCliInvocation: (
    args: string[],
    environment?: Record<string, string | undefined>
  ) => { command: string; args: string[]; cwd: string };
  spawnCapture: (
    command: string,
    args: string[],
    options?: { timeoutMs?: number }
  ) => Promise<{ exitCode: number; timedOut?: boolean }>;
  validateTargetOrg: (
    org: string,
    runner: (command: string, args: string[]) => Promise<{ exitCode: number }>
  ) => Promise<void>;
  writeState: (path: string, state: unknown) => Promise<void>;
};

const root = resolve(import.meta.dirname, '..');
const loadOrchestrator = async (): Promise<Orchestrator> =>
  import(pathToFileURL(resolve(root, 'scripts', 'live-verify-all.mjs')).href) as Promise<Orchestrator>;

describe('live verification orchestrator', () => {
  it('scrubs frontdoor SID and OTP values including URL-encoded sessions', async () => {
    const { scrubString } = await loadOrchestrator();
    const session = `${'00D'}A1b2C3d4E5f6G7H%21opaqueSessionValue`;
    const captured = `https://example.invalid/secur/frontdoor.jsp?otp=${session}&sid=${session}`;
    const scrubbed = scrubString(captured);
    expect(scrubbed).to.equal('https://example.invalid/secur/frontdoor.jsp?otp=[REDACTED]&sid=[REDACTED]');
    expect(scrubbed).to.not.include(session);
  });

  it('scrubs authorization headers, raw sessions, JWTs, and generic token fields', async () => {
    const { scrubString } = await loadOrchestrator();
    const bearer = ['opaque', 'bearer', 'value'].join('-');
    const session = ['opaque', 'session', 'value'].join('-');
    const token = ['opaque', 'token', 'value'].join('-');
    const jwt = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'].join('.');
    const captured = [
      `Authorization: ${['Bearer', bearer].join(' ')}`,
      `sid=${`${'00D'}000000000001!${session}`}`,
      `jwt=${jwt}`,
      `token=${token}`,
    ].join('\n');
    const scrubbed = scrubString(captured);
    for (const secret of [bearer, session, 'aaaaaaaaaa', token]) {
      expect(scrubbed).not.to.include(secret);
    }
  });

  it('removes support trace and correlation IDs from nested error messages and fields', async () => {
    const { scrubFixture, scrubString } = await loadOrchestrator();
    const traceId = 'ce5d76023c4c80ba8200d776850300d9';
    const requestId = '2d952a23-b48f-4118-b574-ea5bc6809cf6';
    const message = `NOT_FOUND [TraceId:${traceId}] request-id=${requestId}`;

    expect(scrubString(message)).to.equal('NOT_FOUND [TraceId:[REDACTED]] request-id=[REDACTED]');
    expect(
      scrubFixture({
        message,
        traceId,
        nested: { correlation_id: traceId },
      })
    ).to.deep.equal({
      message: 'NOT_FOUND [TraceId:[REDACTED]] request-id=[REDACTED]',
      nested: {},
    });
  });

  it('scrubs Salesforce IDs embedded in live API error messages', async () => {
    const { scrubFixture } = await loadOrchestrator();
    const salesforceId = '001ABCdef123456';
    const scrubbed = scrubFixture({
      message: `The specified Search Index ${salesforceId} does not exist.`,
      developerName: `datacloudflow__SalesforceDotCom_${salesforceId}`,
    }) as {
      developerName: string;
      message: string;
    };
    expect(scrubbed.message).to.match(/LIVE_ID_[0-9a-f]{12}/u);
    expect(scrubbed.message).not.to.include(salesforceId);
    expect(scrubbed.developerName).to.match(/datacloudflow__SalesforceDotCom_LIVE_ID_[0-9a-f]{12}/u);
    expect(scrubbed.developerName).not.to.include(salesforceId);
  });

  it('removes record rows and item bodies from publishable live fixtures', async () => {
    const { minimizeLiveFixturePayload } = await loadOrchestrator();
    expect(
      minimizeLiveFixturePayload('data360 query vector', {
        status: 0,
        result: {
          queryId: 'fixture',
          status: 'Finished',
          done: true,
          rowCount: 1,
          columns: [{ name: 'secret_field', type: 'VARCHAR' }],
          rows: [['private record value']],
        },
      })
    ).to.deep.equal({
      status: 0,
      result: {
        queryId: 'fixture',
        status: 'Finished',
        done: true,
        rowCount: 1,
      },
    });
    expect(
      minimizeLiveFixturePayload('data360 profile get', {
        status: 0,
        result: { item: { data: [{ name: 'private record value' }], done: true } },
      })
    ).to.deep.equal({
      status: 0,
      result: { item: { redacted: true } },
    });
  });

  it('keeps live summaries useful without serializing response payloads or target-org identifiers', async () => {
    const { serializeLiveSummary, summarizeLiveResults } = await loadOrchestrator();
    const org = 'sensitive-live-org';
    const resourceId = `${'1ds'}000000000001AAA`;
    const secret = ['opaque', 'session', 'value'].join('-');
    const results = summarizeLiveResults({
      'stream-get': {
        status: 'passed',
        evidence: {
          fixture: 'live/data-stream-get.json',
          schemaValid: true,
          payload: {
            accessToken: secret,
            item: { name: 'retained-private-resource', recordId: resourceId },
          },
        },
      },
      'stream-create': {
        status: 'failed',
        reason: `Target ${org} rejected resource ${resourceId}`,
      },
    });
    const serialized = serializeLiveSummary(
      {
        state: `.tmp/live-verify/${org}-state.json`,
        probeLedger: [{ id: 'data-kit-list', status: 'passed' }],
        results,
      },
      org
    );

    expect(serialized).to.include('"status": "passed"');
    expect(serialized).to.include('"fixture": "live/data-stream-get.json"');
    expect(serialized).to.include('"id": "data-kit-list"');
    expect(serialized).to.include('[REDACTED_ORG]');
    for (const value of [org, resourceId, secret, 'retained-private-resource', '"payload"']) {
      expect(serialized).not.to.include(value);
    }
  });

  it('inventories exactly every current command ID and plans cleanup for mutations', async () => {
    const { buildPlan } = await loadOrchestrator();
    const plan = await buildPlan(root);
    const snapshot = JSON.parse(await readFile(resolve(root, 'command-snapshot.json'), 'utf8')) as {
      commands: Array<{ id: string }>;
    };

    expect(plan.map(({ command }) => command).sort()).to.deep.equal(snapshot.commands.map(({ id }) => id).sort());
    expect(plan).to.have.length(135);
    for (const entry of plan.filter(({ kind }) => ['create', 'update', 'delete', 'action', 'job'].includes(kind))) {
      expect(entry.cleanup, entry.command).to.be.a('string').and.not.equal('');
    }
  });

  it('requires a known target org and defaults to read-only with billing disabled', async () => {
    const { parseArgs, validateTargetOrg } = await loadOrchestrator();
    expect(() => parseArgs([])).to.throw('--org is required');
    const options = parseArgs(['--org', 'fixture-live-org']);
    expect(options).to.include({ org: 'fixture-live-org', readOnly: true, mutations: false, billable: false });
    expect(options.billableCommands).to.deep.equal([]);

    let invocation = '';
    let error: unknown;
    try {
      await validateTargetOrg('does-not-exist', async (command, args) => {
        invocation = [command, ...args].join(' ');
        return { exitCode: 1 };
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.include('Unknown or inaccessible org');
    expect(invocation).to.equal('sf org display --target-org does-not-exist --json');
  });

  it('can execute live probes through an installed Salesforce CLI outside the plugin checkout', async () => {
    const { liveCliInvocation } = await loadOrchestrator();
    const invocation = liveCliInvocation(['data360', 'doctor', '--json'], {
      D360_LIVE_SF_BIN: '/opt/salesforce/bin/sf',
      D360_LIVE_COMMAND_CWD: '/tmp/data360-live-installed',
    });
    expect(invocation).to.deep.equal({
      command: '/opt/salesforce/bin/sf',
      args: ['data360', 'doctor', '--json'],
      cwd: '/tmp/data360-live-installed',
    });
  });

  it('makes raw cleanup non-interactive and preserves direct routing', async () => {
    const { rawCleanupArgsFor } = await loadOrchestrator();
    expect(
      rawCleanupArgsFor({ cleanupRawFamily: 'data-lake-objects', cleanupDirect: true }, 'Owned DLO')
    ).to.deep.equal([
      'data360',
      'api',
      'request',
      'data-lake-objects/Owned%20DLO',
      '--direct',
      '--method',
      'DELETE',
      '--no-prompt',
    ]);
  });

  it('requires an exact gated allowlist for generic billable execution', async () => {
    const { parseArgs } = await loadOrchestrator();
    const previous = {
      mutations: process.env.D360_LIVE_MUTATIONS,
      billable: process.env.D360_LIVE_BILLABLE,
      sharedData: process.env.D360_LIVE_SHARED_DATA,
    };
    Object.assign(process.env, {
      D360_LIVE_MUTATIONS: '1',
      D360_LIVE_BILLABLE: '1',
      D360_LIVE_SHARED_DATA: '1',
    });
    try {
      expect(() => parseArgs(['--org', 'fixture-live-org', '--billable'])).to.throw(
        '--billable requires at least one explicit --billable-command'
      );
      expect(() =>
        parseArgs(['--org', 'fixture-live-org', '--mutations', '--billable-command', 'data360 query vector'])
      ).to.throw('--billable-command requires --billable');
      expect(() =>
        parseArgs(['--org', 'fixture-live-org', '--mutations', '--billable', '--billable-command', 'data360 doctor'])
      ).to.throw('--billable-command must name a known credit-bearing command');
      const options = parseArgs([
        '--org',
        'fixture-live-org',
        '--mutations',
        '--billable',
        '--billable-command',
        'data360 query vector',
        '--billable-command',
        'data360 query hybrid',
        '--billable-command',
        'data360 query vector',
      ]);
      expect(options.billableCommands).to.deep.equal(['data360 query vector', 'data360 query hybrid']);
      expect(options).to.include({ mutations: true, billable: true, sharedData: true });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        const environmentKey = key === 'sharedData' ? 'D360_LIVE_SHARED_DATA' : `D360_LIVE_${key.toUpperCase()}`;
        if (value === undefined) delete process.env[environmentKey];
        else process.env[environmentKey] = value;
      }
    }
  });

  it('requires an explicit shared-data acknowledgement for paid existing-resource actions', async () => {
    const { parseArgs } = await loadOrchestrator();
    const previous = {
      mutations: process.env.D360_LIVE_MUTATIONS,
      billable: process.env.D360_LIVE_BILLABLE,
      sharedData: process.env.D360_LIVE_SHARED_DATA,
    };
    process.env.D360_LIVE_MUTATIONS = '1';
    process.env.D360_LIVE_BILLABLE = '1';
    delete process.env.D360_LIVE_SHARED_DATA;
    try {
      expect(() =>
        parseArgs([
          '--org',
          'fixture-live-org',
          '--mutations',
          '--billable',
          '--billable-command',
          'data360 transform run',
        ])
      ).to.throw('selected billable command requires D360_LIVE_SHARED_DATA=1');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        const environmentKey = key === 'sharedData' ? 'D360_LIVE_SHARED_DATA' : `D360_LIVE_${key.toUpperCase()}`;
        if (value === undefined) delete process.env[environmentKey];
        else process.env[environmentKey] = value;
      }
    }
  });

  it('narrows a paid run to the exact allowlist and its four read dependencies', async () => {
    const { buildPlan, genericPlanDisposition } = await loadOrchestrator();
    const selected = [
      'data360 data-graph refresh',
      'data360 data-stream run',
      'data360 query hybrid',
      'data360 query vector',
      'data360 transform run',
    ];
    const plan = await buildPlan(root);
    const runnable = plan.filter(
      (entry) =>
        genericPlanDisposition(entry, {
          phase: 'all',
          mutations: true,
          billable: true,
          billableCommands: selected,
        }).runnable
    );

    expect(runnable.map(({ command }) => command).sort()).to.deep.equal(
      [
        ...selected,
        'data360 data-graph list',
        'data360 data-stream list',
        'data360 search-index list',
        'data360 transform list',
      ].sort()
    );
    expect(
      runnable
        .filter(({ credit }) => credit)
        .map(({ command }) => command)
        .sort()
    ).to.deep.equal(selected.sort());
  });

  it('allows P5 cleanup-only recovery without the billable gate', async () => {
    const { parseArgs } = await loadOrchestrator();
    const priorMutations = process.env.D360_LIVE_MUTATIONS;
    const priorBillable = process.env.D360_LIVE_BILLABLE;
    process.env.D360_LIVE_MUTATIONS = '1';
    delete process.env.D360_LIVE_BILLABLE;
    try {
      expect(parseArgs(['--org', 'fixture-live-org', '--scenario', 'p5', '--cleanup'])).to.include({
        cleanup: true,
        mutations: true,
        billable: false,
      });
    } finally {
      if (priorMutations === undefined) delete process.env.D360_LIVE_MUTATIONS;
      else process.env.D360_LIVE_MUTATIONS = priorMutations;
      if (priorBillable === undefined) delete process.env.D360_LIVE_BILLABLE;
      else process.env.D360_LIVE_BILLABLE = priorBillable;
    }
  });

  it('proves planned stream and DLO names absent when create returns no key', async () => {
    const { plannedAbsenceProbeFor, plannedCleanupArgsFor } = await loadOrchestrator();
    expect(
      plannedAbsenceProbeFor({ command: 'data360 data-stream create', creates: 'DisposableStream' })
    ).to.deep.equal({
      command: 'data360 data-stream list',
      args: ['data360', 'data-stream', 'list', '--all'],
    });
    expect(plannedAbsenceProbeFor({ command: 'data360 dlo create', creates: 'Disposable__dll' })).to.deep.equal({
      command: 'data360 dlo list',
      args: ['data360', 'dlo', 'list', '--all'],
    });
    expect(plannedAbsenceProbeFor({ command: 'data360 dmo create', creates: 'Disposable__dlm' })).to.equal(null);
    const cleanup = ['data360', 'dlo', 'delete', '--name', 'Disposable__dll', '--no-prompt'];
    expect(
      plannedCleanupArgsFor({
        command: 'data360 dlo create',
        creates: 'Disposable__dll',
        cleanup,
        ownershipProof: { name: 'Disposable__dll', status: 'absent' },
      })
    ).to.deep.equal(cleanup);
    expect(
      plannedCleanupArgsFor({
        command: 'data360 dlo create',
        creates: 'Disposable__dll',
        cleanup,
        ownershipProof: { name: 'Other__dll', status: 'absent' },
      })
    ).to.equal(null);
  });

  it('propagates the explicit P5 demo-org shared-data gate into execution options', async () => {
    const { parseArgs } = await loadOrchestrator();
    const previous = {
      mutations: process.env.D360_LIVE_MUTATIONS,
      billable: process.env.D360_LIVE_BILLABLE,
      sharedData: process.env.D360_LIVE_SHARED_DATA,
    };
    Object.assign(process.env, {
      D360_LIVE_MUTATIONS: '1',
      D360_LIVE_BILLABLE: '1',
      D360_LIVE_SHARED_DATA: '1',
    });
    try {
      expect(parseArgs(['--org', 'fixture-live-org', '--scenario', 'p5'])).to.include({
        mutations: true,
        billable: true,
        readOnly: false,
        sharedData: true,
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        const environmentKey = key === 'sharedData' ? 'D360_LIVE_SHARED_DATA' : `D360_LIVE_${key.toUpperCase()}`;
        if (value === undefined) delete process.env[environmentKey];
        else process.env[environmentKey] = value;
      }
    }
  });

  it('resumes without rerunning commands that already passed', async () => {
    const { executePlan } = await loadOrchestrator();
    const plan = [
      {
        command: 'data360 connector list',
        kind: 'read',
        phase: 'p4',
        args: [],
        expectedSchema: 'schemas/data360.connector.list.json',
        cleanup: null,
        credit: false,
      },
      {
        command: 'data360 dlo list',
        kind: 'read',
        phase: 'p4',
        args: [],
        expectedSchema: 'schemas/data360.dlo.list.json',
        cleanup: null,
        credit: false,
      },
    ];
    const called: string[] = [];
    const state = await executePlan(
      plan,
      { results: { 'data360 connector list': { status: 'passed' } } },
      { resume: true },
      async (entry) => {
        called.push(entry.command);
        return { status: 'passed', schemaValid: true };
      }
    );

    expect(called).to.deep.equal(['data360 dlo list']);
    expect(state.results['data360 connector list'].status).to.equal('passed');
    expect(state.results['data360 dlo list'].status).to.equal('passed');
  });

  it('retries only explicitly requested failed and blocked resume entries', async () => {
    const { executePlan } = await loadOrchestrator();
    const plan = ['passed', 'failed', 'blocked'].map((status) => ({
      command: `data360 ${status}`,
      kind: 'read',
      phase: 'p4',
      args: [],
      expectedSchema: null,
      cleanup: null,
      credit: false,
    }));
    const called: string[] = [];
    await executePlan(
      plan,
      {
        results: {
          'data360 passed': { status: 'passed' },
          'data360 failed': { status: 'failed' },
          'data360 blocked': { status: 'blocked' },
        },
      },
      { resume: true, retryFailed: true, retryBlocked: false },
      async (entry) => {
        called.push(entry.command);
        return { status: 'passed', schemaValid: true };
      }
    );

    expect(called).to.deep.equal(['data360 failed']);
  });

  it('persists a billable attempt marker before execution and retains its count', async () => {
    const { executePlan } = await loadOrchestrator();
    const entry: PlanEntry = {
      command: 'data360 query vector',
      kind: 'job',
      phase: 'p1',
      args: [],
      expectedSchema: 'schemas/data360.query.vector.json',
      cleanup: 'remove disposable dependencies',
      credit: true,
    };
    const progress: string[] = [];
    const state = await executePlan(
      [entry],
      { results: {} },
      {
        resume: false,
        beforeRun: async (current, currentState) => {
          currentState.results[current.command] = { status: 'attempting', attemptCount: 1 };
          return true;
        },
        onProgress: async (currentState) => {
          progress.push(currentState.results[entry.command].status);
        },
      },
      async () => ({ status: 'passed', schemaValid: true })
    );

    expect(progress).to.deep.equal(['attempting', 'passed']);
    expect(state.results[entry.command]).to.deep.equal({
      status: 'passed',
      schemaValid: true,
      attemptCount: 1,
    });
  });

  it('refuses a second paid attempt from the same ledger', async () => {
    const { prepareBillableAttempt } = await loadOrchestrator();
    const entry: PlanEntry = {
      command: 'data360 transform run',
      kind: 'action',
      phase: 'p4',
      args: [],
      expectedSchema: 'schemas/data360.transform.run.json',
      cleanup: 'remove disposable dependencies',
      credit: true,
    };
    const state: {
      results: Record<string, { status: string; schemaValid?: boolean; attemptCount?: number; reason?: string }>;
    } = { results: {} };

    expect(prepareBillableAttempt(entry, state)).to.equal(true);
    expect(state.results[entry.command]).to.include({ status: 'attempting', attemptCount: 1 });
    expect(prepareBillableAttempt(entry, state)).to.equal(false);
    expect(state.results[entry.command]).to.include({ status: 'blocked', attemptCount: 1 });
    expect(state.results[entry.command].reason).to.include('new approval and new ledger');
  });

  it('selects schema-aware dependency fields and provides fallback candidates', async () => {
    const { dependencyCandidates } = await loadOrchestrator();
    const dependencies = new Map<string, unknown>([
      [
        'data360 connector list',
        {
          result: {
            items: [
              { label: 'First connector', name: 'FirstConnector' },
              { label: 'Second connector', name: 'SecondConnector' },
            ],
          },
        },
      ],
    ]);

    expect(dependencyCandidates('data360 connector get', dependencies)).to.deep.equal([
      { flags: ['--name', 'FirstConnector'] },
      { flags: ['--name', 'SecondConnector'] },
    ]);
  });

  it('chooses the known mapped DMO and DLO pair from live list evidence', async () => {
    const { dependencyCandidates } = await loadOrchestrator();
    const dependencies = new Map<string, unknown>([
      ['data360 dmo list', { result: { items: [{ name: 'ssot__Account__dlm' }] } }],
      ['data360 dlo list', { result: { items: [{ name: 'Account_Home__dll' }] } }],
    ]);

    expect(dependencyCandidates('data360 mapping list', dependencies)[0]).to.deep.equal({
      flags: ['--dmo', 'ssot__Account__dlm', '--source-object', 'Account_Home__dll'],
    });
  });

  it('returns no attempts for an empty resource family so gets are blocked', async () => {
    const { dependencyCandidates } = await loadOrchestrator();
    const dependencies = new Map<string, unknown>([['data360 data-graph list', { result: { items: [] } }]]);

    expect(dependencyCandidates('data360 data-graph get', dependencies)).to.deep.equal([]);
  });

  it('derives required names for live-safe action and report commands', async () => {
    const { dependencyCandidates } = await loadOrchestrator();
    const dependencies = new Map<string, unknown>([
      ['data360 activation list', { result: { items: [{ developerName: 'ExistingActivation' }] } }],
      ['data360 connection list', { result: { items: [{ name: 'ExistingConnection' }] } }],
      ['data360 transform list', { result: { items: [{ id: 'ExistingTransform' }] } }],
    ]);

    expect(dependencyCandidates('data360 activation results', dependencies)).to.deep.equal([
      { flags: ['--name', 'ExistingActivation'] },
    ]);
    expect(dependencyCandidates('data360 connection validate', dependencies)).to.deep.equal([
      { flags: ['--name', 'ExistingConnection'] },
    ]);
    expect(dependencyCandidates('data360 transform report', dependencies)).to.deep.equal([
      { flags: ['--name', 'ExistingTransform'] },
    ]);
    expect(dependencyCandidates('data360 transform validate', dependencies)).to.deep.equal([
      { flags: ['--name', 'ExistingTransform'] },
    ]);
  });

  it('never replays redacted fixture identifiers as live dependency arguments', async () => {
    const { dependencyCandidates } = await loadOrchestrator();
    const dependencies = new Map<string, unknown>([
      ['data360 connection list', { result: { items: [{ id: 'LIVE_ID_65cbc31abae3' }] } }],
    ]);

    expect(dependencyCandidates('data360 connection describe', dependencies)).to.deep.equal([]);
  });

  it('selects one ready search index with the command-specific index flag', async () => {
    const { dependencyCandidates } = await loadOrchestrator();
    const dependencies = new Map<string, unknown>([
      [
        'data360 search-index list',
        {
          result: {
            items: [
              { developerName: 'NotReady', runtimeStatus: 'PROVISIONING', searchType: 'HYBRID' },
              { developerName: 'ReadyHybrid', runtimeStatus: 'READY', searchType: 'HYBRID' },
            ],
          },
        },
      ],
    ]);

    expect(dependencyCandidates('data360 query vector', dependencies)).to.deep.equal([
      { flags: ['--index', 'ReadyHybrid'] },
    ]);
    expect(dependencyCandidates('data360 query hybrid', dependencies)).to.deep.equal([
      { flags: ['--index', 'ReadyHybrid'] },
    ]);
  });

  it('honors an approved exact action resource only when it is eligible', async () => {
    const { dependencyCandidates } = await loadOrchestrator();
    const dependencies = new Map<string, unknown>([
      [
        'data360 transform list',
        {
          result: {
            items: [
              { name: 'NotReady', status: 'PROVISIONING' },
              { name: 'ReadyOne', status: 'READY' },
              { name: 'ReadyTwo', status: 'ACTIVE' },
            ],
          },
        },
      ],
    ]);

    expect(
      dependencyCandidates('data360 transform run', dependencies, {
        D360_TRANSFORM_NAME: 'ReadyTwo',
      })
    ).to.deep.equal([{ flags: ['--name', 'ReadyTwo'] }]);
    expect(
      dependencyCandidates('data360 transform run', dependencies, {
        D360_TRANSFORM_NAME: 'NotReady',
      })
    ).to.deep.equal([]);
    expect(
      dependencyCandidates('data360 transform run', dependencies, {
        D360_TRANSFORM_NAME: 'Missing',
      })
    ).to.deep.equal([]);
  });

  it('defines safe raw, URL-only, and sensitive-output command policies', async () => {
    const { executionPolicy } = await loadOrchestrator();

    expect(executionPolicy('data360 api request')).to.deep.equal({
      args: ['data-spaces'],
      captureStdout: true,
      recordFixture: true,
      json: false,
    });
    expect(executionPolicy('data360 open')).to.deep.equal({
      args: ['--url-only'],
      captureStdout: true,
      recordFixture: true,
      json: true,
    });
    expect(executionPolicy('data360 connection describe')).to.deep.equal({
      args: ['--endpoints'],
      captureStdout: true,
      recordFixture: true,
      json: true,
      timeoutMs: 30_000,
    });
    expect(executionPolicy('data360 connection validate')).to.deep.equal({
      args: [],
      captureStdout: true,
      recordFixture: true,
      json: true,
      timeoutMs: 30_000,
    });
    expect(executionPolicy('data360 transform report')).to.deep.equal({
      args: [],
      captureStdout: true,
      recordFixture: true,
      json: true,
      timeoutMs: 30_000,
    });
    expect(executionPolicy('data360 transform validate')).to.deep.equal(executionPolicy('data360 transform report'));
    expect(executionPolicy('data360 calculated-insight run')).to.deep.equal({
      args: ['--no-prompt'],
      captureStdout: true,
      recordFixture: true,
      json: true,
    });
    expect(executionPolicy('data360 transform run')).to.deep.equal({
      args: ['--no-prompt'],
      captureStdout: true,
      recordFixture: true,
      json: true,
      timeoutMs: 360_000,
    });
    expect(executionPolicy('data360 query vector')).to.deep.equal({
      args: ['--text', 'Data 360 verification', '--top-k', '1', '--wait', '2', '--no-prompt'],
      captureStdout: true,
      recordFixture: true,
      json: true,
      timeoutMs: 180_000,
    });
    expect(executionPolicy('data360 token display')).to.deep.equal({
      args: [],
      captureStdout: false,
      recordFixture: false,
      json: true,
    });
  });

  it('removes token fields before writing state', async () => {
    const { redactSecrets, writeState } = await loadOrchestrator();
    const tenantId = ['a360', 'prod', '0123456789abcdef0123456789abcdef'].join('/');
    const orgPhotoHost = ['release-candidate', 'file', 'force', 'com'].join('.');
    const dirty = {
      accessToken: 'secret-core',
      jwt: 'secret-tenant',
      nested: {
        refresh_token: 'secret-refresh',
        clientSecret: 'opaque-client-secret',
        password: 'opaque-password',
        apiKey: 'opaque-api-key',
        privateKey: 'opaque-private-key',
        safe: 'AdobeMarketoEngage',
        recordId: '001000000000001AAA',
        url: 'https://example.test/secur/frontdoor.jsp?sid=secret-session&retURL=%2Fhome',
        photoUrl: `https://${orgPhotoHost}/profilephoto/005/T`,
        detail: JSON.stringify({ tenantId }),
      },
    };
    expect(redactSecrets(dirty)).to.deep.equal({
      nested: {
        safe: 'AdobeMarketoEngage',
        recordId: '001000000000001AAA',
        url: 'https://example.test/secur/frontdoor.jsp?sid=[REDACTED]&retURL=%2Fhome',
        photoUrl: 'https://mock.salesforce.example/profilephoto/005/T',
        detail: '{"tenantId":"a360/[REDACTED_TENANT]"}',
      },
    });

    const directory = await mkdtemp(resolve(tmpdir(), 'fixture-live-org-'));
    const path = resolve(directory, 'state.json');
    await writeState(path, dirty);
    const stored = await readFile(path, 'utf8');
    expect(stored).to.not.include('secret');
    expect(JSON.parse(stored)).to.deep.equal({
      nested: {
        safe: 'AdobeMarketoEngage',
        recordId: 'LIVE_ID_215d60d27769',
        url: 'https://example.test/secur/frontdoor.jsp?sid=[REDACTED]&retURL=%2Fhome',
        photoUrl: 'https://mock.salesforce.example/profilephoto/005/T',
        detail: '{"tenantId":"a360/[REDACTED_TENANT]"}',
      },
    });
  });

  it('uses CLI envelopes but not raw API response fields as process failures', async () => {
    const { commandPayloadExitCode } = await loadOrchestrator();

    expect(commandPayloadExitCode('data360 dmo delete', { status: 1 })).to.equal(1);
    expect(commandPayloadExitCode('data360 connection delete', { exitCode: 2 })).to.equal(2);
    expect(commandPayloadExitCode('data360 api request', [{ status: 1 }, { status: 2 }])).to.equal(0);
  });

  it('updates live verification only after successful schema validation', async () => {
    const { applySuccessfulVerification } = await loadOrchestrator();
    const rows = [
      { command: 'data360 connector list', live: null },
      { command: 'data360 dlo list', live: null },
      { command: 'data360 dmo list', live: null },
    ];
    const updated = applySuccessfulVerification(
      rows,
      [
        { command: 'data360 connector list', status: 'passed', schemaValid: true },
        { command: 'data360 dlo list', status: 'passed', schemaValid: false },
        { command: 'data360 dmo list', status: 'failed', schemaValid: true },
      ],
      '2026-07-11'
    );

    expect(updated).to.deep.equal([
      { command: 'data360 connector list', live: '2026-07-11' },
      { command: 'data360 dlo list', live: null },
      { command: 'data360 dmo list', live: null },
    ]);
  });

  it('fails live runners for unexpected or unknown result outcomes while policy blockers remain neutral', async () => {
    const { liveRunRequiresFailureExit } = await loadOrchestrator();

    expect(
      liveRunRequiresFailureExit({
        results: {
          verified: { status: 'passed' },
          policy: { status: 'blocked' },
          disabled: { status: 'skipped' },
        },
      })
    ).to.equal(false);
    expect(liveRunRequiresFailureExit({ results: { probe: { status: 'failed' } } })).to.equal(true);
    expect(liveRunRequiresFailureExit({ results: { probe: { status: 'running' } } })).to.equal(true);
    expect(liveRunRequiresFailureExit({})).to.equal(true);
  });

  it('fails live runners when cleanup is failed, unresolved, or malformed', async () => {
    const { liveRunRequiresFailureExit } = await loadOrchestrator();
    const passed = { results: { create: { status: 'passed' } } };

    expect(
      liveRunRequiresFailureExit({
        ...passed,
        cleanupStack: [{ status: 'passed' }, { status: 'not-owned' }, { status: 'skipped' }],
        cleanup: [{ status: 'passed' }, { status: 'not-owned' }],
      })
    ).to.equal(false);
    expect(liveRunRequiresFailureExit({ ...passed, cleanupStack: [{ status: 'registered' }] })).to.equal(true);
    expect(liveRunRequiresFailureExit({ ...passed, cleanupStack: [{ status: 'failed' }] })).to.equal(true);
    expect(liveRunRequiresFailureExit({ ...passed, cleanup: [{ status: 'unknown' }] })).to.equal(true);
    expect(liveRunRequiresFailureExit({ ...passed, cleanup: {} as never })).to.equal(true);
  });

  it('keeps cleanup-only recovery neutral for historical command failures but never for cleanup or billing risk', async () => {
    const { liveRunRequiresFailureExit } = await loadOrchestrator();
    const historicalFailure = { results: { create: { status: 'failed' } } };

    expect(liveRunRequiresFailureExit(historicalFailure, { ignoreResultFailures: true })).to.equal(false);
    expect(
      liveRunRequiresFailureExit(
        { ...historicalFailure, cleanupStack: [{ status: 'registered' }] },
        { ignoreResultFailures: true }
      )
    ).to.equal(true);
    expect(
      liveRunRequiresFailureExit(historicalFailure, { ignoreResultFailures: true, additionalFailure: true })
    ).to.equal(true);
  });

  it('labels unexpected scenario errors as errors without claiming they were expected', async () => {
    const { scenarioErrorProvenance } = await loadOrchestrator();
    expect(scenarioErrorProvenance({ command: 'data360 segment create' }, '2026-07-12')).to.deep.equal({
      source: 'live-scrubbed',
      recordedAt: '2026-07-12',
      command: 'data360 segment create',
      outcome: 'error',
      expectedFailure: false,
    });
    expect(scenarioErrorProvenance({ command: 'data360 profile lookup' }, '2026-07-12', true).expectedFailure).to.equal(
      true
    );
  });

  it('terminates a stalled live command so independent steps can continue', async () => {
    const { spawnCapture } = await loadOrchestrator();
    const result = await spawnCapture(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 50 });
    expect(result).to.include({ timedOut: true });
    expect(result.exitCode).to.not.equal(0);
  });

  it('finds older outstanding P5 cleanup ledgers and fails closed on corrupt state', async () => {
    const { latestP5State, p5StateFileOrgKey } = await loadOrchestrator();
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-ledgers-'));
    const org = 'user+live@example.com';
    const key = p5StateFileOrgKey(org);
    expect(key).to.equal('user_live_example_com');
    const outstandingPath = resolve(directory, `${key}-lv_p5_20260711000000_aaaaaa.json`);
    const completedPath = resolve(directory, `${key}-lv_p5_20260712000000_bbbbbb.json`);
    await writeFile(
      outstandingPath,
      JSON.stringify({ prefix: 'lv_p5_20260711000000_aaaaaa', cleanupStack: [{ status: 'failed' }] })
    );
    await writeFile(
      completedPath,
      JSON.stringify({ prefix: 'lv_p5_20260712000000_bbbbbb', cleanupStack: [{ status: 'passed' }] })
    );

    expect((await latestP5State(directory, org))?.path).to.equal(outstandingPath);

    await writeFile(resolve(directory, `${key}-lv_p5_20260713000000_cccccc.json`), '{corrupt');
    let caught: unknown;
    try {
      await latestP5State(directory, org);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).to.include('Cannot safely inspect P5 ledger');
  });
});
