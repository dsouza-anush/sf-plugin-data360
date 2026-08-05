import { defineResource } from './defineResource.js';

export const dataGraphResource = defineResource({
  topic: 'data-graph',
  base: '/data-graphs',
  nameFields: ['dataGraphName', 'developerName', 'name', 'displayName', 'label'],
  columns: ['dataGraphName', 'displayName', 'dataGraphEntityName', 'status', 'lastRefreshDate'],
  operations: ['list', 'get', 'create', 'delete'],
  operationSpecs: { list: { method: 'GET', path: '/data-graphs/metadata' } },
  idKind: { get: 'apiName', delete: 'apiName', refresh: 'apiName' },
  actions: {
    refresh: {
      method: 'POST',
      path: '/data-graphs/{key}/actions/refresh',
      resolveName: false,
      timeoutMs: 120_000,
      outcomeUnknownRecoveryCommand:
        'Run sf data360 data-graph get --name <name> --target-org <alias> before retrying.',
    },
  },
  destructive: { delete: true },
  billable: { refresh: 'Data Services' },
  pagination: { dialect: 'offset', arrayKey: 'dataGraphs' },
});
