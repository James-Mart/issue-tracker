export function pipelineRunPath(conversationId: string): string {
  return `/runs/${encodeURIComponent(conversationId)}`;
}
