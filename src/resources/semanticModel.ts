import { defineResource } from './defineResource.js';

export const semanticModelResource = defineResource({
  topic: 'semantic-model',
  base: '/semantic/models',
  nameFields: ['apiName', 'label'],
  columns: ['apiName', 'label', 'dataspace', 'lastModifiedDate'],
  operationSpecs: {
    list: { method: 'GET', path: '/semantic/models' },
  },
  pagination: { dialect: 'offset', arrayKey: 'items' },
});
