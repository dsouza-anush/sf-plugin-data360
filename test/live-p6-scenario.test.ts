import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';

type P6Step = {
  id: string;
  dependsOn: string[];
  command: string;
  operation: 'list' | 'get' | 'create' | 'update' | 'delete' | 'action' | 'manual';
  contract: 'recorded' | 'documented' | 'unknown';
  fixture?: string;
  args?: string[];
  creates?: string;
  cleanup?: string[];
  blocker?: string;
};

type P6Scenario = {
  argsForP6Step: (step: P6Step & { path?: string }, evidence: Record<string, unknown>) => string[];
  buildP6Plan: (prefix: string) => P6Step[];
  classifyP6Evidence: (input: {
    operation: P6Step['operation'];
    payload?: unknown;
    fixture?: string;
    error?: unknown;
    timedOut?: boolean;
    expectedError?: boolean;
  }) => { status: string; commandEligible: boolean; reason?: string };
  createP6Prefix: (date: Date, random: () => number) => string;
  p6CleanupKey: (
    step: P6Step & { ownershipProof?: { status: string; name?: string }; createEvidence?: unknown }
  ) => string | undefined;
  p6TtyChecklist: () => Array<{
    id: string;
    evidence: 'manual-tty';
    queryDataAllowed: false;
    requiresQuerySubmission: boolean;
    creditApprovalRequired: boolean;
  }>;
  parseP6Options: (environment?: NodeJS.ProcessEnv) => {
    mutations: false;
    billable: false;
    readOnly: true;
  };
  p6DependencyBlocker: (step: P6Step, evidence: Record<string, unknown>) => string | undefined;
  p6LedgerStatus: (runStatus: string, classificationStatus?: string) => string;
  runP6BoundedProbe: <T>(
    execute: (signal: AbortSignal) => Promise<T>,
    options: { timeoutMs: number; signal?: AbortSignal }
  ) => Promise<{ status: 'completed'; value: T } | { status: 'aborted' | 'timed-out'; reason: string }>;
  runP6Scenario: (options: {
    prefix: string;
    statePath: string;
    steps: P6Step[];
    execute: (step: P6Step) => Promise<unknown>;
    cleanup: (step: P6Step) => Promise<{ exitCode: number; deletionConfirmed: boolean }>;
    authorizeCreate?: (
      step: P6Step,
      state: { results: Record<string, { status: string; evidence?: unknown }> }
    ) => { status: 'absent'; name: string; sourceStep: string; provedAt: string };
  }) => Promise<{
    cleanup: Array<{ step: string; status: string }>;
    results: Record<string, { status: string; evidence?: unknown }>;
  }>;
};

