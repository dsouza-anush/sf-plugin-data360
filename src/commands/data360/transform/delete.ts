import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { transformResource } from '../../../resources/transform.js';

const commandMessages = loadCommandMessages('data360.transform.delete');

export default createRegistryCommand({
  resource: transformResource,
  operation: 'delete',
  messages: commandMessages,
});
