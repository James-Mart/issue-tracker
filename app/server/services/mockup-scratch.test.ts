import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let issuesDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-scratch-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

async function loadService() {
  return import("./mockup-scratch.js");
}

async function loadConfig() {
  return import("../config.js");
}

function writeConversationMeta(
  conversationsDir: string,
  conversationId: string,
  overrides: { agentId?: string } = {},
): void {
  const dir = join(conversationsDir, conversationId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      id: conversationId,
      title: conversationId,
      projectId: "test-project",
      model: "composer-2.5",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
      ...overrides,
    }),
  );
}

describe("resolveMockupConversationId", () => {
  it("returns a direct conversation id when meta.json exists", async () => {
    const { resolveMockupConversationId } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "plan-mockup-round-verify");

    expect(resolveMockupConversationId("plan-mockup-round-verify")).toBe(
      "plan-mockup-round-verify",
    );
  });

  it("maps an agent id through meta.json to the owning conversation", async () => {
    const { resolveMockupConversationId } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "plan-mockup-round-verify", {
      agentId: "agent-45876f25-f1a3-4300-b066-7da0ac7979d5",
    });

    expect(
      resolveMockupConversationId(
        "agent-45876f25-f1a3-4300-b066-7da0ac7979d5",
      ),
    ).toBe("plan-mockup-round-verify");
  });

  it("throws when the id resolves to neither lookup", async () => {
    const { resolveMockupConversationId } = await loadService();
    const { conversationsDir } = await loadConfig();

    expect(() =>
      resolveMockupConversationId("agent-unknown-no-owner"),
    ).toThrow(/agent-unknown-no-owner/);
    expect(() =>
      resolveMockupConversationId("agent-unknown-no-owner"),
    ).toThrow(new RegExp(join(conversationsDir, "agent-unknown-no-owner", "meta.json")));
    expect(() =>
      resolveMockupConversationId("agent-unknown-no-owner"),
    ).toThrow(/agentId === "agent-unknown-no-owner"/);
  });
});

describe("mockup scratch layout", () => {
  it("places mockups beside agent-stack under the conversation", async () => {
    const { mockupScratchDir } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    const scratch = mockupScratchDir("my-conversation");

    expect(scratch).toBe(join(conversationsDir, "my-conversation", "mockups"));
    expect(existsSync(scratch)).toBe(true);
    expect(dirname(scratch)).toBe(
      dirname(join(conversationsDir, "my-conversation", "agent-stack")),
    );
  });

  it("creates a direction directory beneath the scratch", async () => {
    const { directionDir, mockupScratchDir } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    const dir = directionDir("my-conversation", "direction-a");

    expect(dir).toBe(join(mockupScratchDir("my-conversation"), "direction-a"));
    expect(existsSync(dir)).toBe(true);
  });

  it("lists direction ids excluding mockup-stack", async () => {
    const { directionDir, listDirectionIds } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    directionDir("my-conversation", "grid");
    directionDir("my-conversation", "grid-lightbox");

    expect(listDirectionIds("my-conversation")).toEqual([
      "grid",
      "grid-lightbox",
    ]);
  });

  it("computes harness.json at the scratch root without creating it", async () => {
    const { harnessConfigPath } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    const path = harnessConfigPath("my-conversation");
    const scratch = join(conversationsDir, "my-conversation", "mockups");

    expect(path).toBe(join(scratch, "harness.json"));
    expect(existsSync(scratch)).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it("routes scratch paths through agent id resolution", async () => {
    const { harnessConfigPath, mockupScratchDir } = await loadService();
    const { conversationsDir } = await loadConfig();
    const agentId = "agent-45876f25-f1a3-4300-b066-7da0ac7979d5";
    writeConversationMeta(conversationsDir, "plan-mockup-round-verify", {
      agentId,
    });

    expect(mockupScratchDir(agentId)).toBe(
      join(conversationsDir, "plan-mockup-round-verify", "mockups"),
    );
    expect(harnessConfigPath(agentId)).toBe(
      join(conversationsDir, "plan-mockup-round-verify", "mockups", "harness.json"),
    );
  });

  it("refuses ids that would escape the conversations dir", async () => {
    const { directionDir, harnessConfigPath, mockupScratchDir } =
      await loadService();

    expect(() => mockupScratchDir("../../etc")).toThrow(/must be a slug/);
    expect(() => directionDir("my-conversation", "../escape")).toThrow(
      /must be a slug/,
    );
    expect(() => harnessConfigPath("../../etc")).toThrow(/must be a slug/);
  });
});

describe("mockup stack state", () => {
  const sampleState = {
    port: 41005,
    pid: 12345,
    startTime: "999999",
    baseUrl: "http://127.0.0.1:41005",
    startedAt: "2026-01-01T00:00:00.000Z",
  };

  it("reports no state before a stack has started", async () => {
    const { readMockupStackState } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    const scratch = join(conversationsDir, "my-conversation", "mockups");

    expect(existsSync(scratch)).toBe(false);
    expect(readMockupStackState("my-conversation")).toBeNull();
    expect(existsSync(scratch)).toBe(false);
  });

  it("round-trips validated state under mockup-stack/state.json", async () => {
    const { mockupScratchDir, readMockupStackState, writeMockupStackState } =
      await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    writeMockupStackState("my-conversation", sampleState);

    const statePath = join(
      mockupScratchDir("my-conversation"),
      "mockup-stack",
      "state.json",
    );
    expect(readFileSync(statePath, "utf8")).toContain('"port": 41005');
    expect(readMockupStackState("my-conversation")).toEqual(sampleState);
  });

  it("rejects malformed state instead of treating it as no stack", async () => {
    const { mockupScratchDir, readMockupStackState } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    const statePath = join(
      mockupScratchDir("my-conversation"),
      "mockup-stack",
      "state.json",
    );
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({ port: "41005", pid: 1, baseUrl: "x", startedAt: "y" }),
    );

    expect(() => readMockupStackState("my-conversation")).toThrow(
      /invalid mockup-stack state/,
    );
  });
});

describe("pruneDirections", () => {
  it("removes sibling directions and keeps the chosen one", async () => {
    const { directionDir, mockupScratchDir, pruneDirections } =
      await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    directionDir("my-conversation", "direction-a");
    directionDir("my-conversation", "direction-b");
    directionDir("my-conversation", "direction-c");
    const scratch = mockupScratchDir("my-conversation");

    const removed = pruneDirections("my-conversation", "direction-b");

    expect(removed.sort()).toEqual(["direction-a", "direction-c"]);
    expect(existsSync(join(scratch, "direction-a"))).toBe(false);
    expect(existsSync(join(scratch, "direction-c"))).toBe(false);
    expect(existsSync(join(scratch, "direction-b"))).toBe(true);
  });

  it("throws for an unknown direction to keep and removes nothing", async () => {
    const { directionDir, mockupScratchDir, pruneDirections } =
      await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    directionDir("my-conversation", "direction-a");
    directionDir("my-conversation", "direction-b");
    const scratch = mockupScratchDir("my-conversation");

    expect(() =>
      pruneDirections("my-conversation", "direction-missing"),
    ).toThrow(/has no direction "direction-missing"/);
    expect(existsSync(join(scratch, "direction-a"))).toBe(true);
    expect(existsSync(join(scratch, "direction-b"))).toBe(true);
  });
});
