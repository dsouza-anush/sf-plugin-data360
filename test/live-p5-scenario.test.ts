import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';

type P5Step = {
  id: string;
  dependsOn: string[];
  command: string;
  creates?: string;
  cleanup?: string[];
  billable?: boolean;
  billableFamily?: string;
  blocker?: string;
  requiresPendingFrom?: string;
  boundedWait?: boolean;
  ownershipProof?: { status: string; name?: string };
  createEvidence?: unknown;
  createFailureReason?: string;
  absenceFrom?: string;
  absenceNotFoundFrom?: string;
  absenceFields?: string[];
  cleanupEndpoint?: string;
  cleanupEndpointKeyFields?: string[];
  cleanupAllowsPlannedName?: boolean;
  nameFrom?: string;
  nameKind?: 'id' | 'apiName' | 'canonicalName';
  recordFrom?: string;
  waitForSegmentReady?: boolean;
  waitForSearchReady?: boolean;
  waitMs?: number;
  timeoutMs?: number;
  definition?: string;
  indexFrom?: string;
  dataKitFrom?: string;
  componentFrom?: string;
  includeComponentType?: boolean;
  expectedComponent?: string;
  query?: string;
};

type P5Scenario = {
  buildP5ContractProbePlan: (prefix: string) => P5Step[];
  buildP5IdentityCloneDefinition: (item: Record<string, unknown>, prefix: string) => Record<string, unknown>;
  buildP5Plan: (
    prefix: string,
    options?: {
      allowSharedData?: boolean;
      useExistingSearch?: boolean;
      useProfileLookup?: boolean;
      allowBillable?: boolean;
      allowIdentity?: boolean;
      includeDataKit?: boolean;
      graphRefreshOnly?: boolean;
      segmentOnly?: boolean;
      dataKitOnly?: boolean;
      identityOnly?: boolean;
    }
  ) => P5Step[];
  argsForP5Step: (
    step: P5Step,
    files: Record<string, string>,
    dynamic?: {
      resourceKeys?: Record<string, string>;
      resourceIdentities?: Record<string, { id?: string; apiName?: string; canonicalName?: string }>;
      recordIds?: Record<string, string>;
      dataKitComponents?: Record<string, { type: string; info: { name: string; label?: string } }>;
    }
  ) => string[];
  createP5Prefix: (date: Date, random: () => number) => string;
  p5Names: (prefix: string) => Record<string, string>;
  deriveProfileLookup: (
    payload: unknown,
    metadata?: unknown
  ) => { entity: string; dataSource: string; dataSourceObject: string; record: string } | undefined;
  extractP5Identity: (payload: unknown, fields?: string[]) => string | undefined;
  selectReadySearchIndex: (payload: unknown) => string | undefined;
  selectP5DataKitComponent: (
    payload: unknown,
    expectedName?: string
  ) => { type: string; info: { name: string; label?: string } } | undefined;
  p5DataKitComponentDefinitions: (component: { type: string; info: { name: string; label?: string } }) => {
    update: { components: unknown[] };
    deploy: { components: unknown[] };
    undeploy: { components: unknown[] };
  };
  executeP5Bounded: <T>(
    execute: () => Promise<T>,
    options: {
      waitMs: number;
      delayMs?: number;
      now?: () => number;
      sleep?: (milliseconds: number) => Promise<void>;
    }
  ) => Promise<T>;
  isP5CreateCollision: (error: unknown) => boolean;
  isP5RemoteAbsent: (payload: unknown) => boolean;
  matchesP5ExpectedError: (payload: unknown, expected: { code: string; action?: string; apiCode?: string }) => boolean;
  p5CleanupKey: (step: P5Step) => string | undefined;
  p5CreditFamily: (command: string) => string | undefined;
  pendingQueryRequiredBlocker: (payload: unknown, operation: string) => string | undefined;
  parseP5Options: (
    environment: NodeJS.ProcessEnv,
    options?: { cleanupOnly?: boolean }
  ) => {
    mutations: true;
    billable: boolean;
    cleanupOnly?: true;
    sharedData?: true;
    graphRefreshOnly?: true;
    segmentOnly?: true;
    dataKitOnly?: true;
    identityOnly?: true;
  };
  proveP5NameAvailable: (
    step: P5Step,
    payload: unknown,
    now?: () => Date
  ) => { status: 'absent'; name: string; sourceStep: string; provedAt: string };
  queryCacheDependencies: (plan: P5Step[]) => Record<string, string[]>;
  validateP5BillablePlan: (plan: P5Step[]) => P5Step[];
  verifyP5Cleanup: (options: {
    current: P5Step;
    remove: (key: string) => Promise<unknown>;
    read: (key: string) => Promise<unknown>;
    isAbsent: (payload: unknown) => boolean;
  }) => Promise<{ exitCode: number; deletionConfirmed: boolean; reason?: string }>;
  runP5Scenario: (options: {
    prefix: string;
    statePath: string;
    steps: P5Step[];
    execute: (step: P5Step) => Promise<unknown>;
    cleanup: (step: P5Step) => Promise<{ exitCode: number; deletionConfirmed: boolean }>;
    authorizeCreate?: (
      step: P5Step,
      state: { results: Record<string, { status: string; evidence?: unknown }> }
    ) => { status: 'absent'; name: string; sourceStep: string; provedAt: string };
    isCreateCollision?: (error: unknown, step: P5Step) => boolean;
    cleanupOnly?: boolean;
    blockerFor?: (
      step: P5Step,
      state: { results: Record<string, { status: string; evidence?: unknown }> }
    ) => string | undefined;
    retryFailed?: boolean;
    retryBlocked?: boolean;
  }) => Promise<{
    billableCalls: number;
    billableAttempts: number;
    billableOutcomes: Array<{ step: string; status: string; reason?: string }>;
    cleanupStack: Array<{ step: string; status: string; reason?: string }>;
    cleanup: Array<{ step: string; status: string }>;
    results: Record<string, { status: string }>;
  }>;
  writeP5Definitions: (directory: string, prefix: string) => Promise<Record<string, string>>;
};

