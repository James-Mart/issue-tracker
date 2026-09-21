import { skillPath } from "@/lib/plugin-paths";

/** Session title for a GitHub-export rewrite on a root. */
export function exportSessionTitle(issueTitle: string): string {
  return `Export ${issueTitle}`;
}

/** First prompt: load the rewrite skill for this root. */
export function exportSessionMessage(rootId: string): string {
  return (
    `Rewrite ${rootId} as GitHub export drafts using the issue-tracker-github-export skill. ` +
    `**Read** ${skillPath("issue-tracker-github-export")} and follow it.`
  );
}
