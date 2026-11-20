import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import {
  AT,
  conversationPath,
  prompt,
  writeConversation,
  writeIssue,
} from "./run-sequence.fixtures.js";

export const PLANNER_AT = "2026-07-09T14:01:00.000Z";
export const PLANNER_ROLE = "issue-tracker-planner-grok";

export const appendPlanningIdle = {
  isBusy: () => false,
  claimStart: () => ({ release() {} }),
};

export function writeJsonl(path: string, rows: readonly unknown[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

/** Platform, origin idea, spec outline, target story, and one append Idea. */
export function seedAppendPlanningGraph(
  appendIdea: { id: string; title: string; order: number },
  extraIdeas: readonly { id: string; title: string; order: number }[] = [],
): void {
  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    workspace: "/tmp/repo",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("origin", {
    kind: "idea",
    title: "Origin",
    partOf: "platform",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("spec", {
    kind: "outline",
    title: "Feature outline",
    partOf: "platform",
    bodyVersion: 1,
    sourceIdea: "origin",
    order: 2,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("target", {
    kind: "story",
    title: "Target",
    partOf: "platform",
    sourceOutline: { outline: "spec", version: 1 },
    order: 3,
    createdAt: AT,
    updatedAt: AT,
  });
  const appendIdeas = [appendIdea, ...extraIdeas];
  for (const idea of appendIdeas) {
    writeIssue(idea.id, {
      kind: "idea",
      title: idea.title,
      partOf: "platform",
      appendTo: "target",
      order: idea.order,
      createdAt: AT,
      updatedAt: AT,
    });
  }
}

export function seedOutlinePlanner(extra: Record<string, unknown> = {}): void {
  writeConversation("outline-planner", {
    transcript: [prompt("OUTLINE PLANNER CONTEXT", PLANNER_AT, 1)],
    meta: {
      title: "Plan feature",
      projectId: "platform",
      issueId: "spec",
      channel: "planning",
      outlineRole: "planner",
      model: "composer-2.5",
      role: PLANNER_ROLE,
      agentId: "planner-agent",
      ...extra,
    },
  });
  writeJsonl(conversationPath("outline-planner", "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.runs), [
    {
      runId: "run-planner",
      agentId: "planner-agent",
      turnNumber: 1,
      status: "finished",
      createdAt: Date.parse(PLANNER_AT),
      updatedAt: Date.parse(PLANNER_AT),
      startedAt: Date.parse(PLANNER_AT),
      startCheckpointRef: null,
      latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-planner" },
    },
  ]);
  writeJsonl(conversationPath("outline-planner", "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.agents), [
    {
      agentId: "planner-agent",
      status: "idle",
      activeRunId: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
}