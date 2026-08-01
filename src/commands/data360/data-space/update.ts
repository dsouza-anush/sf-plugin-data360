import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { dataSpaceResource } from '../../../resources/dataSpace.js';

const commandMessages = loadCommandMessages('data360.data-space.update');

export default createRegistryCommand({
  resource: dataSpaceResource,
  operation: 'update',
  messages: commandMessages,
});
