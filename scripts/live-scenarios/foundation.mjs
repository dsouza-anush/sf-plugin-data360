import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const terminalStatuses = new Set(['passed', 'failed', 'skipped']);

const resourceName = (prefix, suffix) => `${prefix}_${suffix}`;

const step = (id, dependsOn = [], details = {}) => ({ id, dependsOn, ...details });

export const parseFoundationOptions = (environment = process.env) => {
  if (environment.D360_LIVE_MUTATIONS !== '1') {
    throw new Error('Foundation scenario requires D360_LIVE_MUTATIONS=1');
  }
  if (environment.D360_LIVE_BILLABLE !== '1') {
    throw new Error('Foundation scenario requires D360_LIVE_BILLABLE=1');
  }
  return { mutations: true, billable: true };
};

export const createFoundationPrefix = (date = new Date(), random = Math.random) => {
  const stamp = date
    .toISOString()
    .replaceAll(/[-:TZ.]/gu, '')
    .slice(0, 14);
  const entropy = Math.floor(random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `lv_${stamp}_${entropy}`;
};

export const externalFoundationInputs = (environment = process.env) => {
  const values = {
    source: environment.D360_INGEST_SOURCE,
    object: environment.D360_INGEST_OBJECT,
    streamId: environment.D360_STREAM_ID,
    dloName: environment.D360_DLO_NAME,
  };
  const supplied = Object.values(values).filter(Boolean).length;
  if (supplied === 0) return undefined;
  if (supplied !== Object.keys(values).length) {
    throw new Error(
      'External foundation mode requires D360_INGEST_SOURCE, D360_INGEST_OBJECT, D360_STREAM_ID, and D360_DLO_NAME'
    );
  }
  const fixtureValues = {
    sample: environment.D360_INGEST_SAMPLE,
    invalidSample: environment.D360_INGEST_INVALID_SAMPLE,
    csv: environment.D360_INGEST_CSV,
    verifySql: environment.D360_INGEST_VERIFY_SQL,
  };
  const missingFixtures = Object.entries(fixtureValues)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missingFixtures.length > 0) {
    throw new Error(
      'External foundation mode requires D360_INGEST_SAMPLE, D360_INGEST_INVALID_SAMPLE, D360_INGEST_CSV, and D360_INGEST_VERIFY_SQL because retained object schemas are environment-specific'
    );
  }
  return {
    ...values,
    cleanupExternal: environment.D360_CLEANUP_EXTERNAL === '1',
    ...fixtureValues,
  };
};

