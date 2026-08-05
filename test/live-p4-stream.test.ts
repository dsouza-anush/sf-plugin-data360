import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';

type StreamScenario = {
  buildDisposableStreamDefinition?: (existing: Record<string, unknown>, prefix: string) => Record<string, unknown>;
  buildP4StreamPlan?: (
    prefix: string,
    external: typeof testExternal
  ) => Array<{
    id: string;
    command: string;
    dependsOn: string[];
    creates?: string;
    cleanup?: string[];
    external?: boolean;
    expectedFailure?: boolean;
    expectedError?: { code: string; action: string };
    expectedTimeout?: boolean;
    timeoutMs?: number;
    exactAbsentName?: string;
  }>;
  matchesExpectedUnsupportedRun?: (payload: unknown) => boolean;
  hasExactResourceName?: (items: Array<Record<string, unknown>>, name: string) => boolean;
  selectExactConnectionKey?: (items: Array<Record<string, unknown>>, label: string, connectorType: string) => string;
  selectExactStreamKey?: (items: Array<Record<string, unknown>>, name: string) => string;
};

const root = resolve(import.meta.dirname, '..');
const testExternal = {
  source: 'Fixture_Ingest_Source',
  object: 'fixture_event',
  streamId: '1ds000000000000AAA',
  streamApiName: 'Fixture_Ingest_Source_fixture_event_00000000',
  dloName: 'Fixture_Ingest_Source_fixture_event__dll',
};

