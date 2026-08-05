import { defineResource } from './defineResource.js';

export const dmoResource = defineResource({
  topic: 'dmo',
  base: '/data-model-objects',
  nameFields: ['name', 'label', 'developerName'],
  columns: ['name', 'label', 'category', 'mappedDlos#'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  idKind: {
    get: 'idOrApiName',
    update: 'idOrApiName',
    delete: 'idOrApiName',
    relationshipList: 'idOrApiName',
    relationshipCreate: 'idOrApiName',
  },
  actions: {
    relationshipList: { method: 'GET', path: '/data-model-objects/{key}/relationships' },
    relationshipCreate: { method: 'POST', path: '/data-model-objects/{key}/relationships' },
    relationshipDelete: { method: 'DELETE', path: '/data-model-objects/relationships/{relationship}' },
  },
  destructive: { delete: true, relationshipDelete: true },
  pagination: { dialect: 'offset', arrayKey: 'dataModelObjects' },
});
