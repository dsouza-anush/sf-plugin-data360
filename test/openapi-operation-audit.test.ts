import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect } from 'chai';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

describe('OpenAPI operation audit', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'data360-openapi-audit-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('emits a deterministic inventory and input hash from a supplied JSON specification', async () => {
    const source = `${JSON.stringify({
      openapi: '3.0.1',
      paths: {
        '/z': { post: { operationId: 'postZ', tags: ['Beta'] } },
        '/a': {
          parameters: [],
          get: { operationId: 'getA', tags: ['Beta', 'Alpha'] },
        },
      },
    })}\n`;
    const specification = resolve(temporaryDirectory, 'official.json');
    await writeFile(specification, source, 'utf8');

    const { stdout } = await execFileAsync(process.execPath, [
      resolve(root, 'scripts', 'audit-openapi-operations.mjs'),
      specification,
    ]);
    const inventory = JSON.parse(stdout) as {
      operationCount: number;
      operations: Array<{ method: string; operationId: string; path: string; tags: string[] }>;
      source: { openapiVersion: string; sha256: string };
      tagCounts: Record<string, number>;
    };

    expect(inventory.source).to.deep.equal({
      openapiVersion: '3.0.1',
      sha256: createHash('sha256').update(source).digest('hex'),
    });
    expect(inventory.operationCount).to.equal(2);
    expect(inventory.tagCounts).to.deep.equal({ Alpha: 1, Beta: 2 });
    expect(inventory.operations).to.deep.equal([
      { method: 'GET', path: '/a', operationId: 'getA', tags: ['Alpha', 'Beta'] },
      { method: 'POST', path: '/z', operationId: 'postZ', tags: ['Beta'] },
    ]);
  });
});
