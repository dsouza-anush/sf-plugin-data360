import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanupResourceKey, runFoundationScenario } from './foundation.mjs';

export const p4ExternalInputs = (environment = process.env) => {
  const values = {
    source: environment.D360_INGEST_SOURCE,
    object: environment.D360_INGEST_OBJECT,
    streamId: environment.D360_STREAM_ID,
    streamApiName: environment.D360_STREAM_API_NAME,
    dloName: environment.D360_DLO_NAME,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `P4 scenario requires owner-approved external inputs; missing ${missing.join(', ')}. See .env.live.example.`
    );
  }
  return values;
};

const step = (id, dependsOn = [], details = {}) => ({ id, dependsOn, ...details });
const disposable = (prefix, suffix) => `${prefix}_${suffix}`;
const normalized = (value) =>
  String(value ?? '')
    .replaceAll(/[^a-z0-9]/giu, '')
    .toLowerCase();

export const selectP4ResourceKey = (items, selector) => {
  const wantedLabel = normalized(selector.label);
  const selected = items.find((item) => {
    if (selector.connectorType && item?.connectorType !== selector.connectorType) return false;
    if (!wantedLabel) return true;
    const labels = [item?.label, item?.name].map(normalized);
    return labels.some((label) => label === wantedLabel || label.startsWith(wantedLabel));
  });
  return selected?.id ?? selected?.name;
};

export const isVerifiedAbsent = (payload) => {
  const serialized = JSON.stringify(payload);
  return /NOT_FOUND|ITEM_NOT_FOUND|No resource matches|not found|does not exists?/iu.test(serialized);
};

export const matchesP4ExpectedError = (payload, expected) =>
  payload?.code === expected.code &&
  payload?.actions?.includes(expected.action) === true &&
  (expected.apiCode === undefined || payload?.data?.apiCode === expected.apiCode);

export const shouldRecordP4Fixture = (current) =>
  current.recordFixture !== false && !current.id.startsWith('cleanup-') && !current.id.startsWith('ownership-');
export const isP4CleanupVerifiable = (current) => !current.cleanupRawFamily;

export const parseP4Options = (environment = process.env) => {
  if (environment.D360_LIVE_MUTATIONS !== '1') throw new Error('P4 scenario requires D360_LIVE_MUTATIONS=1');
  return { mutations: true, billable: false };
};

