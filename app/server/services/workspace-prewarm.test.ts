import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentOptions, ModelSelection, SDKAgent } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSdk } from "./agent-sdk.js";

const AT = "2026-09-25T16:00:00.000Z";
const MODEL: ModelSelection = { id: "composer-2.5" };

let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, createdAt: AT, updatedAt: AT, ...body }),
  );
}

function workspaceOptions(options: AgentOptions) {
  return {
    apiKey: options.apiKey,
    disallowedTools: options.disallowedTools,
    local: {
      cwd: options.local?.cwd,
      settingSources: options.local?.settingSources,
    },
  };
}

function fakeSdkAgent(): SDKAgent {
  return {
    agentId: "agent-1",
    model: undefined,
    async send() {
      throw new Error("unused");
    },
    close() {},
    async reload() {},
    async [Symbol.asyncDispose]() {},
    async listArtifacts() {
      return [];
    },
    async downloadArtifact() {
      return Buffer.from("");
    },
    async getUsage() {
      return {
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        },
        runs: [],
      };
    },
  };
}

beforeEach(async () => {
  issuesDir = mkdtempSync(join(tmpdir(), "workspace-prewarm-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  const { refreshStorePathsFromEnv } = await import("../config.js");
  refreshStorePathsFromEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(issuesDir, { recursive: true, force: true });
});

describe("prewarmProjectWorkspaces", () => {
  it("prewarms each Project workspace with the options createAgent builds for that cwd", async () => {
    writeIssue("alpha", {
      kind: "project",
      title: "Alpha",
      workspace: "/ws/alpha",
    });
    writeIssue("beta", {
      kind: "project",
      title: "Beta",
      workspace: "/ws/beta",
    });
    writeIssue("bare", { kind: "project", title: "Bare" });
    writeIssue("story", {
      kind: "story",
      title: "Story",
      partOf: "alpha",
      workspace: "/ws/not-a-project",
    });

    const prewarmLocalWorkspace = vi.fn(async (_options: AgentOptions) => {
      return async () => {};
    });
    const createSdkAgent = vi.fn(async (_options: AgentOptions) =>
      fakeSdkAgent(),
    );
    const sdk = createAgentSdk({
      createSdkAgent,
      createPlatform: async () => ({ prewarmLocalWorkspace }),
      apiKey: "key-abc",
    });

    const { prewarmProjectWorkspaces } = await import("./workspace-prewarm.js");
    await prewarmProjectWorkspaces(sdk);

    expect(prewarmLocalWorkspace).toHaveBeenCalledTimes(2);
    const prewarmed = prewarmLocalWorkspace.mock.calls.map((call) => call[0]);
    expect(prewarmed.map((options) => options.local?.cwd).sort()).toEqual([
      "/ws/alpha",
      "/ws/beta",
    ]);

    for (const cwd of ["/ws/alpha", "/ws/beta"]) {
      createSdkAgent.mockClear();
      await sdk.createAgent({ cwd, model: MODEL, storeDir: "/store" });
      const created = createSdkAgent.mock.calls[0]![0];
      const warmed = prewarmed.find((options) => options.local?.cwd === cwd);
      expect(warmed).toEqual(workspaceOptions(created));
    }
  });

  it("logs a failing prewarm and continues boot", async () => {
    writeIssue("ok", {
      kind: "project",
      title: "Ok",
      workspace: "/ws/ok",
    });
    writeIssue("bad", {
      kind: "project",
      title: "Bad",
      workspace: "/ws/bad",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prewarmLocalWorkspace = vi.fn(async (options: AgentOptions) => {
      if (options.local?.cwd === "/ws/bad") {
        throw new Error("scan failed");
      }
      return async () => {};
    });
    const sdk = createAgentSdk({
      createPlatform: async () => ({ prewarmLocalWorkspace }),
      apiKey: "key-abc",
    });

    const { prewarmProjectWorkspaces } = await import("./workspace-prewarm.js");
    const releases = await prewarmProjectWorkspaces(sdk);

    expect(releases).toHaveLength(1);
    expect(prewarmLocalWorkspace).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "prewarm failed for workspace /ws/bad",
      expect.any(Error),
    );
  });
});

describe("shutdown prewarm releases", () => {
  it("calls every release after agent sessions dispose", async () => {
    const order: string[] = [];
    const releases = [
      async () => {
        order.push("release-a");
      },
      async () => {
        order.push("release-b");
      },
    ];

    const { disposeSessionsAndReleasePrewarm } = await import(
      "./workspace-prewarm.js"
    );
    await disposeSessionsAndReleasePrewarm(async () => {
      order.push("dispose");
    }, releases);

    expect(order).toEqual(["dispose", "release-a", "release-b"]);
  });

  it("calls every release when one of them throws", async () => {
    const called: string[] = [];
    const { releasePrewarmedWorkspaces } = await import(
      "./workspace-prewarm.js"
    );
    await expect(
      releasePrewarmedWorkspaces([
        async () => {
          called.push("a");
          throw new Error("release a");
        },
        async () => {
          called.push("b");
        },
      ]),
    ).rejects.toThrow("release a");
    expect(called).toEqual(["a", "b"]);
  });
});
