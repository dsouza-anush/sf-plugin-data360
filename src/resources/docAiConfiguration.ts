import { defineResource } from './defineResource.js';

export const docAiConfigurationResource = defineResource({
  topic: 'docai-config',
  base: '/document-processing/configurations',
  nameFields: ['name', 'label'],
  columns: ['name', 'label', 'activationStatus', 'status', 'lastModifiedDate'],
  operationSpecs: {
    list: { method: 'GET', path: '/document-processing/configurations' },
  },
  pagination: { dialect: 'offset', arrayKey: 'configurations' },
});
