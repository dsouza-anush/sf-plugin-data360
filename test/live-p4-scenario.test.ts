import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';

type P4Step = {
  id: string;
  dependsOn: string[];
  command: string;
  creates?: string;
  cleanup?: string[];
  cleanupParentName?: string;
  external?: boolean;
  expectedFailure?: boolean;
  blocker?: string;
};

type P4Scenario = {
  buildP4MatchedDmoDefinition: (
    payload: unknown,
    prefix: string
  ) => { name: string; fields: Array<{ name: string; isPrimaryKey: boolean }> };
  buildP4Plan: (prefix: string, external: typeof testExternal) => P4Step[];
  createdP4ResourceKey: (step: { cleanupKeyFields?: string[] }, evidence: unknown) => string | undefined;
  parseP4Options: (environment: NodeJS.ProcessEnv) => { mutations: true; billable: false };
  isVerifiedAbsent: (payload: unknown) => boolean;
  isP4CleanupVerifiable: (step: { cleanupRawFamily?: string }) => boolean;
  matchesP4ExpectedError: (payload: unknown, expected: { code: string; action: string; apiCode?: string }) => boolean;
  shouldRecordP4Fixture: (step: { id: string }) => boolean;
  selectP4ResourceKey: (
    items: Array<Record<string, unknown>>,
    selector: { label?: string; connectorType?: string }
  ) => string | undefined;
  runP4Scenario: (options: {
    prefix: string;
    statePath: string;
    steps: P4Step[];
    execute: (step: P4Step) => Promise<unknown>;
    cleanup: (step: P4Step) => Promise<{ exitCode: number; deletionConfirmed: boolean }>;
  }) => Promise<{ cleanup: Array<{ step: string; status: string }> }>;
  selectP4MappingField: (
    payload: unknown
  ) => { name: string; sourceFieldDeveloperName: string; targetFieldDeveloperName: string } | undefined;
};