describe('disposable P4 data-stream lifecycle', () => {
  it('clones only mutable create fields with unique stream and DLO identities', async () => {
    const scenario = (await import(
      pathToFileURL(resolve(root, 'scripts/live-scenarios/p4-stream.mjs')).href
    )) as StreamScenario;
    const template = {
      dataSource: 'Fixture_Ingest_Source',
      sourceFields: [
        { name: 'event_id', dataType: 'Text' },
        { name: 'event_time', dataType: 'DateTime' },
        { name: 'name', dataType: 'Text' },
        { name: 'value', dataType: 'Number' },
      ],
      dataLakeObjectInfo: { category: 'Engagement', dataSpaceInfo: [{ name: 'default' }] },
      refreshConfig: { refreshMode: 'UPSERT' },
    };

    expect(scenario.buildDisposableStreamDefinition).to.be.a('function');
    const definition = scenario.buildDisposableStreamDefinition!(template, 'lv_stream_contract');

    expect(definition).to.deep.include({
      name: 'lv_stream_contract_stream',
      label: 'lv_stream_contract stream',
      datasource: template.dataSource,
      datastreamType: 'INGESTAPI',
    });
    expect(definition).not.to.have.any.keys(
      'recordId',
      'status',
      'isEnabled',
      'lastRunStatus',
      'lastRefreshDate',
      'lastAddedRecords',
      'lastProcessedRecords',
      'totalRecords',
      'problemRecordDataLakeObjectName'
    );
    expect(definition.connectorInfo).to.deep.equal({
      connectorType: 'IngestApi',
      connectorDetails: { name: 'Fixture_Ingest_Source' },
    });
    expect(definition.dataLakeObjectInfo).to.deep.equal({
      name: 'lv_stream_contract_event__dll',
      label: 'lv_stream_contract event',
      category: 'Engagement',
      dataspaceInfo: [{ name: 'default' }],
      eventDateTimeFieldName: 'event_time',
      dataLakeFieldInputRepresentations: [
        { name: 'event_id', label: 'event_id', dataType: 'Text', isPrimaryKey: true },
        { name: 'event_time', label: 'event_time', dataType: 'DateTime', isPrimaryKey: false },
        { name: 'name', label: 'name', dataType: 'Text', isPrimaryKey: false },
        { name: 'value', label: 'value', dataType: 'Number', isPrimaryKey: false },
      ],
    });
  });

  it('preserves declared key and event-time fields from the live detail response shape', async () => {
    const scenario = (await import(
      pathToFileURL(resolve(root, 'scripts/live-scenarios/p4-stream.mjs')).href
    )) as StreamScenario;
    const definition = scenario.buildDisposableStreamDefinition!(
      {
        dataSource: 'Fixture_Ingest_Source',
        sourceFields: [
          { name: 'record_key', datatype: 'Text' },
          { name: 'captured_at', datatype: 'DateTime' },
          { name: 'value', datatype: 'Number' },
        ],
        dataLakeObjectInfo: {
          category: 'Engagement',
          dataSpaceInfo: [{ name: 'default' }],
          eventDateTimeFieldName: 'captured_at',
          dataLakeFieldInfoRepresentation: [
            { name: 'record_key', dataType: 'Text', isPrimaryKey: true },
            { name: 'captured_at', dataType: 'DateTime', isPrimaryKey: false },
          ],
        },
        refreshConfig: { refreshMode: 'UPSERT' },
      },
      'lv_stream_live_shape'
    ) as {
      dataLakeObjectInfo: {
        eventDateTimeFieldName: string;
        dataLakeFieldInputRepresentations: Array<{ name: string; isPrimaryKey: boolean }>;
      };
    };

    expect(definition.dataLakeObjectInfo.eventDateTimeFieldName).to.equal('captured_at');
    expect(definition.dataLakeObjectInfo.dataLakeFieldInputRepresentations).to.deep.include({
      name: 'record_key',
      label: 'record_key',
      dataType: 'Text',
      isPrimaryKey: true,
    });
  });

  it('clones only the safe Salesforce connector fields from a retained CRM stream', async () => {
    const scenario = (await import(
      pathToFileURL(resolve(root, 'scripts/live-scenarios/p4-stream.mjs')).href
    )) as StreamScenario;
    const definition = scenario.buildDisposableStreamDefinition!(
      {
        dataSource: 'Retained CRM',
        dataStreamType: 'SFDC',
        connectorInfo: {
          connectorType: 'SalesforceDotCom',
          connectorDetails: {
            name: 'Retained CRM',
            sourceObject: 'Contact',
            type: 'sfdc',
            credentialField: 'must-not-copy',
          },
        },
        sourceFields: [
          { name: 'Id', datatype: 'Text' },
          { name: 'CreatedDate', datatype: 'DateTime' },
        ],
        dataLakeObjectInfo: {
          category: 'Engagement',
          dataSpaceInfo: [{ name: 'default' }],
          eventDateTimeFieldName: 'CreatedDate',
          dataLakeFieldInfoRepresentation: [
            { name: 'Id', dataType: 'Text', isPrimaryKey: true },
            { name: 'CreatedDate', dataType: 'DateTime', isPrimaryKey: false },
          ],
        },
        refreshConfig: { refreshMode: 'UPSERT' },
      },
      'lv_stream_salesforce'
    );

    expect(definition).to.deep.include({ datasource: 'Retained CRM', datastreamType: 'SFDC' });
    expect(definition.connectorInfo).to.deep.equal({
      connectorType: 'SalesforceDotCom',
      connectorDetails: { name: 'Retained CRM', sourceObject: 'Contact', type: 'sfdc' },
    });
    expect(JSON.stringify(definition)).not.to.include('must-not-copy');
  });

  it('registers cleanup before create and never deletes the retained source or template stream', async () => {
    const scenario = (await import(
      pathToFileURL(resolve(root, 'scripts/live-scenarios/p4-stream.mjs')).href
    )) as StreamScenario;
    expect(scenario.buildP4StreamPlan).to.be.a('function');
    const plan = scenario.buildP4StreamPlan!('lv_stream_contract', testExternal);
    const ids = plan.map(({ id }) => id);

    expect(ids.indexOf('stream-dlo-cleanup')).to.be.lessThan(ids.indexOf('stream-create'));
    expect(plan.find(({ id }) => id === 'stream-dlo-cleanup')).to.deep.include({
      creates: 'lv_stream_contract_event__dll',
      cleanup: ['data360', 'dlo', 'delete', '--name', 'lv_stream_contract_event__dll', '--no-prompt'],
    });
    expect(plan.find(({ id }) => id === 'stream-create')).to.deep.include({
      creates: 'lv_stream_contract_stream',
      cleanup: ['data360', 'data-stream', 'delete', '--name', 'lv_stream_contract_stream', '--no-prompt'],
    });
    expect(plan.find(({ id }) => id === 'stream-delete')?.command).to.equal('data360 data-stream delete');
    expect(plan.find(({ id }) => id === 'stream-delete')?.cleanup).to.equal(undefined);
    expect(plan.filter(({ external }) => external).every(({ cleanup }) => cleanup === undefined)).to.equal(true);
    expect(JSON.stringify(plan)).not.to.include('data360 connection delete');
    expect(plan.find(({ id }) => id === 'stream-delete-verify')).to.deep.include({
      command: 'data360 data-stream list',
      exactAbsentName: 'lv_stream_contract_stream',
    });
    expect(plan.find(({ id }) => id === 'dlo-delete-verify')).to.deep.include({
      command: 'data360 dlo list',
      exactAbsentName: 'lv_stream_contract_event__dll',
    });
    for (const id of ['connection-describe', 'connection-validate']) {
      const entry = plan.find((candidate) => candidate.id === id);
      expect(entry).to.deep.include({ expectedTimeout: true, timeoutMs: 30_000 });
      expect(entry?.expectedError?.action).not.to.include('--verbose');
    }
  });

  it('accepts unsupported run evidence only by exact code and action and rejects ambiguous names', async () => {
    const scenario = (await import(
      pathToFileURL(resolve(root, 'scripts/live-scenarios/p4-stream.mjs')).href
    )) as StreamScenario;
    expect(scenario.matchesExpectedUnsupportedRun).to.be.a('function');
    expect(
      scenario.matchesExpectedUnsupportedRun!({
        code: 'D360_UNSUPPORTED_OP',
        actions: ['Use the configured CRM data stream schedule.'],
      })
    ).to.equal(true);
    expect(
      scenario.matchesExpectedUnsupportedRun!({
        code: 'D360_API_ERROR',
        message: 'D360_UNSUPPORTED_OP',
        actions: ['Use the configured CRM data stream schedule.'],
      })
    ).to.equal(false);

    expect(scenario.selectExactStreamKey).to.be.a('function');
    expect(
      scenario.selectExactStreamKey!(
        [{ name: 'lv_stream_contract_stream', recordId: 'stream-id' }],
        'lv_stream_contract_stream'
      )
    ).to.equal('stream-id');
    expect(() =>
      scenario.selectExactStreamKey!(
        [
          { name: 'lv_stream_contract_stream', recordId: 'first' },
          { name: 'lv_stream_contract_stream', recordId: 'second' },
        ],
        'lv_stream_contract_stream'
      )
    ).to.throw('Ambiguous data stream name');
    expect(scenario.hasExactResourceName).to.be.a('function');
    expect(
      scenario.hasExactResourceName!([{ name: 'lv_stream_contract_stream' }], 'lv_stream_contract_stream')
    ).to.equal(true);
    expect(
      scenario.hasExactResourceName!([{ label: 'lv_stream_contract_stream' }], 'lv_stream_contract_stream')
    ).to.equal(false);

    expect(scenario.selectExactConnectionKey).to.be.a('function');
    expect(
      scenario.selectExactConnectionKey!(
        [{ id: 'connection-id', label: 'Retained Ingest Source', connectorType: 'IngestApi' }],
        'Retained_Ingest_Source',
        'IngestApi'
      )
    ).to.equal('connection-id');
    expect(() =>
      scenario.selectExactConnectionKey!(
        [
          { id: 'first', label: 'Retained Ingest Source', connectorType: 'IngestApi' },
          { id: 'second', label: 'Retained_Ingest_Source', connectorType: 'IngestApi' },
        ],
        'Retained_Ingest_Source',
        'IngestApi'
      )
    ).to.throw('Ambiguous IngestApi connection label');
  });
});
