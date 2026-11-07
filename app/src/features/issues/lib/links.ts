export const ISSUE_LINK_PREFIX = "issue:";

export function issuePath(projectId: string, id: string): string {
  return `/projects/${projectId}/issues/${id}`;
}

export function projectPath(projectId: string): string {
  return issuePath(projectId, projectId);
}

/** Hash target for the Project settings Secrets card. */
export const PROJECT_SECRETS_CARD_ID = "secrets";

export function projectSecretsCardPath(projectId: string): string {
  return `${projectPath(projectId)}?tab=overview#${PROJECT_SECRETS_CARD_ID}`;
}

export function issueChannelPath(
  projectId: string,
  id: string,
  channel: string,
): string {
  return `${issuePath(projectId, id)}?tab=${encodeURIComponent(channel)}`;
}

export function parseIssueLink(href: string | undefined): string | null {
  if (!href || !href.startsWith(ISSUE_LINK_PREFIX)) return null;
  return href.slice(ISSUE_LINK_PREFIX.length);
}

export function linkNotFoundMessage(id: string): string {
  return `Link not found: ${id}`;
}
