import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { transformResource } from '../../../resources/transform.js';

const commandMessages = loadCommandMessages('data360.transform.create');

export default createRegistryCommand({
  resource: transformResource,
  operation: 'create',
  messages: commandMessages,
});
