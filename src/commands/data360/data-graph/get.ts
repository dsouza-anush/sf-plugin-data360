import { loadCommandMessages } from '../../../messages.js';
import { dataGraphResource } from '../../../resources/dataGraph.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.data-graph.get');

export default createRegistryCommand({
  resource: dataGraphResource,
  operation: 'get',
  messages: commandMessages,
});
