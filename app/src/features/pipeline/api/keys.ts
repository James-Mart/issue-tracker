export const pipelineKeys = {
  all: ["pipeline"] as const,
  stepSource: (stepId: string) =>
    [...pipelineKeys.all, "stepSource", stepId] as const,
};
