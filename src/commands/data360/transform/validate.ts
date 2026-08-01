import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { transformResource } from '../../../resources/transform.js';

const commandMessages = loadCommandMessages('data360.transform.validate');

export default createRegistryCommand({
  resource: transformResource,
  operation: 'action',
  action: 'validate',
  messages: commandMessages,
});
