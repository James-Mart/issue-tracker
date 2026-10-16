import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CursorAgentError } from "./agent-sdk.js";
import {
  bindWorkQueueDisk,
  fakeLauncherSessions,
} from "./queue-launcher.test-helpers.js";

let rootDir: string;
let issuesDir: string;
const disk = bindWorkQueueDisk();
const { readRaw, seedProject, seedEpic, seedStory, seedTask } = disk;

/** An `implementing` session on the root with no run, as a paused loop leaves it. */
async function openIdleSession(rootId: string): Promise<string> {
  const { createConversation } = await loadConversations();
  const meta = await createConversation({
    title: `Implement ${rootId}`,
    projectId: "p",
    model: "composer-2.5",
    issueId: rootId,
    channel: "implementing",
  });
  return meta.id;
}

async function archivedById(): Promise<Map<string, boolean>> {
  const { listConversations } = await loadConversations();
  return new Map(listConversations().map((meta) => [meta.id, meta.archived]));
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-work-queue-launcher-"));
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

async function loadLauncher() {
  return import("./work-queue-launcher.js");
}

async function loadConversations() {
  return import("./conversations.js");
}

describe("implementing work-queue launcher", () => {
  it("starts the oldest queued root and holds the next when the cap is 1", async () => {
    seedProject();
    seedEpic("older", 1, { workQueuedAt: "2026-07-01T00:00:00.000Z" });
    seedEpic("newer", 2, { workQueuedAt: "2026-07-02T00:00:00.000Z" });
    const { sessions, started } = fakeLauncherSessions();
    const { drainWorkQueue } = await loadLauncher();
    const { listConversations } = await loadConversations();

    await drainWorkQueue(sessions);

    expect(started).toHaveLength(1);
    const metas = listConversations();
    expect(metas).toHaveLength(1);
    expect(metas[0]?.issueId).toBe("older");
    expect(metas[0]?.channel).toBe("implementing");
    expect(metas[0]?.title).toBe("Implement older");
    expect(readRaw("older").workQueuedAt).toBeUndefined();
    expect(readRaw("older").workQueuePosition).toBeUndefined();
    expect(readRaw("newer").workQueuedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(readRaw("newer").workQueuePosition).toBe(2);

    await drainWorkQueue(sessions);
    expect(started).toHaveLength(1);
  });

  it("archives finished roots' sessions even when nothing is queued", async () => {
    seedProject();
    seedStory("merged-story", "p", 1, { merged: true });
    seedStory("landing-story", "p", 2);
    seedTask("landing-task", "landing-story", "done");
    seedEpic("landed-epic", 3);
    seedStory("landed-child", "landed-epic", 0, { merged: true });
    seedEpic("open-epic", 4);
    seedStory("open-child", "open-epic", 0);
    seedTask("open-task", "open-child", "todo");
    const finished = [
      await openIdleSession("merged-story"),
      await openIdleSession("landing-story"),
      await openIdleSession("landed-epic"),
    ];
    const open = await openIdleSession("open-epic");
    const { sessions } = fakeLauncherSessions();
    const { drainWorkQueue } = await loadLauncher();

    await drainWorkQueue(sessions);

    const archived = await archivedById();
    expect(finished.map((id) => archived.get(id))).toEqual([true, true, true]);
    expect(archived.get(open)).toBe(false);
  });

  it("keeps a failed start queued in its slot until needsAttention is cleared", async () => {
    seedProject();
    seedEpic("older", 1, {
      workQueuedAt: "2026-07-01T00:00:00.000Z",
      workQueuePosition: 1,
    });
    seedEpic("newer", 2, {
      workQueuedAt: "2026-07-02T00:00:00.000Z",
      workQueuePosition: 2,
    });
    const { sessions, started } = fakeLauncherSessions();
    let sends = 0;
    const send = sessions.sendPrompt.bind(sessions);
    sessions.sendPrompt = async (conversationId, options) => {
      sends += 1;
      if (sends === 1) {
        return {
          ok: false,
          cause: "never_started",
          error: new CursorAgentError("coordinator down"),
        };
      }
      return send(conversationId, options);
    };
    const { drainWorkQueue } = await loadLauncher();
    const { update } = await import("./issues.js");
    const { listConversations } = await loadConversations();

    await drainWorkQueue(sessions);

    expect(sends).toBe(1);
    expect(started).toHaveLength(0);
    expect(readRaw("older")).toMatchObject({
      workQueuedAt: "2026-07-01T00:00:00.000Z",
      workQueuePosition: 1,
      needsAttention: true,
      attentionReason: "Auto-start failed: coordinator down",
    });
    expect(readRaw("newer")).toMatchObject({
      workQueuedAt: "2026-07-02T00:00:00.000Z",
      workQueuePosition: 2,
    });
    expect(readRaw("newer").needsAttention).not.toBe(true);
    expect(listConversations().map((meta) => meta.issueId)).toEqual(["older"]);

    await drainWorkQueue(sessions);
    expect(sends).toBe(1);

    await update("older", { needsAttention: false, attentionReason: null });
    await drainWorkQueue(sessions);

    expect(sends).toBe(2);
    expect(started).toHaveLength(1);
    expect(readRaw("older").workQueuedAt).toBeUndefined();
    expect(readRaw("older").workQueuePosition).toBeUndefined();
    expect(readRaw("older").needsAttention).not.toBe(true);
    expect(readRaw("newer").workQueuedAt).toBe("2026-07-02T00:00:00.000Z");
    const live = listConversations().filter((meta) => !meta.archived);
    expect(live.map((meta) => meta.issueId)).toEqual(["older"]);
  });
});
