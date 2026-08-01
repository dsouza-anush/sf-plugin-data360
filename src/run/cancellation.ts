import { loadCommandMessages } from '../messages.js';
import type { EventEmitter } from 'node:events';

const runtimeMessages = loadCommandMessages('data360.runtime.run.cancellation');

export type CommandCancellation = {
  signal: AbortSignal;
  dispose: () => void;
  tempRoot?: string;
};

export const createCommandCancellation = (_emitter: EventEmitter = process): CommandCancellation => {
  const controller = new AbortController();
  const onSigint = (): void => controller.abort(new Error(runtimeMessages.getMessage('error.RUNTIME_0.0')));
  _emitter.once('SIGINT', onSigint);
  return {
    signal: controller.signal,
    dispose: (): void => {
      _emitter.removeListener('SIGINT', onSigint);
    },
  };
};
