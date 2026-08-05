import { defineResource } from './defineResource.js';

export const queryResource = defineResource({
  topic: 'query',
  base: '/query-sql',
  nameFields: ['queryId'],
  columns: ['queryId', 'status'],
  operations: ['get', 'create', 'delete'],
});