export const createP4Prefix = (date = new Date(), random = Math.random) => {
  const stamp = date
    .toISOString()
    .replaceAll(/[-:TZ.]/gu, '')
    .slice(0, 14);
  const entropy = Math.floor(random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `lv_p4_${stamp}_${entropy}`;
};

export const p4Names = (prefix) => ({
  registryDlo: `${disposable(prefix, 'registry')}__dll`,
  dmo: `${disposable(prefix, 'event')}__dlm`,
  mapping: disposable(prefix, 'mapping'),
  relationship: disposable(prefix, 'relationship'),
});

export const buildP4MatchedDmoDefinition = (payload, prefix) => {
  const names = p4Names(prefix);
  const item = payload?.result?.item ?? payload?.result ?? payload;
  const dlo = Array.isArray(item?.dataLakeObjects) ? item.dataLakeObjects[0] : item;
  const fields = dlo?.fields ?? dlo?.dataLakeFieldInfoRepresentation ?? [];
  const sourceFields = Array.isArray(fields)
    ? fields.filter(({ name, dataType, datatype }) => {
        const fieldName = String(name ?? '');
        return (
          fieldName.endsWith('__c') &&
          !/^(?:KQ_|cdp_sys_)/u.test(fieldName) &&
          !['DataSource__c', 'DataSourceObject__c', 'InternalOrganization__c'].includes(fieldName) &&
          typeof (dataType ?? datatype) === 'string'
        );
      })
    : [];
  if (sourceFields.length === 0 || !sourceFields.some(({ isPrimaryKey }) => isPrimaryKey === true)) {
    throw new Error('External DLO detail must expose at least one business field and a primary key');
  }
  return {
    name: names.dmo.replace(/__dlm$/u, ''),
    label: `${prefix} event DMO`,
    description: 'Disposable P4 live verification DMO matched to an approved read-only source DLO',
    dataSpaceName: 'default',
    category: 'ENGAGEMENT',
    fields: sourceFields.map(({ name, label, dataType, datatype, isPrimaryKey }) => ({
      name,
      label: label ?? name,
      dataType: dataType ?? datatype,
      isPrimaryKey: isPrimaryKey === true,
      isDynamicLookup: false,
    })),
  };
};

export const selectP4MappingField = (payload) => {
  const item = payload?.result?.item ?? payload?.result ?? payload;
  const fields = item?.fieldMappings ?? item?.fieldMapping ?? [];
  if (!Array.isArray(fields)) return undefined;
  const selected = fields.find(
    ({ developerName, name, sourceFieldDeveloperName, targetFieldDeveloperName }) =>
      typeof (developerName ?? name) === 'string' &&
      typeof sourceFieldDeveloperName === 'string' &&
      typeof targetFieldDeveloperName === 'string' &&
      !/^(?:KQ_|cdp_sys_)/u.test(sourceFieldDeveloperName)
  );
  if (!selected) return undefined;
  return {
    name: selected.developerName ?? selected.name,
    sourceFieldDeveloperName: selected.sourceFieldDeveloperName,
    targetFieldDeveloperName: selected.targetFieldDeveloperName,
  };
};

export const buildP4Plan = (prefix, external) => {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,48}$/u.test(prefix)) {
    throw new Error('P4 prefix must be API-safe and 3-49 characters');
  }
  const names = p4Names(prefix);
  return [
    step('external-stream', [], {
      command: 'external ingestion resource',
      external: true,
      resource: { id: external.streamId, name: external.streamApiName },
    }),
    step('external-dlo', [], {
      command: 'external ingestion resource',
      external: true,
      resource: { name: external.dloName },
    }),
    step('connector-list', [], { command: 'data360 connector list' }),
    step('connector-get', ['connector-list'], {
      command: 'data360 connector get',
      selectFirstConnector: true,
    }),
    step('connection-list', [], { command: 'data360 connection list' }),
    step('connection-get', ['connection-list'], {
      command: 'data360 connection get',
      selectConnectionLabel: external.source,
    }),
    step('connection-describe', ['connection-get'], {
      command: 'data360 connection describe',
      nameFrom: 'connection-get',
      args: ['--endpoints'],
      expectedFailure: true,
      expectedTimeout: true,
      timeoutMs: 30_000,
      expectedError: {
        code: 'D360_API_ERROR',
        action: 'Re-run with --json to inspect the structured API error details.',
      },
    }),
    step('connection-validate', ['connection-get'], {
      command: 'data360 connection validate',
      nameFrom: 'connection-get',
      expectedFailure: true,
      expectedTimeout: true,
      timeoutMs: 30_000,
      expectedError: {
        code: 'D360_API_ERROR',
        action: 'Re-run with --json to inspect the structured API error details.',
      },
    }),
    step('connection-update-unsupported', ['connection-get'], {
      command: 'data360 connection update',
      nameFrom: 'connection-get',
      definition: 'connectionUpdate',
      expectedFailure: true,
      expectedError: {
        code: 'D360_UNSUPPORTED_OP',
        action: 'Create a replacement connection or update this connector in Data 360 Setup.',
      },
    }),
    step('stream-list', ['external-stream'], { command: 'data360 data-stream list' }),
    step('stream-get', ['external-stream'], {
      command: 'data360 data-stream get',
      name: external.streamId,
    }),
    step('external-stream-update-safety', ['stream-get'], {
      command: 'data360 data-stream update',
      external: true,
      blocker: 'External stream update is blocked until the live endpoint proves a reversible accepted definition',
    }),
    step('dlo-list', ['external-dlo'], { command: 'data360 dlo list' }),
    step('dlo-get', ['external-dlo'], { command: 'data360 dlo get', name: external.dloName }),
    step('external-dlo-update-safety', ['dlo-get'], {
      command: 'data360 dlo update',
      external: true,
      blocker: 'External DLO update is blocked until the live endpoint proves a reversible accepted definition',
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
      nameFrom: 'registry-dlo-create',
      waitForStatus: 'ACTIVE',
    }),
    step('registry-dlo-update', ['registry-dlo-get'], {
      command: 'data360 dlo update',
      nameFrom: 'registry-dlo-create',
      definition: 'dloUpdate',
      expectedFailure: true,
      expectedError: {
        code: 'D360_API_ERROR',
        apiCode: 'INTERNAL_ERROR',
        action: 'Re-run with --json to inspect the structured API error details.',
      },
    }),
    step('dmo-create', ['dlo-get'], {
      command: 'data360 dmo create',
      creates: names.dmo,
      definition: 'dmo',
      cleanup: ['data360', 'dmo', 'delete', '--name', names.dmo, '--no-prompt'],
      cleanupKeyFields: ['name', 'id'],
    }),
    step('dmo-get', ['dmo-create'], { command: 'data360 dmo get', nameFrom: 'dmo-create' }),
    step('dmo-list', ['dmo-create'], { command: 'data360 dmo list' }),
    step('dmo-update', ['dmo-get'], {
      command: 'data360 dmo update',
      nameFrom: 'dmo-create',
      definition: 'dmoUpdate',
    }),
    step('mapping-auto-dry-run', ['dlo-get', 'dmo-create'], {
      command: 'data360 mapping create',
      args: ['--auto', '--dry-run', '--dlo', external.dloName],
      dmoFrom: 'dmo-create',
      dryRun: true,
    }),
    step('mapping-create', ['dlo-get', 'dmo-create'], {
      command: 'data360 mapping create',
      creates: names.mapping,
      args: ['--auto', '--dlo', external.dloName],
      dmoFrom: 'dmo-create',
      cleanup: ['data360', 'mapping', 'delete', '--name', names.mapping, '--no-prompt'],
      cleanupKeyFields: ['developerName', 'name', 'id'],
    }),
    step('mapping-get', ['mapping-create'], {
      command: 'data360 mapping get',
      nameFrom: 'mapping-create',
      waitForStatus: 'ACTIVE',
    }),
    step('mapping-list', ['mapping-create'], {
      command: 'data360 mapping list',
      args: ['--source-object', external.dloName],
      dmoFrom: 'dmo-create',
    }),
    step('mapping-update-field', ['mapping-get'], {
      command: 'data360 mapping update',
      nameFrom: 'mapping-create',
      definition: 'mappingFields',
    }),
    step('mapping-delete-fields', ['mapping-get'], {
      command: 'data360 mapping delete',
      nameFrom: 'mapping-create',
      fieldFrom: 'mapping-get',
      args: ['--no-prompt'],
    }),
    step('mapping-delete-prompt', ['mapping-get'], {
      command: 'data360 mapping delete',
      nameFrom: 'mapping-create',
      expectedFailure: true,
      expectedError: {
        code: 'D360_CONFIRMATION_REQUIRED',
        action: 'Re-run with --no-prompt.',
      },
    }),
    step('relationship-create', ['mapping-get'], {
      command: 'data360 dmo relationship create',
      creates: names.relationship,
      nameFrom: 'dmo-create',
      definition: 'relationship',
      cleanup: ['data360', 'dmo', 'relationship', 'delete', '--relationship-name', names.relationship, '--no-prompt'],
      cleanupKeyFields: ['name', 'developerName', 'id'],
      cleanupParentName: names.dmo,
    }),
    step('relationship-list', ['relationship-create'], {
      command: 'data360 dmo relationship list',
      nameFrom: 'dmo-create',
    }),
    step('data-space-list', [], { command: 'data360 data-space list' }),
    step('data-space-get', ['data-space-list'], {
      command: 'data360 data-space get',
      selectFirst: true,
    }),
    step('data-space-member-list', ['data-space-get'], {
      command: 'data360 data-space member list',
      nameFrom: 'data-space-get',
    }),
    step('data-space-mutations', ['data-space-list'], {
      command: 'data360 data-space create',
      blocker: 'No data-space delete command exists, so disposable mutation cannot guarantee cleanup',
    }),
    step('transform-list', [], { command: 'data360 transform list' }),
    step('transform-mutations', ['transform-list'], {
      command: 'data360 transform create',
      blocker: 'No verified disposable transform definition is available',
    }),
  ];
};

