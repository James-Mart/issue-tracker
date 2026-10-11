import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import {
  GUEST_REFUSED_CHANNEL_SESSION,
  GUEST_REFUSED_CONVERSATION_MESSAGE,
  GUEST_REFUSED_CONVERSATION_PROMPT,
  GUEST_REFUSED_DELEGATE,
  GUEST_REFUSED_FORK,
  GUEST_REFUSED_PREWARM,
  GUEST_REFUSED_RESUME_AGENT,
  GUEST_REFUSED_START_AGENT,
} from "./guest-agent-launch.js";
import {
  AT,
  createGuestStore,
  disposeGuestStore,
  expectGuest,
  type GuestStore,
  listen,
  writeIssue,
} from "./guest-refusal.test-harness.js";

const AT_END = "2026-07-09T16:00:00.000Z";
const QUEUED = "2026-07-01T00:00:00.000Z";

let store: GuestStore;
let root: string;
let issuesDir: string;
let conversationsDir: string;
let server: Server | undefined;
let baseUrl: string;
let sendPrompt: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let steer: ReturnType<typeof vi.fn>;

function conversationIds(): string[] {
  if (!existsSync(conversationsDir)) return [];
  return readdirSync(conversationsDir).sort();
}

function transcriptOf(id: string): string {
  return readFileSync(join(conversationsDir, id, "transcript.jsonl"), "utf8");
}

function stubSessions(): AgentSessions {
  sendPrompt = vi.fn();
  cancel = vi.fn(async () => true);
  steer = vi.fn(async () => "complete_delivered");
  return {
    sendPrompt,
    getActiveRun(conversationId: string) {
      if (conversationId !== "live") return undefined;
      return {
        id: "run-live",
        startedAt: AT,
        steer,
        wait: async () => ({ id: "run-live", status: "finished" as const }),
      };
    },
    listActiveRuns: () => [],
    cancel,
    dispose: vi.fn(),
    disposeAll: vi.fn(),
  };
}

beforeEach(() => {
  store = createGuestStore("issue-tracker-guest-launch-");
  ({ root, issuesDir } = store);
  conversationsDir = join(root, "conversations");
  mkdirSync(conversationsDir, { recursive: true });
  server = undefined;
});

afterEach(async () => {
  await disposeGuestStore(store, server);
});

