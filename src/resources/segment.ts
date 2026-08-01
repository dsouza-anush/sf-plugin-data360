import { defineResource } from './defineResource.js';

export const segmentResource = defineResource({
  topic: 'segment',
  base: '/segments',
  nameFields: ['segmentApiName', 'apiName', 'displayName'],
  columns: ['segmentApiName', 'displayName', 'segmentType', 'publishStatus', 'lastPublishedDate'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  idKind: {
    get: 'idOrApiName',
    update: 'apiName',
    delete: 'apiName',
    count: 'apiName',
    publish: 'id',
    deactivate: 'apiName',
  },
  actions: {
    publish: { method: 'POST', path: '/segments/{key}/actions/publish' },
    deactivate: { method: 'POST', path: '/segments/{key}/actions/deactivate' },
    count: { method: 'POST', path: '/segments/{key}/actions/count' },
  },
  destructive: { delete: true, deactivate: true },
  billable: { publish: 'Segmentation & Activation' },
  pagination: { dialect: 'offset', arrayKey: 'segments' },
});
