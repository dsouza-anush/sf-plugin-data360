import { defineResource } from './defineResource.js';

export const activationTargetResource = defineResource({
  topic: 'activation-target',
  base: '/activation-targets',
  nameFields: ['activationTargetName', 'displayName'],
  columns: ['activationTargetId', 'activationTargetName', 'displayName', 'type', 'status', 'maxFileSize'],
  operations: ['list', 'get', 'create', 'update'],
  operationSpecs: { update: { method: 'PATCH', path: '/activation-targets/{key}' } },
  idKind: { get: 'id', update: 'id' },
  numericRanges: { maxFileSize: { min: 1, max: 500 } },
  pagination: { dialect: 'offset', arrayKey: 'activationTargets' },
});
