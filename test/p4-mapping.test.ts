import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import MappingCreate from '../src/commands/data360/mapping/create.js';
import MappingDelete from '../src/commands/data360/mapping/delete.js';
import MappingGet from '../src/commands/data360/mapping/get.js';
import MappingList from '../src/commands/data360/mapping/list.js';
import MappingUpdate from '../src/commands/data360/mapping/update.js';
import type { SsotClient } from '../src/client/ssotClient.js';
import { MappingClient } from '../src/mapping/client.js';
import { matchFields } from '../src/mapping/matcher.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';
import { assertRejects } from './helpers/async.js';

describe('P4 mapping family', () => {
  const commandTest = createCommandTestContext();

  const rejectsWith = async (promise: Promise<unknown>, message: string): Promise<Error> => {
    try {
      await promise;
      expect.fail('expected promise to reject');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.include(message);
      return error as Error;
    }
  };

  it('registers corrected verified field operation paths and methods', () => {
    const resource = registry.get('mapping');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.actions?.updateField).to.deep.include({
      method: 'PATCH',
      path: '/data-model-object-mappings/{key}/field-mappings/{field}',
    });
    expect(resource.actions?.deleteFields).to.deep.include({
      method: 'DELETE',
      path: '/data-model-object-mappings/{key}/field-mappings/{field}',
    });
  });

  it('matches exact, synonym, and prefix fields with deterministic ambiguity', () => {
    expect(
      matchFields(
        [{ name: 'FirstName__c' }, { name: 'Email__c' }, { name: 'MailingCity__c' }, { name: 'CustomerNumberLong__c' }],
        [
          { name: 'ssot__FirstName__c' },
          { name: 'ssot__EmailAddress__c' },
          { name: 'ssot__CityName__c' },
          { name: 'ssot__CustomerNumber__c' },
        ]
      ).mappings
    ).to.deep.equal([
      {
        sourceFieldDeveloperName: 'FirstName__c',
        targetFieldDeveloperName: 'ssot__FirstName__c',
        matchType: 'exact',
      },
      {
        sourceFieldDeveloperName: 'Email__c',
        targetFieldDeveloperName: 'ssot__EmailAddress__c',
        matchType: 'synonym',
      },
      {
        sourceFieldDeveloperName: 'MailingCity__c',
        targetFieldDeveloperName: 'ssot__CityName__c',
        matchType: 'synonym',
      },
      {
        sourceFieldDeveloperName: 'CustomerNumberLong__c',
        targetFieldDeveloperName: 'ssot__CustomerNumber__c',
        matchType: 'prefix',
      },
    ]);
    expect(
      matchFields([{ name: 'EmailAddress__c' }], [{ name: 'EmailAddress__c' }, { name: 'ssot__EmailAddress__c' }])
    ).to.deep.include({
      ambiguous: [],
      mappings: [
        {
          sourceFieldDeveloperName: 'EmailAddress__c',
          targetFieldDeveloperName: 'EmailAddress__c',
          matchType: 'exact',
        },
      ],
    });
    expect(
      matchFields(
        [{ name: 'event_id__c' }, { name: 'KQ_event_id__c' }],
        [{ name: 'event_id__c' }, { name: 'KQ_event_id__c' }]
      )
    ).to.deep.include({
      ambiguous: [],
      mappings: [
        {
          sourceFieldDeveloperName: 'event_id__c',
          targetFieldDeveloperName: 'event_id__c',
          matchType: 'exact',
        },
        {
          sourceFieldDeveloperName: 'KQ_event_id__c',
          targetFieldDeveloperName: 'KQ_event_id__c',
          matchType: 'exact',
        },
      ],
    });
  });

  it('retains the live API reason for a failed per-field update', async () => {
    const client = new MappingClient({
      request: async ({ method }: { method?: string }) => {
        if (method === 'GET') {
          return {
            sourceEntityDeveloperName: 'source__dll',
            targetEntityDeveloperName: 'target__dlm',
          };
        }
        throw new Error('Field mapping PATCH rejected as a no-op');
      },
    } as unknown as SsotClient);

    expect(
      await client.update('MappingName', [
        {
          name: 'name__c_fieldmap_name__c',
          sourceFieldDeveloperName: 'name__c',
          targetFieldDeveloperName: 'name__c',
        },
      ])
    ).to.deep.equal([
      {
        field: 'name__c_fieldmap_name__c',
        success: false,
        reason: 'Field mapping PATCH rejected as a no-op',
      },
    ]);
  });

  it('rejects a DLO-only list locally because the Connect API requires a target DMO scope', async () => {
    const org = new MockTestOrgData('p4-mapping-list-contract');
    await commandTest.context.stubAuths(org);
    const requests: string[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push(String((request as { url?: string }).url ?? ''));
      return {} as never;
    };

    const error = await rejectsWith(
      MappingList.run(['-o', org.username, '--source-object', 'Contact_Home__dll', '--json']),
      'Target DMO developer name is required'
    );
    expect(error).to.have.property('name', 'D360_INVALID_DEFINITION');
    expect(error).to.have.deep.property('actions', [
      'The Connect API requires --dmo as the primary scope. Use --source-object with --dmo to filter by DLO developer name.',
    ]);
    expect(requests.some((url) => url.includes('/data-model-object-mappings'))).to.equal(false);
  });

  it('encodes every mapping CSV cell and neutralizes spreadsheet formulas', async () => {
    const org = new MockTestOrgData('p4-mapping-csv');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (): Promise<never> =>
      ({
        objectSourceTargetMaps: [
          {
            developerName: '=FORMULA',
            sourceEntityDeveloperName: 'source,with,commas',
            targetEntityDeveloperName: 'target\nwith newline',
            status: 'Active',
            fieldMappings: [],
          },
        ],
      }) as never;
    const stdout = commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);

    await MappingList.run(['-o', org.username, '--dmo', 'Target__dlm', '--result-format', 'csv']);

    expect(String(stdout.firstCall.args[0])).to.equal(
      'developerName,sourceEntityDeveloperName,targetEntityDeveloperName,status,fieldMappings#\r\n' +
        '\'=FORMULA,"source,with,commas","target\nwith newline",Active,0\r\n'
    );
  });

  it('runs filtered CRUD, per-field methods, and dry-run auto mapping through real parsers', async () => {
    const org = new MockTestOrgData('p4-mapping');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string; body?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      requests.push(value);
      if (value.method === 'DELETE') return undefined as never;
      if (value.url?.includes('/data-lake-objects/Orders__dll')) {
        return {
          dataLakeObjects: [{ fields: [{ name: 'Email__c' }, { name: 'CustomerNumberLong__c' }] }],
        } as never;
      }
      if (value.url?.includes('/data-model-objects/Individual__dlm')) {
        return { fields: [{ name: 'ssot__EmailAddress__c' }, { name: 'ssot__CustomerNumber__c' }] } as never;
      }
      if (value.method === 'POST' || value.method === 'PATCH') return JSON.parse(value.body ?? '{}') as never;
      if (/\/data-model-object-mappings\/[^?]+$/u.test(value.url ?? '')) {
        return {
          name: 'OrdersToIndividual',
          sourceEntityDeveloperName: 'Orders__dll',
          targetEntityDeveloperName: 'Individual__dlm',
        } as never;
      }
      const secondPage = value.url?.includes('nextBatchId=page-2');
      return {
        objectSourceTargetMaps: [
          {
            developerName: secondPage ? 'SecondMapping' : 'OrdersToIndividual',
            sourceEntityDeveloperName: secondPage ? 'Other__dll' : 'Orders__dll',
            targetEntityDeveloperName: 'Individual__dlm',
          },
        ],
        ...(secondPage ? {} : { nextBatchId: 'page-2' }),
      } as never;
    };
    const directory = await mkdtemp(join(tmpdir(), 'mapping-'));
    const definition = join(directory, 'mapping.json');
    const fields = join(directory, 'fields.json');
    await writeFile(definition, '{"name":"OrdersToIndividual"}');
    await writeFile(
      fields,
      '{"fieldMappings":[{"name":"EmailMap","sourceFieldDeveloperName":"Email__c","targetFieldDeveloperName":"Email__c"},{"name":"CustomerMap","sourceFieldDeveloperName":"Customer__c","targetFieldDeveloperName":"Customer__c"}]}'
    );

    expect(
      (await MappingList.run(['-o', org.username, '--dmo', 'Individual__dlm', '--all', '--json'])).items
    ).to.have.length(2);
    await MappingGet.run(['-o', org.username, '-n', 'OrdersToIndividual', '--json']);
    expect(
      await MappingGet.run(['-o', org.username, '--dmo', 'Individual__dlm', '--source-object', 'Orders__dll', '--json'])
    ).to.deep.equal({
      item: {
        name: 'OrdersToIndividual',
        sourceEntityDeveloperName: 'Orders__dll',
        targetEntityDeveloperName: 'Individual__dlm',
      },
    });
    await MappingCreate.run(['-o', org.username, '-f', definition, '--json']);
    const dryRun = await MappingCreate.run([
      '-o',
      org.username,
      '--auto',
      '--dlo',
      'Orders__dll',
      '--dmo',
      'Individual__dlm',
      '--dry-run',
      '--json',
    ]);
    expect(dryRun).to.deep.include({ unmapped: [], ambiguous: [] });
    expect(dryRun).to.have.property('created', false);
    const created = await MappingCreate.run([
      '-o',
      org.username,
      '--auto',
      '--dlo',
      'Orders__dll',
      '--dmo',
      'Individual__dlm',
      '--json',
    ]);
    expect(created).to.have.property('created', true);
    expect(created).to.have.nested.property('item.sourceEntityDeveloperName', 'Orders__dll');
    expect(created).to.have.nested.property('item.targetEntityDeveloperName', 'Individual__dlm');
    await MappingUpdate.run(['-o', org.username, '-n', 'OrdersToIndividual', '-f', fields, '--json']);
    const emptyFields = await assertRejects(
      MappingDelete.run(['-o', org.username, '-n', 'OrdersToIndividual', '--fields=', '--no-prompt', '--json'])
    );
    expect(emptyFields.name).to.equal('D360_INVALID_DEFINITION');
    await MappingDelete.run([
      '-o',
      org.username,
      '-n',
      'OrdersToIndividual',
      '--fields',
      'EmailMap,CustomerMap',
      '--no-prompt',
      '--json',
    ]);
    expect(requests.filter(({ method }) => method === 'PATCH')).to.have.length(2);
    expect(
      requests
        .filter(({ method }) => method === 'PATCH')
        .map(({ body }) => JSON.parse(body ?? '{}') as Record<string, unknown>)
        .every((body) => body.name === undefined && body.fieldMappingName === undefined)
    ).to.equal(true);
    expect(
      requests
        .filter(({ method }) => method === 'PATCH')
        .map(({ body }) => JSON.parse(body ?? '{}') as Record<string, unknown>)
    ).to.deep.equal([
      {
        sourceEntityDeveloperName: 'Orders__dll',
        targetEntityDeveloperName: 'Individual__dlm',
        fieldMapping: [{ sourceFieldDeveloperName: 'Email__c', targetFieldDeveloperName: 'Email__c' }],
      },
      {
        sourceEntityDeveloperName: 'Orders__dll',
        targetEntityDeveloperName: 'Individual__dlm',
        fieldMapping: [{ sourceFieldDeveloperName: 'Customer__c', targetFieldDeveloperName: 'Customer__c' }],
      },
    ]);
    expect(requests.some(({ url }) => url?.includes('dmoDeveloperName=Individual__dlm'))).to.equal(true);
    expect(requests.some(({ url }) => url?.includes('dloDeveloperName=') === false)).to.equal(true);
    expect(
      requests.some(
        ({ url }) => url?.includes('dmoDeveloperName=Individual__dlm') && url.includes('dloDeveloperName=Orders__dll')
      )
    ).to.equal(true);
    expect(
      requests.some(({ method, url }) => method === 'DELETE' && url?.endsWith('/field-mappings/EmailMap'))
    ).to.equal(true);
    expect(
      requests.some(({ method, url }) => method === 'DELETE' && url?.endsWith('/field-mappings/CustomerMap'))
    ).to.equal(true);
  });
});
