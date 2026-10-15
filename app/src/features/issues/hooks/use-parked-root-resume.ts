import type { ConversationChannel } from "@server/schemas";
import { useResumeParkedWorkRoot } from "../api/mutations";
import { useIssuesQuery } from "../api/queries";

export type ParkedRootResume = {
  pending: boolean;
  resume(note: string, onSuccess: () => void): void;
};

/**
 * For an implementing session on a parked work root: resume that root through
 * the queue with a note for its next coordinator. Undefined for any other
 * session.
 */
export function useParkedRootResume(
  issueId: string | undefined,
  channel: ConversationChannel | undefined,
): ParkedRootResume | undefined {
  const { data } = useIssuesQuery();
  const resume = useResumeParkedWorkRoot(issueId ?? "");
  if (channel !== "implementing" || issueId === undefined) return undefined;
  const root = data?.issues.find((issue) => issue.id === issueId);
  if ((root?.kind !== "epic" && root?.kind !== "story") || !root.workParkedAt) {
    return undefined;
  }
  return {
    pending: resume.isPending,
    resume: (note, onSuccess) => resume.mutate({ note }, { onSuccess }),
  };
}
