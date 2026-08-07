import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import ConnectionCreate from '../src/commands/data360/connection/create.js';
import ConnectionDelete from '../src/commands/data360/connection/delete.js';
import ConnectionDescribe from '../src/commands/data360/connection/describe.js';
import ConnectionGet from '../src/commands/data360/connection/get.js';
import ConnectionList from '../src/commands/data360/connection/list.js';
import ConnectionUpdate from '../src/commands/data360/connection/update.js';
import ConnectionValidate from '../src/commands/data360/connection/validate.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 connection family', () => {
  const commandTest = createCommandTestContext();

  it('registers the verified connection operation and discovery contract', () => {
    const resource = registry.get('connection');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.operationSpecs?.list?.queryParams).to.deep.equal({ connectorType: '{connectorType}' });
    expect(resource.actions).to.have.keys(['validateExisting', 'validateCandidate']);
    expect(resource.columns).to.deep.equal(['name', 'label', 'connectorType', 'status', 'lastUpdated']);
  });

  it('runs CRUD, connector iteration, validation, description, and schema upsert through real parsers', async () => {
    const org = new MockTestOrgData('p4-connection');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string; body?: string }> = [];
    const requestOptions: Array<{ timeout?: number }> = [];
    commandTest.context.fakeConnectionRequest = async (request, options): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      requests.push(value);
      requestOptions.push((options ?? {}) as { timeout?: number });
      if (value.url?.endsWith('/connectors')) {
        return { connectors: [{ type: 'MarketingCloud' }, { type: 'Web' }] } as never;
      }
      if (value.url?.includes('/connections?')) {
        const type = new URL(`https://example.test${value.url}`).searchParams.get('connectorType');
        return {
          connections: [
            {
              id: type === 'Web' ? 'web-id' : 'mc-id',
              name: type === 'Web' ? 'Web' : 'Orders',
              label: type === 'Web' ? 'Web' : 'Orders',
              connectorType: type,
              status: 'Active',
            },
          ],
        } as never;
      }
      if (value.url?.endsWith('/connections/mc-id')) {
        if (value.method === 'DELETE') return undefined as never;
        return {
          id: 'mc-id',
          name: 'Orders',
          label: 'Orders',
          connectorType: 'MarketingCloud',
          status: 'Active',
        } as never;
      }
      if (value.url?.includes('/actions/test')) {
        const sessionValue = ['opaque', 'session', 'value'].join('-');
        const validationValue = ['opaque', 'validation', 'value'].join('-');
        return {
          valid: true,
          sessionId: sessionValue,
          detail: ['authorization', ['Bearer', validationValue].join(' ')].join('='),
        } as never;
      }
      if (value.url?.includes('/databases')) {
        const secret = ['synthetic', 'describe', 'secret'].join('-');
        return { databases: [{ name: 'sales', password: secret, nested: { accessToken: secret } }] } as never;
      }
      if (value.method === 'POST' || value.method === 'PATCH') return JSON.parse(value.body ?? '{}') as never;
      return {} as never;
    };

    const directory = await mkdtemp(join(tmpdir(), 'connection-'));
    const definition = join(directory, 'connection.json');
    const schema = join(directory, 'schema.json');
    await writeFile(definition, '{"name":"Orders","connectorType":"MarketingCloud"}');
    await writeFile(schema, '{"objects":[]}');

    expect((await ConnectionList.run(['-o', org.username, '--json'])).items).to.have.length(2);
    expect((await ConnectionList.run(['-o', org.username, '--limit', '1', '--json'])).items).to.have.length(1);
    const stdout = commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);
    await ConnectionList.run(['-o', org.username, '--limit', '1', '--result-format', 'csv']);
    expect(String(stdout.firstCall.args[0])).to.match(/^name,label,connectorType,status,lastUpdated\r\n/u);
    expect(await ConnectionGet.run(['-o', org.username, '-n', 'orders', '--json'])).to.have.property('item');
    expect(await ConnectionCreate.run(['-o', org.username, '-f', definition, '--json'])).to.have.property('item');
    expect(
      await ConnectionUpdate.run([
        '-o',
        org.username,
        '-n',
        'Orders',
        '-f',
        definition,
        '--schema-file',
        schema,
        '--json',
      ])
    ).to.have.property('item');
    expect(await ConnectionValidate.run(['-o', org.username, '-f', definition, '--json'])).to.deep.equal({
      result: { valid: true, sessionId: '[REDACTED]', detail: 'authorization=[REDACTED] [REDACTED]' },
    });
    const described = await ConnectionDescribe.run([
      '-o',
      org.username,
      '-n',
      'Orders',
      '--databases',
      '--schemas',
      '--json',
    ]);
    expect(described).to.have.nested.property('sections.databases');
    expect(JSON.stringify(described)).not.to.include('synthetic-describe-secret');
    expect(described.sections.databases).to.deep.equal({
      databases: [{ name: 'sales', password: '[REDACTED]', nested: { accessToken: '[REDACTED]' } }],
    });
    expect(await ConnectionDelete.run(['-o', org.username, '-n', 'Orders', '--no-prompt', '--json'])).to.deep.equal({
      deleted: true,
      id: 'mc-id',
    });
    expect(requests.filter(({ url }) => url?.includes('/connections?'))).to.have.length.greaterThan(2);
    expect(requests.some(({ url }) => url?.endsWith('/database-schemas'))).to.equal(true);
    expect(requestOptions.filter(({ timeout }) => timeout === 30_000)).to.have.length(2);
    expect(requests.some(({ method, url }) => method === 'PUT' && url?.endsWith('/schema'))).to.equal(true);
  });
});
