import { deleteConversation } from "@/features/agents/api/client";
import { listChannelSessions } from "../api/channel-sessions";

/** Delete every planning-channel session on an Idea, in list order. */
export async function deletePartialPlanSessions(issueId: string): Promise<void> {
  const sessions = await listChannelSessions(issueId, "planning");
  for (const session of sessions) {
    await deleteConversation(session.id);
  }
}
