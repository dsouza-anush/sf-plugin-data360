import { loadCommandMessages } from '../../../messages.js';
import { activationTargetResource } from '../../../resources/activationTarget.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.activation-target.create');

export default createRegistryCommand({
  resource: activationTargetResource,
  operation: 'create',
  messages: commandMessages,
});