describe("guest agent launch refusals", () => {
  beforeEach(async () => {
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    writeIssue(issuesDir, "platform", {
      kind: "project",
      title: "Platform",
      order: 0,
      workspace,
      maxImplementingRuns: 1,
      autonomous: true,
    });
    writeIssue(issuesDir, "ship", {
      kind: "epic",
      title: "Ship",
      partOf: "platform",
      order: 1,
      workQueuedAt: QUEUED,
    });
    writeIssue(issuesDir, "story", {
      kind: "story",
      title: "Story",
      partOf: "ship",
      order: 1,
    });
    writeIssue(issuesDir, "linked-task", {
      kind: "task",
      title: "Linked task",
      partOf: "story",
      status: "todo",
      order: 1,
    });
    writeIssue(issuesDir, "idea", {
      kind: "idea",
      title: "Idea",
      partOf: "platform",
      order: 2,
      archived: false,
      stakeholder: "composer-2.5",
      planQueuedAt: QUEUED,
    });

    const copied = join(conversationsDir, "copied");
    mkdirSync(copied, { recursive: true });
    writeFileSync(
      join(copied, "meta.json"),
      `${JSON.stringify(
        {
          id: "copied",
          title: "Copied chat",
          projectId: "platform",
          model: "composer-2.5",
          createdAt: AT,
          updatedAt: AT,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(copied, "transcript.jsonl"),
      `${JSON.stringify({ type: "prompt", text: "copied prompt", at: AT })}\n`,
    );

    const channel = join(conversationsDir, "channel-copied");
    mkdirSync(channel, { recursive: true });
    writeFileSync(
      join(channel, "meta.json"),
      `${JSON.stringify(
        {
          id: "channel-copied",
          title: "Copied implementing",
          projectId: "platform",
          issueId: "ship",
          channel: "implementing",
          model: "composer-2.5",
          createdAt: AT,
          updatedAt: AT,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(channel, "transcript.jsonl"),
      `${JSON.stringify({ type: "assistant", text: "copied reply", at: AT })}\n`,
    );
    writeFileSync(
      join(channel, "delegations.jsonl"),
      `${JSON.stringify({
        delegationId: "del-completed",
        agentId: "agent-impl",
        role: "implementor",
        model: "composer-2.5",
        at: AT,
        issueId: "linked-task",
        parentCallId: "call-completed",
        lifecycle: "tracked",
      })}\n${JSON.stringify({
        kind: "end",
        delegationId: "del-completed",
        status: "completed",
        endedAt: AT_END,
      })}\n`,
    );

    const { createApp } = await import("../app.js");
    ({ server, baseUrl } = await listen(createApp(stubSessions())));
  });

  it("refuses prompts, messages, forks, and channel sessions before any write or SDK call", async () => {
    const beforeIds = conversationIds();
    const beforeTranscript = transcriptOf("copied");

    const prompted = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "platform",
        title: "New",
        message: "start",
      }),
    });
    await expectGuest(prompted, GUEST_REFUSED_CONVERSATION_PROMPT);

    const messaged = await fetch(`${baseUrl}/api/conversations/copied/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "follow up" }),
    });
    await expectGuest(messaged, GUEST_REFUSED_CONVERSATION_PROMPT);

    const interrupted = await fetch(`${baseUrl}/api/conversations/live/interrupt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "stop and go" }),
    });
    await expectGuest(interrupted, GUEST_REFUSED_CONVERSATION_PROMPT);

    const steered = await fetch(`${baseUrl}/api/conversations/live/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "steer" }),
    });
    await expectGuest(steered, GUEST_REFUSED_CONVERSATION_MESSAGE);

    const forked = await fetch(`${baseUrl}/api/conversations/copied/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq: 0 }),
    });
    await expectGuest(forked, GUEST_REFUSED_FORK);

    const channel = await fetch(
      `${baseUrl}/api/issues/ship/channels/implementing/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", message: "implement" }),
      },
    );
    await expectGuest(channel, GUEST_REFUSED_CHANNEL_SESSION);

    expect(conversationIds()).toEqual(beforeIds);
    expect(transcriptOf("copied")).toBe(beforeTranscript);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
  });

  it("refuses delegate and SDK create, resume, and prewarm before the SDK call", async () => {
    const storeDir = join(root, "nested-store");
    const { createFakeAgentSdk } = await import("./agent-sdk.fake.js");
    const fake = createFakeAgentSdk();
    const { createDelegateCustomTools } = await import("./delegate-tool.js");
    const tools = createDelegateCustomTools({
      sdk: fake,
      cwd: join(root, "workspace"),
      storeDir,
    });

    await expect(
      tools.delegate!.execute({ role: "implementor", prompt: "go" }, {}),
    ).rejects.toMatchObject({
      code: "guest",
      status: 403,
      message: GUEST_REFUSED_DELEGATE,
    });
    await expect(
      tools.delegate!.execute(
        { role: "implementor", prompt: "again", resumeId: "agent-1" },
        {},
      ),
    ).rejects.toMatchObject({ code: "guest", status: 403 });
    expect(fake.created).toEqual([]);
    expect(fake.resumed).toEqual([]);
    expect(existsSync(storeDir)).toBe(false);

    const createSdkAgent = vi.fn();
    const resumeSdkAgent = vi.fn();
    const createPlatform = vi.fn();
    const { createAgentSdk } = await import("./agent-sdk.js");
    const sdk = createAgentSdk({
      createSdkAgent,
      resumeSdkAgent,
      createPlatform,
      listSdkModels: async () => [],
      apiKey: "test",
    });
    const model = { id: "composer-2.5" };
    await expect(
      sdk.createAgent({ cwd: "/repo", model, storeDir: "/store" }),
    ).rejects.toMatchObject({
      code: "guest",
      status: 403,
      message: GUEST_REFUSED_START_AGENT,
    });
    await expect(
      sdk.resumeAgent("agent-1", "/store", { cwd: "/repo", model }),
    ).rejects.toMatchObject({
      code: "guest",
      status: 403,
      message: GUEST_REFUSED_RESUME_AGENT,
    });
    await expect(sdk.prewarmWorkspace("/repo")).rejects.toMatchObject({
      code: "guest",
      status: 403,
      message: GUEST_REFUSED_PREWARM,
    });
    expect(createSdkAgent).not.toHaveBeenCalled();
    expect(resumeSdkAgent).not.toHaveBeenCalled();
    expect(createPlatform).not.toHaveBeenCalled();
  });
});
