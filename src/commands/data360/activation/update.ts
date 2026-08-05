import { loadCommandMessages } from '../../../messages.js';
import { activationResource } from '../../../resources/activation.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.activation.update');

export default createRegistryCommand({
  resource: activationResource,
  operation: 'update',
  messages: commandMessages,
});
