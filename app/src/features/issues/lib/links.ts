import { writeChatCompanionParam } from "./chat-companion";

export const ISSUE_LINK_PREFIX = "issue:";

export function projectPath(projectId: string): string {
  return `/projects/${projectId}`;
}

export function issuePath(projectId: string, id: string): string {
  return `/projects/${projectId}/issues/${id}`;
}

/**
 * Detail route with chat companion forced open. Absence means adaptive, so
 * Jump-to-chat must set an explicit `chat=expanded` override.
 */
export function issueChatPath(projectId: string, id: string): string {
  const params = writeChatCompanionParam(new URLSearchParams(), "expanded");
  return `${issuePath(projectId, id)}?${params.toString()}`;
}

export function parseIssueLink(href: string | undefined): string | null {
  if (!href || !href.startsWith(ISSUE_LINK_PREFIX)) return null;
  return href.slice(ISSUE_LINK_PREFIX.length);
}

export function linkNotFoundMessage(id: string): string {
  return `Link not found: ${id}`;
}
