export const pipelineKeys = {
  all: ["pipeline"] as const,
  runs: () => [...pipelineKeys.all, "runs"] as const,
  run: (conversationId: string) =>
    [...pipelineKeys.runs(), conversationId] as const,
  stepSource: (stepId: string) =>
    [...pipelineKeys.all, "stepSource", stepId] as const,
};
