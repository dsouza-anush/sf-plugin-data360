export const BILLABLE_USAGE_URL =
  'https://help.salesforce.com/s/articleView?id=data.c360_a_data_usage_types.htm&type=5';
export const billableNotice = (pool: string): string =>
  `Note: this run bills ${pool} credits (rows-processed based). Docs: ${BILLABLE_USAGE_URL}`;
