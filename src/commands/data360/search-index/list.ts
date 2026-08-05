import { loadCommandMessages } from '../../../messages.js';
import { createRegistryCommand } from '../../../resources/registry.js';
import { searchIndexResource } from '../../../resources/searchIndex.js';

const commandMessages = loadCommandMessages('data360.search-index.list');

export default createRegistryCommand({
  resource: searchIndexResource,
  operation: 'list',
  messages: commandMessages,
});
