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
const { seedProject, seedEpic } = disk;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-enqueue-"));
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

async function load() {
  const enqueue = await import("./enqueue-work-root.js");
  const launcher = await import("./work-queue-launcher.js");
  const conversations = await import("./conversations.js");
  const launch = await import("./implementing-launch.js");
  return { ...enqueue, ...launcher, ...conversations, ...launch };
}

describe("enqueueWorkRoot", () => {
  it("starts an eligible root immediately with only the work-loop message", async () => {
    seedProject();
    seedEpic("ship", 1);
    const { sessions } = fakeLauncherSessions();
    const { enqueueWorkRoot, listConversations, readConversation, implementingSessionMessage, implementingResumePrompt } =
      await load();

    const root = await enqueueWorkRoot("ship", sessions);

    expect(root.id).toBe("ship");
    expect(root.kind === "epic" && root.workQueuedAt).toBeUndefined();
    const metas = listConversations();
    expect(metas.map((meta) => meta.issueId)).toEqual(["ship"]);
    expect(metas[0]?.title).toBe("Implement ship");
    const transcript = JSON.stringify(readConversation(metas[0]!.id).transcript);
    expect(transcript).toContain(implementingSessionMessage("ship"));
    expect(transcript).not.toContain(implementingResumePrompt());
  });
});
