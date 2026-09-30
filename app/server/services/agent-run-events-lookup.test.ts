import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AT,
  delegation,
  fixtureConversationsDir,
  setupRunSequenceTest,
  subagentToolCall,
  teardownRunSequenceTest,
  writeConversation,
} from "./run-sequence.fixtures.js";

const ISSUE_ID = "linked-task";

function conversationsDir(): string {
  return fixtureConversationsDir();
}

function indexPath(): string {
  return join(dirname(conversationsDir()), "delegation-index.json");
}

function linked(
  delegationId: string,
  parentCallId: string | undefined,
  issueId = ISSUE_ID,
) {
  return delegation({
    delegationId,
    agentId: "agent-a",
    role: "implementor",
    model: "composer-2.5",
    at: AT,
    issueId,
    ...(parentCallId !== undefined ? { parentCallId } : {}),
  });
}

function nested(parentCallId: string, seq: number, callId: string) {
  return subagentToolCall({
    parentCallId,
    callId,
    status: "completed",
    at: AT,
    seq,
  });
}

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("delegation index", () => {
  it("builds once from existing records and then resolves without them", async () => {
    writeConversation("conv-owner", {
      delegations: [
        {
          ...linked("del-a", "call-a"),
          end: { status: "completed", endedAt: AT },
        },
      ],
    });
    writeConversation("conv-other", {
      delegations: [linked("del-b", "call-b", "other-issue")],
      transcript: [nested("call-b", 1, "other")],
    });

    const { resolveDelegation } = await import("./delegation-index.js");
    expect(resolveDelegation("del-a")).toEqual({
      conversationId: "conv-owner",
      parentCallId: "call-a",
      issueId: ISSUE_ID,
    });
    expect(existsSync(indexPath())).toBe(true);
    expect(existsSync(join(conversationsDir(), "delegation-index.json"))).toBe(
      false,
    );

    rmSync(join(conversationsDir(), "conv-owner", "delegations.jsonl"));
    writeConversation("conv-later", {
      delegations: [linked("del-a", "call-stolen", "other-issue")],
    });

    expect(resolveDelegation("del-a")).toEqual({
      conversationId: "conv-owner",
      parentCallId: "call-a",
      issueId: ISSUE_ID,
    });
    expect(resolveDelegation("del-missing")).toBeUndefined();
  });

  it("skips a delegation that has no parent call", async () => {
    writeConversation("conv-owner", {
      delegations: [linked("del-open", undefined)],
    });
    const { resolveDelegation } = await import("./delegation-index.js");
    expect(resolveDelegation("del-open")).toBeUndefined();
  });

  it("skips an unreadable conversation and still indexes the others", async () => {
    const bad = join(conversationsDir(), "conv-bad");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "meta.json"), "{not json");
    writeConversation("conv-owner", {
      delegations: [linked("del-a", "call-a")],
    });
    const { resolveDelegation } = await import("./delegation-index.js");
    expect(resolveDelegation("del-a")?.conversationId).toBe("conv-owner");
  });

  it("records a delegation write and keeps the first owner", async () => {
    const { createConversation, appendDelegation } = await import(
      "./conversations.js"
    );
    const { resolveDelegation } = await import("./delegation-index.js");
    const owner = await createConversation({
      title: "Owner",
      projectId: "platform",
      model: "composer-2.5",
    });
    const other = await createConversation({
      title: "Other",
      projectId: "platform",
      model: "composer-2.5",
    });
    await appendDelegation(owner.id, {
      delegationId: "del-live",
      agentId: "agent-a",
      role: "implementor",
      model: "composer-2.5",
      issueId: ISSUE_ID,
      parentCallId: "call-live",
    });
    await appendDelegation(other.id, {
      delegationId: "del-live",
      agentId: "agent-b",
      role: "implementor",
      model: "composer-2.5",
      issueId: "other-issue",
      parentCallId: "call-other",
    });
    expect(resolveDelegation("del-live")).toEqual({
      conversationId: owner.id,
      parentCallId: "call-live",
      issueId: ISSUE_ID,
    });
  });

  it("builds a missing index on a delegation end write", async () => {
    writeConversation("conv-owner", {
      delegations: [linked("del-a", "call-a")],
    });
    const { appendDelegationEnd } = await import("./conversations.js");
    const { resolveDelegation } = await import("./delegation-index.js");
    expect(existsSync(indexPath())).toBe(false);
    await appendDelegationEnd("conv-owner", {
      delegationId: "del-a",
      status: "completed",
    });
    expect(resolveDelegation("del-a")?.conversationId).toBe("conv-owner");
  });

  it("drops a deleted conversation and keeps the others", async () => {
    const { createConversation, appendDelegation, deleteConversation } =
      await import("./conversations.js");
    const { resolveDelegation } = await import("./delegation-index.js");
    const gone = await createConversation({
      title: "Gone",
      projectId: "platform",
      model: "composer-2.5",
    });
    const kept = await createConversation({
      title: "Kept",
      projectId: "platform",
      model: "composer-2.5",
    });
    await appendDelegation(gone.id, {
      delegationId: "del-gone",
      agentId: "agent-a",
      role: "implementor",
      model: "composer-2.5",
      issueId: ISSUE_ID,
      parentCallId: "call-gone",
    });
    await appendDelegation(kept.id, {
      delegationId: "del-kept",
      agentId: "agent-b",
      role: "implementor",
      model: "composer-2.5",
      issueId: ISSUE_ID,
      parentCallId: "call-kept",
    });
    await deleteConversation(gone.id);
    expect(resolveDelegation("del-gone")).toBeUndefined();
    expect(resolveDelegation("del-kept")?.conversationId).toBe(kept.id);
  });

  it("refuses a corrupt index", async () => {
    writeFileSync(indexPath(), "{not json");
    const { resolveDelegation } = await import("./delegation-index.js");
    expect(() => resolveDelegation("del-a")).toThrow(/invalid delegation index/);
  });
});

