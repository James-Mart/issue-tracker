import type { Issue } from "../schemas.js";
import {
  planningSessionMessage,
  planningSessionModel,
  planningSessionTitle,
} from "../../src/features/issues/lib/planning-launch.js";
import type { AgentSessions } from "./agent-sessions.js";
import {
  createIssueChannelSession,
  startConversationPrompt,
} from "./conversations.js";
import { appendComment, list, update } from "./issues.js";

type QueuedIdea = Extract<Issue, { kind: "idea" }>;

function queuedIdeas(): QueuedIdea[] {
  const eligible = list().issues.filter(
    (issue): issue is QueuedIdea =>
      issue.kind === "idea" &&
      Boolean(issue.planQueuedAt) &&
      Boolean(issue.stakeholder),
  );
  eligible.sort((a, b) => a.planQueuedAt!.localeCompare(b.planQueuedAt!));
  return eligible;
}

async function clearPlanQueuedAt(ideaId: string): Promise<void> {
  await update(ideaId, { planQueuedAt: null });
}

async function noteAutoPlanFailure(
  ideaId: string,
  message: string,
): Promise<void> {
  await clearPlanQueuedAt(ideaId);
  await appendComment(ideaId, {
    role: "launcher",
    body: `Auto-plan failed to start: ${message}`,
  });
}

async function startQueuedIdea(
  idea: QueuedIdea,
  sessions: AgentSessions,
): Promise<void> {
  const stakeholder = idea.stakeholder!;
  const title = planningSessionTitle(idea.title);
  const model = planningSessionModel(stakeholder, stakeholder);
  const message = planningSessionMessage(idea.id, stakeholder);
  const { meta, initialPrompt } = await createIssueChannelSession(
    {
      projectId: idea.partOf,
      title,
      model,
      issueId: idea.id,
      channel: "planning",
      message,
    },
    sessions,
  );
  if (!initialPrompt) return;
  const started = await startConversationPrompt(
    meta.id,
    initialPrompt,
    model,
    sessions,
    { persistPrompt: false },
  );
  if (!started.ok) {
    throw new Error(started.message);
  }
}

/** Drain Ideas carrying planQueuedAt across all Projects, oldest first. */
export async function drainPlanQueue(sessions: AgentSessions): Promise<void> {
  for (const idea of queuedIdeas()) {
    try {
      await startQueuedIdea(idea, sessions);
      await clearPlanQueuedAt(idea.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await noteAutoPlanFailure(idea.id, message);
    }
  }
}
