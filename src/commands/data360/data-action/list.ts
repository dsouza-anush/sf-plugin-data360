import { loadCommandMessages } from '../../../messages.js';
import { dataActionResource } from '../../../resources/dataAction.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.data-action.list');

export default createRegistryCommand({
  resource: dataActionResource,
  operation: 'list',
  messages: commandMessages,
});