export const writeP4Definitions = async (directory, prefix, external) => {
  const names = p4Names(prefix);
  const fields = [
    { name: 'event_id', label: 'Event ID', dataType: 'Text', isPrimaryKey: true },
    { name: 'event_time', label: 'Event Time', dataType: 'DateTime', isPrimaryKey: false },
    { name: 'name', label: 'Name', dataType: 'Text', isPrimaryKey: false },
    { name: 'value', label: 'Value', dataType: 'Number', isPrimaryKey: false },
  ];
  const definitions = {
    connectionUpdate: { label: `${prefix.slice(0, 30)} probe` },
    dlo: {
      name: names.registryDlo.replace(/__dll$/u, ''),
      label: `${prefix} registry DLO`,
      category: 'Engagement',
      eventDateTimeFieldName: 'event_time',
      dataLakeFieldInputRepresentations: fields,
    },
    dloUpdate: { label: `${prefix.slice(0, 30)} DLO updated` },
    dmo: {
      name: names.dmo.replace(/__dlm$/u, ''),
      label: `${prefix} event DMO`,
      description: 'Disposable P4 live verification DMO',
      dataSpaceName: 'default',
      category: 'ENGAGEMENT',
      fields: fields.map((field) => ({
        name: `${field.name}__c`,
        label: field.label,
        dataType: field.dataType,
        isPrimaryKey: field.isPrimaryKey,
        isDynamicLookup: false,
      })),
    },
    dmoUpdate: { label: `${prefix.slice(0, 30)} DMO updated` },
    mapping: {
      sourceEntityDeveloperName: names.registryDlo,
      targetEntityDeveloperName: names.dmo,
      fieldMapping: fields.map(({ name }) => ({
        sourceFieldDeveloperName: `${name}__c`,
        targetFieldDeveloperName: `${name}__c`,
      })),
    },
    mappingFields: {
      fieldMappings: [
        {
          name: 'name__c_fieldmap_name__c',
          sourceFieldDeveloperName: 'name__c',
          targetFieldDeveloperName: 'name__c',
        },
      ],
    },
    relationship: {
      relationships: [
        {
          sourceObjectName: names.dmo,
          targetObjectName: 'ssot__Individual__dlm',
          cardinality: 'ManyToOne',
          sourceFieldName: 'event_id__c',
          targetFieldName: 'ssot__Id__c',
          relationshipOwner: 'DataCloud',
        },
      ],
    },
  };
  await mkdir(directory, { recursive: true });
  const files = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const path = resolve(directory, `${name}.json`);
    await writeFile(path, `${JSON.stringify(definition, undefined, 2)}\n`, { mode: 0o600 });
    files[name] = path;
  }
  return files;
};

