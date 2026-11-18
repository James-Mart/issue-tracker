export const CHAT_PATH = "/chat";
export const LEGACY_AGENTS_PATH = "/agents";

export function isChatAreaPath(pathname: string): boolean {
  return (
    pathname === CHAT_PATH ||
    pathname.startsWith(`${CHAT_PATH}/`) ||
    pathname === LEGACY_AGENTS_PATH ||
    pathname.startsWith(`${LEGACY_AGENTS_PATH}/`)
  );
}

export function chatConversationPath(conversationId: string): string {
  return `${CHAT_PATH}/${encodeURIComponent(conversationId)}`;
}
