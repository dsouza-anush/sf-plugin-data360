import { loadCommandMessages } from '../../../messages.js';
import { dataGraphResource } from '../../../resources/dataGraph.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.data-graph.create');

export default createRegistryCommand({
  resource: dataGraphResource,
  operation: 'create',
  messages: commandMessages,
});
