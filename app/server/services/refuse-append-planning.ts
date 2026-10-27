import { existsSync } from "fs";
import {
  appendPlanningContextForStory,
  appendPlanningRefusal,
} from "../append-planning-context.js";
import type { ConversationChannel } from "../schemas.js";
import { IssueError } from "./errors.js";
import { list } from "./issues.js";

/**
 * Planning-session create follows the append target's context.
 * Merged and closed targets refuse before any session is written.
 */
export function refuseAppendPlanningCreate(
  issueId: string,
  channel: ConversationChannel,
): void {
  if (channel !== "planning") return;
  const snapshot = list();
  const issue = snapshot.issues.find((item) => item.id === issueId);
  if (!issue || issue.kind !== "idea" || !issue.appendTo) return;
  const target = snapshot.issues.find((item) => item.id === issue.appendTo);
  if (!target || target.kind !== "story") return;
  const context = appendPlanningContextForStory(
    target,
    snapshot.derived[target.id]?.mergeBase,
    Boolean(target.worktreePath && existsSync(target.worktreePath)),
  );
  const message = appendPlanningRefusal(context);
  if (message) throw new IssueError("conflict", message);
}
