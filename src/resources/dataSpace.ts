import { defineResource } from './defineResource.js';
export const dataSpaceResource = defineResource({
  topic: 'data-space',
  base: '/data-spaces',
  nameFields: ['name', 'label'],
  columns: ['name', 'label'],
  operations: ['list', 'get', 'create', 'update'],
  idKind: { get: 'idOrApiName', update: 'idOrApiName' },
  actions: {
    memberList: { method: 'GET', path: '/data-spaces/{key}/members' },
    memberSet: { method: 'PUT', path: '/data-spaces/{key}/members' },
  },
  pagination: { dialect: 'offset', arrayKey: 'dataSpaces' },
});
