import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { segmentResource } from '../../../resources/segment.js';

const commandMessages = loadCommandMessages('data360.segment.delete');

export default createRegistryCommand({
  resource: segmentResource,
  operation: 'delete',
  messages: commandMessages,
});
