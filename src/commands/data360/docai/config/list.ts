import { loadCommandMessages } from '../../../../messages.js';
import { createRegistryCommand } from '../../../../resources/registry.js';
import { docAiConfigurationResource } from '../../../../resources/docAiConfiguration.js';

const commandMessages = loadCommandMessages('data360.docai.config.list');

export default createRegistryCommand({
  resource: docAiConfigurationResource,
  operation: 'list',
  messages: commandMessages,
});
