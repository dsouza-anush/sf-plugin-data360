import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { connectorResource } from '../../../resources/connector.js';

const commandMessages = loadCommandMessages('data360.connector.get');

export default createRegistryCommand({
  resource: connectorResource,
  operation: 'get',
  messages: commandMessages,
});
