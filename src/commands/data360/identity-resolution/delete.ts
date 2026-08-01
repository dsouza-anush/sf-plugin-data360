import { loadCommandMessages } from '../../../messages.js';
import { identityResolutionResource } from '../../../resources/identityResolution.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.identity-resolution.delete');

export default createRegistryCommand({
  resource: identityResolutionResource,
  operation: 'delete',
  messages: commandMessages,
});
