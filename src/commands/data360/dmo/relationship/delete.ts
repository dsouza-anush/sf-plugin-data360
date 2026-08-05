import { loadCommandMessages } from '../../../../messages.js';
import { Flags } from '@oclif/core';
import { DmoCommand } from '../../../../dmo/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.dmo.relationship.delete');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DmoRelationshipDelete extends DmoCommand<{ deleted: true; relationshipName: string }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'relationship-name': Flags.string({
      required: true,
      summary: commandMessages.getMessage('flags.relationship-name.summary'),
    }),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ deleted: true; relationshipName: string }> {
    const { flags, client } = await this.initializeDmo(DmoRelationshipDelete);
    const relationshipName = flags['relationship-name'] as string;
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive.0', [String(relationshipName)])
    );
    await client.deleteRelationship(relationshipName);
    return { deleted: true, relationshipName };
  }
}
