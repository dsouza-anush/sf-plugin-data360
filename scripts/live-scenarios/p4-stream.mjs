import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const step = (id, dependsOn = [], details = {}) => ({ id, dependsOn, ...details });

export const P4_STREAM_RUN_UNSUPPORTED = Object.freeze({
  code: 'D360_UNSUPPORTED_OP',
  action: 'Use the configured CRM data stream schedule.',
});

export const p4StreamNames = (prefix) => ({
  stream: `${prefix}_stream`,
  dlo: `${prefix}_event__dll`,
});

export const createP4StreamPrefix = (date = new Date(), random = Math.random) => {
  const stamp = date
    .toISOString()
    .replaceAll(/[-:TZ.]/gu, '')
    .slice(0, 14);
  const entropy = Math.floor(random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `lv_stream_${stamp}_${entropy}`;
};

const assertPrefix = (prefix) => {
  if (!/^lv_stream_[A-Za-z0-9_]{3,37}$/u.test(prefix)) {
    throw new Error('P4 stream prefix must start with lv_stream_ and contain at most 47 API-safe characters');
  }
};

export const buildDisposableStreamDefinition = (existing, prefix) => {
  assertPrefix(prefix);
  const names = p4StreamNames(prefix);
  const connectorType = existing.connectorInfo?.connectorType ?? 'IngestApi';
  const connectorDetails =
    connectorType === 'IngestApi'
      ? { name: existing.dataSource }
      : Object.fromEntries(
          Object.entries(existing.connectorInfo?.connectorDetails ?? {}).filter(
            ([key, value]) => ['name', 'sourceObject', 'type'].includes(key) && typeof value === 'string' && value
          )
        );
  const sourceFields = existing.sourceFields?.map(({ name, datatype, dataType }) => ({
    name,
    dataType: dataType ?? datatype,
  }));
  if (!Array.isArray(sourceFields) || sourceFields.length === 0) {
    throw new Error('Existing stream response has no source fields to clone');
  }
  const fieldRepresentations =
    existing.dataLakeObjectInfo?.dataLakeFieldInputRepresentations ??
    existing.dataLakeObjectInfo?.dataLakeFieldInfoRepresentation ??
    [];
  const primaryKeyName =
    fieldRepresentations.find(({ isPrimaryKey }) => isPrimaryKey === true)?.name ??
    sourceFields.find(({ name, dataType }) => name === 'event_id' && dataType === 'Text')?.name;
  const eventTimeName =
    existing.dataLakeObjectInfo?.eventDateTimeFieldName ??
    sourceFields.find(({ name, dataType }) => name === 'event_time' && dataType === 'DateTime')?.name;
  const primaryKey = sourceFields.find(({ name }) => name === primaryKeyName);
  const eventTime = sourceFields.find(({ name }) => name === eventTimeName);
  if (primaryKey?.dataType !== 'Text' || eventTime?.dataType !== 'DateTime') {
    throw new Error('Existing stream must declare a Text primary key and DateTime event-time field');
  }

  return {
    name: names.stream,
    label: `${prefix} stream`,
    datasource: existing.dataSource,
    datastreamType: connectorType === 'IngestApi' ? 'INGESTAPI' : existing.dataStreamType,
    connectorInfo: {
      connectorType,
      connectorDetails,
    },
    dataLakeObjectInfo: {
      name: names.dlo,
      label: `${prefix} event`,
      category: existing.dataLakeObjectInfo?.category ?? 'Engagement',
      dataspaceInfo: [{ name: existing.dataLakeObjectInfo?.dataSpaceInfo?.[0]?.name ?? 'default' }],
      eventDateTimeFieldName: eventTimeName,
      dataLakeFieldInputRepresentations: sourceFields.map(({ name, dataType }) => ({
        name,
        label: name,
        dataType,
        isPrimaryKey: name === primaryKeyName,
      })),
    },
    sourceFields,
    mappings: [],
    refreshConfig: {
      isAccelerationEnabled: false,
      refreshMode: existing.refreshConfig?.refreshMode ?? 'UPSERT',
      frequency: { frequencyType: 'NONE' },
    },
  };
};

export const buildP4StreamPlan = (prefix, external, connectorType = 'IngestApi') => {
  assertPrefix(prefix);
  const names = p4StreamNames(prefix);
  return [
    step('external-source', [], {
      command: 'external ingestion source',
      external: true,
      resource: { name: external.source, object: external.object },
    }),
    step('external-stream-template', [], {
      command: 'external data stream',
      external: true,
      resource: { id: external.streamId, name: external.streamApiName },
    }),
    step('stream-template-get', ['external-stream-template'], {
      command: 'data360 data-stream get',
      name: external.streamId,
      fixtureCommand: 'data360 data-stream get',
    }),
    step('connection-list', ['external-source'], { command: 'data360 connection list' }),
    step('connection-describe', ['connection-list'], {
      command: 'data360 connection describe',
      selectConnectionLabel: external.source,
      args: ['--endpoints'],
      expectedFailure: true,
      expectedTimeout: true,
      timeoutMs: 30_000,
      allowSuccess: true,
      expectedError: {
        code: 'D360_API_ERROR',
        action: 'Re-run with --json to inspect the structured API error details.',
      },
    }),
    step('connection-validate', ['connection-list'], {
      command: 'data360 connection validate',
      selectConnectionLabel: external.source,
      expectedFailure: true,
      expectedTimeout: true,
      timeoutMs: 30_000,
      allowSuccess: true,
      expectedError: {
        code: 'D360_API_ERROR',
        action: 'Re-run with --json to inspect the structured API error details.',
      },
    }),
    step('stream-dlo-cleanup', ['stream-template-get'], {
      command: 'register disposable DLO cleanup',
      registerOnly: true,
      creates: names.dlo,
      cleanup: ['data360', 'dlo', 'delete', '--name', names.dlo, '--no-prompt'],
      cleanupKeyFields: ['name'],
    }),
    step('stream-create', ['stream-dlo-cleanup'], {
      command: 'data360 data-stream create',
      creates: names.stream,
      definition: 'streamCreate',
      cleanup: ['data360', 'data-stream', 'delete', '--name', names.stream, '--no-prompt'],
      cleanupKeyFields: ['recordId', 'name'],
    }),
    step('stream-get', ['stream-create'], {
      command: 'data360 data-stream get',
      nameFrom: 'stream-create',
    }),
    step('stream-list', ['stream-create'], {
      command: 'data360 data-stream list',
      args: ['--all'],
      exactName: names.stream,
    }),
    step('stream-update', ['stream-get'], {
      command: 'data360 data-stream update',
      nameFrom: 'stream-create',
      definition: 'streamUpdate',
    }),
    step('stream-update-get', ['stream-update'], {
      command: 'data360 data-stream get',
      nameFrom: 'stream-create',
      expectedLabel: `${prefix} stream updated`,
    }),
    step('stream-restore', ['stream-update-get'], {
      command: 'data360 data-stream update',
      nameFrom: 'stream-create',
      definition: 'streamRestore',
    }),
    step('stream-run', ['stream-restore'], {
      command: 'data360 data-stream run',
      nameFrom: 'stream-create',
      expectedFailure: true,
      expectedError: P4_STREAM_RUN_UNSUPPORTED,
      ...(connectorType === 'IngestApi'
        ? {}
        : { blocker: 'The disposable non-IngestApi stream run requires the separate billable-command gate' }),
    }),
    step('stream-delete', ['stream-restore'], {
      command: 'data360 data-stream delete',
      nameFrom: 'stream-create',
      args: ['--no-prompt'],
    }),
    step('stream-delete-verify', ['stream-delete'], {
      command: 'data360 data-stream list',
      args: ['--all'],
      exactAbsentName: names.stream,
    }),
    step('dlo-get-retained', ['stream-delete'], {
      command: 'data360 dlo get',
      name: names.dlo,
    }),
    step('dlo-update', ['dlo-get-retained'], {
      command: 'data360 dlo update',
      name: names.dlo,
      definition: 'dloUpdate',
    }),
    step('dlo-restore', ['dlo-update'], {
      command: 'data360 dlo update',
      name: names.dlo,
      definition: 'dloRestore',
    }),
    step('dlo-delete', ['dlo-restore'], {
      command: 'data360 dlo delete',
      name: names.dlo,
      args: ['--no-prompt'],
    }),
    step('dlo-delete-verify', ['dlo-delete'], {
      command: 'data360 dlo list',
      args: ['--all'],
      exactAbsentName: names.dlo,
    }),
  ];
};

export const writeP4StreamDefinitions = async (directory, prefix, existing) => {
  const create = buildDisposableStreamDefinition(existing, prefix);
  const definitions = {
    streamCreate: create,
    streamUpdate: {
      label: `${prefix} stream updated`,
      refreshConfig: { ...create.refreshConfig, shouldFetchImmediately: false },
    },
    streamRestore: {
      label: create.label,
      refreshConfig: create.refreshConfig,
    },
    dloUpdate: { label: `${prefix} event updated` },
    dloRestore: { label: create.dataLakeObjectInfo.label },
  };
  await mkdir(directory, { recursive: true });
  return Object.fromEntries(
    await Promise.all(
      Object.entries(definitions).map(async ([name, definition]) => {
        const path = resolve(directory, `${name}.json`);
        await writeFile(path, `${JSON.stringify(definition, undefined, 2)}\n`, { mode: 0o600 });
        return [name, path];
      })
    )
  );
};

export const argsForP4StreamStep = (current, files, dynamic = {}) => {
  const args = current.command.split(' ');
  const resolvedName = current.nameFrom ? dynamic.resourceKeys?.[current.nameFrom] : current.name;
  if (resolvedName) args.push('--name', resolvedName);
  if (current.definition) args.push('--file', files[current.definition]);
  args.push(...(current.args ?? []));
  if (current.command === 'data360 data-stream run' && !args.includes('--no-prompt')) args.push('--no-prompt');
  return args;
};

export const matchesExpectedUnsupportedRun = (payload) =>
  payload?.code === P4_STREAM_RUN_UNSUPPORTED.code &&
  Array.isArray(payload?.actions) &&
  payload.actions.length === 1 &&
  payload.actions[0] === P4_STREAM_RUN_UNSUPPORTED.action;

export const selectExactStreamKey = (items, name) => {
  const matches = items.filter((item) => item?.name === name);
  if (matches.length > 1) throw new Error(`Ambiguous data stream name: ${name}`);
  if (matches.length === 0) throw new Error(`Data stream not found by exact name: ${name}`);
  return matches[0].recordId ?? matches[0].id ?? matches[0].name;
};

export const hasExactResourceName = (items, name) =>
  items.some((item) => [item?.name, item?.developerName, item?.apiName].includes(name));

export const selectExactConnectionKey = (items, label, connectorType) => {
  const wanted = String(label)
    .replaceAll(/[^a-z0-9]/giu, '')
    .toLowerCase();
  const matches = items.filter(
    (item) =>
      item?.connectorType === connectorType &&
      [item?.label, item?.name]
        .map((value) =>
          String(value ?? '')
            .replaceAll(/[^a-z0-9]/giu, '')
            .toLowerCase()
        )
        .includes(wanted)
  );
  if (matches.length > 1) throw new Error(`Ambiguous ${connectorType} connection label: ${label}`);
  if (matches.length === 0) throw new Error(`${connectorType} connection not found by exact label: ${label}`);
  return matches[0].id ?? matches[0].name;
};
