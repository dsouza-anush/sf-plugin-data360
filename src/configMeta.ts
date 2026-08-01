import { ConfigAggregator, type ConfigPropertyMeta } from '@salesforce/core';
import { loadCommandMessages } from './messages.js';

const messages = loadCommandMessages('data360.common');

export const DATA_SPACE_CONFIG_KEY = 'data360-data-space';
export const CREDIT_NOTICES_CONFIG_KEY = 'data360-credit-notices';

export const shouldDisplayCreditNotice = (info: { value?: unknown }): boolean =>
  info.value !== false && !(typeof info.value === 'string' && info.value.toLowerCase() === 'false');

export const resolveCreditNotices = async (aggregator?: DataSpaceConfigAggregator): Promise<boolean> => {
  const resolved = aggregator ?? (await ConfigAggregator.create({ customConfigMeta: [...configMeta] }));
  return shouldDisplayCreditNotice(resolved.getInfo(CREDIT_NOTICES_CONFIG_KEY));
};

export const configMeta: ConfigPropertyMeta[] = [
  {
    key: DATA_SPACE_CONFIG_KEY,
    description: messages.getMessage('config.data-space.description'),
    hidden: false,
  },
  {
    key: CREDIT_NOTICES_CONFIG_KEY,
    description: messages.getMessage('config.credit-notices.description'),
    hidden: false,
  },
] as const;

export type DataSpaceConfigAccess = {
  getLocal: (key: string) => Promise<string | undefined>;
  getGlobal: (key: string) => Promise<string | undefined>;
};

export type ResolveDataSpaceOptions = {
  flagValue?: string;
  env?: Readonly<Record<string, string | undefined>>;
  config: DataSpaceConfigAccess;
};

export type DataSpaceConfigAggregator = {
  getInfo(key: string): {
    location?: 'Local' | 'Global' | 'Environment';
    value?: unknown;
  };
};

export const createDataSpaceConfigAccess = (aggregator: DataSpaceConfigAggregator): DataSpaceConfigAccess => {
  const get = async (location: 'Local' | 'Global'): Promise<string | undefined> => {
    const info = aggregator.getInfo(DATA_SPACE_CONFIG_KEY);
    return info.location === location && typeof info.value === 'string' ? info.value : undefined;
  };
  return {
    getLocal: async () => get('Local'),
    getGlobal: async () => get('Global'),
  };
};

export type ResolveCommandDataSpaceOptions = {
  flagValue?: string;
  env?: Readonly<Record<string, string | undefined>>;
  aggregator?: DataSpaceConfigAggregator;
};

export const resolveCommandDataSpace = async ({
  flagValue,
  env = process.env,
  aggregator,
}: ResolveCommandDataSpaceOptions): Promise<string> => {
  const commandAggregator = aggregator ?? (await ConfigAggregator.create({ customConfigMeta: [...configMeta] }));
  return resolveDataSpace({
    flagValue,
    env,
    config: createDataSpaceConfigAccess(commandAggregator),
  });
};

export const resolveDataSpace = async ({
  flagValue,
  env = process.env,
  config,
}: ResolveDataSpaceOptions): Promise<string> =>
  flagValue ??
  env.SF_DATA360_DATA_SPACE ??
  (await config.getLocal(DATA_SPACE_CONFIG_KEY)) ??
  (await config.getGlobal(DATA_SPACE_CONFIG_KEY)) ??
  'default';

export default configMeta;
