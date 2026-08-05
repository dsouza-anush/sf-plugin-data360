import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { dataStreamResource } from '../../../resources/dataStream.js';

const commandMessages = loadCommandMessages('data360.data-stream.get');

export default createRegistryCommand({
  resource: dataStreamResource,
  operation: 'get',
  messages: commandMessages,
});
