import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { segmentResource } from '../../../resources/segment.js';

const commandMessages = loadCommandMessages('data360.segment.create');

export default createRegistryCommand({
  resource: segmentResource,
  operation: 'create',
  messages: commandMessages,
});
