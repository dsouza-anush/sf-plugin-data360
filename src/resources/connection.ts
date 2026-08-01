import { defineResource } from './defineResource.js';

export const connectionResource = defineResource({
  topic: 'connection',
  base: '/connections',
  nameFields: ['name', 'label'],
  columns: ['name', 'label', 'connectorType', 'status', 'lastUpdated'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  operationSpecs: {
    list: { method: 'GET', queryParams: { connectorType: '{connectorType}' } },
    update: { method: 'PATCH', path: '/connections/{key}' },
  },
  idKind: {
    get: 'id',
    update: 'id',
    delete: 'id',
    validateExisting: 'id',
  },
  actions: {
    validateExisting: { method: 'POST', path: '/connections/{key}/actions/test' },
    validateCandidate: { method: 'POST', path: '/connections/actions/test' },
  },
  destructive: { delete: true },
  pagination: { dialect: 'offset', arrayKey: 'connections' },
});
