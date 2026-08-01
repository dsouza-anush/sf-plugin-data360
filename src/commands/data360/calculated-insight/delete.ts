import { loadCommandMessages } from '../../../messages.js';
import { calculatedInsightResource } from '../../../resources/calculatedInsight.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.calculated-insight.delete');

export default createRegistryCommand({
  resource: calculatedInsightResource,
  operation: 'delete',
  messages: commandMessages,
});
