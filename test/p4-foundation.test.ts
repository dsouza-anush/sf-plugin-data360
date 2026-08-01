import { Readable } from 'node:stream';
import { expect } from 'chai';
import { defineResource } from '../src/resources/defineResource.js';
import { loadDefinition, MAX_DEFINITION_BYTES } from '../src/shared/definitionFile.js';
import { resolveResourceKey } from '../src/shared/nameResolver.js';

const rejectsWith = async (promise: Promise<unknown>, message: string): Promise<void> => {
  try {
    await promise;
    expect.fail('expected promise to reject');
  } catch (error) {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.include(message);
  }
};

describe('P4 registry foundation', () => {
  it('preserves the complete registry execution contract', () => {
    const resource = defineResource({
      topic: 'transform',
      base: '/data-transforms' as const,
      root: 'ssot',
      nameFields: ['name', 'label'],
      columns: ['name', 'label', 'type', 'status'],
      operations: ['list', 'get', 'create', 'update', 'delete'] as const,
      operationSpecs: {
        list: { method: 'GET', queryParams: { limit: 100 } },
        update: { method: 'PUT', path: '/data-transforms/{key}' },
      },
      idKind: { get: 'idOrApiName', update: 'apiName' },
      actions: { run: { method: 'POST', path: '/data-transforms/{key}/actions/run' } },
      destructive: { delete: true, cancel: true },
      billable: { run: 'Data Services credits' },
      pagination: { dialect: 'nextPageUrl', arrayKey: 'dataTransforms' },
    });

    expect(resource.root).to.equal('ssot');
    expect(resource.operationSpecs?.update).to.deep.equal({
      method: 'PUT',
      path: '/data-transforms/{key}',
    });
    expect(resource.actions?.run).to.deep.equal({
      method: 'POST',
      path: '/data-transforms/{key}/actions/run',
    });
    expect(resource.pagination).to.deep.equal({
      dialect: 'nextPageUrl',
      arrayKey: 'dataTransforms',
    });
    expect(Object.isFrozen(resource.actions?.run)).to.equal(true);
  });

  it('loads JSON object definitions from files and stdin', async () => {
    expect(await loadDefinition('-', Readable.from(['{"name":"Web"}']))).to.deep.equal({ name: 'Web' });
    await rejectsWith(loadDefinition('-', Readable.from(['[]'])), 'JSON object');
    await rejectsWith(loadDefinition('-', Readable.from(['{'])), 'valid JSON');
    await rejectsWith(
      loadDefinition('-', Readable.from(['{"value":"', 'x'.repeat(MAX_DEFINITION_BYTES), '"}'])),
      'byte limit'
    );
  });

  it('resolves IDs, exact names, ambiguity, and capped suggestions', async () => {
    let listCalls = 0;
    const records = [
      { id: 'first', name: 'Orders', label: 'Shared' },
      { id: 'second', name: 'Contacts', label: 'Shared' },
      ...Array.from({ length: 25 }, (_, index) => ({
        id: `id-${index}`,
        name: `Candidate ${index}`,
      })),
    ];
    const list = async (): Promise<typeof records> => {
      listCalls += 1;
      return records;
    };

    expect(await resolveResourceKey('001000000000000AAA', { idKind: 'id', nameFields: ['name'], list })).to.equal(
      '001000000000000AAA'
    );
    expect(listCalls).to.equal(0);
    expect(
      await resolveResourceKey('orders', {
        idKind: 'id',
        idField: 'id',
        nameFields: ['name', 'label'],
        list,
      })
    ).to.equal('first');
    expect(
      await resolveResourceKey('orders', {
        idKind: 'idOrApiName',
        apiNameField: 'name',
        nameFields: ['name', 'label'],
        list,
      })
    ).to.equal('Orders');
    expect(
      await resolveResourceKey('live segment', {
        idKind: 'apiName',
        nameFields: ['segmentApiName', 'apiName', 'displayName'],
        list: async () => [{ apiName: 'Live_Segment', displayName: 'Live Segment' }],
      })
    ).to.equal('Live_Segment');

    await rejectsWith(
      resolveResourceKey('shared', { idKind: 'id', idField: 'id', nameFields: ['name', 'label'], list }),
      'matches multiple'
    );

    try {
      await resolveResourceKey('missing', { idKind: 'apiName', nameFields: ['name'], list });
      expect.fail('expected missing name to reject');
    } catch (error) {
      const actions = (error as { actions?: string[] }).actions ?? [];
      expect(actions.join(' ')).to.include('Candidate 0');
      expect(
        actions[0]
          .replace(/^Available resources include: /u, '')
          .replace(/\.$/u, '')
          .split(', ')
      ).to.have.length(20);
    }
  });
});
