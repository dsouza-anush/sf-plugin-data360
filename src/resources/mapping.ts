import { defineResource } from './defineResource.js';

export const mappingResource = defineResource({
  topic: 'mapping',
  base: '/data-model-object-mappings',
  nameFields: ['developerName', 'name', 'label'],
  columns: ['developerName', 'sourceEntityDeveloperName', 'targetEntityDeveloperName', 'status', 'fieldMappings#'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  idKind: { get: 'apiName', update: 'apiName', delete: 'apiName' },
  actions: {
    updateField: {
      method: 'PATCH',
      path: '/data-model-object-mappings/{key}/field-mappings/{field}',
    },
    deleteFields: {
      method: 'DELETE',
      path: '/data-model-object-mappings/{key}/field-mappings/{field}',
    },
  },
  destructive: { delete: true, deleteFields: true },
  pagination: { dialect: 'offset', arrayKey: 'dataModelObjectMappings' },
});