const root = resolve(import.meta.dirname, '..');
const loadP5 = async (): Promise<P5Scenario | null> => {
  const modulePath = resolve(root, 'scripts', 'live-scenarios', 'p5.mjs');
  try {
    await access(modulePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return (await import(pathToFileURL(modulePath).href)) as P5Scenario;
};

describe('disposable Query/P5 live scenario', () => {
  it('defines an ordered DAG with explicit mutation and billable gates', async () => {
    const scenario = await loadP5();
    expect(scenario, 'P5 scenario module must exist').not.to.equal(null);
    expect(() => scenario!.parseP5Options({})).to.throw('D360_LIVE_MUTATIONS=1');
    expect(scenario!.parseP5Options({ D360_LIVE_MUTATIONS: '1' })).to.deep.equal({
      mutations: true,
      billable: false,
    });
    expect(scenario!.parseP5Options({ D360_LIVE_MUTATIONS: '1', D360_LIVE_BILLABLE: '1' })).to.deep.equal({
      mutations: true,
      billable: true,
    });
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_BILLABLE: '1',
        D360_LIVE_SHARED_DATA: '1',
      })
    ).to.deep.equal({ mutations: true, billable: true, sharedData: true });
    expect(scenario!.parseP5Options({ D360_LIVE_MUTATIONS: '1' }, { cleanupOnly: true })).to.deep.equal({
      mutations: true,
      billable: false,
      cleanupOnly: true,
    });
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_BILLABLE: '1',
        D360_LIVE_EXISTING_SEARCH: '1',
      })
    ).to.deep.equal({ mutations: true, billable: true, existingSearch: true });
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_BILLABLE: '1',
        D360_LIVE_PROFILE_LOOKUP: '1',
      })
    ).to.deep.equal({ mutations: true, billable: true, profileLookup: true });
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_DATA_KIT_MUTATIONS: '1',
      })
    ).to.deep.equal({ mutations: true, billable: false, dataKitMutations: true });
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_CONTRACT_PROBES_ONLY: '1',
      })
    ).to.deep.equal({ mutations: true, billable: false, contractProbesOnly: true });
    expect(() =>
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_P5_GRAPH_REFRESH_ONLY: '1',
      })
    ).to.throw('P5 graph-refresh-only scenario requires D360_LIVE_BILLABLE=1');
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_BILLABLE: '1',
        D360_LIVE_P5_GRAPH_REFRESH_ONLY: '1',
      })
    ).to.deep.equal({
      mutations: true,
      billable: true,
      graphRefreshOnly: true,
    });
    expect(() =>
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_P5_SEGMENT_ONLY: '1',
      })
    ).to.throw('P5 segment-only scenario requires D360_LIVE_BILLABLE=1');
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_BILLABLE: '1',
        D360_LIVE_P5_SEGMENT_ONLY: '1',
      })
    ).to.deep.equal({
      mutations: true,
      billable: true,
      segmentOnly: true,
    });
    expect(() =>
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_P5_DATA_KIT_ONLY: '1',
      })
    ).to.throw('P5 data-kit-only scenario requires D360_LIVE_DATA_KIT_MUTATIONS=1');
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_DATA_KIT_MUTATIONS: '1',
        D360_LIVE_P5_DATA_KIT_ONLY: '1',
      })
    ).to.deep.equal({
      mutations: true,
      billable: false,
      dataKitMutations: true,
      dataKitOnly: true,
    });
    expect(() =>
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_P5_IDENTITY_ONLY: '1',
      })
    ).to.throw('P5 identity-only scenario requires D360_LIVE_BILLABLE=1');
    expect(
      scenario!.parseP5Options({
        D360_LIVE_MUTATIONS: '1',
        D360_LIVE_BILLABLE: '1',
        D360_LIVE_P5_IDENTITY_ONLY: '1',
      })
    ).to.deep.equal({
      mutations: true,
      billable: true,
      identityOnly: true,
    });
    expect(scenario!.isP5RemoteAbsent([{ message: 'Data Graph not found with name disposable_graph' }])).to.equal(true);
    expect(scenario!.createP5Prefix(new Date('2026-07-11T12:34:56.000Z'), () => 0)).to.equal(
      'lv_p5_20260711123456_000000'
    );
    const entropyNames = scenario!.p5Names('lv_p5_20260711123456_abcdef_extra_length_that_forces_truncation_abcdef');
    expect(Object.values(entropyNames).every((value) => value.length <= 40)).to.equal(true);
    expect(
      Object.entries(entropyNames)
        .filter(([key]) => key !== 'identity')
        .every(([, value]) => value.includes('abcdef'))
    ).to.equal(true);
    expect(entropyNames.identity).to.match(/^r[a-z0-9]{3}$/u);

    const plan = scenario!.buildP5Plan('lv_p5_contract');
    const indexes = new Map(plan.map(({ id }, index) => [id, index]));
    for (const current of plan) {
      for (const dependency of current.dependsOn) {
        expect(indexes.get(dependency), `${current.id} dependency ${dependency}`).to.be.lessThan(
          indexes.get(current.id)!
        );
      }
    }

    const creditSteps = plan.filter(({ command }) => scenario!.p5CreditFamily(command));
    expect(creditSteps).not.to.be.empty;
    for (const current of creditSteps) {
      expect(current.billable, current.id).to.equal(true);
      expect(current.billableFamily, current.id).to.equal(scenario!.p5CreditFamily(current.command));
    }
    const billableCounts = new Map<string, number>();
    for (const current of creditSteps.filter(({ blocker }) => !blocker)) {
      billableCounts.set(current.billableFamily!, (billableCounts.get(current.billableFamily!) ?? 0) + 1);
    }
    expect([...billableCounts.values()].every((count) => count <= 1)).to.equal(true);
    const querySubmits = plan.filter(({ command }) => command === 'data360 query');
    expect(querySubmits.filter(({ blocker }) => !blocker)).to.have.length(0);
    expect(querySubmits.every(({ blocker }) => Boolean(blocker))).to.equal(true);
    expect(JSON.stringify(querySubmits)).not.to.include('CROSS JOIN');
    expect(plan.find(({ id }) => id === 'disposable-dmo-create')?.blocker).to.equal(undefined);
    for (const id of ['calculated-insight-create', 'segment-create', 'search-index-create', 'data-graph-create']) {
      expect(plan.find((current) => current.id === id)?.dependsOn).to.include('disposable-dmo-get');
      expect(plan.find((current) => current.id === id)?.blocker).to.equal(undefined);
    }
    const nonBillablePlan = scenario!.buildP5Plan('lv_p5_nonbillable', { allowBillable: false });
    for (const current of nonBillablePlan.filter(({ command }) => scenario!.p5CreditFamily(command))) {
      expect(current.blocker, current.id).to.be.a('string');
    }
    const graphRefreshPlan = scenario!.buildP5Plan('lv_p5_graph_refresh', {
      allowBillable: true,
      graphRefreshOnly: true,
    });
    expect(graphRefreshPlan.map(({ id }) => id)).to.deep.equal([
      'disposable-dmo-list',
      'disposable-dmo-create',
      'disposable-dmo-get',
      'data-graph-list',
      'data-graph-create',
      'data-graph-get',
      'data-graph-refresh',
    ]);
    expect(graphRefreshPlan.filter(({ billable }) => billable).map(({ command }) => command)).to.deep.equal([
      'data360 data-graph refresh',
    ]);
    expect(graphRefreshPlan.filter(({ creates }) => creates).map(({ command }) => command)).to.deep.equal([
      'data360 dmo create',
      'data360 data-graph create',
    ]);
    const segmentOnlyPlan = scenario!.buildP5Plan('lv_p5_segment_only', {
      allowBillable: true,
      segmentOnly: true,
    });
    expect(segmentOnlyPlan.map(({ id }) => id)).to.deep.equal([
      'disposable-dmo-list',
      'disposable-dmo-create',
      'disposable-dmo-get',
      'segment-list',
      'segment-create',
      'segment-get',
      'segment-update',
      'segment-get-after-update',
      'segment-publish',
      'segment-deactivate',
    ]);
    expect(segmentOnlyPlan.filter(({ billable }) => billable).map(({ command }) => command)).to.deep.equal([
      'data360 segment publish',
    ]);
    const dataKitOnlyPlan = scenario!.buildP5Plan('lv_p5_data_kit_only', {
      includeDataKit: true,
      dataKitOnly: true,
    });
    expect(dataKitOnlyPlan.map(({ id }) => id)).to.include.members([
      'data-kit-dlo-create',
      'data-kit-create',
      'data-kit-component-dependencies',
      'data-kit-deploy',
      'data-kit-delete',
    ]);
    expect(dataKitOnlyPlan.every(({ id }) => id.startsWith('data-kit-'))).to.equal(true);
    const identityOnlyPlan = scenario!.buildP5Plan('lv_p5_identity_only', {
      allowBillable: true,
      allowIdentity: true,
      identityOnly: true,
    });
    expect(identityOnlyPlan.map(({ id }) => id)).to.deep.equal([
      'identity-list',
      'identity-create',
      'identity-get',
      'identity-update',
      'identity-run',
      'identity-delete',
    ]);
    expect(identityOnlyPlan.find(({ id }) => id === 'identity-create')?.blocker).to.equal(undefined);
    const identityClone = scenario!.buildP5IdentityCloneDefinition(
      {
        id: 'retained-id',
        label: 'Retained ruleset',
        rulesetStatus: 'ACTIVE',
        totalUnifiedProfiles: 123,
        configurationType: 'individual',
        dataSpaceName: 'default',
        doesRunAutomatically: true,
        matchRules: [{ label: 'Email', criteria: [{ fieldName: 'ssot__EmailAddress__c' }] }],
        reconciliationRules: [{ entityName: 'ssot__Individual__dlm', ruleType: 'lastupdated' }],
      },
      'lv_p5_identity_clone'
    );
    expect(identityClone).to.deep.include({
      rulesetId: scenario!.p5Names('lv_p5_identity_clone').identity,
      doesRunAutomatically: false,
      configurationType: 'individual',
      dataSpaceName: 'default',
    });
    expect(identityClone).not.to.have.any.keys('id', 'rulesetStatus', 'totalUnifiedProfiles');
    const sharedPlan = scenario!.buildP5Plan('lv_p5_shared', { allowSharedData: true });
    expect(sharedPlan.find(({ id }) => id === 'query-one-shot')?.blocker).to.equal(undefined);
    expect(sharedPlan.find(({ id }) => id === 'query-one-shot')?.query).to.equal(
      'SELECT "ssot__Id__c" FROM "ssot__Account__dlm" LIMIT 1'
    );
    expect(sharedPlan.find(({ id }) => id === 'identity-create')?.blocker).to.include('Contact Point');
    expect(
      scenario!.buildP5Plan('lv_p5_identity', { allowIdentity: true }).find(({ id }) => id === 'identity-create')
        ?.blocker
    ).to.equal(undefined);
    const bypassedCap = plan.map((current) =>
      ['query-one-shot', 'query-async'].includes(current.id) ? { ...current, blocker: undefined } : current
    );
    expect(() => scenario!.validateP5BillablePlan(bypassedCap)).to.throw('billable cap exceeded for query');
    const existingSearchPlan = scenario!.buildP5Plan('lv_p5_existing_search', { useExistingSearch: true });
    for (const id of ['query-vector', 'query-hybrid']) {
      expect(existingSearchPlan.find((current) => current.id === id)).to.deep.include({
        dependsOn: ['search-index-list'],
        indexFrom: 'search-index-list',
      });
      expect(existingSearchPlan.find((current) => current.id === id)?.blocker).to.equal(undefined);
    }
    expect(
      scenario!.selectReadySearchIndex({
        result: {
          items: [
            { developerName: 'FailedIndex', runtimeStatus: 'FAILED' },
            { developerName: 'ReadyIndex', runtimeStatus: 'READY' },
          ],
        },
      })
    ).to.equal('ReadyIndex');
    const selectedComponent = scenario!.selectP5DataKitComponent(
      {
        result: {
          items: [
            { type: 'DataGraph', info: { name: 'SkipGraph' } },
            { componentType: 'DataLakeObject', developerName: 'RetainedSource__dll', label: 'Retained Source' },
            { type: 'DataLakeObject', info: { name: 'OwnedSource__dll', label: 'Owned Source' } },
          ],
        },
      },
      'OwnedSource__dll'
    );
    expect(selectedComponent).to.deep.equal({
      type: 'DataLakeObject',
      info: { name: 'OwnedSource__dll', label: 'Owned Source' },
    });
    expect(scenario!.p5DataKitComponentDefinitions(selectedComponent!)).to.deep.equal({
      update: {
        components: [{ type: 'DataLakeObject', info: { name: 'OwnedSource__dll', label: 'Owned Source' } }],
      },
      deploy: { components: [{ type: 'DataLakeObject', name: 'OwnedSource__dll' }] },
      undeploy: { components: [{ type: 'DataLakeObject', name: 'OwnedSource__dll' }] },
    });
    expect(
      scenario!.argsForP5Step(
        {
          id: 'component-dependencies',
          dependsOn: [],
          command: 'data360 data-kit component dependencies',
          nameFrom: 'data-kit-create',
          componentFrom: 'data-kit-available-owned',
          includeComponentType: true,
        },
        {},
        {
          resourceKeys: { 'data-kit-create': 'OwnedKit' },
          dataKitComponents: { 'data-kit-available-owned': selectedComponent! },
        }
      )
    ).to.deep.equal([
      'data360',
      'data-kit',
      'component',
      'dependencies',
      '--name',
      'OwnedKit',
      '--component',
      'OwnedSource__dll',
      '--component-type',
      'DataLakeObject',
    ]);
    const profilePlan = scenario!.buildP5Plan('lv_p5_profile', { useProfileLookup: true });
    expect(profilePlan.find(({ id }) => id === 'query-one-shot')?.query).to.include('ssot__DataSourceObjectId__c');
    expect(profilePlan.find(({ id }) => id === 'profile-lookup')?.blocker).to.equal(undefined);

    const activationMutations = plan.filter(
      ({ command }) =>
        /^data360 activation(?:-target)? (?:create|update|delete)$/u.test(command) ||
        /^data360 activation (?:create|update|delete)$/u.test(command)
    );
    expect(activationMutations).not.to.be.empty;
    expect(activationMutations.every(({ blocker, creates }) => Boolean(blocker) && !creates)).to.equal(true);

    const metadataSearch = plan.find(({ id }) => id === 'metadata-search');
    expect(metadataSearch).to.deep.include({
      command: 'data360 metadata search',
      blocker: 'Metadata search is specified but is not shipped in the current 135-command snapshot',
    });
    for (const id of ['query-one-shot', 'profile-get', 'profile-lookup', 'data-graph-query']) {
      expect(plan.find((current) => current.id === id)?.blocker, `${id} shared-data guard`).to.be.a('string');
    }
    const segmentCreate = plan.find(({ id }) => id === 'segment-create')!;
    expect(scenario!.p5CleanupKey(segmentCreate)).to.equal(undefined);
    expect(
      scenario!.p5CleanupKey({
        ...segmentCreate,
        ownershipProof: { status: 'absent', name: segmentCreate.creates },
      })
    ).to.equal(segmentCreate.creates);
    expect(
      scenario!.p5CleanupKey({
        ...segmentCreate,
        createEvidence: { payload: { result: { item: { segmentApiName: segmentCreate.creates } } } },
      })
    ).to.equal(segmentCreate.creates);
    const searchCreate = plan.find(({ id }) => id === 'search-index-create')!;
    expect(
      scenario!.p5CleanupKey({
        ...searchCreate,
        ownershipProof: { status: 'absent', name: searchCreate.creates },
      })
    ).to.equal(undefined);
    expect(
      scenario!.p5CleanupKey({
        ...segmentCreate,
        ownershipProof: { status: 'absent', name: segmentCreate.creates },
        createFailureReason: '409 CONFLICT: already exists',
      })
    ).to.equal(undefined);
    expect(scenario!.p5CleanupKey({ id: 'shared-read', dependsOn: [], command: 'data360 segment list' })).to.equal(
      undefined
    );
    expect(
      scenario!.isP5RemoteAbsent({
        code: 'D360_NOT_FOUND',
        data: { httpStatus: 404, apiCode: 'ITEM_NOT_FOUND' },
      })
    ).to.equal(true);
    expect(scenario!.isP5RemoteAbsent([{ errorCode: 'ITEM_NOT_FOUND', message: 'Data graph not found' }])).to.equal(
      true
    );
    expect(
      scenario!.isP5RemoteAbsent({
        code: 'D360_API_ERROR',
        data: { httpStatus: 404, apiCode: 'INTERNAL_ERROR' },
        message: 'Data Graph not found with name lv_p5_owned_dg',
      })
    ).to.equal(true);
    expect(
      scenario!.isP5RemoteAbsent({
        code: 'D360_API_ERROR',
        message: 'A data lake object instance with the supplied ID does not exists.',
      })
    ).to.equal(true);
    expect(scenario!.isP5RemoteAbsent({ code: 'D360_NAME_NOT_FOUND', message: 'No resource matches' })).to.equal(false);
  });

  it('builds non-billable real-org contract probes without retained-resource mutations', async () => {
    const scenario = (await loadP5())!;
    const plan = scenario.buildP5ContractProbePlan('lv_p5_contract');
    const commands = plan.map(({ command }) => command);
    for (const command of [
      'data360 activation-target create',
      'data360 activation-target update',
      'data360 activation create',
      'data360 activation results',
      'data360 activation update',
      'data360 activation delete',
      'data360 data-graph query',
      'data360 data-graph delete',
      'data360 calculated-insight update',
      'data360 segment update',
      'data360 search-index delete',
      'data360 data-space member set',
      'data360 query resume',
      'data360 query results',
      'data360 query cancel',
      'data360 token display',
      'data360 identity-resolution update',
      'data360 transform create',
      'data360 transform update',
      'data360 transform get',
      'data360 transform validate',
      'data360 transform report',
      'data360 transform retry',
      'data360 transform cancel',
      'data360 transform schedule set',
      'data360 transform schedule display',
      'data360 transform delete',
    ]) {
      expect(commands, command).to.include(command);
    }
    expect(plan.every(({ billable, creates }) => billable !== true && creates === undefined)).to.equal(true);
    expect(commands).not.to.include('data360 transform run');
    expect(plan.find(({ id }) => id === 'probe-query-cancel')).to.deep.include({
      expectedFailure: true,
      allowSuccess: true,
    });
  });

  it('connects async, resume, results, and cancel exclusively through cached query IDs', async () => {
    const scenario = (await loadP5())!;
    const dependencies = scenario.queryCacheDependencies(scenario.buildP5Plan('lv_p5_query'));
    expect(dependencies).to.deep.equal({
      'query-resume': ['query-async'],
      'query-results': ['query-resume'],
      'query-cancel': ['query-cancel-submit'],
    });
    const plan = scenario.buildP5Plan('lv_p5_query');
    expect(plan.find(({ id }) => id === 'query-resume')?.command).to.equal('data360 query resume');
    expect(plan.find(({ id }) => id === 'query-results')?.command).to.equal('data360 query results');
    expect(
      plan
        .filter(({ id }) => ['query-resume', 'query-results'].includes(id))
        .some(({ command }) => command === 'data360 query')
    ).to.equal(false);
    expect(plan.find(({ id }) => id === 'query-resume')?.requiresPendingFrom).to.equal('query-async');
    expect(plan.find(({ id }) => id === 'query-cancel')?.requiresPendingFrom).to.equal('query-cancel-submit');
    expect(
      scenario.pendingQueryRequiredBlocker(
        { status: 0, result: { status: 'ResultsProduced', queryId: 'terminal-id' } },
        'data360 query cancel'
      )
    ).to.include('was not invoked and is not live-verified');
    expect(
      scenario.pendingQueryRequiredBlocker(
        { status: 0, result: { status: 'Running', queryId: 'pending-id' } },
        'data360 query cancel'
      )
    ).to.equal(undefined);
  });

  it('records absent metadata search as a blocker without invoking the CLI', async () => {
    const scenario = (await loadP5())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-metadata-search-'));
    const metadataSearch = scenario.buildP5Plan('lv_p5_metadata').find(({ id }) => id === 'metadata-search')!;
    let executions = 0;

    const state = await scenario.runP5Scenario({
      prefix: 'lv_p5_metadata',
      statePath: resolve(directory, 'state.json'),
      steps: [metadataSearch],
      execute: async () => {
        executions += 1;
        return {};
      },
      cleanup: async () => ({ exitCode: 0, deletionConfirmed: true }),
    });

    expect(executions).to.equal(0);
    expect(state.results['metadata-search']).to.deep.include({
      status: 'blocked',
      reason: metadataSearch.blocker,
    });
  });

  it('never invokes resume or cancel when the corresponding submit is already terminal', async () => {
    const scenario = (await loadP5())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-terminal-query-'));
    const selected = scenario
      .buildP5Plan('lv_p5_terminal')
      .filter(({ id }) => ['query-async', 'query-resume', 'query-cancel-submit', 'query-cancel'].includes(id))
      .map((current) =>
        ['query-async', 'query-cancel-submit'].includes(current.id) ? { ...current, blocker: undefined } : current
      );
    const executions: string[] = [];

    const state = await scenario.runP5Scenario({
      prefix: 'lv_p5_terminal',
      statePath: resolve(directory, 'state.json'),
      steps: selected,
      blockerFor: (current, currentState) =>
        current.requiresPendingFrom
          ? scenario.pendingQueryRequiredBlocker(
              currentState.results[current.requiresPendingFrom]?.evidence,
              current.command
            )
          : undefined,
      execute: async (current) => {
        executions.push(current.id);
        return { status: 0, result: { queryId: `${current.id}-id`, status: 'ResultsProduced' } };
      },
      cleanup: async () => ({ exitCode: 0, deletionConfirmed: true }),
    });

    expect(executions).to.deep.equal(['query-async', 'query-cancel-submit']);
    expect(state.results['query-resume'].status).to.equal('blocked');
    expect(state.results['query-cancel'].status).to.equal('blocked');
  });

  it('extracts actual names and IDs and never guesses incomplete profile lookup paths', async () => {
    const scenario = (await loadP5())!;
    const payload = {
      result: {
        rows: [
          {
            ssot__Id__c: 'account-record',
            ssot__DataSourceId__c: 'source-id',
            ssot__DataSourceObjectId__c: 'source-object-id',
          },
        ],
        metadata: { dataModelName: 'ssot__Account__dlm' },
      },
    };
    expect(scenario.extractP5Identity(payload, ['ssot__Id__c'])).to.equal('account-record');
    expect(scenario.deriveProfileLookup(payload)).to.deep.equal({
      entity: 'ssot__Account__dlm',
      dataSource: 'source-id',
      dataSourceObject: 'source-object-id',
      record: 'account-record',
    });
    expect(scenario.deriveProfileLookup({ result: { rows: [{ ssot__Id__c: 'account-record' }] } })).to.equal(undefined);
    expect(
      scenario.deriveProfileLookup(
        {
          result: {
            rows: [
              {
                ssot__Id__c: 'account-record',
                ssot__DataSourceId__c: 'source-id',
                ssot__DataSourceObjectId__c: 'source-object-id',
              },
            ],
          },
        },
        {
          result: {
            item: {
              metadata: [{ name: 'ssot__Account__dlm', referenceModelEntityDeveloperName: 'Account' }],
            },
          },
        }
      )
    ).to.deep.equal({
      entity: 'ssot__Account__dlm',
      dataSource: 'source-id',
      dataSourceObject: 'source-object-id',
      record: 'account-record',
    });
  });

  it('writes definitions that satisfy constraints proven by the first live attempt', async () => {
    const scenario = (await loadP5())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-defs-'));
    const prefix = 'lv_p5_20260712005606_08090a';
    const files = await scenario.writeP5Definitions(directory, prefix);
    const definitions = Object.fromEntries(
      await Promise.all(
        Object.entries(files).map(async ([key, path]) => [key, JSON.parse(await readFile(path, 'utf8')) as unknown])
      )
    ) as Record<string, Record<string, unknown>>;
    expect((definitions.dataGraph.name as string).length).to.be.at.most(40);
    expect((definitions.dataGraph.label as string).length).to.be.at.most(40);
    expect((definitions.calculatedInsight.apiName as string).length).to.be.at.most(40);
    expect((definitions.calculatedInsight.displayName as string).length).to.be.at.most(40);
    const sourceDmo = scenario.p5Names(prefix).dmo;
    expect(definitions.calculatedInsight.expression).to.include(`${sourceDmo}.record_id__c`);
    expect(definitions.calculatedInsight.expression).not.to.include('"');
    expect(
      (definitions.segment.includeDbt as { models: { models: Array<{ sql: string }> } }).models.models[0].sql
    ).to.include(`${sourceDmo}.record_id__c`);
    expect(definitions.searchIndex.sourceDmoDeveloperName).to.equal(sourceDmo);
    expect(definitions.dataGraph.primaryObjectName).to.equal(sourceDmo);
    expect(JSON.stringify(definitions.searchIndex)).not.to.include('max_token_limit');
    expect(JSON.stringify(definitions.searchIndex)).not.to.include('hnswEfConstruction');
    expect(definitions.searchIndexUpdate).to.deep.include({
      developerName: definitions.searchIndex.developerName,
      label: `${prefix.slice(0, 18)} Index Updated`,
    });
    expect((definitions.calculatedInsightUpdate.displayName as string).length).to.be.at.most(40);
    expect(
      (
        definitions.identity.matchRules as Array<{
          criteria: Array<{ fieldName: string }>;
        }>
      )[0].criteria.map(({ fieldName }) => fieldName)
    ).to.deep.equal(['ssot__FirstName__c', 'ssot__LastName__c', 'ssot__BirthDate__c']);
    for (const key of ['developerName', 'chunkDmoDeveloperName', 'vectorDmoDeveloperName']) {
      expect((definitions.searchIndex[key] as string).length, key).to.be.at.most(40);
    }
    const identity = scenario.buildP5Plan(prefix).find(({ id }) => id === 'identity-create');
    expect(identity?.blocker).to.include('Contact Point');
    expect(identity?.creates).to.equal(scenario.p5Names(prefix).identity);
    expect(identity?.cleanupEndpoint).to.equal('/identity-resolutions/{key}');
    const dataKitPlan = scenario.buildP5Plan(prefix, { includeDataKit: true });
    expect(dataKitPlan.find(({ id }) => id === 'data-kit-dlo-create')).to.deep.include({
      command: 'data360 dlo create',
      creates: scenario.p5Names(prefix).dataKitDlo,
      cleanupEndpoint: '/data-lake-objects/{key}',
    });
    expect(dataKitPlan.find(({ id }) => id === 'data-kit-absence')).to.deep.include({
      command: 'data360 api request',
      expectedFailure: true,
    });
    expect(dataKitPlan.find(({ id }) => id === 'data-kit-create')).to.deep.include({
      command: 'data360 data-kit create',
      creates: scenario.p5Names(prefix).dataKit,
      cleanupEndpoint: '/data-kits/{key}',
      dependsOn: ['data-kit-absence', 'data-kit-dlo-create'],
    });
    expect(dataKitPlan.find(({ id }) => id === 'data-kit-available-owned')).to.deep.include({
      command: 'data360 data-kit available',
      dataKitFrom: 'data-kit-create',
    });
    expect(dataKitPlan.find(({ id }) => id === 'data-kit-component-dependencies')).to.deep.include({
      command: 'data360 data-kit component dependencies',
      componentFrom: 'data-kit-available-owned',
    });
    expect(dataKitPlan.find(({ id }) => id === 'data-kit-component-status')).to.deep.include({
      command: 'data360 data-kit component status',
      dependsOn: ['data-kit-deploy'],
    });
    expect(dataKitPlan.find(({ id }) => id === 'data-kit-undeploy')).to.deep.include({
      command: 'data360 data-kit undeploy',
      dependsOn: ['data-kit-update'],
      expectedFailure: true,
      allowSuccess: true,
    });
    const plan = scenario.buildP5Plan(prefix);
    expect(plan.find(({ id }) => id === 'segment-get')).to.deep.include({
      command: 'data360 segment get',
      dependsOn: ['segment-create'],
      waitForSegmentReady: true,
      waitMs: 300_000,
    });
    expect(plan.find(({ id }) => id === 'segment-get-after-update')).to.deep.include({
      command: 'data360 segment get',
      dependsOn: ['segment-update'],
      waitForSegmentReady: true,
      waitMs: 300_000,
    });
    expect('args' in plan.find(({ id }) => id === 'segment-get')!).to.equal(false);
    expect(plan.find(({ id }) => id === 'data-graph-get')?.boundedWait).to.equal(true);
  });

  it('keeps record-reading commands blocked while provisioning disposable metadata lifecycles', async () => {
    const scenario = (await loadP5())!;
    const plan = scenario.buildP5Plan('lv_p5_lifecycle');
    const byId = new Map(plan.map((current) => [current.id, current]));
    for (const id of ['query-one-shot']) {
      expect(byId.get(id)?.blocker, id).to.be.a('string').and.not.empty;
    }
    for (const id of ['segment-create', 'search-index-create', 'data-graph-create']) {
      expect(byId.get(id)?.blocker, id).to.equal(undefined);
      expect(byId.get(id)?.dependsOn, id).to.include('disposable-dmo-get');
    }
    expect(byId.get('query-one-shot')?.query).to.equal(undefined);
    expect(byId.get('data-graph-query')).to.deep.include({
      blocker: 'No scenario-owned synthetic graph record exists; arbitrary Account graph bodies are not read',
    });
    expect(byId.get('data-graph-query')?.nameFrom).to.equal(undefined);
    expect(byId.get('data-graph-query')?.recordFrom).to.equal(undefined);
  });

  it('bounds disposable P5 lifecycles and dependent reads', async () => {
    const scenario = (await loadP5())!;
    const plan = scenario.buildP5Plan('lv_p5_proven');
    const byId = new Map(plan.map((current) => [current.id, current]));

    for (const id of ['segment-create', 'search-index-create', 'data-graph-create']) {
      expect(byId.get(id)?.blocker, id).to.equal(undefined);
      expect(byId.get(id)?.cleanup, id).to.be.an('array').and.not.empty;
    }
    expect(byId.get('query-one-shot')?.blocker).to.include('shared Account records are not queried');
    expect(byId.get('segment-publish')).to.deep.include({
      billable: true,
      billableFamily: 'segment',
      args: ['--wait', '5', '--no-prompt'],
      timeoutMs: 360_000,
    });
    expect(byId.get('search-index-describe')).to.deep.include({
      command: 'data360 search-index describe',
      dependsOn: ['search-index-get'],
      nameFrom: 'search-index-get',
    });
    expect(byId.get('search-index-describe')?.waitForSearchReady).to.equal(undefined);
    expect(byId.get('data-graph-get')).to.deep.include({ boundedWait: true, waitMs: 300_000 });
    expect(byId.get('data-graph-refresh')).to.deep.include({ timeoutMs: 360_000 });
    expect(byId.get('data-graph-query')?.blocker).to.include('arbitrary Account graph bodies are not read');
  });

  it('classifies expected errors by structured code, action, and API code', async () => {
    const scenario = (await loadP5())!;
    const expected = {
      code: 'D360_API_ERROR',
      action: 'Re-run with --json to inspect the structured API error details.',
      apiCode: 'FEATURE_NOT_ENABLED',
    };
    expect(
      scenario.matchesP5ExpectedError(
        {
          code: expected.code,
          actions: [expected.action],
          data: { apiCode: expected.apiCode },
        },
        expected
      )
    ).to.equal(true);
    expect(
      scenario.matchesP5ExpectedError(
        { code: 'D360_API_ERROR', message: expected.apiCode, actions: [expected.action] },
        expected
      )
    ).to.equal(false);
  });

  it('surfaces the last bounded-wait error instead of returning undefined', async () => {
    const scenario = (await loadP5())!;
    let attempts = 0;
    let caught: unknown;
    try {
      await scenario.executeP5Bounded(
        async () => {
          attempts += 1;
          throw new Error('not visible yet');
        },
        { waitMs: 0 }
      );
    } catch (error) {
      caught = error;
    }
    expect(attempts).to.equal(1);
    expect((caught as Error).message).to.equal('not visible yet');
  });

  it('uses deadline-aware bounded-wait sleeps and rethrows the original last error', async () => {
    const scenario = (await loadP5())!;
    let clock = 1_000;
    const sleeps: number[] = [];
    const original = new Error('still not visible');
    let caught: unknown;
    try {
      await scenario.executeP5Bounded(
        async () => {
          throw original;
        },
        {
          waitMs: 25,
          delayMs: 10,
          now: () => clock,
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
            clock += milliseconds;
          },
        }
      );
    } catch (error) {
      caught = error;
    }
    expect(sleeps).to.deep.equal([10, 10, 5]);
    expect(caught).to.equal(original);
  });

  it('proves exact absence before create and never cleans a collision it does not own', async () => {
    const scenario = (await loadP5())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-ownership-'));
    const plan = scenario.buildP5Plan('lv_p5_ownership');
    const list = plan.find(({ id }) => id === 'segment-list')!;
    const create = {
      ...plan.find(({ id }) => id === 'segment-create')!,
      blocker: undefined,
      dependsOn: [list.id],
    };
    expect(() =>
      scenario.proveP5NameAvailable(create, { result: { items: [{ developerName: create.creates }] } })
    ).to.throw('not scenario-owned');

    let cleanupCalls = 0;
    const state = await scenario.runP5Scenario({
      prefix: 'lv_p5_ownership',
      statePath: resolve(directory, 'state.json'),
      steps: [list, create],
      authorizeCreate: (current, currentState) =>
        scenario.proveP5NameAvailable(current, currentState.results[list.id].evidence, () => new Date(0)),
      isCreateCollision: scenario.isP5CreateCollision,
      execute: async (current) => {
        if (current.id === list.id) return { result: { items: [] } };
        throw new Error('409 CONFLICT: resource already exists');
      },
      cleanup: async () => {
        cleanupCalls += 1;
        return { exitCode: 0, deletionConfirmed: true };
      },
    });

    expect(cleanupCalls).to.equal(0);
    expect(state.results[create.id].status).to.equal('failed');
    expect(state.cleanup).to.deep.include({
      step: create.id,
      status: 'not-owned',
      reason: `Create was rejected as a collision; the existing ${create.creates} resource was not deleted`,
    });
  });

  it('persists billable attempts before execution and records failed outcomes once', async () => {
    const scenario = (await loadP5())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-billing-ledger-'));
    const statePath = resolve(directory, 'state.json');
    const query = {
      ...scenario.buildP5Plan('lv_p5_billing').find(({ id }) => id === 'query-one-shot')!,
      blocker: undefined,
    };
    let observedAttempt = false;
    const execute = async (): Promise<unknown> => {
      const persisted = JSON.parse(await readFile(statePath, 'utf8')) as {
        billableAttempts: number;
        billableOutcomes: Array<{ status: string }>;
      };
      observedAttempt = persisted.billableAttempts === 1 && persisted.billableOutcomes[0]?.status === 'attempted';
      throw new Error('accepted request timed out before response');
    };
    const options = {
      prefix: 'lv_p5_billing',
      statePath,
      steps: [query],
      execute,
      cleanup: async (): Promise<{ exitCode: number; deletionConfirmed: boolean }> => ({
        exitCode: 0,
        deletionConfirmed: true,
      }),
    };

    const first = await scenario.runP5Scenario(options);
    expect(observedAttempt).to.equal(true);
    expect(first.billableCalls).to.equal(0);
    expect(first.billableAttempts).to.equal(1);
    expect(first.billableOutcomes[0]).to.deep.include({ step: query.id, status: 'failed' });
    const second = await scenario.runP5Scenario(options);
    expect(second.billableAttempts).to.equal(1);
  });

  it('runs --cleanup mode without forward steps or billable attempts', async () => {
    const scenario = (await loadP5())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-cleanup-only-'));
    const statePath = resolve(directory, 'state.json');
    const step: P5Step = {
      id: 'owned-create',
      dependsOn: [],
      command: 'data360 segment create',
      creates: 'lv_p5_owned_seg',
    };
    let executions = 0;
    const first = await scenario.runP5Scenario({
      prefix: 'lv_p5_cleanup_only',
      statePath,
      steps: [step],
      execute: async () => {
        executions += 1;
        return { payload: { result: { item: { developerName: step.creates } } } };
      },
      cleanup: async () => ({ exitCode: 1, deletionConfirmed: false }),
    });
    expect(first.cleanup[0].status).to.equal('failed');

    const cleaned = await scenario.runP5Scenario({
      prefix: 'lv_p5_cleanup_only',
      statePath,
      steps: [step],
      cleanupOnly: true,
      execute: async () => {
        executions += 1;
        return {};
      },
      cleanup: async () => ({ exitCode: 0, deletionConfirmed: true }),
    });
    expect(executions).to.equal(1);
    expect(cleaned.cleanup[0].status).to.equal('passed');
    expect(cleaned.cleanupStack[0]).not.to.have.property('reason');
    expect(cleaned.billableAttempts).to.equal(0);
  });

  it('registers cleanup before create, resumes passed work, and cleans in reverse order', async () => {
    const scenario = (await loadP5())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-'));
    const statePath = resolve(directory, 'state.json');
    const steps = scenario
      .buildP5Plan('lv_p5_cleanup')
      .filter(({ id }) => ['calculated-insight-create', 'segment-create', 'search-index-create'].includes(id))
      .map((step, index, selected) => ({
        ...step,
        blocker: undefined,
        dependsOn: index === 0 ? [] : [selected[index - 1].id],
      }));
    const events: string[] = [];
    const execute = async (step: P5Step): Promise<unknown> => {
      events.push(`run:${step.id}`);
      return { payload: { result: { item: { name: step.creates, id: `${step.creates}-id` } } } };
    };
    const cleanup = async (step: P5Step): Promise<{ exitCode: number; deletionConfirmed: boolean }> => {
      events.push(`cleanup:${step.id}`);
      return { exitCode: 0, deletionConfirmed: true };
    };
    const first = await scenario.runP5Scenario({
      prefix: 'lv_p5_cleanup',
      statePath,
      steps,
      execute,
      cleanup,
    });
    expect(first.cleanup.map(({ step }) => step)).to.deep.equal([
      'search-index-create',
      'segment-create',
      'calculated-insight-create',
    ]);
    await scenario.runP5Scenario({ prefix: 'lv_p5_cleanup', statePath, steps, execute, cleanup });
    expect(events.filter((event) => event.startsWith('run:'))).to.have.length(3);
  });

  it('does not retry terminal failed or blocked lifecycle steps from a persisted ledger', async () => {
    const scenario = (await loadP5())!;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p5-lifecycle-resume-'));
    const statePath = resolve(directory, 'state.json');
    const create: P5Step = {
      id: 'resource-create',
      dependsOn: [],
      command: 'data360 segment create',
      creates: 'lv_p5_resume_seg',
    };
    const get: P5Step = {
      id: 'resource-get',
      dependsOn: [create.id],
      command: 'data360 segment get',
      nameFrom: create.id,
    };
    const update: P5Step = {
      id: 'resource-update',
      dependsOn: [get.id],
      command: 'data360 segment update',
      nameFrom: create.id,
    };
    const executions: string[] = [];
    let failGet = true;
    const execute = async (current: P5Step): Promise<unknown> => {
      executions.push(current.id);
      if (current.id === get.id && failGet) throw new Error('not visible yet');
      return { payload: { result: { item: { apiName: create.creates } } } };
    };
    let cleanupSucceeds = false;
    const cleanup = async (): Promise<{ exitCode: number; deletionConfirmed: boolean }> => ({
      exitCode: cleanupSucceeds ? 0 : 1,
      deletionConfirmed: cleanupSucceeds,
    });

    const first = await scenario.runP5Scenario({
      prefix: 'lv_p5_lifecycle_resume',
      statePath,
      steps: [create, get, update],
      execute,
      cleanup,
    });
    expect(first.results[get.id].status).to.equal('failed');
    expect(first.results[update.id].status).to.equal('blocked');

    failGet = false;
    cleanupSucceeds = true;
    const resumed = await scenario.runP5Scenario({
      prefix: 'lv_p5_lifecycle_resume',
      statePath,
      steps: [create, get, update],
      execute,
      cleanup,
    });
    expect(executions).to.deep.equal([create.id, get.id]);
    expect(resumed.results[get.id].status).to.equal('failed');
    expect(resumed.results[update.id].status).to.equal('blocked');
    expect(resumed.cleanup[0].status).to.equal('passed');
  });

  it('verifies the exact planned name after delete and rejects resolver-mismatch false positives', async () => {
    const scenario = (await loadP5())!;
    const planned = scenario.buildP5Plan('lv_p5_cleanup_proof').find(({ id }) => id === 'segment-create')!;
    const current = {
      ...planned,
      ownershipProof: { status: 'absent', name: planned.creates },
    };
    const keys: string[] = [];
    const mismatch = await scenario.verifyP5Cleanup({
      current,
      remove: async (key) => {
        keys.push(`delete:${key}`);
        throw new Error('No resource matches an unrelated response ID');
      },
      read: async (key) => {
        keys.push(`get:${key}`);
        return { developerName: key, status: 'ACTIVE' };
      },
      isAbsent: (payload) => JSON.stringify(payload).includes('NOT_FOUND'),
    });

    expect(keys).to.deep.equal([`delete:${current.creates}`, `get:${current.creates}`]);
    expect(mismatch.deletionConfirmed).to.equal(false);
    expect(mismatch.reason).to.include('did not return a verified not-found response');

    const absent = await scenario.verifyP5Cleanup({
      current,
      remove: async () => {
        throw new Error('NOT_FOUND');
      },
      read: async () => ({
        code: 'D360_NOT_FOUND',
        data: { httpStatus: 404, apiCode: 'ITEM_NOT_FOUND' },
      }),
      isAbsent: scenario.isP5RemoteAbsent,
    });
    expect(absent).to.deep.equal({ exitCode: 0, deletionConfirmed: true });

    const searchIndex = scenario.buildP5Plan('lv_p5_cleanup_absent').find(({ id }) => id === 'search-index-create')!;
    let removed = false;
    const absentAfterFailedCreate = await scenario.verifyP5Cleanup({
      current: {
        ...searchIndex,
        ownershipProof: { status: 'absent', name: searchIndex.creates },
      },
      remove: async () => {
        removed = true;
      },
      read: async () => ({ code: 'D360_NOT_FOUND', data: { httpStatus: 404, apiCode: 'ITEM_NOT_FOUND' } }),
      isAbsent: scenario.isP5RemoteAbsent,
    });
    expect(absentAfterFailedCreate).to.deep.equal({ exitCode: 0, deletionConfirmed: true });
    expect(removed).to.equal(false);
  });
});
