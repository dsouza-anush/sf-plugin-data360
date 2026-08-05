import { loadCommandMessages } from '../../../messages.js';
import { dataActionTargetResource } from '../../../resources/dataActionTarget.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.data-action-target.list');

export default createRegistryCommand({
  resource: dataActionTargetResource,
  operation: 'list',
  messages: commandMessages,
});
