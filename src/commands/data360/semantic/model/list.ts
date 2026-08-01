import { loadCommandMessages } from '../../../../messages.js';
import { createRegistryCommand } from '../../../../resources/registry.js';
import { semanticModelResource } from '../../../../resources/semanticModel.js';

const commandMessages = loadCommandMessages('data360.semantic.model.list');

export default createRegistryCommand({
  resource: semanticModelResource,
  operation: 'list',
  messages: commandMessages,
});
