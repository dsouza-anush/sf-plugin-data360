import type { HttpMethod } from '../shared/types.js';
import type { ApiRoot } from '../shared/path.js';

export type ResourceOperation = 'list' | 'get' | 'create' | 'update' | 'delete';
export type ResourceAction = ResourceOperation | string;
export type ResourceIdKind = 'id' | 'apiName' | 'idOrApiName';
export type PaginationDialect = 'offset' | 'nextBatchId' | 'nextPageUrl';
export type OperationSpec = {
  method?: HttpMethod;
  path?: string;
  queryParams?: Readonly<Record<string, string | number | boolean>>;
  timeoutMs?: number;
};
export type ActionSpec = OperationSpec & {
  method: HttpMethod;
  path: string;
  outcomeUnknownRecoveryCommand?: string;
  resolveName?: boolean;
};

export type ResourceDefinition = {
  topic: string;
  base: `/${string}`;
  root?: ApiRoot;
  nameFields: readonly string[];
  columns: readonly string[];
  apiNameSuffix?: string;
  numericRanges?: Readonly<Record<string, { min: number; max: number }>>;
  operations?: readonly ResourceOperation[];
  operationSpecs?: Readonly<Record<string, OperationSpec>>;
  idKind?: Readonly<Record<string, ResourceIdKind>>;
  actions?: Readonly<Record<string, string | ActionSpec>>;
  destructive?: Readonly<Record<string, boolean>>;
  billable?: Readonly<Record<string, string>>;
  pagination?: {
    dialect: PaginationDialect;
    arrayKey?: string;
    pageSizeParameter?: 'batchSize' | 'limit';
  };
};