export const buildFoundationPlan = (prefix, existingNames = new Set(), external) => {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,48}$/u.test(prefix)) {
    throw new Error('Foundation prefix must be API-safe and 3-49 characters');
  }

  const names = {
    connection: resourceName(prefix, 'connection'),
    object: resourceName(prefix, 'object'),
    stream: resourceName(prefix, 'stream'),
    dlo: `${resourceName(prefix, 'object')}__dll`,
    dmo: `${resourceName(prefix, 'object')}__dlm`,
    relationship: resourceName(prefix, 'relationship'),
    mapping: resourceName(prefix, 'mapping'),
    registryDlo: `${resourceName(prefix, 'registry')}__dll`,
    registryDmo: `${resourceName(prefix, 'registry')}__dlm`,
    registryRelationship: resourceName(prefix, 'registry_relationship'),
    registryMapping: resourceName(prefix, 'registry_mapping'),
    dataSpace: resourceName(prefix, 'space'),
    transform: resourceName(prefix, 'transform'),
  };
  for (const name of Object.values(names)) {
    if (existingNames.has(name)) throw new Error(`Disposable name already exists: ${name}`);
  }

  const records = [
    { Id: `${prefix}_1`, Name: 'Foundation one', Timestamp: '2026-01-01T00:00:00.000Z', Value: 1 },
    { Id: `${prefix}_2`, Name: 'Foundation two', Timestamp: '2026-01-01T00:00:01.000Z', Value: 2 },
    { Id: `${prefix}_3`, Name: 'Foundation three', Timestamp: '2026-01-01T00:00:02.000Z', Value: 3 },
  ];

  const plan = [
    step('connector-list', [], { command: 'data360 connector list' }),
    step('connector-get', ['connector-list'], { command: 'data360 connector get', actualListItem: true }),
    step('connection-create', [], {
      command: 'data360 connection create',
      creates: names.connection,
      definition: 'connection',
      cleanup: ['data360', 'connection', 'delete', '--name', names.connection, '--no-prompt'],
      cleanupKeyFields: ['id', 'name'],
    }),
    step('connection-validate-existing', ['connection-create'], {
      command: 'data360 connection validate',
      name: names.connection,
      nameFrom: 'connection-create',
      blocker: 'Live IngestApi connection validation failed in transport with "fetch failed"',
    }),
    step('connection-get-created', ['connection-create'], {
      command: 'data360 connection get',
      name: names.connection,
      nameFrom: 'connection-create',
    }),
    step('connection-list', ['connection-create'], { command: 'data360 connection list' }),
    step('connection-update-unsupported', ['connection-create'], {
      command: 'data360 connection update',
      name: names.connection,
      blocker: 'Connection update is documented as unsupported for non-Marketing Cloud connection types',
    }),
    step('connection-schema-setup', ['connection-create'], {
      command: 'data360 api request',
      rawEndpointFrom: 'connection-create',
      rawSuffix: '/schema',
      rawMethod: 'PUT',
      rawHeaders: ['Content-Type: application/json'],
      definition: 'schema',
      retryAttempts: 6,
      retryDelayMs: 10_000,
    }),
    step('connection-describe-created', ['connection-schema-setup'], {
      command: 'data360 connection describe',
      name: names.connection,
      nameFrom: 'connection-create',
      describeFlags: ['--endpoints'],
      // Schema upload is accepted asynchronously. Treat endpoint discovery as
      // the readiness gate instead of posting a data-stream immediately after
      // the schema PUT; the live service has taken longer than 30 seconds here.
      timeoutMs: 10 * 60_000,
    }),
    step('stream-create', ['connection-describe-created'], {
      command: 'data360 data-stream create',
      creates: names.stream,
      definition: 'stream',
      cleanup: ['data360', 'data-stream', 'delete', '--name', names.stream, '--delete-dlo', '--no-prompt'],
      cleanupKeyFields: ['id', 'name'],
    }),
    step('stream-get', ['stream-create'], { command: 'data360 data-stream get', name: names.stream }),
    step('stream-list', ['stream-create'], { command: 'data360 data-stream list' }),
    step('stream-run', ['stream-create'], {
      command: 'data360 data-stream run',
      name: names.stream,
      billable: true,
    }),
    step('dlo-get', ['stream-create'], { command: 'data360 dlo get', name: names.dlo }),
    step('dlo-update', ['dlo-get'], {
      command: 'data360 dlo update',
      name: names.dlo,
      definition: 'dloUpdate',
    }),
    step('ingest-validate', ['connection-schema-setup'], {
      command: 'data360 ingest validate',
      sourceName: names.connection,
      sourceNameFrom: 'connection-create',
      objectName: names.object,
      definition: 'streamRecord',
      records: records.slice(0, 1),
    }),
    step('ingest-validate-invalid', ['connection-schema-setup'], {
      command: 'data360 ingest validate',
      sourceName: names.connection,
      sourceNameFrom: 'connection-create',
      objectName: names.object,
      definition: 'invalidRecord',
      records: [{ WrongField: 'expected validation failure' }],
      expectsFailure: true,
    }),
    step('ingest-stream', ['ingest-validate'], {
      command: 'data360 ingest',
      sourceName: names.connection,
      sourceNameFrom: 'connection-create',
      objectName: names.object,
      definition: 'streamRecord',
      records: records.slice(0, 1),
      billable: true,
    }),
    step('ingest-bulk', ['ingest-validate'], {
      command: 'data360 ingest bulk',
      sourceName: names.connection,
      sourceNameFrom: 'connection-create',
      objectName: names.object,
      definition: 'bulkRecords',
      records,
      billable: true,
    }),
    step('ingest-report', ['ingest-bulk'], {
      command: 'data360 ingest report',
      jobFrom: 'ingest-bulk',
    }),
    step('ingest-resume', ['ingest-bulk'], {
      command: 'data360 ingest resume',
      jobFrom: 'ingest-bulk',
      // Data 360 documents bulk processing as asynchronous with roughly three-minute
      // latency. Keep the child-process guard slightly above the command's ten-minute
      // default so the orchestrator does not kill a healthy resume prematurely.
      timeoutMs: 11 * 60_000,
    }),
    step('ingest-cancel-job', ['ingest-validate'], {
      command: 'data360 ingest bulk',
      sourceName: names.connection,
      sourceNameFrom: 'connection-create',
      objectName: names.object,
      definition: 'bulkRecords',
      records: records.slice(0, 1),
      billable: true,
    }),
    step('ingest-cancel', ['ingest-cancel-job'], {
      command: 'data360 ingest cancel',
      jobFrom: 'ingest-cancel-job',
    }),
    step('query-visible-records', ['ingest-bulk', 'dlo-get'], {
      command: 'data360 query',
      query: `SELECT "Id__c" FROM "${names.dlo}" WHERE "Id__c" LIKE '${prefix}_%' LIMIT 3`,
      billable: true,
      boundedConsistencyWait: true,
    }),
    step('registry-dlo-create', [], {
      command: 'data360 dlo create',
      creates: names.registryDlo,
      definition: 'dlo',
      cleanup: ['data360', 'dlo', 'delete', '--name', names.registryDlo, '--no-prompt'],
      cleanupKeyFields: ['id', 'name'],
      cleanupRawFamily: 'data-lake-objects',
      cleanupRetryMs: 15_000,
    }),
    step('registry-dlo-get', ['registry-dlo-create'], {
      command: 'data360 dlo get',
      name: names.registryDlo,
      nameFrom: 'registry-dlo-create',
      nameKind: 'canonical',
      waitForStatus: 'ACTIVE',
    }),
    step('registry-dlo-update', ['registry-dlo-get'], {
      command: 'data360 dlo update',
      name: names.registryDlo,
      nameFrom: 'registry-dlo-create',
      nameKind: 'canonical',
      definition: 'dloUpdate',
      expectsFailure: true,
      expectedError: 'INTERNAL_ERROR',
      allowSuccess: true,
    }),
    step('dmo-create', ['registry-dlo-get'], {
      command: 'data360 dmo create',
      creates: names.registryDmo,
      definition: 'dmo',
      cleanup: ['data360', 'dmo', 'delete', '--name', names.registryDmo, '--no-prompt'],
      cleanupKeyFields: ['name', 'id'],
    }),
    step('dmo-get', ['dmo-create'], {
      command: 'data360 dmo get',
      name: names.registryDmo,
      nameFrom: 'dmo-create',
      nameKind: 'canonical',
    }),
    step('dmo-update', ['dmo-create'], {
      command: 'data360 dmo update',
      name: names.registryDmo,
      nameFrom: 'dmo-create',
      nameKind: 'canonical',
      definition: 'dmoUpdate',
    }),
    step('mapping-auto-dry-run', ['dmo-create', 'dlo-get'], {
      command: 'data360 mapping create',
      auto: true,
      dryRun: true,
      dlo: names.dlo,
      dmo: names.registryDmo,
    }),
    step('mapping-create', ['dmo-create', 'dlo-get'], {
      command: 'data360 mapping create',
      creates: names.registryMapping,
      definition: 'mapping',
      cleanup: ['data360', 'mapping', 'delete', '--name', names.registryMapping, '--no-prompt'],
      cleanupKeyFields: ['developerName', 'name', 'id'],
    }),
    step('mapping-get', ['mapping-create'], { command: 'data360 mapping get', name: names.registryMapping }),
    step('mapping-list', ['mapping-create'], {
      command: 'data360 mapping list',
      dlo: names.dlo,
      dmo: names.registryDmo,
    }),
    step('mapping-update', ['mapping-create'], {
      command: 'data360 mapping update',
      name: names.registryMapping,
      definition: 'mappingFields',
    }),
    step('relationship-create', ['mapping-create'], {
      command: 'data360 dmo relationship create',
      name: names.registryDmo,
      creates: names.registryRelationship,
      definition: 'relationship',
      cleanup: [
        'data360',
        'dmo',
        'relationship',
        'delete',
        '--relationship-name',
        names.registryRelationship,
        '--no-prompt',
      ],
      cleanupKeyFields: ['name', 'id'],
    }),
    step('relationship-list', ['relationship-create'], {
      command: 'data360 dmo relationship list',
      name: names.registryDmo,
    }),
    step('data-space-safety-check', [], {
      command: 'data360 data-space list',
      blocker: 'No verified data-space delete command exists; create/update/member mutation is unsafe to clean up',
    }),
    step('transform-definition-check', [], {
      command: 'data360 transform list',
      blocker: 'No valid disposable transform definition is available from verified fixtures or workshop definitions',
    }),
    step('open-url-only', [], { command: 'data360 open', requiresFallbackOrg: true }),
  ];
  if (!external) return plan;

  const externalStream = step('external-stream', [], {
    command: 'external ingestion resource',
    external: true,
    streamId: external.streamId,
    dloName: external.dloName,
    ...(external.cleanupExternal
      ? {
          creates: external.streamId,
          cleanup: ['data360', 'data-stream', 'delete', '--name', external.streamId, '--delete-dlo', '--no-prompt'],
          cleanupKeyFields: ['id', 'name'],
        }
      : {}),
  });
  const p3Ids = new Set([
    'ingest-validate',
    'ingest-validate-invalid',
    'ingest-stream',
    'ingest-bulk',
    'ingest-report',
    'ingest-resume',
    'ingest-cancel-job',
    'ingest-cancel',
    'query-visible-records',
  ]);
  const p3 = plan
    .filter(({ id }) => p3Ids.has(id))
    .map((current) => {
      const updated = { ...current };
      if (
        current.id === 'ingest-validate' ||
        current.id === 'ingest-validate-invalid' ||
        current.id === 'ingest-cancel-job'
      ) {
        updated.dependsOn = ['external-stream'];
      }
      if (current.sourceName || current.sourceNameFrom) {
        updated.sourceName = external.source;
        delete updated.sourceNameFrom;
        updated.objectName = external.object;
      }
      if (current.id === 'ingest-cancel-job') {
        updated.command = 'data360 api request';
        updated.billableFamily = 'data360 ingest bulk';
        updated.rawPath = '/api/v1/ingest/jobs';
        updated.rawDirect = true;
        updated.rawMethod = 'POST';
        updated.rawHeaders = ['Content-Type: application/json'];
        updated.rawBody = { sourceName: external.source, object: external.object, operation: 'upsert' };
        updated.creates = `${prefix}_cancel_job`;
        updated.cleanup = ['data360', 'api', 'request'];
        updated.cleanupRawFamily = '/api/v1/ingest/jobs';
        updated.cleanupDirect = true;
        updated.cleanupKeyFields = ['id'];
        delete updated.definition;
        delete updated.sourceName;
        delete updated.objectName;
      }
      if (current.id === 'query-visible-records') {
        updated.dependsOn = ['ingest-bulk', 'external-stream'];
        updated.query =
          external.verifySql ?? `SELECT "Id__c" FROM "${external.dloName}" WHERE "Id__c" LIKE '${prefix}_%' LIMIT 3`;
      }
      return updated;
    });
  return [externalStream, ...p3];
};

