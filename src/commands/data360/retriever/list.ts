import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { retrieverResource } from '../../../resources/retriever.js';

const commandMessages = loadCommandMessages('data360.retriever.list');

export default createRegistryCommand({
  resource: retrieverResource,
  operation: 'list',
  messages: commandMessages,
});
