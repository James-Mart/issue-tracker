import { existsSync, readFileSync } from "fs";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendPlanningIdle,
  PLANNER_ROLE,
  seedAppendPlanningGraph,
  seedOutlinePlanner,
} from "./append-planning.test-helpers.js";
import {
  conversationPath,
  setupRunSequenceTest,
  teardownRunSequenceTest,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
  seedAppendPlanningGraph({ id: "append-idea", title: "Append", order: 4 });
});

afterEach(() => {
  teardownRunSequenceTest();
});

async function start(message: string, model = "cursor-grok-4.7") {
  const { createIssueChannelSession, listConversations } = await import(
    "./conversations.js"
  );
  const { meta } = await createIssueChannelSession(
    {
      issueId: "append-idea",
      channel: "planning",
      projectId: "platform",
      title: "Plan Append",
      model,
      message,
    },
    appendPlanningIdle,
  );
  const transcript = readFileSync(conversationPath(meta.id, "transcript.jsonl"), "utf8");
  return { meta, transcript, sessions: listConversations() };
}

describe("createIssueChannelSession append planner fork", () => {
  it("forks the outline planner into the append Idea's planning session", async () => {
    seedOutlinePlanner();
    const { meta, transcript, sessions } = await start("Plan the append.");

    expect(meta).toMatchObject({
      issueId: "append-idea",
      channel: "planning",
      forkedFrom: "outline-planner",
      forkedAtSeq: 1,
      model: "composer-2.5",
      role: PLANNER_ROLE,
    });
    expect(transcript).toContain("OUTLINE PLANNER CONTEXT");
    expect(transcript).toContain("Plan the append.");
    expect(
      existsSync(conversationPath(meta.id, "agent-state", JSONL_LOCAL_AGENT_STORE_FILES.runs)),
    ).toBe(true);
    expect(sessions.find((session) => session.id === "outline-planner")).toMatchObject({
      archived: false,
      issueId: "spec",
    });
  });
});