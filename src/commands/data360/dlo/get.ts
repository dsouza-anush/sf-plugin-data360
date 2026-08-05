import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { dloResource } from '../../../resources/dlo.js';

const commandMessages = loadCommandMessages('data360.dlo.get');

export default createRegistryCommand({
  resource: dloResource,
  operation: 'get',
  messages: commandMessages,
});
