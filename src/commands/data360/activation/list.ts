import { loadCommandMessages } from '../../../messages.js';
import { activationResource } from '../../../resources/activation.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.activation.list');

export default createRegistryCommand({
  resource: activationResource,
  operation: 'list',
  messages: commandMessages,
});
