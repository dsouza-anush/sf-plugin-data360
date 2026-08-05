import { loadCommandMessages } from '../messages.js';
import { Flags } from '@oclif/core';
import { SfError, type Connection } from '@salesforce/core';
import { Data360Command } from '../command/Data360Command.js';
import { resolveCreditNotices } from '../configMeta.js';
import { csvCell } from '../ux/csv.js';
import { SsotClient } from '../client/ssotClient.js';
import { paginate, type Page } from '../client/pagination.js';
import {
  allFlag,
  apiVersionFlag,
  limitFlag,
  noPromptFlag,
  resultFormatFlag,
  targetOrgFlag,
  timingFlag,
} from '../shared/flags.js';
import { loadDefinition } from '../shared/definitionFile.js';
import { billableNotice } from '../shared/billableNotice.js';
import { resolveResourceKey } from '../shared/nameResolver.js';
import type { ActionSpec, OperationSpec, ResourceDefinition } from './types.js';
import { connectionResource } from './connection.js';
import { activationResource } from './activation.js';
import { activationTargetResource } from './activationTarget.js';
import { calculatedInsightResource } from './calculatedInsight.js';
import { connectorResource } from './connector.js';
import { dloResource } from './dlo.js';
import { dmoResource } from './dmo.js';
import { mappingResource } from './mapping.js';
import { dataStreamResource } from './dataStream.js';
import { transformResource } from './transform.js';
import { dataSpaceResource } from './dataSpace.js';
import { dataGraphResource } from './dataGraph.js';
import { dataKitResource } from './dataKit.js';
import { identityResolutionResource } from './identityResolution.js';
import { metadataResource } from './metadata.js';
import { queryResource } from './query.js';
import { segmentResource } from './segment.js';
import { searchIndexResource } from './searchIndex.js';
import { retrieverResource } from './retriever.js';
import { dataActionResource } from './dataAction.js';
import { dataActionTargetResource } from './dataActionTarget.js';
import { docAiConfigurationResource } from './docAiConfiguration.js';
import { semanticModelResource } from './semanticModel.js';

const runtimeMessages = loadCommandMessages('data360.runtime.resources.registry');
const commonMessages = loadCommandMessages('data360.common');

export class ResourceRegistry {
  private readonly resources = new Map<string, ResourceDefinition>();

  public constructor(resources: readonly ResourceDefinition[] = []) {
    for (const resource of resources) this.register(resource);
  }

  public register(resource: ResourceDefinition): void {
    if (this.resources.has(resource.topic))
      throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0', [String(resource.topic)]));
    this.resources.set(resource.topic, resource);
  }

  public get(topic: string): ResourceDefinition {
    const resource = this.resources.get(topic);
    if (!resource) throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1', [String(topic)]));
    return resource;
  }

  public list(): ResourceDefinition[] {
    return [...this.resources.values()];
  }
}

export const registry = new ResourceRegistry([
  queryResource,
  metadataResource,
  connectionResource,
  connectorResource,
  dloResource,
  dmoResource,
  mappingResource,
  dataStreamResource,
  transformResource,
  dataSpaceResource,
  identityResolutionResource,
  calculatedInsightResource,
  segmentResource,
  activationResource,
  activationTargetResource,
  searchIndexResource,
  dataGraphResource,
  dataKitResource,
  retrieverResource,
  docAiConfigurationResource,
  semanticModelResource,
  dataActionResource,
  dataActionTargetResource,
]);

type RegistryOperation = 'list' | 'get' | 'create' | 'update' | 'delete' | 'action';
type RegistryCommandHelp =
  | { messages: ReturnType<typeof loadCommandMessages>; summary?: never; description?: never; examples?: never }
  | { messages?: never; summary: string; description?: string; examples?: string[] };
