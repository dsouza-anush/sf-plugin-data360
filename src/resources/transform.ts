import { defineResource } from './defineResource.js';
export const transformResource = defineResource({
  topic: 'transform',
  base: '/data-transforms',
  nameFields: ['name', 'label'],
  columns: ['name', 'label', 'type', 'status'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  operationSpecs: { update: { method: 'PUT', path: '/data-transforms/{key}' } },
  idKind: { get: 'idOrApiName', update: 'idOrApiName', delete: 'idOrApiName', run: 'idOrApiName' },
  actions: {
    run: {
      method: 'POST',
      path: '/data-transforms/{key}/actions/run',
      timeoutMs: 120_000,
      outcomeUnknownRecoveryCommand:
        'Run sf data360 transform report --name <name> --target-org <alias> before retrying.',
    },
    retry: { method: 'POST', path: '/data-transforms/{key}/actions/retry' },
    cancel: { method: 'POST', path: '/data-transforms/{key}/actions/cancel' },
    report: { method: 'POST', path: '/data-transforms/{key}/actions/refresh-status' },
    validate: { method: 'POST', path: '/data-transforms/{key}/actions/validate' },
    history: { method: 'GET', path: '/data-transforms/{key}/run-history' },
    scheduleDisplay: { method: 'GET', path: '/data-transforms/{key}/schedule' },
    scheduleSet: { method: 'PUT', path: '/data-transforms/{key}/schedule' },
  },
  destructive: { delete: true, cancel: true, retry: true },
  billable: { run: 'Data Services' },
  pagination: { dialect: 'offset', arrayKey: 'dataTransforms' },
});
