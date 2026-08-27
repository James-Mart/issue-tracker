import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let issuesDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-stack-boot-"));
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

async function loadBoot() {
  vi.resetModules();
  return import("./mockup-stack-boot.js");
}

function writeStaleStackState(conversationsDir: string, conversationId: string): void {
  const statePath = join(
    conversationsDir,
    conversationId,
    "mockups",
    "mockup-stack",
    "state.json",
  );
  mkdirSync(join(statePath, ".."), { recursive: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      port: 41005,
      pid: 2 ** 30,
      startTime: "1",
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

describe("captureMockupStackReapAtBoot", () => {
  it("records what the boot sweep reaped", async () => {
    const { conversationsDir } = await import("./config.js");
    writeStaleStackState(conversationsDir, "stale-conversation");

    const { captureMockupStackReapAtBoot, getMockupStackReapReport } =
      await loadBoot();
    await captureMockupStackReapAtBoot();

    expect(getMockupStackReapReport()).toEqual({
      staleStateRemoved: ["stale-conversation"],
      orphanedStacksStopped: [],
    });
    expect(
      existsSync(
        join(
          conversationsDir,
          "stale-conversation",
          "mockups",
          "mockup-stack",
          "state.json",
        ),
      ),
    ).toBe(false);
  });

  it("reports undefined before capture runs", async () => {
    const { getMockupStackReapReport } = await loadBoot();
    expect(getMockupStackReapReport()).toBeUndefined();
  });
});