type RegistryCommandOptions = RegistryCommandHelp & {
  resource: ResourceDefinition;
  operation: RegistryOperation;
  action?: string;
};
type RegistryItem = Record<string, unknown>;
type RegistryResponse = RegistryItem | RegistryItem[];
type RegistryFlag =
  | typeof targetOrgFlag
  | typeof apiVersionFlag
  | typeof timingFlag
  | typeof allFlag
  | typeof limitFlag
  | typeof resultFormatFlag
  | typeof noPromptFlag
  | ReturnType<typeof Flags.string>;

const operationMethod = (operation: RegistryOperation): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' => {
  if (operation === 'list' || operation === 'get') return 'GET';
  if (operation === 'create' || operation === 'action') return 'POST';
  if (operation === 'update') return 'PATCH';
  return 'DELETE';
};

const asRecord = (value: unknown): RegistryItem =>
  typeof value === 'object' && value !== null ? (value as RegistryItem) : {};

const extractItems = (value: unknown, arrayKey?: string): RegistryItem[] => {
  if (Array.isArray(value)) return value.map(asRecord);
  const response = asRecord(value);
  if (arrayKey && Array.isArray(response[arrayKey])) return (response[arrayKey] as unknown[]).map(asRecord);
  const collection = asRecord(response.collection);
  if (Array.isArray(collection.items)) return (collection.items as unknown[]).map(asRecord);
  const array = Object.values(response).find(Array.isArray);
  return Array.isArray(array) ? array.map(asRecord) : [];
};

const deriveColumns = (item: RegistryItem, columns: readonly string[]): RegistryItem => {
  const result = { ...item };
  for (const column of columns) {
    if (!column.endsWith('#') || result[column] !== undefined) continue;
    const value = result[column.slice(0, -1)];
    if (Array.isArray(value)) result[column] = value.length;
  }
  return result;
};

class RegistryService {
  public constructor(
    private readonly resource: ResourceDefinition,
    private readonly client: SsotClient
  ) {}

  public async list(options: { all?: boolean; limit?: number } = {}): Promise<RegistryItem[]> {
    const specification = this.resource.operationSpecs?.list;
    const limit = options.all ? Number.POSITIVE_INFINITY : (options.limit ?? 100);
    const iterator = paginate<RegistryItem>(
      async ({ offset, pageSize, cursor, nextPageUrl }): Promise<Page<RegistryItem>> => {
        const query: Record<string, string | number | boolean | undefined> = {
          ...specification?.queryParams,
        };
        if (!nextPageUrl) {
          if (this.resource.pagination?.dialect === 'nextBatchId') {
            query.batchSize = pageSize;
            query.limit = pageSize;
            query.nextBatchId = cursor;
          } else if (this.resource.pagination?.dialect !== 'nextPageUrl') {
            query.offset = offset;
            query[this.resource.pagination?.pageSizeParameter ?? 'limit'] = pageSize;
          }
        }
        const response = await this.client.request<unknown>({
          method: specification?.method ?? 'GET',
          endpoint: nextPageUrl ?? specification?.path ?? this.resource.base,
          query,
          root: this.resource.root,
        });
        const record = asRecord(response);
        const collection = asRecord(record.collection);
        return {
          data: extractItems(response, this.resource.pagination?.arrayKey).map((item) =>
            deriveColumns(item, this.resource.columns)
          ),
          totalSize:
            typeof record.totalSize === 'number'
              ? record.totalSize
              : typeof record.total === 'number'
                ? record.total
                : typeof collection.totalSize === 'number'
                  ? collection.totalSize
                  : typeof collection.total === 'number'
                    ? collection.total
                    : undefined,
          nextBatchId:
            typeof record.nextBatchId === 'string'
              ? record.nextBatchId
              : typeof collection.nextBatchId === 'string'
                ? collection.nextBatchId
                : undefined,
          nextPageUrl:
            typeof record.nextPageUrl === 'string'
              ? record.nextPageUrl
              : typeof collection.nextPageUrl === 'string'
                ? collection.nextPageUrl
                : undefined,
        };
      },
      { pageSize: Math.min(Number.isFinite(limit) ? limit : 200, 200), limit }
    );
    const items: RegistryItem[] = [];
    for await (const item of iterator) items.push(item);
    return items;
  }