const root = resolve(import.meta.dirname, '..');
const loadP6 = async (): Promise<P6Scenario | null> => {
  const modulePath = resolve(root, 'scripts', 'live-scenarios', 'p6.mjs');
  try {
    await access(modulePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return (await import(pathToFileURL(modulePath).href)) as P6Scenario;
};

describe('verified-contract P6 live scenario', () => {
  it('is read-only and non-billable and creates collision-resistant ledger names', async () => {
    const scenario = await loadP6();
    expect(scenario, 'P6 scenario module must exist').not.to.equal(null);
    expect(scenario!.parseP6Options()).to.deep.equal({
      mutations: false,
      billable: false,
      readOnly: true,
    });
    expect(scenario!.createP6Prefix(new Date('2026-07-11T12:34:56.000Z'), () => 0)).to.equal(
      'lv_p6_20260711123456_000000'
    );
  });

  it('plans every safe P6 probe with a 30-second ceiling and wires the live orchestrator', async () => {
    const scenario = (await loadP6())!;
    const plan = scenario.buildP6Plan('lv_p6_contract') as Array<P6Step & { path?: string; timeoutMs?: number }>;
    expect(plan.find(({ id }) => id === 'data-kit-list')?.timeoutMs).to.equal(120_000);
    expect(
      plan
        .filter(({ id }) => id !== 'data-kit-list')
        .every(({ timeoutMs }) => typeof timeoutMs === 'number' && timeoutMs <= 30_000)
    ).to.equal(true);
    expect(plan.find(({ id }) => id === 'docai-config-list')).to.deep.include({
      command: 'data360 docai config list',
      operation: 'list',
    });
    expect(plan.find(({ id }) => id === 'semantic-model-list')).to.deep.include({
      command: 'data360 semantic model list',
    });
    expect(plan.find(({ id }) => id === 'consent-read')?.blocker).to.include('Exact safe consent GET path');
    const retrieverGet = plan.find(({ id }) => id === 'retriever-get')!;
    expect(scenario.p6DependencyBlocker(retrieverGet, { 'retriever-list': { result: { items: [] } } })).to.include(
      'returned an empty list'
    );
    expect(
      scenario.p6DependencyBlocker(retrieverGet, {
        'retriever-list': { classification: { status: 'timed-out' } },
      })
    ).to.include('did not produce verified evidence');
    expect(
      scenario.argsForP6Step(retrieverGet, {
        'retriever-list': { result: { items: [{ name: 'ExampleRetriever' }] } },
      })
    ).to.deep.equal(['data360', 'retriever', 'get', '--name', 'ExampleRetriever']);
    expect(
      scenario.argsForP6Step(
        plan.find(({ id }) => id === 'semantic-model-list')!,
        {}
      )
    ).to.deep.equal(['data360', 'semantic', 'model', 'list']);
    const dataKitAvailable = plan.find(({ id }) => id === 'data-kit-available')!;
    expect(dataKitAvailable.dependsOn).to.deep.equal(['data-kit-list']);
    expect(
      scenario.argsForP6Step(dataKitAvailable, {
        'data-kit-list': {
          result: {
            items: [
              { developerName: 'ManagedKit', dataKitType: 'FILEBASED' },
              { developerName: 'SandboxKit', dataKitType: 'SANDBOX' },
            ],
          },
        },
      })
    ).to.deep.equal([
      'data360',
      'data-kit',
      'available',
      '--component-type',
      'DataLakeObject',
      '--data-kit',
      'SandboxKit',
    ]);

    const orchestrator = (await import(
      pathToFileURL(resolve(root, 'scripts', 'live-verify-all.mjs')).href
    )) as unknown as {
      parseArgs: (args: string[]) => { scenario: string; mutations: boolean; billable: boolean; readOnly: boolean };
      latestP6State: (directory: string, org: string) => Promise<unknown>;
    };
    expect(orchestrator.parseArgs(['--org', 'fixture-live-org', '--scenario', 'p6'])).to.deep.include({
      scenario: 'p6',
      mutations: false,
      billable: false,
      readOnly: true,
    });

    const corruptDirectory = await mkdtemp(resolve(tmpdir(), 'd360-p6-corrupt-'));
    await writeFile(resolve(corruptDirectory, 'fixture-live-org-lv_p6_bad.json'), '{not-json');
    let corruptError: unknown;
    try {
      await orchestrator.latestP6State(corruptDirectory, 'fixture-live-org');
    } catch (error) {
      corruptError = error;
    }
    expect(corruptError).to.be.instanceOf(Error);
    expect((corruptError as Error).message).to.include('Cannot safely inspect P6 ledger');
  });

  it('aborts bounded probes on timeout and honors a caller abort signal', async () => {
    const scenario = (await loadP6())!;
    let timeoutSignal: AbortSignal | undefined;
    const timedOut = await scenario.runP6BoundedProbe(
      async (signal) => {
        timeoutSignal = signal;
        await new Promise<void>(() => {});
        return 'unreachable';
      },
      { timeoutMs: 5 }
    );
    expect(timedOut).to.deep.include({ status: 'timed-out' });
    expect(timeoutSignal?.aborted).to.equal(true);

    const controller = new AbortController();
    controller.abort('resume cancelled');
    let invoked = false;
    const aborted = await scenario.runP6BoundedProbe(
      async () => {
        invoked = true;
        return 'unreachable';
      },
      { timeoutMs: 30_000, signal: controller.signal }
    );
    expect(aborted).to.deep.include({ status: 'aborted' });
    expect(invoked).to.equal(false);
  });

  it('gates command generation on recorded fixtures and distinguishes empty-list evidence', async () => {
    const scenario = (await loadP6())!;
    expect(
      scenario.classifyP6Evidence({
        operation: 'list',
        payload: { status: 0, result: { items: [] } },
        fixture: 'live/semantic-model-list.json',
      })
    ).to.deep.include({ status: 'verified', commandEligible: true });
    expect(
      scenario.classifyP6Evidence({
        operation: 'get',
        payload: { status: 0, result: { items: [] } },
        fixture: 'live/semantic-model-list.json',
      })
    ).to.deep.include({ status: 'blocked', commandEligible: false });
    expect(
      scenario.classifyP6Evidence({
        operation: 'create',
        payload: { status: 0, result: { items: [{ name: 'example' }] } },
      })
    ).to.deep.include({ status: 'blocked', commandEligible: false });
    expect(
      scenario.classifyP6Evidence({
        operation: 'list',
        timedOut: true,
        error: new Error('probe deadline exceeded'),
      })
    ).to.deep.include({ status: 'timed-out', commandEligible: false });
    expect(
      scenario.classifyP6Evidence({
        operation: 'get',
        error: { status: 404, code: 'NOT_FOUND' },
        fixture: 'live/p6-probe-error.json',
        expectedError: true,
      })
    ).to.deep.include({ status: 'expected-error', commandEligible: false });
    expect(
      scenario.classifyP6Evidence({
        operation: 'get',
        error: { status: 404, code: 'NOT_FOUND' },
        fixture: 'live/p6-probe-error.json',
      })
    ).to.deep.include({ status: 'failed', commandEligible: false });
    expect(
      scenario.classifyP6Evidence({
        operation: 'get',
        error: { exitCode: 2, message: 'Missing required flag name' },
        fixture: 'live/p6-probe-error.json',
      })
    ).to.deep.include({ status: 'failed', commandEligible: false });
    expect(scenario.p6LedgerStatus('passed', 'verified')).to.equal('passed');
    expect(scenario.p6LedgerStatus('passed', 'expected-error')).to.equal('expectedError');
    expect(scenario.p6LedgerStatus('passed', 'failed')).to.equal('failed');
  });

  it('registers cleanup before create, resumes passed probes, and cleans only proven ownership', async () => {
    const scenario = (await loadP6())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p6-'));
    const statePath = resolve(directory, 'state.json');
    const create: P6Step = {
      id: 'docai-config-create',
      dependsOn: [],
      command: 'data360 docai config create',
      operation: 'create',
      contract: 'recorded',
      fixture: 'live/docai-config-create.json',
      creates: 'lv_p6_cleanup_docai',
      cleanup: ['data360', 'docai', 'config', 'delete', '--name', 'lv_p6_cleanup_docai', '--no-prompt'],
    };
    const events: string[] = [];
    const execute = async (step: P6Step): Promise<unknown> => {
      events.push(`run:${step.id}`);
      return { payload: { result: { item: { name: step.creates } } } };
    };
    const cleanup = async (step: P6Step): Promise<{ exitCode: number; deletionConfirmed: boolean }> => {
      events.push(`cleanup:${step.id}`);
      return { exitCode: 0, deletionConfirmed: true };
    };
    const authorizeCreate = (
      step: P6Step
    ): { status: 'absent'; name: string; sourceStep: string; provedAt: string } => ({
      status: 'absent' as const,
      name: step.creates!,
      sourceStep: 'docai-config-list',
      provedAt: '2026-07-11T00:00:00.000Z',
    });

    const first = await scenario.runP6Scenario({
      prefix: 'lv_p6_cleanup',
      statePath,
      steps: [create],
      execute,
      cleanup,
      authorizeCreate,
    });
    expect(first.cleanup.find(({ step }) => step === create.id)).to.deep.include({
      step: create.id,
      status: 'passed',
    });
    await scenario.runP6Scenario({
      prefix: 'lv_p6_cleanup',
      statePath,
      steps: [create],
      execute,
      cleanup,
      authorizeCreate,
    });
    expect(events.filter((event) => event.startsWith('run:'))).to.deep.equal([`run:${create.id}`]);
    expect(scenario.p6CleanupKey(create)).to.equal(undefined);
    expect(
      scenario.p6CleanupKey({
        ...create,
        ownershipProof: { status: 'absent', name: create.creates },
        createEvidence: { payload: { result: { item: { name: create.creates } } } },
      })
    ).to.equal(create.creates);
  });

  it('models every REPL meta-command as manual evidence and flags the one query-submitting action', async () => {
    const scenario = (await loadP6())!;
    const checklist = scenario.p6TtyChecklist();
    expect(checklist.map(({ id }) => id)).to.have.members([
      '\\q',
      '\\dt',
      '\\d',
      '\\x',
      '\\f',
      '\\o',
      '\\dataspace',
      '\\timing',
      '\\i',
      '\\last',
      'history',
      'ctrl-c',
    ]);
    expect(
      checklist.every(({ evidence, queryDataAllowed }) => evidence === 'manual-tty' && !queryDataAllowed)
    ).to.equal(true);
    expect(
      checklist.filter(({ requiresQuerySubmission }) => requiresQuerySubmission).map(({ id }) => id)
    ).to.deep.equal(['\\i']);
    expect(checklist.find(({ id }) => id === '\\i')?.creditApprovalRequired).to.equal(true);
  });
});
