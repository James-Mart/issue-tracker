export function pipelineRunPath(conversationId: string): string {
  return `/pipeline/runs/${encodeURIComponent(conversationId)}`;
}
