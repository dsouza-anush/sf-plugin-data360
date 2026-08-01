import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { segmentResource } from '../../../resources/segment.js';

const commandMessages = loadCommandMessages('data360.segment.update');

export default createRegistryCommand({
  resource: segmentResource,
  operation: 'update',
  messages: commandMessages,
});
