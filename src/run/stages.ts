import { MultiStageOutput } from '@oclif/multi-stage-output';

export type JobProgress = { goto(stage: string, detail?: string): void; stop(error?: Error): void };

export const createJobProgress = (options: {
  title: string;
  stages: string[];
  jsonEnabled: boolean;
  isTTY?: boolean;
  ci?: boolean;
  log?: (message: string) => void;
}): JobProgress => {
  if (options.jsonEnabled) return { goto: (): void => {}, stop: (): void => {} };
  if (!options.isTTY || options.ci) {
    const log =
      options.log ??
      ((message: string): void => {
        process.stderr.write(`${message}\n`);
      });
    return {
      goto: (stage, detail): void => log(`${options.title}: ${stage}${detail ? ` — ${detail}` : ''}`),
      stop: (error): void => {
        if (error) log(`${options.title}: failed — ${error.message}`);
      },
    };
  }
  const output = new MultiStageOutput<{ detail?: string }>({
    title: options.title,
    stages: options.stages,
    jsonEnabled: false,
    postStagesBlock: [{ type: 'dynamic-key-value', label: 'Status', get: (data): string | undefined => data?.detail }],
  });
  return {
    goto: (stage, detail): void => output.goto(stage, detail ? { detail } : undefined),
    stop: (error): void => output.stop(error ? 'failed' : undefined),
  };
};
