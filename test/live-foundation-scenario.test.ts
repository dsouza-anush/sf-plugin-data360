import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';
import { ConnectionClient } from '../src/connection/client.js';
import type { SsotClient } from '../src/client/ssotClient.js';
import { DmoClient } from '../src/dmo/client.js';
import { paginate } from '../src/client/pagination.js';
import { collect } from './helpers/async.js';

type Step = {
  id: string;
  dependsOn: string[];
  creates?: string;
  billable?: boolean;
  records?: unknown[];
};

type Foundation = {
  argsForFoundationStep: (
    step: Step & { command: string; definition?: string },
    files: Record<string, string>,
    dynamic?: Record<string, unknown>
  ) => string[];
  buildFoundationPlan: (
    prefix: string,
    existingNames?: Set<string>,
    external?: {
      source: string;
      object: string;
      streamId: string;
      dloName: string;
      cleanupExternal: boolean;
    }
  ) => Step[];
  cleanupResourceKey: (step: Step, evidence?: unknown) => string | undefined;
  externalFoundationInputs: (environment: NodeJS.ProcessEnv) =>
    | {
        source: string;
        object: string;
        streamId: string;
        dloName: string;
        cleanupExternal: boolean;
      }
    | undefined;
  parseFoundationOptions: (environment: NodeJS.ProcessEnv) => { mutations: true; billable: true };
  orgForFoundationStep: (
    step: Step & { requiresFallbackOrg?: boolean },
    primaryOrg: string,
    fallback?: string
  ) => string;
  runFoundationScenario: (options: {
    prefix: string;
    statePath: string;
    steps: Step[];
    execute: (step: Step) => Promise<unknown>;
    cleanup: (step: Step) => Promise<{ exitCode: number; deletionConfirmed: boolean; reason?: string }>;
  }) => Promise<{ results: Record<string, { status: string }>; cleanup: Array<{ step: string; status: string }> }>;
  writeFoundationDefinitions: (directory: string, prefix: string) => Promise<Record<string, string>>;
};

const root = resolve(import.meta.dirname, '..');
const loadFoundation = async (): Promise<Foundation> =>
  import(pathToFileURL(resolve(root, 'scripts', 'live-scenarios', 'foundation.mjs')).href) as Promise<Foundation>;