  public async execute(
    operation: Exclude<RegistryOperation, 'list'>,
    options: { name?: string; body?: RegistryItem; action?: string }
  ): Promise<RegistryResponse | undefined> {
    const operationName = operation === 'action' ? options.action! : operation;
    const specification =
      operation === 'action' ? this.resource.actions?.[operationName] : this.resource.operationSpecs?.[operationName];
    const normalizedSpecification = (typeof specification === 'string' ? { path: specification } : specification) as
      ActionSpec | OperationSpec | undefined;
    const actionSpecification =
      operation === 'action' ? (normalizedSpecification as ActionSpec | undefined) : undefined;
    let key: string | undefined;
    if (options.name) {
      key =
        actionSpecification?.resolveName === false
          ? options.name
          : await resolveResourceKey(options.name, {
              idKind: this.resource.idKind?.[operationName] ?? 'idOrApiName',
              nameFields: this.resource.nameFields,
              list: async () => this.list({ all: true }),
            });
    }
    const suffix = this.resource.apiNameSuffix;
    if (suffix && key && !key.endsWith(suffix)) {
      throw new SfError(
        runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.2', [String(suffix)]),
        'D360_INVALID_DEFINITION',
        [runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.2.actions.1', [String(suffix)])]
      );
    }
    if (suffix && options.body) {
      const apiName = options.body.apiName ?? options.body.name;
      if (typeof apiName === 'string' && !apiName.endsWith(suffix)) {
        throw new SfError(
          runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.3', [String(suffix)]),
          'D360_INVALID_DEFINITION',
          [runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.3.actions.1', [String(suffix)])]
        );
      }
    }
    if (options.body && this.resource.numericRanges) {
      for (const [field, range] of Object.entries(this.resource.numericRanges)) {
        const value = options.body[field];
        if (value !== undefined && (typeof value !== 'number' || value < range.min || value > range.max)) {
          throw new SfError(
            runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.4', [
              String(field),
              String(range.min),
              String(range.max),
            ]),
            'D360_INVALID_DEFINITION',
            [
              runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.4.actions.1', [
                String(field),
                String(range.min),
                String(range.max),
              ]),
            ]
          );
        }
      }
    }
    const defaultPath =
      operation === 'create'
        ? this.resource.base
        : operation === 'action'
          ? `${this.resource.base}/{key}/${normalizedSpecification?.path ?? operationName}`
          : `${this.resource.base}/{key}`;
    const endpoint = (normalizedSpecification?.path ?? defaultPath).replace('{key}', encodeURIComponent(key ?? ''));
    return this.client.request<RegistryResponse | undefined>({
      method: normalizedSpecification?.method ?? operationMethod(operation),
      endpoint,
      body: options.body,
      query: normalizedSpecification?.queryParams,
      root: this.resource.root,
      timeoutMs: normalizedSpecification?.timeoutMs,
      errorContext: actionSpecification?.outcomeUnknownRecoveryCommand
        ? {
            actionTimeout: {
              label: `${this.resource.topic.replaceAll('-', ' ')} ${operationName}`,
              recoveryCommand: actionSpecification.outcomeUnknownRecoveryCommand,
            },
          }
        : undefined,
    });
  }
}

const flagsFor = (options: RegistryCommandOptions): Record<string, RegistryFlag> => ({
  'target-org': targetOrgFlag,
  'api-version': apiVersionFlag,
  timing: timingFlag,
  ...(options.operation === 'list' ? { all: allFlag, limit: limitFlag, 'result-format': resultFormatFlag } : {}),
  ...(['get', 'update', 'delete', 'action'].includes(options.operation)
    ? {
        name: Flags.string({
          char: 'n',
          required: true,
          summary: commonMessages.getMessage('flags.name.summary'),
        }),
      }
    : {}),
  ...(['create', 'update'].includes(options.operation)
    ? {
        file: Flags.string({
          char: 'f',
          required: true,
          summary: commonMessages.getMessage('flags.file.summary'),
        }),
      }
    : {}),
  ...(options.operation === 'delete' ||
  (options.operation === 'action' &&
    (options.resource.destructive?.[options.action ?? ''] || options.resource.billable?.[options.action ?? '']))
    ? { 'no-prompt': noPromptFlag }
    : {}),
});

