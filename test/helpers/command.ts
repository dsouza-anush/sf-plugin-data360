import { TestContext } from '@salesforce/core/testSetup';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';

export type CommandTestContext = {
  context: TestContext;
  ux: ReturnType<typeof stubSfCommandUx>;
};

export const createCommandTestContext = (): CommandTestContext => {
  const context = new TestContext();
  const ux = {} as ReturnType<typeof stubSfCommandUx>;
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];
  const proxyVariables = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'all_proxy',
  ];
  let originalListeners = new Map<NodeJS.Signals, Array<(...args: unknown[]) => void>>();
  let originalProxyEnvironment = new Map<string, string | undefined>();
  beforeEach(() => {
    originalListeners = new Map(
      signals.map((signal) => [signal, process.listeners(signal) as Array<(...args: unknown[]) => void>])
    );
    originalProxyEnvironment = new Map(proxyVariables.map((name) => [name, process.env[name]]));
    for (const name of proxyVariables) delete process.env[name];
    Object.assign(ux, stubSfCommandUx(context.SANDBOX));
  });
  afterEach(() => {
    for (const signal of signals) {
      const original = originalListeners.get(signal) ?? [];
      for (const listener of process.listeners(signal) as Array<(...args: unknown[]) => void>) {
        if (!original.includes(listener)) process.removeListener(signal, listener);
      }
    }
    for (const [name, value] of originalProxyEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return {
    context,
    ux,
  };
};
