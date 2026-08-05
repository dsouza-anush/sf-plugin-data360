import { defineResource } from './defineResource.js';

export const calculatedInsightResource = defineResource({
  topic: 'calculated-insight',
  base: '/calculated-insights',
  nameFields: ['apiName', 'displayName'],
  columns: ['apiName', 'displayName', 'status', 'lastRunStatus'],
  apiNameSuffix: '__cio',
  operations: ['list', 'get', 'create', 'update', 'delete'],
  idKind: {
    get: 'apiName',
    update: 'apiName',
    delete: 'apiName',
    run: 'apiName',
  },
  actions: {
    run: { method: 'POST', path: '/calculated-insights/{key}/actions/run' },
  },
  destructive: { delete: true },
  billable: { run: 'Calculated Insights' },
  pagination: { dialect: 'offset', arrayKey: 'calculatedInsights' },
});
