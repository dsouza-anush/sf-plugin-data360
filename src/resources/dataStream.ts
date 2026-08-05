import { defineResource } from './defineResource.js';

export const dataStreamResource = defineResource({
  topic: 'data-stream',
  base: '/data-streams',
  nameFields: ['name', 'label', 'developerName'],
  columns: ['name', 'label', 'connectorType', 'refreshMode', 'lastRunStatus', 'lastRunTime'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  idKind: { get: 'idOrApiName', update: 'idOrApiName', delete: 'idOrApiName', run: 'idOrApiName' },
  actions: {
    run: {
      method: 'POST',
      path: '/data-streams/{key}/actions/run',
      timeoutMs: 120_000,
      outcomeUnknownRecoveryCommand:
        'Run sf data360 data-stream get --name <name> --target-org <alias> before retrying.',
    },
  },
  destructive: { delete: true },
  billable: { run: 'Data Services' },
  pagination: { dialect: 'offset', arrayKey: 'dataStreams' },
});
