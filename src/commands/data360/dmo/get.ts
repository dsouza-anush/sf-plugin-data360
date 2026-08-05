import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { dmoResource } from '../../../resources/dmo.js';

const commandMessages = loadCommandMessages('data360.dmo.get');

export default createRegistryCommand({
  resource: dmoResource,
  operation: 'get',
  messages: commandMessages,
});
