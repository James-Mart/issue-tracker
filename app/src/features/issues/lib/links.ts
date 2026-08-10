export const ISSUE_LINK_PREFIX = "issue:";

export function projectPath(projectId: string): string {
  return `/projects/${projectId}`;
}

export function issuePath(projectId: string, id: string): string {
  return `/projects/${projectId}/issues/${id}`;
}

export function parseIssueLink(href: string | undefined): string | null {
  if (!href || !href.startsWith(ISSUE_LINK_PREFIX)) return null;
  return href.slice(ISSUE_LINK_PREFIX.length);
}

export function linkNotFoundMessage(id: string): string {
  return `Link not found: ${id}`;
}
