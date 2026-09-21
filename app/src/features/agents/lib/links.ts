export const AGENTS_PATH = "/agents";

export function agentsConversationPath(conversationId: string): string {
  return `${AGENTS_PATH}/${conversationId}`;
}
