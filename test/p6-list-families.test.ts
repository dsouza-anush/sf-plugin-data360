import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import { createCommandTestContext } from './helpers/command.js';
import { loadFixture } from './helpers/fixtures.js';

type Command = { run: (args: string[]) => Promise<{ items: unknown[] }> };
type Resource = {
  topic: string;
  base: string;
  nameFields: readonly string[];
  columns: readonly string[];
  operationSpecs?: Record<string, { method?: string; path?: string }>;
  pagination?: { dialect?: string; arrayKey?: string; pageSizeParameter?: string };
};
type P6ListModules = {
  commands: Command[];
  resources: Resource[];
};

const root = resolve(import.meta.dirname, '..');
const loadModules = async (): Promise<P6ListModules | null> => {
  try {
    const [
      docai,
      semantic,
      dataAction,
      dataActionTarget,
      docaiResource,
      semanticResource,
      dataActionResource,
      dataActionTargetResource,
    ] = await Promise.all([
      import(pathToFileURL(resolve(root, 'src/commands/data360/docai/config/list.ts')).href),
      import(pathToFileURL(resolve(root, 'src/commands/data360/semantic/model/list.ts')).href),
      import(pathToFileURL(resolve(root, 'src/commands/data360/data-action/list.ts')).href),
      import(pathToFileURL(resolve(root, 'src/commands/data360/data-action-target/list.ts')).href),
      import(pathToFileURL(resolve(root, 'src/resources/docAiConfiguration.ts')).href),
      import(pathToFileURL(resolve(root, 'src/resources/semanticModel.ts')).href),
      import(pathToFileURL(resolve(root, 'src/resources/dataAction.ts')).href),
      import(pathToFileURL(resolve(root, 'src/resources/dataActionTarget.ts')).href),
    ]);
    return {
      commands: [docai.default, semantic.default, dataAction.default, dataActionTarget.default] as Command[],
      resources: [
        docaiResource.docAiConfigurationResource,
        semanticResource.semanticModelResource,
        dataActionResource.dataActionResource,
        dataActionTargetResource.dataActionTargetResource,
      ],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
};

describe('P6 fixture-backed list families', () => {
  const commandTest = createCommandTestContext();

  it('matches raw replay envelopes, dedicated-command provenance, and verified Salesforce item fields', async () => {
    const modules = await loadModules();
    expect(modules, 'P6 list command modules must exist').not.to.equal(null);
    const fixtures = [
      {
        file: 'docai/configurations.json',
        liveFile: 'docai-config-list.json',
        command: 'data360 docai config list',
        arrayKey: 'configurations',
      },
      {
        file: 'semantic/models.json',
        liveFile: 'semantic-model-list.json',
        command: 'data360 semantic model list',
        arrayKey: 'items',
      },
      {
        file: 'data-action/list.json',
        liveFile: 'data-action-list.json',
        command: 'data360 data-action list',
        arrayKey: 'dataActions',
      },
      {
        file: 'data-action-target/list.json',
        liveFile: 'data-action-target-list.json',
        command: 'data360 data-action-target list',
        arrayKey: 'dataActionTargets',
      },
    ];
    for (const { arrayKey, command, file } of fixtures) {
      const fixture = JSON.parse(await readFile(resolve(root, 'test/fixtures', file), 'utf8')) as {
        __fixture?: { source?: string; command?: string };
        [key: string]: unknown;
      };
      expect(fixture.__fixture?.source, file).to.equal('live-scrubbed');
      expect(fixture.__fixture?.command, file).to.equal(command);
      expect(fixture[arrayKey], file).to.be.an('array');
      expect(fixture, file).to.have.property('currentPageUrl');
      expect(fixture, file).to.have.property('nextPageUrl');
    }
    for (const { command, liveFile } of fixtures) {
      const capture = JSON.parse(await readFile(resolve(root, 'test/fixtures/live', liveFile), 'utf8')) as {
        __fixture?: { source?: string; command?: string };
        status?: number;
        result?: { items?: unknown[] };
      };
      expect(capture.__fixture, liveFile).to.deep.include({ source: 'live-scrubbed', command });
      expect(capture.status, liveFile).to.equal(0);
      expect(capture.result?.items, liveFile).to.be.an('array');
    }
    expect(
      modules!.resources.map(
        ({ base, columns, nameFields, operationSpecs, pagination, topic }): Record<string, unknown> => ({
          topic,
          base,
          nameFields: [...nameFields],
          columns: [...columns],
          operationSpecs,
          pagination,
        })
      )
    ).to.deep.equal([
      {
        topic: 'docai-config',
        base: '/document-processing/configurations',
        nameFields: ['name', 'label'],
        columns: ['name', 'label', 'activationStatus', 'status', 'lastModifiedDate'],
        operationSpecs: { list: { method: 'GET', path: '/document-processing/configurations' } },
        pagination: { dialect: 'offset', arrayKey: 'configurations' },
      },
      {
        topic: 'semantic-model',
        base: '/semantic/models',
        nameFields: ['apiName', 'label'],
        columns: ['apiName', 'label', 'dataspace', 'lastModifiedDate'],
        operationSpecs: { list: { method: 'GET', path: '/semantic/models' } },
        pagination: { dialect: 'offset', arrayKey: 'items' },
      },
      {
        topic: 'data-action',
        base: '/data-actions',
        nameFields: ['developerName', 'dataActionName', 'masterLabel'],
        columns: [
          'developerName',
          'masterLabel',
          'dataActionStatus',
          'dataSpaceDevName',
          'isRealTimeAction',
          'lastActionStatusDateTime',
        ],
        operationSpecs: { list: { method: 'GET', path: '/data-actions' } },
        pagination: { dialect: 'offset', arrayKey: 'dataActions', pageSizeParameter: 'batchSize' },
      },
      {
        topic: 'data-action-target',
        base: '/data-action-targets',
        nameFields: ['apiName', 'label'],
        columns: ['apiName', 'label', 'type', 'status'],
        operationSpecs: { list: { method: 'GET', path: '/data-action-targets' } },
        pagination: { dialect: 'offset', arrayKey: 'dataActionTargets', pageSizeParameter: 'batchSize' },
      },
    ]);
  });

  it('executes every recorded collection with the API-specific page-size parameter', async () => {
    const modules = (await loadModules())!;
    const server = Fastify({ logger: false });
    const requests: string[] = [];
    server.get('/services/data/v67.0/ssot/*', async (request) => {
      requests.push(request.url);
      const path = request.url.split('?')[0];
      if (path.endsWith('/document-processing/configurations')) return loadFixture('docai/configurations.json');
      if (path.endsWith('/semantic/models')) return loadFixture('semantic/models.json');
      if (path.endsWith('/data-actions')) return loadFixture('data-action/list.json');
      return loadFixture('data-action-target/list.json');
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p6-list-families');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const response = await fetch(`${base}${(request as { url: string }).url}`);
      return (await response.json()) as never;
    };

    try {
      const common = ['--target-org', org.username, '--api-version', '67.0', '--json'];
      for (const command of modules.commands) {
        expect((await command.run(common)).items).to.deep.equal([]);
      }
      expect(
        requests.map((url) => {
          const parsed = new URL(url, base);
          return {
            path: parsed.pathname,
            offset: parsed.searchParams.get('offset'),
            limit: parsed.searchParams.get('limit'),
            batchSize: parsed.searchParams.get('batchSize'),
          };
        })
      ).to.deep.equal([
        {
          path: '/services/data/v67.0/ssot/document-processing/configurations',
          offset: '0',
          limit: '100',
          batchSize: null,
        },
        {
          path: '/services/data/v67.0/ssot/semantic/models',
          offset: '0',
          limit: '100',
          batchSize: null,
        },
        {
          path: '/services/data/v67.0/ssot/data-actions',
          offset: '0',
          limit: null,
          batchSize: '100',
        },
        {
          path: '/services/data/v67.0/ssot/data-action-targets',
          offset: '0',
          limit: null,
          batchSize: '100',
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it('honors --limit and follows server nextPageUrl pagination for batchSize collections', async () => {
    const modules = (await loadModules())!;
    const DataActionList = modules.commands[2];
    const server = Fastify({ logger: false });
    const requests: string[] = [];
    server.get('/services/data/v67.0/ssot/data-actions', async (request) => {
      requests.push(request.url);
      const offset = new URL(request.url, 'http://localhost').searchParams.get('offset');
      if (offset === '0') {
        return {
          dataActions: [{ developerName: 'First' }, { developerName: 'Second' }],
          nextPageUrl: '/services/data/v67.0/ssot/data-actions?batchSize=200&offset=2',
        };
      }
      return { dataActions: [{ developerName: 'Third' }], nextPageUrl: null };
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p6-data-action-pagination');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const response = await fetch(`${base}${(request as { url: string }).url}`);
      return (await response.json()) as never;
    };

    try {
      const common = ['--target-org', org.username, '--api-version', '67.0', '--json'];
      expect((await DataActionList.run([...common, '--limit', '1'])).items).to.deep.equal([{ developerName: 'First' }]);
      expect(requests).to.have.length(1);
      expect(new URL(requests[0], base).searchParams.get('batchSize')).to.equal('1');

      requests.length = 0;
      expect((await DataActionList.run([...common, '--all'])).items).to.deep.equal([
        { developerName: 'First' },
        { developerName: 'Second' },
        { developerName: 'Third' },
      ]);
      expect(
        requests.map((url) => {
          const parsed = new URL(url, base);
          return { batchSize: parsed.searchParams.get('batchSize'), offset: parsed.searchParams.get('offset') };
        })
      ).to.deep.equal([
        { batchSize: '200', offset: '0' },
        { batchSize: '200', offset: '2' },
      ]);
    } finally {
      await server.close();
    }
  });

  it('uses the semantic-model total field to stop after an exact full page', async () => {
    const modules = (await loadModules())!;
    const SemanticModelList = modules.commands[1];
    const server = Fastify({ logger: false });
    let requestCount = 0;
    server.get('/services/data/v67.0/ssot/semantic/models', async () => {
      requestCount += 1;
      return {
        count: 200,
        items: Array.from({ length: 200 }, (_, index) => ({ apiName: `Model${index}` })),
        nextPageUrl: null,
        total: 200,
      };
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p6-semantic-total');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const response = await fetch(`${base}${(request as { url: string }).url}`);
      return (await response.json()) as never;
    };

    try {
      const result = await SemanticModelList.run([
        '--target-org',
        org.username,
        '--api-version',
        '67.0',
        '--all',
        '--json',
      ]);
      expect(result.items).to.have.length(200);
      expect(requestCount).to.equal(1);
    } finally {
      await server.close();
    }
  });
});
