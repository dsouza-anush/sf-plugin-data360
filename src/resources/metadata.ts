import { defineResource } from './defineResource.js';

export const metadataResource = defineResource({
  topic: 'metadata',
  base: '/metadata',
  nameFields: ['name', 'displayName'],
  columns: ['name', 'displayName', 'entityCategory', 'entityType'],
  operations: ['list', 'get'],
});
