import { request } from "@/lib/api/client";
import type { AgentRun } from "@server/schemas";

export type IssueAgentRunsResponse = {
  runs: AgentRun[];
};

/** List agent runs linked to an issue, oldest spawn first. */
export function fetchIssueAgentRuns(
  issueId: string,
): Promise<IssueAgentRunsResponse> {
  return request<IssueAgentRunsResponse>(
    `/api/issues/${encodeURIComponent(issueId)}/agent-runs`,
  );
}
