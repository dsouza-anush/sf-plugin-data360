import { expect } from 'chai';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import ConnectorGet from '../src/commands/data360/connector/get.js';
import ConnectorList from '../src/commands/data360/connector/list.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 connector family', () => {
  const commandTest = createCommandTestContext();

  it('registers only the verified read operations and fixture-backed columns', () => {
    const resource = registry.get('connector');
    expect(resource.operations).to.deep.equal(['list', 'get']);
    expect(resource.columns).to.deep.equal(['name', 'label', 'category', 'ingestType']);
  });

  it('runs list and get through concrete oclif leaves and mocked transport', async () => {
    const org = new MockTestOrgData('p4-connector');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const url = (request as { url?: string }).url ?? '';
      if (url.includes('/connectors/MarketingCloud')) {
        return {
          name: 'MarketingCloud',
          label: 'Marketing Cloud',
          category: 'Engagement',
          ingestType: 'Batch',
          configSchema: { required: ['endpoint'] },
        } as never;
      }
      return {
        connectors: [
          {
            name: 'MarketingCloud',
            label: 'Marketing Cloud',
            category: 'Engagement',
            ingestType: 'Batch',
          },
          { name: 'Web', label: 'Web', category: 'Web', ingestType: 'Streaming' },
        ],
      } as never;
    };

    expect(((await ConnectorList.run(['-o', org.username, '--json'])) as { items: unknown[] }).items).to.have.length(2);
    const got = (await ConnectorGet.run(['-o', org.username, '-n', 'marketingcloud', '--json'])) as {
      item: Record<string, unknown>;
    };
    expect(got.item).to.deep.include({ name: 'MarketingCloud', configSchema: { required: ['endpoint'] } });
  });
});
