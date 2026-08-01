import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import MemberList from '../src/commands/data360/data-space/member/list.js';
import MemberSet from '../src/commands/data360/data-space/member/set.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';
describe('P4 data-space family', () => {
  const commandTest = createCommandTestContext();
  it('registers no delete and only verified member list/set', () => {
    const resource = registry.get('data-space');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update']);
    expect(resource.columns).to.deep.equal(['name', 'label']);
    expect(resource.actions).to.have.keys(['memberList', 'memberSet']);
  });
  it('lists and sets members with the nested v67 request contract and no unset-only ten-member cap', async () => {
    const org = new MockTestOrgData('space');
    await commandTest.context.stubAuths(org);
    const requests: unknown[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push(request);
      if (
        (request as { url?: string }).url?.includes('/data-spaces?') ||
        (request as { url?: string }).url?.endsWith('/data-spaces')
      )
        return { dataSpaces: [{ name: 'default', label: 'Default' }] } as never;
      return (
        (request as { method?: string }).method === 'GET' ? { members: [{ name: 'Order' }] } : { ok: true }
      ) as never;
    };
    const dir = await mkdtemp(join(tmpdir(), 'space-'));
    const valid = join(dir, 'valid.json');
    await writeFile(
      valid,
      '{"members":[{"memberName":"Order__dll","filter":{"conjunctiveOperator":"NoneOperator","conditions":{"conditions":[]}}}]}'
    );
    expect((await MemberList.run(['-o', org.username, '-n', 'default', '--json'])).items).to.have.length(1);
    expect(
      (await MemberSet.run(['-o', org.username, '-n', 'default', '-f', valid, '--no-prompt', '--json'])).items
    ).to.have.length(1);
    const putRequest = requests.find((request) => (request as { method?: string }).method === 'PUT') as {
      body: string;
    };
    expect(JSON.parse(putRequest.body)).to.deep.equal({
      members: {
        members: [
          {
            memberName: 'Order__dll',
            filter: { conjunctiveOperator: 'NoneOperator', conditions: { conditions: [] } },
          },
        ],
      },
    });
    const eleven = join(dir, 'eleven.json');
    await writeFile(
      eleven,
      JSON.stringify({
        members: Array.from({ length: 11 }, (_, i) => ({
          memberName: `M${i}__dll`,
          filter: { conjunctiveOperator: 'NoneOperator', conditions: { conditions: [] } },
        })),
      })
    );
    expect(
      (await MemberSet.run(['-o', org.username, '-n', 'default', '-f', eleven, '--no-prompt', '--json'])).items
    ).to.have.length(11);
  });
});
