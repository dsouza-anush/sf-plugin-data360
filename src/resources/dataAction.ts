import { defineResource } from './defineResource.js';

export const dataActionResource = defineResource({
  topic: 'data-action',
  base: '/data-actions',
  nameFields: ['developerName', 'dataActionName', 'masterLabel'],
  columns: [
    'developerName',
    'masterLabel',
    'dataActionStatus',
    'dataSpaceDevName',
    'isRealTimeAction',
    'lastActionStatusDateTime',
  ],
  operationSpecs: {
    list: { method: 'GET', path: '/data-actions' },
  },
  pagination: { dialect: 'offset', arrayKey: 'dataActions', pageSizeParameter: 'batchSize' },
});
