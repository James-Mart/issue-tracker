import type { IssueRecord } from "@server/schemas";

export function issueMatchesSearch(issue: IssueRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    issue.title.toLowerCase().includes(q) || issue.id.toLowerCase().includes(q)
  );
}
