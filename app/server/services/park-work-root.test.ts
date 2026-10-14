import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindWorkQueueDisk,
  fakeLauncherSessions,
} from "./queue-launcher.test-helpers.js";

let rootDir: string;
let issuesDir: string;
const disk = bindWorkQueueDisk();
const { seedProject, seedEpic, readRaw } = disk;

const idle = { getActiveRun: () => undefined };

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-park-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  disk.setDir(issuesDir);
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(rootDir, { recursive: true, force: true });
});

async function openIdleSession(rootId: string): Promise<string> {
  const { createConversation } = await import("./conversations.js");
  const meta = await createConversation({
    title: `Implement ${rootId}`,
    projectId: "p",
    model: "composer-2.5",
    issueId: rootId,
    channel: "implementing",
  });
  return meta.id;
}

describe("parkWorkRoot", () => {
  it("frees the slot and lets the next waiting root start", async () => {
    seedProject();
    seedEpic("paused", 1);
    seedEpic("waiting", 2, {
      workQueuedAt: "2026-07-01T00:00:00.000Z",
      workQueuePosition: 1,
    });
    const sessionId = await openIdleSession("paused");
    const { parkWorkRoot } = await import("./park-work-root.js");
    const { runLauncherPass } = await import("./work-queue-launcher.js");
    const { listConversations } = await import("./conversations.js");
    const { sessions, started } = fakeLauncherSessions();

    await runLauncherPass(sessions);
    expect(started).toHaveLength(0);

    const parked = await parkWorkRoot("paused", idle);

    expect(parked.kind).toBe("epic");
    if (parked.kind !== "epic") throw new Error("expected epic");
    expect(typeof parked.workParkedAt).toBe("string");
    expect(listConversations().find((meta) => meta.id === sessionId)?.archived).toBe(
      false,
    );

    await runLauncherPass(sessions);

    expect(started).toHaveLength(1);
    expect(readRaw("waiting").workQueuedAt).toBeUndefined();
    expect(
      listConversations().some(
        (meta) => meta.issueId === "waiting" && !meta.archived,
      ),
    ).toBe(true);
    expect(listConversations().find((meta) => meta.id === sessionId)?.archived).toBe(
      false,
    );
  });
});
