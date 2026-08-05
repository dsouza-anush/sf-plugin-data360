import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);

export const loadCommandMessages = (bundle: string): Messages<string> =>
  Messages.loadMessages('sf-plugin-data360', bundle);