describe('disposable P3/P4 foundation scenario', () => {
  it('builds a dependency DAG with unique API-safe names and at most three records', async () => {
    const { buildFoundationPlan } = await loadFoundation();
    const prefix = 'lv_20260711_a1b2c3';
    const plan = buildFoundationPlan(prefix, new Set(['existing_connection', 'Default']));
    const indexes = new Map(plan.map((step, index) => [step.id, index]));

    expect(plan.length).to.be.greaterThan(10);
    for (const step of plan) {
      for (const dependency of step.dependsOn) {
        expect(indexes.get(dependency), `${step.id} dependency ${dependency}`).to.be.lessThan(indexes.get(step.id)!);
      }
      if (step.creates) {
        expect(step.creates).to.match(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`, 'u'));
        expect(['existing_connection', 'Default']).to.not.include(step.creates);
      }
      expect(step.records ?? []).to.have.lengthOf.at.most(3);
    }
    expect(new Set(plan.map(({ creates }) => creates).filter(Boolean)).size).to.equal(
      plan.filter(({ creates }) => creates).length
    );
  });

  it('requires explicit mutation and billing gates', async () => {
    const { externalFoundationInputs, parseFoundationOptions } = await loadFoundation();

    expect(() => parseFoundationOptions({})).to.throw('D360_LIVE_MUTATIONS=1');
    expect(() => parseFoundationOptions({ D360_LIVE_MUTATIONS: '1' })).to.throw('D360_LIVE_BILLABLE=1');
    expect(parseFoundationOptions({ D360_LIVE_MUTATIONS: '1', D360_LIVE_BILLABLE: '1' })).to.deep.equal({
      mutations: true,
      billable: true,
    });
    expect(() => externalFoundationInputs({ D360_INGEST_SOURCE: 'partial' })).to.throw(
      'D360_INGEST_SOURCE, D360_INGEST_OBJECT, D360_STREAM_ID, and D360_DLO_NAME'
    );
    expect(
      externalFoundationInputs({
        D360_INGEST_SOURCE: 'source',
        D360_INGEST_OBJECT: 'object',
        D360_STREAM_ID: 'stream',
        D360_DLO_NAME: 'object__dll',
        D360_INGEST_SAMPLE: 'valid.json',
        D360_INGEST_INVALID_SAMPLE: 'invalid.json',
        D360_INGEST_CSV: 'records.csv',
        D360_INGEST_VERIFY_SQL: 'SELECT 1',
      })
    ).to.deep.equal({
      source: 'source',
      object: 'object',
      streamId: 'stream',
      dloName: 'object__dll',
      cleanupExternal: false,
      sample: 'valid.json',
      invalidSample: 'invalid.json',
      csv: 'records.csv',
      verifySql: 'SELECT 1',
    });
    expect(() =>
      externalFoundationInputs({
        D360_INGEST_SOURCE: 'source',
        D360_INGEST_OBJECT: 'object',
        D360_STREAM_ID: 'stream',
        D360_DLO_NAME: 'object__dll',
      })
    ).to.throw('retained object schemas are environment-specific');
  });

  it('uses externally provisioned ingestion resources without creating connection schema or stream resources', async () => {
    const { argsForFoundationStep, buildFoundationPlan, runFoundationScenario, writeFoundationDefinitions } =
      await loadFoundation();
    const external = {
      source: 'Fixture_Ingest_Source',
      object: 'fixture_event',
      streamId: '1ds000000000000AAA',
      dloName: 'Fixture_Ingest_Source__dll',
      cleanupExternal: false,
      sample: 'valid.json',
      invalidSample: 'invalid.json',
      csv: 'records.csv',
      verifySql: 'SELECT "Id__c" FROM "Fixture_Ingest_Source__dll" LIMIT 3',
    };
    const plan = buildFoundationPlan('lv_external', new Set(), external);
    const ids = plan.map(({ id }) => id);
    expect(ids).not.to.include.members(['connection-create', 'connection-schema-setup', 'stream-create']);
    expect(ids).to.include.members([
      'ingest-validate',
      'ingest-stream',
      'ingest-bulk',
      'ingest-report',
      'ingest-resume',
      'ingest-cancel-job',
      'ingest-cancel',
      'query-visible-records',
    ]);
    expect(ids).not.to.include('ingest-cancel-wait');
    expect(plan.find(({ id }) => id === 'ingest-resume')).to.include({ timeoutMs: 11 * 60_000 });
    expect(plan.find(({ id }) => id === 'ingest-cancel-job')).to.deep.include({
      command: 'data360 api request',
      rawPath: '/api/v1/ingest/jobs',
      rawDirect: true,
      cleanupRawFamily: '/api/v1/ingest/jobs',
      cleanupDirect: true,
    });

    const directory = await mkdtemp(resolve(tmpdir(), 'd360-foundation-external-'));
    const files = await writeFoundationDefinitions(directory, 'lv_external');
    const validate = plan.find(({ id }) => id === 'ingest-validate') as Step & {
      command: string;
      definition?: string;
    };
    expect(argsForFoundationStep(validate, files)).to.include.members([
      '--source-name',
      external.source,
      '--object-name',
      external.object,
    ]);
    expect(plan.find(({ id }) => id === 'query-visible-records')).to.include({
      query: external.verifySql,
    });

    const state = await runFoundationScenario({
      prefix: 'lv_external',
      statePath: resolve(directory, 'state.json'),
      steps: plan.filter(({ id }) => ['external-stream', 'ingest-validate', 'ingest-stream'].includes(id)),
      execute: async () => ({ ok: true }),
      cleanup: async () => ({ exitCode: 0, deletionConfirmed: true }),
    });
    expect(state.cleanup).to.deep.equal([]);
  });

  it('registers external stream cleanup only when explicitly enabled', async () => {
    const { buildFoundationPlan } = await loadFoundation();
    const base = {
      source: 'external-source',
      object: 'external-object',
      streamId: 'external-stream-id',
      dloName: 'external__dll',
    };
    const retained = buildFoundationPlan('lv_retained', new Set(), { ...base, cleanupExternal: false });
    expect(retained.some(({ id, creates }) => id === 'external-stream' && creates)).to.equal(false);
    const disposable = buildFoundationPlan('lv_disposable', new Set(), { ...base, cleanupExternal: true });
    expect(disposable.find(({ id }) => id === 'external-stream')).to.deep.include({
      creates: base.streamId,
      cleanup: ['data360', 'data-stream', 'delete', '--name', base.streamId, '--delete-dlo', '--no-prompt'],
    });
  });

  it('includes API-only IngestApi connections when connector discovery omits the type', async () => {
    const queried: string[] = [];
    const client = new ConnectionClient({
      request: async ({ endpoint, query }: { endpoint: string; query?: Record<string, unknown> }) => {
        if (endpoint === '/connectors') return { connectors: [{ name: 'Web' }] };
        const connectorType = String(query?.connectorType);
        queried.push(connectorType);
        return {
          connections:
            connectorType === 'IngestApi'
              ? [{ id: 'ingest-id', name: 'generated_ingest_name', connectorType: 'IngestApi' }]
              : [],
        };
      },
    } as unknown as SsotClient);

    expect(await client.list()).to.deep.equal([
      { id: 'ingest-id', name: 'generated_ingest_name', connectorType: 'IngestApi' },
    ]);
    expect(queried).to.include('IngestApi');
  });

  it('resolves DMO relationships from the live plural list envelope', async () => {
    const requests: string[] = [];
    const client = new DmoClient({
      request: async ({ endpoint }: { endpoint: string }) => {
        requests.push(endpoint);
        if (endpoint === '/data-model-objects') {
          return { dataModelObjects: [{ id: 'dmo-id', name: 'Disposable__dlm', label: 'Disposable' }] };
        }
        return { name: 'DisposableRelationship' };
      },
    } as unknown as SsotClient);

    expect(await client.createRelationship('Disposable', { name: 'DisposableRelationship' })).to.deep.equal({
      name: 'DisposableRelationship',
    });
    expect(requests).to.deep.equal(['/data-model-objects', '/data-model-objects/Disposable__dlm/relationships']);

    requests.length = 0;
    await client.createRelationship('Disposable__dlm', { name: 'DisposableRelationship' });
    expect(requests).to.deep.equal(['/data-model-objects/Disposable__dlm/relationships']);
  });

  it('terminates offset pagination when the server repeats a page', async () => {
    let calls = 0;
    const iterator = paginate(
      async () => {
        calls += 1;
        return { data: [{ id: 'same-id' }], totalSize: 10_000 };
      },
      { pageSize: 1 }
    );

    let message = '';
    try {
      await collect(iterator);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).to.include('repeated page');
    expect(calls).to.equal(2);
  });

  it('writes the IngestApi schema, stream, and mapping create contract', async () => {
    const { argsForFoundationStep, buildFoundationPlan, writeFoundationDefinitions } = await loadFoundation();
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-foundation-definitions-'));
    const files = await writeFoundationDefinitions(directory, 'lv_contract');
    const connection = JSON.parse(await readFile(files.connection, 'utf8')) as { connectorType: string };
    const schema = JSON.parse(await readFile(files.schema, 'utf8')) as {
      schemas: Array<{ schemaType: string }>;
    };
    const stream = JSON.parse(await readFile(files.stream, 'utf8')) as {
      datastreamType: string;
      connectorInfo: Record<string, unknown>;
    };
    const mapping = JSON.parse(await readFile(files.mapping, 'utf8')) as Record<string, unknown>;
    const relationship = JSON.parse(await readFile(files.relationship, 'utf8')) as Record<string, unknown>;

    expect(connection.connectorType).to.equal('IngestApi');
    expect(schema.schemas[0].schemaType).to.equal('IngestApi');
    expect(stream.datastreamType).to.equal('INGESTAPI');
    expect(stream.connectorInfo).to.deep.equal({
      connectorType: 'IngestApi',
      connectorDetails: { name: 'lv_contract_connection' },
    });
    const describeStep = buildFoundationPlan('lv_contract').find(({ id }) => id === 'connection-describe-created')!;
    const streamStep = buildFoundationPlan('lv_contract').find(({ id }) => id === 'stream-create')!;
    expect(describeStep).to.include({ timeoutMs: 10 * 60_000 });
    expect(streamStep.dependsOn).to.deep.equal(['connection-describe-created']);
    expect(mapping).to.have.keys(['sourceEntityDeveloperName', 'targetEntityDeveloperName', 'fieldMapping']);
    expect(mapping).not.to.have.property('developerName');
    expect(relationship).to.have.keys(['relationships']);
    expect((relationship.relationships as Array<Record<string, unknown>>)[0]).not.to.have.property('name');
    const schemaStep = buildFoundationPlan('lv_contract').find(({ id }) => id === 'connection-schema-setup')!;
    expect(
      argsForFoundationStep(schemaStep as Step & { command: string; definition?: string }, files, {
        resourceIds: { 'connection-create': 'connection-id' },
      })
    ).to.include.members(['--header', 'Content-Type: application/json']);
  });

  it('uses recorded cleanup keys and a per-step fallback org', async () => {
    const { buildFoundationPlan, cleanupResourceKey, orgForFoundationStep } = await loadFoundation();
    const plan = buildFoundationPlan('lv_cleanup');
    const connection = plan.find(({ id }) => id === 'connection-create')!;
    const open = plan.find(({ id }) => id === 'open-url-only')! as Step & { requiresFallbackOrg?: boolean };

    expect(
      cleanupResourceKey(connection, {
        payload: { result: { item: { id: 'recorded-id', name: 'generated-canonical-name' } } },
      })
    ).to.equal('recorded-id');
    expect(cleanupResourceKey(connection)).to.equal(undefined);
    expect(cleanupResourceKey({ id: 'shared-read', dependsOn: [] })).to.equal(undefined);
    expect(() => orgForFoundationStep(open, 'fixture-primary')).to.throw('D360_LIVE_FALLBACK_ORG');
    expect(orgForFoundationStep(open, 'fixture-primary', 'fixture-core')).to.equal('fixture-core');
  });

  it('retains cleanup when create evidence is lost instead of guessing a planned name', async () => {
    const { cleanupResourceKey, runFoundationScenario } = await loadFoundation();
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-foundation-lost-create-evidence-'));
    const statePath = resolve(directory, 'state.json');
    const plannedName = 'lv_lost_response_connection';
    const steps: Step[] = [{ id: 'connection-create', dependsOn: [], creates: plannedName }];
    const cleanupKeys: Array<string | undefined> = [];

    const state = await runFoundationScenario({
      prefix: 'lv_lost_response',
      statePath,
      steps,
      execute: async () => {
        throw new Error('connection closed after the server accepted the create');
      },
      cleanup: async (current) => {
        const key = cleanupResourceKey(current);
        cleanupKeys.push(key);
        return {
          exitCode: key ? 0 : 1,
          deletionConfirmed: Boolean(key),
          reason: key ? undefined : 'No authoritative create key was recorded',
        };
      },
    });

    expect(state.results['connection-create'].status).to.equal('failed');
    expect(cleanupKeys).to.deep.equal([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(state.cleanup).to.deep.include({
      step: 'connection-create',
      status: 'failed',
      attempts: 3,
      reason: 'No authoritative create key was recorded',
    });
  });

  it('retains cleanup failures unless exit and absence verification both succeed', async () => {
    const { runFoundationScenario } = await loadFoundation();
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-foundation-cleanup-'));
    const statePath = resolve(directory, 'state.json');
    const steps: Step[] = [{ id: 'connection-create', dependsOn: [], creates: 'lv_test_connection' }];

    const state = await runFoundationScenario({
      prefix: 'lv_test',
      statePath,
      steps,
      execute: async () => ({ payload: { result: { item: { id: 'created-id' } } } }),
      cleanup: async () => ({ exitCode: 1, deletionConfirmed: false, reason: 'API error on stderr' }),
    });

    expect(state.cleanup).to.deep.include({
      step: 'connection-create',
      status: 'failed',
      attempts: 3,
      reason: 'API error on stderr',
    });
  });

  it('persists cleanup before create, resumes completed steps, and cleans up in reverse after failure', async () => {
    const { runFoundationScenario } = await loadFoundation();
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-foundation-'));
    const statePath = resolve(directory, 'state.json');
    const steps: Step[] = [
      { id: 'connection-create', dependsOn: [], creates: 'lv_test_connection' },
      { id: 'schema-update', dependsOn: ['connection-create'] },
      { id: 'stream-create', dependsOn: ['schema-update'], creates: 'lv_test_stream' },
    ];
    const events: string[] = [];
    let createStateHadCleanup = false;

    const first = await runFoundationScenario({
      prefix: 'lv_test',
      statePath,
      steps,
      execute: async (step) => {
        events.push(`run:${step.id}`);
        if (step.id === 'connection-create') {
          const persisted = JSON.parse(await readFile(statePath, 'utf8')) as { cleanupStack: Array<{ step: string }> };
          createStateHadCleanup = persisted.cleanupStack.some(({ step: id }) => id === step.id);
        }
        if (step.id === 'stream-create') throw new Error('expected test failure');
        return { ok: true };
      },
      cleanup: async (step) => {
        events.push(`cleanup:${step.id}`);
        return { exitCode: 0, deletionConfirmed: true };
      },
    });

    expect(createStateHadCleanup).to.equal(true);
    expect(first.results['stream-create'].status).to.equal('failed');
    expect(events.slice(-2)).to.deep.equal(['cleanup:stream-create', 'cleanup:connection-create']);

    events.length = 0;
    await runFoundationScenario({
      prefix: 'lv_test',
      statePath,
      steps,
      execute: async (step) => {
        events.push(`run:${step.id}`);
        return { ok: true };
      },
      cleanup: async (step) => {
        events.push(`cleanup:${step.id}`);
        return { exitCode: 0, deletionConfirmed: true };
      },
    });
    expect(events).to.deep.equal([]);
  });
});