const persist = async (path, state) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
};

const loadState = async (path, prefix) => {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state.prefix !== prefix) throw new Error(`State prefix ${state.prefix} does not match ${prefix}`);
    state.ownershipProofs ??= {};
    state.billableCalls ??= 0;
    state.billableAttempts ??= 0;
    state.billableOutcomes ??= [];
    return state;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {
      version: 1,
      prefix,
      results: {},
      cleanupStack: [],
      cleanup: [],
      ownershipProofs: {},
      billableCalls: 0,
      billableAttempts: 0,
      billableOutcomes: [],
    };
  }
};

const cleanupWithRetries = async (entry, cleanup, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const outcome = await cleanup(entry);
      if (outcome?.exitCode !== 0 || outcome?.deletionConfirmed !== true) {
        throw new Error(outcome?.reason ?? 'Cleanup did not verify resource absence');
      }
      return { step: entry.id, status: 'passed', attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((done) => setTimeout(done, entry.cleanupRetryMs ?? attempt * 250));
    }
  }
  return {
    step: entry.id,
    status: 'failed',
    attempts,
    reason: lastError instanceof Error ? lastError.message : String(lastError),
  };
};

export const runFoundationScenario = async ({
  prefix,
  statePath,
  steps,
  execute,
  cleanup,
  blockerFor,
  authorizeCreate,
  isCreateCollision,
  cleanupOnly = false,
}) => {
  const state = await loadState(statePath, prefix);
  const byId = new Map(steps.map((entry) => [entry.id, entry]));

  for (const current of cleanupOnly ? [] : steps) {
    if (terminalStatuses.has(state.results[current.id]?.status)) continue;
    const unavailable = current.dependsOn.find((dependency) => state.results[dependency]?.status !== 'passed');
    if (unavailable) {
      state.results[current.id] = {
        status: 'blocked',
        reason: `Dependency ${unavailable} did not pass`,
      };
      await persist(statePath, state);
      continue;
    }
    const blocker = current.blocker ?? (await blockerFor?.(current, state));
    if (blocker) {
      state.results[current.id] = { status: 'blocked', reason: blocker };
      await persist(statePath, state);
      continue;
    }

    if (current.creates && authorizeCreate && !state.ownershipProofs[current.id]) {
      try {
        const proof = await authorizeCreate(current, state);
        if (!proof || proof.name !== current.creates || proof.status !== 'absent') {
          throw new Error(`Create ownership proof did not establish exact absence for ${current.creates}`);
        }
        state.ownershipProofs[current.id] = proof;
      } catch (error) {
        state.results[current.id] = {
          status: 'blocked',
          reason: error instanceof Error ? error.message : String(error),
        };
        await persist(statePath, state);
        continue;
      }
    }

    if (current.creates && !state.cleanupStack.some(({ step: id }) => id === current.id)) {
      state.cleanupStack.push({ step: current.id, status: 'registered', registeredAt: new Date().toISOString() });
      await persist(statePath, state);
    }

    let billableOutcome;
    if (current.billable) {
      const unresolved = state.billableOutcomes.find(
        ({ step: id, status }) => id === current.id && status === 'attempted'
      );
      if (unresolved) {
        state.results[current.id] = {
          status: 'blocked',
          reason: `A prior billable attempt for ${current.id} has an unknown outcome; inspect the ledger before retrying`,
        };
        await persist(statePath, state);
        continue;
      }
      billableOutcome = {
        step: current.id,
        command: current.command,
        family: current.billableFamily ?? current.command,
        status: 'attempted',
        attemptedAt: new Date().toISOString(),
      };
      state.billableAttempts += 1;
      state.billableOutcomes.push(billableOutcome);
      await persist(statePath, state);
    }

    try {
      const evidence = await execute(current);
      state.results[current.id] = { status: 'passed', evidence };
      if (current.billable) {
        state.billableCalls += 1;
        Object.assign(billableOutcome, { status: 'passed', completedAt: new Date().toISOString() });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.results[current.id] = {
        status: 'failed',
        reason,
      };
      if (billableOutcome) {
        Object.assign(billableOutcome, { status: 'failed', completedAt: new Date().toISOString(), reason });
      }
      if (current.creates && isCreateCollision?.(error, current)) {
        state.cleanupStack = state.cleanupStack.filter(({ step: id }) => id !== current.id);
        state.cleanup = state.cleanup.filter(({ step: id }) => id !== current.id);
        state.cleanup.push({
          step: current.id,
          status: 'not-owned',
          reason: `Create was rejected as a collision; the existing ${current.creates} resource was not deleted`,
        });
      }
    }
    await persist(statePath, state);
  }

  for (const registered of [...state.cleanupStack].reverse()) {
    if (registered.status === 'passed') continue;
    const current = byId.get(registered.step);
    if (!current) continue;
    const result = await cleanupWithRetries(
      {
        ...current,
        createEvidence: state.results[current.id]?.evidence,
        createFailureReason: state.results[current.id]?.reason,
        ownershipProof: state.ownershipProofs[current.id],
      },
      cleanup
    );
    delete registered.reason;
    Object.assign(registered, result);
    state.cleanup = state.cleanup.filter(({ step: id }) => id !== current.id);
    state.cleanup.push(result);
    await persist(statePath, state);
  }
  for (const registered of [...state.cleanupStack].reverse()) {
    if (registered.status !== 'failed') continue;
    const current = byId.get(registered.step);
    if (!current) continue;
    const result = await cleanupWithRetries(
      {
        ...current,
        createEvidence: state.results[current.id]?.evidence,
        createFailureReason: state.results[current.id]?.reason,
        ownershipProof: state.ownershipProofs[current.id],
      },
      cleanup
    );
    delete registered.reason;
    Object.assign(registered, result);
    state.cleanup = state.cleanup.filter(({ step: id }) => id !== current.id);
    state.cleanup.push(result);
    await persist(statePath, state);
  }

  state.completedAt = new Date().toISOString();
  await persist(statePath, state);
  return state;
};

export const foundationNames = (prefix) => ({
  connection: resourceName(prefix, 'connection'),
  object: resourceName(prefix, 'object'),
  stream: resourceName(prefix, 'stream'),
  dlo: `${resourceName(prefix, 'object')}__dll`,
  dmo: `${resourceName(prefix, 'object')}__dlm`,
  relationship: resourceName(prefix, 'relationship'),
  mapping: resourceName(prefix, 'mapping'),
  registryDlo: `${resourceName(prefix, 'registry')}__dll`,
  registryDmo: `${resourceName(prefix, 'registry')}__dlm`,
  registryRelationship: resourceName(prefix, 'registry_relationship'),
  registryMapping: resourceName(prefix, 'registry_mapping'),
  dataSpace: resourceName(prefix, 'space'),
  transform: resourceName(prefix, 'transform'),
});

export const cleanupResourceKey = (current, createEvidence) => {
  const item = createEvidence?.payload?.result?.item ?? createEvidence?.payload?.result ?? createEvidence?.payload;
  const findField = (value, field) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findField(entry, field);
        if (found) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== 'object') return undefined;
    if (typeof value[field] === 'string' && value[field]) return value[field];
    for (const entry of Object.values(value)) {
      const found = findField(entry, field);
      if (found) return found;
    }
    return undefined;
  };
  for (const field of current.cleanupKeyFields ?? ['id', 'developerName', 'name']) {
    const found = findField(item, field);
    if (found) return found;
  }
  return undefined;
};