describe("run event log", () => {
  it("reads one run from a legacy transcript and ignores later transcript edits", async () => {
    writeConversation("conv-owner", {
      delegations: [linked("del-a", "call-a"), linked("del-b", "call-b")],
      transcript: [
        nested("call-a", 4, "second"),
        nested("call-b", 2, "sibling"),
        nested("call-a", 1, "first"),
      ],
    });
    writeConversation("conv-other", {
      delegations: [linked("del-c", "call-c")],
      transcript: [nested("call-c", 1, "elsewhere")],
    });

    const { listAgentRunEvents } = await import("./agent-runs.js");
    const events = listAgentRunEvents(ISSUE_ID, "del-a");
    expect(events?.map((event) => event.step)).toEqual([
      { kind: "tool_call", callId: "first", name: "delegate", status: "completed" },
      { kind: "tool_call", callId: "second", name: "delegate", status: "completed" },
    ]);
    expect(existsSync(join(conversationsDir(), "conv-owner", "run-events", "ready"))).toBe(
      true,
    );
    expect(existsSync(join(conversationsDir(), "conv-other", "run-events"))).toBe(
      false,
    );

    writeFileSync(join(conversationsDir(), "conv-owner", "transcript.jsonl"), "");
    const again = listAgentRunEvents(ISSUE_ID, "del-a");
    expect(again?.map((event) => event.step)).toEqual([
      { kind: "tool_call", callId: "first", name: "delegate", status: "completed" },
      { kind: "tool_call", callId: "second", name: "delegate", status: "completed" },
    ]);
    expect(listAgentRunEvents("other-issue", "del-a")).toBeUndefined();
    expect(listAgentRunEvents(ISSUE_ID, "del-empty")).toBeUndefined();
  });

  it("returns an empty list for a linked run that has no events", async () => {
    writeConversation("conv-owner", {
      delegations: [linked("del-a", "call-a")],
      transcript: [nested("call-other", 1, "not-this-run")],
    });
    const { listAgentRunEvents } = await import("./agent-runs.js");
    expect(listAgentRunEvents(ISSUE_ID, "del-a")).toEqual([]);
  });

  it("appends each subagent_update with the transcript write", async () => {
    const { createConversation, appendDelegation, appendEvent } = await import(
      "./conversations.js"
    );
    const { listAgentRunEvents } = await import("./agent-runs.js");
    const meta = await createConversation({
      title: "Live",
      projectId: "platform",
      model: "composer-2.5",
    });
    await appendDelegation(meta.id, {
      delegationId: "del-live",
      agentId: "agent-a",
      role: "implementor",
      model: "composer-2.5",
      issueId: ISSUE_ID,
      parentCallId: "call/live",
    });
    await appendEvent(meta.id, {
      type: "prompt",
      text: "go",
    });
    expect(existsSync(join(conversationsDir(), meta.id, "run-events"))).toBe(false);

    await appendEvent(meta.id, {
      type: "subagent_update",
      parentCallId: "call/live",
      step: { kind: "text", text: "one" },
    });
    await appendEvent(meta.id, {
      type: "subagent_update",
      parentCallId: "ready",
      step: { kind: "text", text: "marker name" },
    });
    await appendEvent(meta.id, {
      type: "subagent_update",
      parentCallId: "call/live",
      step: { kind: "text", text: "two" },
    });
    await appendEvent(meta.id, {
      type: "subagent_update",
      parentCallId: "..",
      step: { kind: "text", text: "dotdot" },
    });

    const events = listAgentRunEvents(ISSUE_ID, "del-live");
    expect(events?.map((event) => event.step)).toEqual([
      { kind: "text", text: "one" },
      { kind: "text", text: "two" },
    ]);
    const readyMarker = readFileSync(
      join(conversationsDir(), meta.id, "run-events", "ready"),
      "utf8",
    );
    expect(readyMarker).toBe("");
    const names = ["call%2Flive.jsonl", "ready.jsonl", "ready"];
    for (const name of names) {
      expect(existsSync(join(conversationsDir(), meta.id, "run-events", name))).toBe(
        true,
      );
    }
    const dotdot = `${createHash("sha256").update("..").digest("hex")}.jsonl`;
    expect(existsSync(join(conversationsDir(), meta.id, "run-events", dotdot))).toBe(
      true,
    );
  });

  it("appends to an existing log after the transcript was the backfill source", async () => {
    writeConversation("conv-owner", {
      delegations: [linked("del-a", "call-a")],
      transcript: [nested("call-a", 1, "legacy")],
    });
    const { listAgentRunEvents } = await import("./agent-runs.js");
    const { appendEvent } = await import("./conversations.js");
    expect(listAgentRunEvents(ISSUE_ID, "del-a")).toHaveLength(1);
    writeFileSync(join(conversationsDir(), "conv-owner", "transcript.jsonl"), "");
    await appendEvent("conv-owner", {
      type: "subagent_update",
      parentCallId: "call-a",
      step: { kind: "text", text: "live" },
    });
    expect(listAgentRunEvents(ISSUE_ID, "del-a")?.map((event) => event.step)).toEqual([
      { kind: "tool_call", callId: "legacy", name: "delegate", status: "completed" },
      { kind: "text", text: "live" },
    ]);
  });
});
