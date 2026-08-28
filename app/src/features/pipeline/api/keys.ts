export const pipelineKeys = {
  all: ["pipeline"] as const,
  runs: () => [...pipelineKeys.all, "runs"] as const,
  stepSource: (stepId: string) =>
    [...pipelineKeys.all, "stepSource", stepId] as const,
};