export const orgForFoundationStep = (current, primaryOrg, fallbackOrg = process.env.D360_LIVE_FALLBACK_ORG) => {
  if (!current.requiresFallbackOrg) return primaryOrg;
  if (!fallbackOrg) throw new Error('This step requires D360_LIVE_FALLBACK_ORG to name an approved Core org.');
  return fallbackOrg;
};

export const writeFoundationDefinitions = async (directory, prefix) => {
  const names = foundationNames(prefix);
  await mkdir(directory, { recursive: true });
  const definitions = {
    connection: {
      connectorType: 'IngestApi',
      label: `${prefix} connection`,
      name: names.connection,
    },
    connectionUpdate: { label: `${prefix} connection updated` },
    schema: {
      schemas: [
        {
          label: names.object,
          name: names.object,
          schemaType: 'IngestApi',
          fields: [
            { name: 'Id', label: 'Id', dataType: 'Text' },
            { name: 'Name', label: 'Name', dataType: 'Text' },
            { name: 'Timestamp', label: 'Timestamp', dataType: 'DateTime' },
            { name: 'Value', label: 'Value', dataType: 'Number' },
          ],
        },
      ],
    },
    stream: {
      name: names.stream,
      label: `${prefix} stream`,
      datasource: names.connection,
      // Detail responses omit connectorDetails, but the v67 create parser
      // requires the polymorphic block. IngestApi rejects sourceObject here.
      datastreamType: 'INGESTAPI',
      connectorInfo: {
        connectorType: 'IngestApi',
        connectorDetails: { name: names.connection },
      },
      dataLakeObjectInfo: {
        label: names.object,
        name: names.dlo,
        category: 'Engagement',
        dataspaceInfo: [{ name: 'Default' }],
        eventDateTimeFieldName: 'Timestamp',
        dataLakeFieldInputRepresentations: [
          { name: 'Id', label: 'Id', dataType: 'Text', isPrimaryKey: true },
          { name: 'Name', label: 'Name', dataType: 'Text', isPrimaryKey: false },
          { name: 'Timestamp', label: 'Timestamp', dataType: 'DateTime', isPrimaryKey: false },
          { name: 'Value', label: 'Value', dataType: 'Number', isPrimaryKey: false },
        ],
      },
      sourceFields: [
        { name: 'Id', dataType: 'Text' },
        { name: 'Name', dataType: 'Text' },
        { name: 'Timestamp', dataType: 'DateTime' },
        { name: 'Value', dataType: 'Number' },
      ],
      mappings: [],
      refreshConfig: { isAccelerationEnabled: false, refreshMode: 'UPSERT', frequency: { frequencyType: 'NONE' } },
    },
    dloUpdate: { label: `${prefix} object updated` },
    dlo: {
      name: names.registryDlo.replace(/__dll$/u, ''),
      label: `${prefix} registry object`,
      category: 'Engagement',
      eventDateTimeFieldName: 'Timestamp',
      dataLakeFieldInputRepresentations: [
        { name: 'Id', label: 'Id', dataType: 'Text', isPrimaryKey: true },
        { name: 'Name', label: 'Name', dataType: 'Text', isPrimaryKey: false },
        { name: 'Timestamp', label: 'Timestamp', dataType: 'DateTime', isPrimaryKey: false },
      ],
    },
    dmo: {
      name: names.registryDmo.replace(/__dlm$/u, ''),
      label: `${prefix} object`,
      description: 'Disposable live verification DMO',
      dataSpaceName: 'default',
      category: 'ENGAGEMENT',
      fields: [
        { name: 'Id__c', label: 'Id', isPrimaryKey: true, isDynamicLookup: false, dataType: 'Text' },
        { name: 'Name__c', label: 'Name', isPrimaryKey: false, isDynamicLookup: false, dataType: 'Text' },
        {
          name: 'Timestamp__c',
          label: 'Timestamp',
          isPrimaryKey: false,
          isDynamicLookup: false,
          dataType: 'DateTime',
        },
        { name: 'Value__c', label: 'Value', isPrimaryKey: false, isDynamicLookup: false, dataType: 'Number' },
      ],
    },
    dmoUpdate: { label: `${prefix} object updated` },
    relationship: {
      relationships: [
        {
          sourceObjectName: names.registryDmo,
          targetObjectName: 'ssot__Individual__dlm',
          cardinality: 'ManyToOne',
          sourceFieldName: 'Id__c',
          targetFieldName: 'ssot__Id__c',
          relationshipOwner: 'DataCloud',
        },
      ],
    },
    mapping: {
      sourceEntityDeveloperName: names.dlo,
      targetEntityDeveloperName: names.registryDmo,
      fieldMapping: [
        { sourceFieldDeveloperName: 'Id__c', targetFieldDeveloperName: 'Id__c' },
        { sourceFieldDeveloperName: 'Name__c', targetFieldDeveloperName: 'Name__c' },
        { sourceFieldDeveloperName: 'Timestamp__c', targetFieldDeveloperName: 'Timestamp__c' },
        { sourceFieldDeveloperName: 'Value__c', targetFieldDeveloperName: 'Value__c' },
      ],
    },
    mappingFields: {
      fieldMappings: [{ name: 'Name__c', sourceFieldDeveloperName: 'Name__c', targetFieldDeveloperName: 'Name__c' }],
    },
    streamRecord: [{ Id: `${prefix}_1`, Name: 'Foundation one', Timestamp: '2026-01-01T00:00:00.000Z', Value: 1 }],
    invalidRecord: [{ WrongField: 'expected validation failure' }],
    bulkRecords: `Id,Name,Timestamp,Value\n${prefix}_1,Foundation one,2026-01-01T00:00:00.000Z,1\n${prefix}_2,Foundation two,2026-01-01T00:00:01.000Z,2\n${prefix}_3,Foundation three,2026-01-01T00:00:02.000Z,3\n`,
  };
  const files = {};
  for (const [key, value] of Object.entries(definitions)) {
    const extension = key === 'bulkRecords' ? 'csv' : 'json';
    const path = resolve(directory, `${key}.${extension}`);
    const content = typeof value === 'string' ? value : `${JSON.stringify(value, undefined, 2)}\n`;
    await writeFile(path, content, { mode: 0o600 });
    files[key] = path;
  }
  return files;
};

