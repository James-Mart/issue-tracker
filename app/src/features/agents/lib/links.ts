export const CHAT_PATH = "/chat";
export const AGENTS_CATALOG_PATH = "/agents";

export function isChatAreaPath(pathname: string): boolean {
  return pathname === CHAT_PATH || pathname.startsWith(`${CHAT_PATH}/`);
}

export function isAgentsCatalogPath(pathname: string): boolean {
  return (
    pathname === AGENTS_CATALOG_PATH ||
    pathname.startsWith(`${AGENTS_CATALOG_PATH}/`)
  );
}

export type AgentsCatalogSelection =
  | { kind: "list" }
  | { kind: "default" }
  | { kind: "profile"; id: string }
  | { kind: "role"; id: string };

export function agentsCatalogDefaultPath(): string {
  return `${AGENTS_CATALOG_PATH}/default`;
}

export function agentsCatalogProfilePath(profileId: string): string {
  return `${AGENTS_CATALOG_PATH}/profiles/${encodeURIComponent(profileId)}`;
}

export function agentsCatalogRolePath(roleId: string): string {
  return `${AGENTS_CATALOG_PATH}/roles/${encodeURIComponent(roleId)}`;
}

export function agentsCatalogEntryPath(entry: {
  kind: "default" | "profile" | "role";
  id: string;
}): string {
  if (entry.kind === "default") return agentsCatalogDefaultPath();
  if (entry.kind === "profile") return agentsCatalogProfilePath(entry.id);
  return agentsCatalogRolePath(entry.id);
}

export function chatConversationPath(conversationId: string): string {
  return `${CHAT_PATH}/${encodeURIComponent(conversationId)}`;
}
