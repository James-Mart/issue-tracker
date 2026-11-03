import { listedAgentModels } from "../agent-model-slugs.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import {
  clearWorkQueueFields,
  startIssueChannelSession,
} from "./conversations.js";
import { implementingSessionModel } from "./implementing-launch.js";
import { requireProjectWorkspace } from "./project-workspace.js";

/**
 * Open an implementing session and start its first turn.
 * The caller supplies the full first-prompt text.
 */
export async function startImplementingChannelSession(
  input: {
    projectId: string;
    issueId: string;
    title: string;
    message: string;
  },
  sessions: ConversationMessageSessions,
): Promise<void> {
  requireProjectWorkspace(input.projectId);
  const model = implementingSessionModel(listedAgentModels());
  if (!model) {
    throw new Error("no coordinator model is available");
  }
  await startIssueChannelSession(
    {
      projectId: input.projectId,
      title: input.title,
      model,
      issueId: input.issueId,
      channel: "implementing",
      message: input.message,
    },
    sessions,
  );
  await clearWorkQueueFields(input.issueId);
}