export const argsForFoundationStep = (current, files, dynamic = {}) => {
  const args = current.command.split(' ');
  if (current.rawPath) {
    args.push(current.rawPath);
    if (current.rawDirect) args.push('--direct');
    if (current.rawMethod) args.push('--method', current.rawMethod);
    if (current.rawMethod && current.rawMethod !== 'GET') args.push('--no-prompt');
    for (const header of current.rawHeaders ?? []) args.push('--header', header);
    if (current.rawBody) args.push('--body', JSON.stringify(current.rawBody));
  }
  if (current.actualListItem) {
    if (!dynamic.connectorName) throw new Error('Connector list returned no usable connector name');
    args.push('--name', dynamic.connectorName);
  }
  const resolvedName = current.nameFrom
    ? current.nameKind === 'canonical'
      ? dynamic.resourceNames?.[current.nameFrom]
      : dynamic.resourceKeys?.[current.nameFrom]
    : current.name;
  if (resolvedName) args.push('--name', resolvedName);
  if (current.definition) args.push('--file', files[current.definition]);
  if (current.schemaDefinition) args.push('--schema-file', files[current.schemaDefinition]);
  const sourceName = current.sourceNameFrom ? dynamic.resourceNames?.[current.sourceNameFrom] : current.sourceName;
  if (sourceName) args.push('--source-name', sourceName);
  if (current.objectName) args.push('--object-name', current.objectName);
  if (current.auto) args.push('--auto');
  if (current.dryRun) args.push('--dry-run');
  if (current.dlo) args.push('--dlo', current.dlo);
  if (current.dmo) args.push('--dmo', current.dmo);
  if (current.describeFlags) args.push(...current.describeFlags);
  if (current.command === 'data360 ingest') args.push('--no-prompt');
  if (current.command === 'data360 ingest bulk') args.push('--async', '--no-prompt');
  if (current.jobFrom) {
    const jobId = dynamic.jobIds?.[current.jobFrom];
    if (!jobId) throw new Error(`No job ID recorded by ${current.jobFrom}`);
    args.push('--job-id', jobId);
    if (current.id === 'ingest-cancel') args.push('--no-prompt');
  }
  if (current.query) args.push('--query', current.query, '--wait', '10', '--no-prompt');
  if (current.rawEndpointFrom) {
    const key = dynamic.resourceIds?.[current.rawEndpointFrom] ?? dynamic.resourceKeys?.[current.rawEndpointFrom];
    if (!key) throw new Error(`No resource key recorded by ${current.rawEndpointFrom}`);
    args.push(`${current.rawEndpointFrom.replace('-create', 's')}/${key}${current.rawSuffix ?? ''}`);
    if (current.rawMethod) args.push('--method', current.rawMethod);
    if (current.rawMethod && current.rawMethod !== 'GET') args.push('--no-prompt');
    for (const header of current.rawHeaders ?? []) args.push('--header', header);
    if (current.definition) {
      args.splice(args.indexOf('--file'), 2);
      args.push('--body', `@${files[current.definition]}`);
    }
  }
  if (current.id === 'open-url-only') args.push('--url-only');
  return args;
};
