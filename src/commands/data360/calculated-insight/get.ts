import { loadCommandMessages } from '../../../messages.js';
import { calculatedInsightResource } from '../../../resources/calculatedInsight.js';
import { createRegistryCommand } from '../../../resources/registry.js';

const commandMessages = loadCommandMessages('data360.calculated-insight.get');

export default createRegistryCommand({
  resource: calculatedInsightResource,
  operation: 'get',
  messages: commandMessages,
});
