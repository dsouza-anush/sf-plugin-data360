import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { dataSpaceResource } from '../../../resources/dataSpace.js';

const commandMessages = loadCommandMessages('data360.data-space.get');

export default createRegistryCommand({
  resource: dataSpaceResource,
  operation: 'get',
  messages: commandMessages,
});
