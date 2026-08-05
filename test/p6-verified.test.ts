import { readFile } from 'node:fs/promises';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import DocAiDescribe from '../src/commands/data360/docai/describe.js';
import RetrieverConfigurationList from '../src/commands/data360/retriever/configuration/list.js';
import RetrieverGet from '../src/commands/data360/retriever/get.js';
import RetrieverList from '../src/commands/data360/retriever/list.js';
import { retrieverResource } from '../src/resources/retriever.js';
import { createCommandTestContext } from './helpers/command.js';
import { loadFixture } from './helpers/fixtures.js';

describe('P6 live-verified read commands', () => {
  const commandTest = createCommandTestContext();

  it('requires recorded fixtures before registering P6 operations', async () => {
    for (const file of [
      'test/fixtures/retriever/list.json',
      'test/fixtures/retriever/get.json',
      'test/fixtures/retriever/configurations.json',
      'test/fixtures/docai/global-config.json',
    ]) {
      const fixture = JSON.parse(await readFile(file, 'utf8')) as { __fixture?: { source?: string } };
      expect(fixture.__fixture?.source, file).to.equal('live-scrubbed');
    }
    expect(Object.keys(retrieverResource.operationSpecs ?? {})).to.deep.equal(['list', 'get']);
  });

  it('executes retriever reads and Document AI describe through recorded HTTP fixtures', async () => {
    const server = Fastify({ logger: false });
    const requests: string[] = [];
    server.get('/services/data/v67.0/ssot/*', async (request) => {
      requests.push(request.url);
      const path = request.url.split('?')[0];
      if (path.includes('/document-processing/global-config')) return loadFixture('docai/global-config.json');
      if (path.endsWith('/configurations')) return loadFixture('retriever/configurations.json');
      if (path.includes('/machine-learning/retrievers/') && !path.endsWith('/retrievers'))
        return loadFixture('retriever/get.json');
      return loadFixture('retriever/list.json');
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p6-verified');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { url: string };
      const response = await fetch(`${base}${value.url}`);
      return (await response.json()) as never;
    };
    const common = ['--target-org', org.username, '--api-version', '67.0', '--json'];

    const listed = (await RetrieverList.run([...common, '--all'])) as { items: unknown[] };
    expect(listed.items).to.have.length(3);
    const detail = (await RetrieverGet.run([...common, '--name', 'salesforce help content retriever'])) as {
      item: Record<string, unknown>;
    };
    expect(detail.item.name).to.equal('SalesforceHelpContentRetriever');
    const configurations = (await RetrieverConfigurationList.run([
      ...common,
      '--name',
      'Salesforce Help Content Retriever',
      '--all',
    ])) as { items: unknown[] };
    expect(configurations.items).to.have.length(1);
    const docai = (await DocAiDescribe.run(common)) as {
      item: { supportedContentTypes?: unknown[]; supportedModels?: unknown[] };
    };
    expect(docai.item.supportedContentTypes).to.have.length(4);
    expect(docai.item.supportedModels).to.have.length.greaterThan(0);
    expect(requests.some((url) => url.includes('/machine-learning/retrievers'))).to.equal(true);
    expect(
      requests.some((url) =>
        url.split('?')[0].endsWith('/machine-learning/retrievers/sfdc_ai__SalesforceHelpContentRetriever')
      )
    ).to.equal(true);
    expect(requests.some((url) => url.includes('/document-processing/global-config'))).to.equal(true);
    await server.close();
  });
});