export const createRegistryCommand = (
  options: RegistryCommandOptions
): { run: (argv?: string[]) => Promise<unknown> } => {
  class RegistryLeaf extends Data360Command<unknown> {
    public static readonly summary = options.messages?.getMessage('summary') ?? options.summary;
    public static readonly description =
      options.messages?.getMessage('description') ?? options.description ?? options.summary;
    public static readonly examples = options.messages?.getMessages('examples') ?? options.examples ?? [];
    public static readonly enableJsonFlag = true;
    public static readonly flags = flagsFor(options);

    public async run(): Promise<unknown> {
      type RuntimeFlags = {
        'target-org': { getConnection: (version?: string) => Promise<Connection> };
        'api-version'?: string;
        'result-format'?: 'human' | 'csv' | 'json';
        'no-prompt'?: boolean;
        timing?: boolean;
        all?: boolean;
        limit?: number;
        name?: string;
        file?: string;
      };
      const initialized = await this.initializeTiming<{ flags: RuntimeFlags }, Connection>({
        parse: async () => (await this.parse(RegistryLeaf as never)) as unknown as { flags: RuntimeFlags },
        connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
        timingSelected: ({ flags }) => Boolean(flags.timing),
      });
      const { flags } = initialized.parsed;
      const client = new RegistryService(
        options.resource,
        new SsotClient(
          initialized.connection,
          flags['api-version'] ?? initialized.connection.version,
          initialized.requestTiming
        )
      );
      let result: unknown;
      if (options.operation === 'list') {
        const items = await client.list({ all: Boolean(flags.all), limit: flags.limit as number });
        result = { items };
        if (!this.jsonEnabled() && flags['result-format'] === 'human') {
          this.table({ data: items, columns: [...options.resource.columns] });
        } else if (!this.jsonEnabled() && flags['result-format'] === 'json') {
          process.stdout.write(`${JSON.stringify(items, undefined, 2)}\n`);
        } else if (!this.jsonEnabled()) {
          const columns = options.resource.columns;
          process.stdout.write(
            `${[columns, ...items.map((item) => columns.map((column) => item[column]))]
              .map((row) => row.map(csvCell).join(','))
              .join('\r\n')}\r\n`
          );
        }
        return result;
      }

      const actionRequiresConfirmation =
        options.operation === 'action' &&
        Boolean(
          options.resource.destructive?.[options.action ?? ''] || options.resource.billable?.[options.action ?? '']
        );
      if (options.operation === 'delete' || actionRequiresConfirmation) {
        await this.confirmDestructive(
          Boolean(flags['no-prompt']),
          options.operation === 'delete'
            ? runtimeMessages.getMessage('runtime.confirmDestructive.5', [
                String(options.resource.topic),
                String(flags.name),
              ])
            : runtimeMessages.getMessage('runtime.confirmAction.7', [
                String(options.action),
                String(options.resource.topic),
                String(flags.name),
              ])
        );
      }
      if (
        options.operation === 'action' &&
        options.resource.billable?.[options.action ?? ''] &&
        !this.jsonEnabled() &&
        (await resolveCreditNotices())
      ) {
        this.status(billableNotice(String(options.resource.billable[options.action ?? ''])));
      }
      const body =
        options.operation === 'create' || options.operation === 'update'
          ? await loadDefinition(flags.file as string)
          : undefined;
      const response = await client.execute(options.operation, {
        name: flags.name as string | undefined,
        body,
        action: options.action,
      });
      if (options.operation === 'delete') return { deleted: true, key: flags.name };
      return { item: response };
    }
  }

  return RegistryLeaf;
};
