import { defineResource } from './defineResource.js';

export const connectorResource = defineResource({
  topic: 'connector',
  base: '/connectors',
  nameFields: ['name', 'label'],
  columns: ['name', 'label', 'category', 'ingestType'],
  operations: ['list', 'get'],
  idKind: { get: 'apiName' },
  pagination: { dialect: 'offset', arrayKey: 'connectors' },
});
