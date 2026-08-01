import { readFile } from 'node:fs/promises';
import type { Config } from '@oclif/core';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Query from '../src/commands/data360/query.js';
import Hybrid from '../src/commands/data360/query/hybrid.js';
import Vector from '../src/commands/data360/query/vector.js';
import { executeSearchQuery } from '../src/query/searchCommand.js';
import { buildHybridSearchSql, buildVectorSearchSql } from '../src/query/searchSql.js';
import { QueryJobCache } from '../src/run/queryJobCache.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 vector and hybrid query builders', () => {
  const commandTest = createCommandTestContext();
  it('publishes both search query commands', async () => {
    const snapshot = await readFile(new URL('../command-snapshot.json', import.meta.url), 'utf8');
    expect(snapshot).to.include('data360 query vector');
    expect(snapshot).to.include('data360 query hybrid');
  });

  it('labels generated search SQL as beta until its Data 360 SQL dialect is live-verified', () => {
    for (const command of [Vector, Hybrid]) {
      const description = command.description.replaceAll(/\s+/gu, ' ');
      expect(description).to.include('Data 360 SQL');
      expect(description).to.include('non-production target org');
      expect(description).to.include('has not completed live verification');
    }
  });

  it('builds normalized golden SQL with quoted identifiers and escaped literals', () => {
    expect(buildVectorSearchSql({ index: 'Knowledge', text: "Ada's guide", topK: 3, select: 'Title,Body' })).to.equal(
      `SELECT c."Title", c."Body", v."score__c", v."SourceRecordId__c" FROM vector_search(TABLE("Knowledge_index__dlm"), 'Ada''s guide', '', 3) AS v JOIN "Knowledge_chunk__dlm" AS c ON v."SourceRecordId__c" = c."RecordId__c" ORDER BY v."score__c" DESC LIMIT 3`
    );
    const injected = buildHybridSearchSql({
      index: 'Bad"Index_index__dlm',
      text: "'; DROP TABLE x;--",
      topK: 5,
      filter: "Type='Home'",
    });
    expect(injected).to.include('TABLE("Bad""Index_index__dlm")');
    expect(injected).to.include("'''; DROP TABLE x;--'");
    expect(injected).to.include("'Type=''Home'''");
  });

  it('forwards every optional search control to the shared query command', async () => {
    const run = commandTest.context.SANDBOX.stub(Query, 'runNested').resolves({ done: true } as never);
    const config = {} as Config;
    await executeSearchQuery(
      {
        'target-org': { getUsername: () => 'user@example.invalid' },
        'api-version': '66.0',
        'data-space': 'Private Space',
        wait: { milliseconds: 120_000 },
        async: true,
        'result-format': 'csv',
        'output-file': 'results.csv',
        timing: true,
        'top-k': 7,
      },
      'SELECT 1',
      false,
      config
    );
    expect(
      run.calledOnceWithExactly(
        [
          '--target-org',
          'user@example.invalid',
          '--query',
          'SELECT 1',
          '--row-limit',
          '7',
          '--wait',
          '2',
          '--api-version',
          '66.0',
          '--data-space',
          'Private Space',
          '--async',
          '--output-file',
          'results.csv',
          '--timing',
          '--result-format',
          'csv',
        ],
        config
      )
    ).to.equal(true);
  });

  it('executes both builders through the standard query job endpoint', async () => {
    const server = Fastify({ logger: false });
    const sql: string[] = [];
    server.post('/services/data/v67.0/ssot/query-sql', async (request) => {
      sql.push((request.body as { sql: string }).sql);
      return {
        status: { queryId: `q-${sql.length}`, completionStatus: 'ResultsProduced', rowCount: 1 },
        data: [['chunk', 0.9]],
        metadata: [
          { name: 'Chunk__c', type: 'TEXT' },
          { name: 'score__c', type: 'NUMBER' },
        ],
        returnedRows: 1,
      };
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-query-search');
    await commandTest.context.stubAuths(org);
    const save = commandTest.context.SANDBOX.stub().resolves();
    const createCache = commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      save,
    } as unknown as QueryJobCache);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      const response = await fetch(`${base}${value.url}`, {
        method: value.method,
        body: value.body,
        headers: { 'content-type': 'application/json' },
      });
      return (await response.json()) as never;
    };
    const common = [
      '-o',
      org.username,
      '--api-version',
      '67.0',
      '--json',
      '--index',
      'Knowledge',
      '-t',
      'hello',
      '--no-prompt',
    ];
    try {
      expect((await Vector.run([...common, '--top-k', '3'])).done).to.equal(true);
      expect((await Hybrid.run([...common, '--filter', "Type='Home'", '--select', 'Title'])).done).to.equal(true);
      expect(sql[0]).to.include('vector_search');
      expect(sql[1]).to.include('hybrid_search');
      expect(createCache.notCalled).to.equal(true);
      expect(save.notCalled).to.equal(true);
    } finally {
      await server.close();
    }
  });
});
