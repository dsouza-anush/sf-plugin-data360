import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { dataStreamResource } from '../../../resources/dataStream.js';

const commandMessages = loadCommandMessages('data360.data-stream.create');

export default createRegistryCommand({
  resource: dataStreamResource,
  operation: 'create',
  messages: commandMessages,
});
