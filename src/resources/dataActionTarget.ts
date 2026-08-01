import { defineResource } from './defineResource.js';

export const dataActionTargetResource = defineResource({
  topic: 'data-action-target',
  base: '/data-action-targets',
  nameFields: ['apiName', 'label'],
  columns: ['apiName', 'label', 'type', 'status'],
  operationSpecs: {
    list: { method: 'GET', path: '/data-action-targets' },
  },
  pagination: { dialect: 'offset', arrayKey: 'dataActionTargets', pageSizeParameter: 'batchSize' },
});
