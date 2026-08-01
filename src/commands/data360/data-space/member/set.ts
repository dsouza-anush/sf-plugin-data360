import { loadCommandMessages } from '../../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { TransformCommand } from '../../../../transform/command.js';
import { loadDefinition } from '../../../../shared/definitionFile.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-space.member.set');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataSpaceMemberSet extends TransformCommand<{ items: Array<Record<string, unknown>> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    file: Flags.string({ char: 'f', required: true, summary: commandMessages.getMessage('flags.file.summary') }),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };
  public async run(): Promise<{ items: Array<Record<string, unknown>> }> {
    const { flags, client } = await this.initializeTransform(DataSpaceMemberSet);
    const key = await this.resolveKey(client, '/data-spaces', 'dataSpaces', flags.name as string);
    const definition = await loadDefinition(flags.file as string);
    const members = definition.members;
    if (
      !Array.isArray(members) ||
      members.length === 0 ||
      members.some(
        (member) =>
          !member ||
          typeof member !== 'object' ||
          typeof (member as Record<string, unknown>).memberName !== 'string' ||
          !(member as Record<string, unknown>).memberName ||
          !(member as Record<string, unknown>).filter ||
          typeof (member as Record<string, unknown>).filter !== 'object' ||
          Array.isArray((member as Record<string, unknown>).filter)
      )
    )
      throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
        commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
      ]);
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmMembers', [members.length, String(flags.name)])
    );
    await client.request({
      method: 'PUT',
      endpoint: `/data-spaces/${encodeURIComponent(key)}/members`,
      body: { members: { members } },
    });
    return { items: members as Array<Record<string, unknown>> };
  }
}
