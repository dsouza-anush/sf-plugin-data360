import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { dloResource } from '../../../resources/dlo.js';

const commandMessages = loadCommandMessages('data360.dlo.update');

export default createRegistryCommand({
  resource: dloResource,
  operation: 'update',
  messages: commandMessages,
});
