import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDirectory = resolve(root, 'schemas');
const errorCodes = [
  'D360_API_ERROR',
  'D360_AUTH_EXPIRED',
  'D360_CONFIRMATION_REQUIRED',
  'D360_ECA_CREATE_FAILED',
  'D360_ECA_INVALID_NAME',
  'D360_ECA_OAUTH_FAILED',
  'D360_INVALID_DEFINITION',
  'D360_JOB_FAILED',
  'D360_JOB_TIMEOUT',
  'D360_NAME_AMBIGUOUS',
  'D360_NAME_NOT_FOUND',
  'D360_NOT_FOUND',
  'D360_NOT_PROVISIONED',
  'D360_QUERY_SYNTAX',
  'D360_RATE_LIMITED',
  'D360_SCOPE_MISSING',
  'D360_TOKEN_EXCHANGE_FAILED',
  'D360_UNSUPPORTED_OP',
];

const column = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type'],
  properties: { name: { type: 'string' }, type: { type: 'string' } },
};

const queryResult = {
  type: 'object',
  additionalProperties: false,
  required: ['queryId', 'status', 'done'],
  properties: {
    queryId: { type: 'string' },
    status: { type: 'string' },
    done: { type: 'boolean' },
    rowCount: { type: 'integer', minimum: 0 },
    columns: { type: 'array', items: column },
    rows: { type: 'array', items: { type: 'array' } },
  },
};

const entity = {
  type: 'object',
  additionalProperties: true,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    displayName: { type: 'string' },
    category: { type: 'string' },
    type: { type: 'string' },
    fields: { type: 'array', items: { type: 'object', additionalProperties: true } },
    relationships: { type: 'array', items: { type: 'object', additionalProperties: true } },
    primaryKeys: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};

const check = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'status', 'detail'],
  properties: {
    name: { type: 'string' },
    status: { enum: ['pass', 'warn', 'fail'] },
    detail: { type: 'string' },
    action: { type: 'string' },
  },
};

const ingestJob = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'state'],
  properties: {
    id: { type: 'string' },
    state: { type: 'string' },
    recordsProcessed: { type: 'integer', minimum: 0 },
    recordsFailed: { type: 'integer', minimum: 0 },
  },
};
const ingestCancel = {
  ...ingestJob,
  required: [...ingestJob.required, 'cancelled'],
  properties: { ...ingestJob.properties, cancelled: { type: 'boolean' } },
};
const registryItem = { type: 'object', additionalProperties: true };
const registryList = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: registryItem } },
};
const registrySingle = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: { item: registryItem },
};
const namedRegistryItem = {
  type: 'object',
  additionalProperties: true,
  required: ['name'],
  properties: { name: { type: 'string' } },
};
const namedRegistrySingle = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: { item: namedRegistryItem },
};
const developerNamedRegistrySingle = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      type: 'object',
      additionalProperties: true,
      required: ['developerName'],
      properties: { developerName: { type: 'string' } },
    },
  },
};
const relationshipsRegistrySingle = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      type: 'object',
      additionalProperties: true,
      required: ['relationships'],
      properties: {
        relationships: { type: 'array', items: namedRegistryItem },
      },
    },
  },
};
const statusRegistrySingle = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      type: 'object',
      additionalProperties: true,
      required: ['status'],
      properties: { status: { type: 'string' } },
    },
  },
};
const calculatedInsightRun = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: true,
          required: ['status'],
          properties: { status: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: true,
          required: ['success', 'errors'],
          properties: {
            success: { type: 'boolean' },
            errors: { type: 'array', items: {} },
          },
        },
      ],
    },
  },
};
const dataKitAsync = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: registryItem,
    jobId: { type: 'string' },
  },
};