const root = resolve(import.meta.dirname, '..');
const testExternal = {
  source: 'Fixture_Ingest_Source',
  object: 'fixture_event',
  streamId: '1ds000000000000AAA',
  streamApiName: 'Fixture_Ingest_Source_fixture_event_00000000',
  dloName: 'Fixture_Ingest_Source_fixture_event__dll',
};
const loadP4 = async (): Promise<P4Scenario | null> => {
  const modulePath = resolve(root, 'scripts', 'live-scenarios', 'p4.mjs');
  try {
    await access(modulePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return (await import(pathToFileURL(modulePath).href)) as P4Scenario;
};

describe('disposable P4 live scenario', () => {
  it('defines the dependency DAG, outcomes, ownership, cleanup, and mutation gate', async () => {
    const scenario = await loadP4();
    expect(scenario, 'P4 scenario module must exist').not.to.equal(null);
    const { buildP4Plan, parseP4Options } = scenario!;

    expect(() => parseP4Options({})).to.throw('D360_LIVE_MUTATIONS=1');
    expect(parseP4Options({ D360_LIVE_MUTATIONS: '1' })).to.deep.equal({ mutations: true, billable: false });

    const plan = buildP4Plan('lv_p4_contract', testExternal);
    const indexes = new Map(plan.map(({ id }, index) => [id, index]));
    for (const step of plan) {
      for (const dependency of step.dependsOn) {
        expect(indexes.get(dependency), `${step.id} dependency ${dependency}`).to.be.lessThan(indexes.get(step.id)!);
      }
    }

    const external = plan.filter(({ external }) => external);
    expect(external.map(({ id }) => id)).to.include.members(['external-stream', 'external-dlo']);
    expect(external.every(({ creates, cleanup }) => !creates && !cleanup)).to.equal(true);

    for (const id of ['registry-dlo-create', 'dmo-create', 'mapping-create', 'relationship-create']) {
      const step = plan.find((entry) => entry.id === id)!;
      expect(step.creates, id).to.be.a('string').and.not.equal('');
      expect(step.cleanup, id).to.be.an('array').and.include('--no-prompt');
    }
    expect(plan.find(({ id }) => id === 'relationship-create')?.cleanupParentName).to.equal(
      'lv_p4_contract_event__dlm'
    );
    expect(plan.find(({ id }) => id === 'mapping-create')).to.deep.include({
      args: ['--auto', '--dlo', testExternal.dloName],
      dmoFrom: 'dmo-create',
    });
    expect(plan.find(({ id }) => id === 'mapping-create')).not.to.have.property('definition');
    expect(plan.find(({ id }) => id === 'connection-describe')).to.include({ timeoutMs: 30_000 });
    expect(plan.find(({ id }) => id === 'connection-validate')).to.include({ timeoutMs: 30_000 });
    expect(plan.find(({ id }) => id === 'mapping-delete-fields')?.dependsOn).to.deep.equal(['mapping-get']);
    expect(plan.find(({ id }) => id === 'mapping-delete-fields')).to.deep.include({
      fieldFrom: 'mapping-get',
      args: ['--no-prompt'],
    });

    expect(plan.filter(({ expectedFailure }) => expectedFailure).map(({ id }) => id)).to.deep.equal([
      'connection-describe',
      'connection-validate',
      'connection-update-unsupported',
      'registry-dlo-update',
      'mapping-delete-prompt',
    ]);
    expect(plan.filter(({ blocker }) => blocker).map(({ id }) => id)).to.deep.equal([
      'external-stream-update-safety',
      'external-dlo-update-safety',
      'data-space-mutations',
      'transform-mutations',
    ]);
  });

  it('builds a disposable DMO from an approved source DLO and selects an exact mutable mapping field', async () => {
    const scenario = await loadP4();
    expect(scenario, 'P4 scenario module must exist').not.to.equal(null);
    const definition = scenario!.buildP4MatchedDmoDefinition(
      {
        result: {
          item: {
            dataLakeObjects: [
              {
                fields: [
                  { name: 'Id__c', label: 'Id', dataType: 'Text', isPrimaryKey: true },
                  { name: 'CreatedDate__c', label: 'Created Date', dataType: 'DateTime', isPrimaryKey: false },
                  { name: 'KQ_Id__c', dataType: 'Text', isPrimaryKey: false },
                  { name: 'cdp_sys_SourceVersion__c', dataType: 'Text', isPrimaryKey: false },
                  { name: 'DataSource__c', dataType: 'Text', isPrimaryKey: false },
                ],
              },
            ],
          },
        },
      },
      'lv_p4_matched'
    );
    expect(definition.name).to.equal('lv_p4_matched_event');
    expect(definition.fields).to.deep.equal([
      { name: 'Id__c', label: 'Id', dataType: 'Text', isPrimaryKey: true, isDynamicLookup: false },
      {
        name: 'CreatedDate__c',
        label: 'Created Date',
        dataType: 'DateTime',
        isPrimaryKey: false,
        isDynamicLookup: false,
      },
    ]);
    expect(
      scenario!.selectP4MappingField({
        result: {
          item: {
            fieldMappings: [
              {
                developerName: 'KQ_Id__c_fieldmap_KQ_Id__c',
                sourceFieldDeveloperName: 'KQ_Id__c',
                targetFieldDeveloperName: 'KQ_Id__c',
              },
              {
                developerName: 'Id__c_fieldmap_Id__c',
                sourceFieldDeveloperName: 'Id__c',
                targetFieldDeveloperName: 'Id__c',
              },
            ],
          },
        },
      })
    ).to.deep.equal({
      name: 'Id__c_fieldmap_Id__c',
      sourceFieldDeveloperName: 'Id__c',
      targetFieldDeveloperName: 'Id__c',
    });
  });

  it('registers every create before execution and cleans only created resources in reverse order', async () => {
    const scenario = await loadP4();
    expect(scenario, 'P4 scenario module must exist').not.to.equal(null);
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p4-'));
    const statePath = resolve(directory, 'state.json');
    const steps = scenario!
      .buildP4Plan('lv_p4_cleanup', testExternal)
      .filter(({ id }) =>
        ['external-stream', 'external-dlo', 'registry-dlo-create', 'dmo-create', 'mapping-create'].includes(id)
      )
      .map((step) => ({ ...step, dependsOn: step.dependsOn.filter((id) => stepsIds.has(id)) }));
    const events: string[] = [];

    await scenario!.runP4Scenario({
      prefix: 'lv_p4_cleanup',
      statePath,
      steps,
      execute: async (step) => {
        events.push(`run:${step.id}`);
        if (step.creates) {
          const state = JSON.parse(await readFile(statePath, 'utf8')) as { cleanupStack: Array<{ step: string }> };
          expect(
            state.cleanupStack.map(({ step: id }) => id),
            step.id
          ).to.include(step.id);
        }
        return { ok: true };
      },
      cleanup: async (step) => {
        events.push(`cleanup:${step.id}`);
        return { exitCode: 0, deletionConfirmed: true };
      },
    });

    expect(events.filter((event) => event.startsWith('cleanup:'))).to.deep.equal([
      'cleanup:mapping-create',
      'cleanup:dmo-create',
      'cleanup:registry-dlo-create',
    ]);
    expect(events).not.to.include.members(['cleanup:external-stream', 'cleanup:external-dlo']);
  });

  it('recognizes live connection identities, mapping create envelopes, and raw not-found cleanup responses', async () => {
    const scenario = await loadP4();
    expect(scenario, 'P4 scenario module must exist').not.to.equal(null);
    expect(scenario!.shouldRecordP4Fixture({ id: 'mapping-create' })).to.equal(true);
    expect(scenario!.shouldRecordP4Fixture({ id: 'cleanup-mapping-create' })).to.equal(false);
    expect(scenario!.shouldRecordP4Fixture({ id: 'cleanup-mapping-create-verify' })).to.equal(false);
    expect(scenario!.isP4CleanupVerifiable({})).to.equal(true);
    expect(scenario!.isP4CleanupVerifiable({ cleanupRawFamily: 'data-lake-objects' })).to.equal(false);
    const expected = { code: 'D360_CONFIRMATION_REQUIRED', action: 'Re-run with --no-prompt.' };
    expect(
      scenario!.matchesP4ExpectedError(
        {
          code: expected.code,
          message: 'Confirmation is required for this operation.',
          actions: [expected.action],
        },
        expected
      )
    ).to.equal(true);
    expect(
      scenario!.matchesP4ExpectedError(
        {
          code: 'D360_API_ERROR',
          message: `wrapped ${expected.code}`,
          actions: [expected.action],
        },
        expected
      )
    ).to.equal(false);
    expect(
      scenario!.selectP4ResourceKey(
        [
          {
            connectorType: 'IngestApi',
            id: '1WMWt0000008N97OAE',
            label: 'Fixture Ingest Source',
            name: 'Fixture_Ingest_Source_generated',
          },
        ],
        { label: 'Fixture_Ingest_Source', connectorType: 'IngestApi' }
      )
    ).to.equal('1WMWt0000008N97OAE');
    expect(
      scenario!.isVerifiedAbsent([
        { errorCode: 'INVALID_INPUT', message: 'A data lake object instance with Id: x does not exists.' },
      ])
    ).to.equal(true);
    expect(
      scenario!.createdP4ResourceKey(
        { cleanupKeyFields: ['name', 'id'] },
        { payload: { result: { item: { relationships: [{ id: 'relationship-id', name: 'relationship-name' }] } } } }
      )
    ).to.equal('relationship-name');

    const schema = JSON.parse(await readFile(resolve(root, 'schemas', 'data360.mapping.create.json'), 'utf8')) as {
      properties: { result: { oneOf: Array<{ properties?: { item?: { required?: string[] } } }> } };
    };
    expect(schema.properties.result.oneOf[0].properties?.item?.required).to.include('developerName');
    const relationshipSchema = JSON.parse(
      await readFile(resolve(root, 'schemas', 'data360.dmo.relationship.create.json'), 'utf8')
    ) as {
      properties: {
        result: { properties: { item: { required?: string[]; properties?: Record<string, unknown> } } };
      };
    };
    expect(relationshipSchema.properties.result.properties.item.required).to.include('relationships');
    expect(relationshipSchema.properties.result.properties.item.properties).to.have.property('relationships');
  });

  it('retries failed child cleanup after deleting its parent', async () => {
    const scenario = await loadP4();
    expect(scenario, 'P4 scenario module must exist').not.to.equal(null);
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-p4-cascade-'));
    const events: string[] = [];
    let parentDeleted = false;
    const state = await scenario!.runP4Scenario({
      prefix: 'lv_p4_cascade',
      statePath: resolve(directory, 'state.json'),
      steps: [
        { id: 'dmo-create', dependsOn: [], command: 'data360 dmo create', creates: 'dmo' },
        {
          id: 'mapping-create',
          dependsOn: ['dmo-create'],
          command: 'data360 mapping create',
          creates: 'mapping',
        },
      ],
      execute: async () => ({ ok: true }),
      cleanup: async (step) => {
        events.push(`cleanup:${step.id}`);
        if (step.id === 'mapping-create' && !parentDeleted) {
          return { exitCode: 1, deletionConfirmed: false };
        }
        if (step.id === 'dmo-create') parentDeleted = true;
        return { exitCode: 0, deletionConfirmed: true };
      },
    });
    expect(events).to.deep.equal([
      'cleanup:mapping-create',
      'cleanup:mapping-create',
      'cleanup:mapping-create',
      'cleanup:dmo-create',
      'cleanup:mapping-create',
    ]);
    expect(state.cleanup).to.deep.include({ step: 'mapping-create', status: 'passed', attempts: 1 });
    const mappingCleanup = (
      state as unknown as {
        cleanupStack: Array<{ step: string; status: string; reason?: string }>;
      }
    ).cleanupStack.find(({ step }) => step === 'mapping-create');
    expect(mappingCleanup).to.deep.include({ step: 'mapping-create', status: 'passed', attempts: 1 });
    expect(mappingCleanup).not.to.have.property('reason');
  });
});

const stepsIds = new Set(['external-stream', 'external-dlo', 'registry-dlo-create', 'dmo-create', 'mapping-create']);
