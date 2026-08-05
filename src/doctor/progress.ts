import { MultiStageOutput } from '@oclif/multi-stage-output';
import { loadCommandMessages } from '../messages.js';
import type { DoctorCheck } from './types.js';

const messages = loadCommandMessages('data360.runtime.doctor.progress');

export type DoctorProgress = {
  report(check: DoctorCheck): void;
  stop(): void;
};

export const createDoctorProgress = (options: {
  stages: string[];
  jsonEnabled: boolean;
  isTTY: boolean;
  log: (message: string) => void;
}): DoctorProgress => {
  if (options.jsonEnabled) return { report: (): void => {}, stop: (): void => {} };
  if (!options.isTTY) {
    return {
      report: (check): void =>
        options.log(messages.getMessage('status-line', [check.status, check.name, check.detail])),
      stop: (): void => {},
    };
  }
  const output = new MultiStageOutput({
    stages: options.stages,
    title: messages.getMessage('title'),
    jsonEnabled: false,
  });
  return {
    report: (check): void => output.goto(check.name),
    stop: (): void => output.stop(),
  };
};
