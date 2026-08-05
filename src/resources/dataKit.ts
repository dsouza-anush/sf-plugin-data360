import { defineResource } from './defineResource.js';

export const dataKitResource = defineResource({
  topic: 'data-kit',
  base: '/data-kits',
  nameFields: ['developerName', 'devName', 'label'],
  columns: ['developerName', 'label', 'components#', 'publishingSequence#'],
  operations: ['list', 'create', 'update', 'delete'],
  operationSpecs: {
    list: { method: 'GET', path: '/data-kits' },
    create: { method: 'POST', path: '/data-kits' },
    update: { method: 'PATCH', path: '/data-kits/{key}' },
    delete: { method: 'DELETE', path: '/data-kits/{key}' },
  },
  idKind: { update: 'apiName', delete: 'apiName', deploy: 'apiName', undeploy: 'apiName' },
  actions: {
    available: { method: 'GET', path: '/data-kits/available-components' },
    manifest: { method: 'GET', path: '/datakit/{key}/manifest' },
    deploy: { method: 'POST', path: '/data-kits/{key}', queryParams: { asyncMode: true } },
    undeploy: { method: 'POST', path: '/data-kits/{key}/undeploy', queryParams: { asyncMode: true } },
    dependencies: { method: 'GET', path: '/data-kits/{key}/components/{component}/dependencies' },
    status: { method: 'GET', path: '/data-kits/{key}/components/{component}/deployment-status' },
  },
  destructive: { update: true, delete: true, undeploy: true },
});
