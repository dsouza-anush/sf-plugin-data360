import { loadCommandMessages } from '../../messages.js';
import { Flags } from '@oclif/core';
import { Org, SfError } from '@salesforce/core';
import { Data360Command } from '../../command/Data360Command.js';
import { launchBrowser } from '../../open/browser.js';
import { DATA360_ROUTES, routeFor, type Data360Route } from '../../open/routes.js';
import { targetOrgFlag } from '../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.open');

export type OpenResult = { url: string };

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class Open extends Data360Command<OpenResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    path: Flags.option({
      options: Object.keys(DATA360_ROUTES) as Data360Route[],
      default: 'home' as Data360Route,
      summary: commandMessages.getMessage('flags.path.summary'),
    })(),
    'url-only': Flags.boolean({
      exclusive: ['private'],
      summary: commandMessages.getMessage('flags.url-only.summary'),
    }),
    private: Flags.boolean({ exclusive: ['url-only'], summary: commandMessages.getMessage('flags.private.summary') }),
  };

  public async run(): Promise<OpenResult> {
    const { flags } = await this.parse(Open);
    if (this.jsonEnabled() && !flags['url-only']) {
      throw new SfError(commandMessages.getMessage('error.D360_CONFIRMATION_REQUIRED'), 'D360_CONFIRMATION_REQUIRED', [
        commandMessages.getMessage('error.D360_CONFIRMATION_REQUIRED.actions'),
      ]);
    }
    const username = flags['target-org'].getUsername();
    const org = await Org.create({ aliasOrUsername: username });
    const url = await org.getFrontDoorUrl(routeFor(flags.path));
    if (flags['url-only'] && !this.jsonEnabled()) this.log(url);
    if (!flags['url-only'] && !this.jsonEnabled()) await launchBrowser(url, Boolean(flags.private));
    return { url };
  }
}
