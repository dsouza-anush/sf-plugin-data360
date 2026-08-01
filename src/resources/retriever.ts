import { defineResource } from './defineResource.js';

export const retrieverResource = defineResource({
  topic: 'retriever',
  base: '/machine-learning/retrievers',
  idField: 'name',
  idKind: { get: 'idOrApiName' },
  nameFields: ['name', 'label'],
  columns: ['name', 'label', 'dataSourceType', 'isGlobal', 'isDefault'],
  pagination: { dialect: 'offset', arrayKey: 'retrievers' },
  operationSpecs: {
    list: { method: 'GET', path: '/machine-learning/retrievers' },
    get: { method: 'GET', path: '/machine-learning/retrievers/{key}' },
  },
});
