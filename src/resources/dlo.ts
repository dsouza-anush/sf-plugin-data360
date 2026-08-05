import { defineResource } from './defineResource.js';

export const dloResource = defineResource({
  topic: 'dlo',
  base: '/data-lake-objects',
  nameFields: ['name', 'label', 'developerName'],
  columns: ['name', 'label', 'category', 'storageType'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  idKind: {
    get: 'idOrApiName',
    update: 'idOrApiName',
    delete: 'idOrApiName',
  },
  destructive: { delete: true },
  pagination: { dialect: 'offset', arrayKey: 'dataLakeObjects' },
});
