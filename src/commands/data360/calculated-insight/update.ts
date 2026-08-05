import { loadCommandMessages } from '../../../messages.js';
import { calculatedInsightResource } from '../../../resources/calculatedInsight.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.calculated-insight.update');

export default createRegistryCommand({
  resource: calculatedInsightResource,
  operation: 'update',
  messages: commandMessages,
});
