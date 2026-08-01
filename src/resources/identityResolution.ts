import { defineResource } from './defineResource.js';

export const identityResolutionResource = defineResource({
  topic: 'identity-resolution',
  base: '/identity-resolutions',
  nameFields: ['name', 'rulesetId', 'label'],
  columns: ['name', 'label', 'status', 'lastRunStatus', 'matchedRate'],
  operations: ['list', 'get', 'create', 'update', 'delete'],
  idKind: {
    // Live responses expose `id`, `rulesetId`, and `label`, but no `name`.
    // Every item endpoint is ID-keyed, so resolve friendly inputs to the ID.
    get: 'id',
    update: 'id',
    delete: 'id',
    run: 'id',
  },
  actions: {
    run: { method: 'POST', path: '/identity-resolutions/{key}/actions/run-now' },
  },
  destructive: { delete: true, run: true },
  billable: { run: 'Identity Resolution' },
  pagination: { dialect: 'offset', arrayKey: 'identityResolutions' },
});
