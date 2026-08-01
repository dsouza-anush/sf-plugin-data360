import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { dloResource } from '../../../resources/dlo.js';

const commandMessages = loadCommandMessages('data360.dlo.list');

export default createRegistryCommand({
  resource: dloResource,
  operation: 'list',
  messages: commandMessages,
});
