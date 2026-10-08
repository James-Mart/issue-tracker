import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import { subscribeTopic, type TopicMessage } from "@/lib/ws/transport";
import type { ProjectPrsResponse } from "@server/services/delivery";
import { PR_SYNC_TOPIC } from "@server/services/pr-sync-topic";
import { issuesKeys } from "./keys";

function projectIdFrom(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const record = event as { type?: unknown; projectId?: unknown };
  if (record.type !== "pr-sync" || typeof record.projectId !== "string") {
    return undefined;
  }
  return record.projectId;
}

/** Refetch one Project's cached PR facts after a sync pass finishes. */
export function useProjectPrSync(): void {
  const qc = useQueryClient();

  useEffect(() => {
    return subscribeTopic(PR_SYNC_TOPIC, (message: TopicMessage) => {
      if (message.type === "reset") {
        void qc.invalidateQueries({
          queryKey: [...issuesKeys.all, "projectPullRequests"],
        });
        return;
      }
      const projectId = projectIdFrom(message.event);
      if (!projectId) return;
      void qc.invalidateQueries({
        queryKey: issuesKeys.projectPullRequests(projectId),
      });
    });
  }, [qc]);
}

/** GitHub read while mergeability is still unknown. Merge and recorded-PR refreshes run on the server. */
export async function refreshProjectPullRequestsLive(
  qc: QueryClient,
  projectId: string,
): Promise<void> {
  try {
    await qc.fetchQuery({
      queryKey: issuesKeys.projectPullRequests(projectId),
      queryFn: () =>
        request<ProjectPrsResponse>(`/api/projects/${projectId}/prs?live=1`),
      retry: false,
      staleTime: Infinity,
    });
  } catch {
    // fetchQuery records the failure on this query. The panel renders that error.
  }
}