export const argsForP4Step = (current, files, dynamic = {}) => {
  const args = current.command.split(' ');
  const resolvedName = current.nameFrom ? dynamic.resourceKeys?.[current.nameFrom] : current.name;
  if (resolvedName) args.push('--name', resolvedName);
  if (current.definition) args.push('--file', files[current.definition]);
  if (current.dmoFrom) {
    const dmo = dynamic.resourceNames?.[current.dmoFrom];
    if (!dmo) throw new Error(`No DMO name recorded by ${current.dmoFrom}`);
    args.push('--dmo', dmo);
  }
  if (current.fieldFrom) {
    const field = dynamic.mappingFields?.[current.fieldFrom];
    if (!field) throw new Error(`No mapping field recorded by ${current.fieldFrom}`);
    args.push('--fields', field);
  }
  args.push(...(current.args ?? []));
  return args;
};

export const runP4Scenario = async (options) => {
  const state = await runFoundationScenario(options);
  let changed = false;
  for (const result of [...state.cleanupStack, ...state.cleanup]) {
    if (result.status === 'passed' && 'reason' in result) {
      delete result.reason;
      changed = true;
    }
  }
  if (changed) {
    await writeFile(options.statePath, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
  }
  return state;
};
export const createdP4ResourceKey = cleanupResourceKey;