const results = {
  'error-codes': {
    type: 'string',
    enum: errorCodes,
  },
  'data360.query': queryResult,
  'data360.query.resume': queryResult,
  'data360.query.results': queryResult,
  'data360.query.cancel': {
    type: 'object',
    additionalProperties: false,
    required: ['queryId', 'cancelled'],
    properties: { queryId: { type: 'string' }, cancelled: { const: true } },
  },
  'data360.query.vector': queryResult,
  'data360.query.hybrid': queryResult,
  'data360.metadata.list': {
    type: 'object',
    additionalProperties: false,
    required: ['entities'],
    properties: { entities: { type: 'array', items: entity } },
  },
  'data360.metadata.get': entity,
  'data360.open': {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: { url: { type: 'string', format: 'uri' } },
  },
  'data360.token.display': {
    type: 'object',
    additionalProperties: false,
    required: ['accessToken', 'instanceUrl', 'expiresAt', 'scopes'],
    properties: {
      accessToken: { type: 'string' },
      instanceUrl: { type: 'string', format: 'uri' },
      expiresAt: { type: 'string', format: 'date-time' },
      scopes: { type: 'array', items: { type: 'string' } },
    },
  },
  'data360.doctor': {
    type: 'object',
    additionalProperties: false,
    required: ['checks'],
    properties: { checks: { type: 'array', minItems: 8, maxItems: 8, items: check } },
  },
  'data360.ingest': {
    type: 'object',
    additionalProperties: false,
    required: ['accepted', 'batches'],
    properties: { accepted: { type: 'integer', minimum: 0 }, batches: { type: 'integer', minimum: 0 } },
  },
  'data360.ingest.validate': {
    type: 'object',
    additionalProperties: false,
    required: ['valid', 'records'],
    properties: { valid: { const: true }, records: { type: 'integer', minimum: 0 } },
  },
  'data360.ingest.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['accepted'],
    properties: { accepted: { type: 'boolean' } },
  },
  'data360.ingest.bulk': ingestJob,
  'data360.ingest.report': ingestJob,
  'data360.ingest.resume': ingestJob,
  'data360.ingest.cancel': ingestCancel,
  'data360.connection.list': registryList,
  'data360.connection.get': registrySingle,
  'data360.connection.create': namedRegistrySingle,
  'data360.connection.update': namedRegistrySingle,
  'data360.connection.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'id'],
    properties: { deleted: { const: true }, id: { type: 'string' } },
  },
  'data360.connection.validate': {
    type: 'object',
    additionalProperties: false,
    required: ['result'],
    properties: { result: registryItem },
  },
  'data360.connection.describe': {
    type: 'object',
    additionalProperties: false,
    required: ['sections'],
    properties: { sections: registryItem },
  },
  'data360.connector.list': registryList,
  'data360.connector.get': registrySingle,
  'data360.dlo.list': registryList,
  'data360.dlo.get': registrySingle,
  'data360.dlo.create': namedRegistrySingle,
  'data360.dlo.update': namedRegistrySingle,
  'data360.dlo.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'key'],
    properties: { deleted: { const: true }, key: { type: 'string' } },
  },
  'data360.dmo.list': registryList,
  'data360.dmo.get': registrySingle,
  'data360.dmo.create': namedRegistrySingle,
  'data360.dmo.update': namedRegistrySingle,
  'data360.dmo.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'key'],
    properties: { deleted: { const: true }, key: { type: 'string' } },
  },
  'data360.dmo.relationship.list': registryList,
  'data360.dmo.relationship.create': relationshipsRegistrySingle,
  'data360.dmo.relationship.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'relationshipName'],
    properties: { deleted: { const: true }, relationshipName: { type: 'string' } },
  },
  'data360.mapping.list': registryList,
  'data360.mapping.get': registrySingle,
  'data360.mapping.create': {
    oneOf: [
      developerNamedRegistrySingle,
      {
        type: 'object',
        required: ['mappings', 'unmapped', 'ambiguous', 'created'],
        properties: {
          mappings: { type: 'array', items: registryItem },
          unmapped: { type: 'array', items: { type: 'string' } },
          ambiguous: { type: 'array', items: { type: 'string' } },
          created: { type: 'boolean' },
        },
      },
    ],
  },
  'data360.mapping.update': {
    type: 'object',
    required: ['outcomes'],
    properties: { outcomes: { type: 'array', items: registryItem } },
  },
  'data360.mapping.delete': {
    type: 'object',
    required: ['deleted', 'name'],
    properties: {
      deleted: { const: true },
      name: { type: 'string' },
      fields: { type: 'array', items: { type: 'string' } },
    },
  },
  'data360.data-stream.list': registryList,
  'data360.data-stream.get': registrySingle,
  'data360.data-stream.create': namedRegistrySingle,
  'data360.data-stream.update': namedRegistrySingle,
  'data360.data-stream.delete': {
    type: 'object',
    required: ['deleted', 'deleteDlo'],
    properties: { deleted: { const: true }, deleteDlo: { type: 'boolean' } },
  },
  'data360.data-stream.run': statusRegistrySingle,
  'data360.transform.list': registryList,
  'data360.transform.get': registrySingle,
  'data360.transform.create': namedRegistrySingle,
  'data360.transform.update': namedRegistrySingle,
  'data360.transform.delete': registryItem,
  'data360.transform.run': statusRegistrySingle,
  'data360.transform.retry': statusRegistrySingle,
  'data360.transform.cancel': {
    type: 'object',
    required: ['cancelled', 'name'],
    properties: { cancelled: { const: true }, name: { type: 'string' } },
  },
  'data360.transform.report': {
    type: 'object',
    required: ['item'],
    properties: { item: registryItem, history: {} },
  },
  'data360.transform.validate': statusRegistrySingle,
  'data360.transform.schedule.display': registrySingle,
  'data360.transform.schedule.set': registrySingle,
  'data360.data-space.list': registryList,
  'data360.data-space.get': registrySingle,
  'data360.data-space.create': namedRegistrySingle,
  'data360.data-space.update': namedRegistrySingle,
  'data360.data-space.member.list': registryList,
  'data360.data-space.member.set': registryList,
  'data360.identity-resolution.list': registryList,
  'data360.identity-resolution.get': registrySingle,
  'data360.identity-resolution.create': registrySingle,
  'data360.identity-resolution.update': registrySingle,
  'data360.identity-resolution.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'key'],
    properties: { deleted: { const: true }, key: { type: 'string' } },
  },
  'data360.identity-resolution.run': statusRegistrySingle,
  'data360.calculated-insight.list': registryList,
  'data360.calculated-insight.get': registrySingle,
  'data360.calculated-insight.create': registrySingle,
  'data360.calculated-insight.update': registrySingle,
  'data360.calculated-insight.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'key'],
    properties: { deleted: { const: true }, key: { type: 'string' } },
  },
  'data360.calculated-insight.run': calculatedInsightRun,
  'data360.calculated-insight.query': registrySingle,
  'data360.segment.list': registryList,
  'data360.segment.get': {
    type: 'object',
    additionalProperties: false,
    required: ['item'],
    properties: { item: registryItem, count: {} },
  },
  'data360.segment.create': registrySingle,
  'data360.segment.update': registrySingle,
  'data360.segment.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'key'],
    properties: { deleted: { const: true }, key: { type: 'string' } },
  },
  'data360.segment.publish': {
    type: 'object',
    additionalProperties: false,
    required: ['item'],
    properties: { item: registryItem, segment: registryItem },
  },
  'data360.segment.deactivate': registrySingle,
  'data360.activation.list': registryList,
  'data360.activation.get': registrySingle,
  'data360.activation.create': registrySingle,
  'data360.activation.update': registrySingle,
  'data360.activation.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'key'],
    properties: { deleted: { const: true }, key: { type: 'string' } },
  },
  'data360.activation.results': registrySingle,
  'data360.activation.platforms': registryList,
  'data360.activation-target.list': registryList,
  'data360.activation-target.get': registrySingle,
  'data360.activation-target.create': registrySingle,
  'data360.activation-target.update': registrySingle,
  'data360.search-index.list': registryList,
  'data360.search-index.get': registrySingle,
  'data360.search-index.create': registrySingle,
  'data360.search-index.update': registrySingle,
  'data360.search-index.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'key'],
    properties: { deleted: { const: true }, key: { type: 'string' } },
  },
  'data360.search-index.describe': registrySingle,
  'data360.data-graph.list': registryList,
  'data360.data-graph.get': registrySingle,
  'data360.data-graph.create': registrySingle,
  'data360.data-graph.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'key'],
    properties: { deleted: { const: true }, key: { type: 'string' } },
  },
  'data360.data-graph.refresh': registrySingle,
  'data360.data-graph.query': {
    type: 'object',
    additionalProperties: false,
    required: ['item'],
    properties: { item: registryItem, outputFile: { type: 'string' } },
  },
  'data360.profile.get': registrySingle,
  'data360.profile.describe': registrySingle,
  'data360.profile.lookup': registrySingle,
  'data360.retriever.list': registryList,
  'data360.retriever.get': registrySingle,
  'data360.retriever.configuration.list': registryList,
  'data360.docai.describe': registrySingle,
  'data360.docai.config.list': registryList,
  'data360.semantic.model.list': registryList,
  'data360.data-action.list': registryList,
  'data360.data-action-target.list': registryList,
  'data360.data-kit.list': registryList,
  'data360.data-kit.available': registryList,
  'data360.data-kit.manifest': registryList,
  'data360.data-kit.create': registrySingle,
  'data360.data-kit.update': registrySingle,
  'data360.data-kit.delete': {
    type: 'object',
    additionalProperties: false,
    required: ['deleted', 'name'],
    properties: { deleted: { const: true }, name: { type: 'string' } },
  },
  'data360.data-kit.deploy': dataKitAsync,
  'data360.data-kit.undeploy': dataKitAsync,
  'data360.data-kit.component.dependencies': registryList,
  'data360.data-kit.component.status': registrySingle,
  'data360.setup.eca': {
    type: 'object',
    additionalProperties: false,
    required: ['appName', 'consumerKey', 'instanceUrl', 'scopes', 'created', 'reauthorizeCommand'],
    properties: {
      appName: { type: 'string' },
      consumerKey: { type: ['string', 'null'] },
      instanceUrl: { type: 'string', format: 'uri' },
      scopes: { type: 'array', items: { type: 'string' } },
      created: { type: 'boolean' },
      reauthorizeCommand: { type: 'string' },
    },
  },
};

const envelope = (id, result) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `urn:sf-plugin-data360:schema:${id}`,
  title: `${id} JSON output`,
  type: 'object',
  additionalProperties: false,
  required: ['status', 'result', 'warnings'],
  properties: {
    status: { type: 'integer' },
    result,
    warnings: { type: 'array', items: { type: 'string' } },
  },
});

await mkdir(schemaDirectory, { recursive: true });
const checkMode = process.argv.includes('--check');
await Promise.all(
  Object.entries(results).map(async ([id, result]) => {
    const path = resolve(schemaDirectory, `${id}.json`);
    const schema =
      id === 'error-codes'
        ? {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $id: 'urn:sf-plugin-data360:schema:error-codes',
            title: 'Data 360 public error codes',
            ...result,
          }
        : envelope(id, result);
    const expected = await format(JSON.stringify(schema), { parser: 'json', printWidth: 120 });
    if (checkMode) {
      const actual = await readFile(path, 'utf8');
      if (actual !== expected) throw new Error(`${path} is stale. Run yarn schemas:generate.`);
    } else {
      await writeFile(path, expected);
    }
  })
);
if (checkMode) process.stdout.write('Command schemas are fresh.\n');
