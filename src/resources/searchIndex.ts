import { defineResource } from './defineResource.js';

export const searchIndexResource = defineResource({
  topic: 'search-index',
  base: '/search-index',
  nameFields: ['developerName', 'displayName'],
  columns: ['developerName', 'displayName', 'runtimeStatus', 'searchType', 'sourceDmoDeveloperName'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  idKind: { get: 'idOrApiName', update: 'idOrApiName', delete: 'id', describe: 'idOrApiName' },
  actions: { describe: { method: 'GET', path: '/search-index/{key}' } },
  destructive: { delete: true },
  pagination: { dialect: 'offset', arrayKey: 'semanticSearchDefinitionDetails' },
});
