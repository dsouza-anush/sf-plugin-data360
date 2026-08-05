import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { transformResource } from '../../../resources/transform.js';

const commandMessages = loadCommandMessages('data360.transform.update');

export default createRegistryCommand({
  resource: transformResource,
  operation: 'update',
  messages: commandMessages,
});
