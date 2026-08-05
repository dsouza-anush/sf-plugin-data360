import { defineResource } from './defineResource.js';

export const activationResource = defineResource({
  topic: 'activation',
  base: '/activations',
  nameFields: ['activationName', 'displayName'],
  columns: ['activationId', 'activationName', 'displayName', 'status', 'activationTargetName'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  operationSpecs: { update: { method: 'PUT', path: '/activations/{key}' } },
  idKind: { get: 'id', update: 'id', delete: 'id', results: 'id' },
  destructive: { delete: true },
  pagination: { dialect: 'offset', arrayKey: 'activations' },
});
