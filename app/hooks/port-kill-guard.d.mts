export function resolveConversationsDir(hookDir?: string): string;

export function decidePortKillPermission(args: {
  command: string;
  conversationId: string | undefined;
  conversationsDir: string;
}):
  | { permission: "allow" }
  | { permission: "deny"; agent_message: string };
