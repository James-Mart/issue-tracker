import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-08-17T12:00:00.000Z";

let root: string;
let issuesRoot: string;
let server: Server | undefined;
let baseUrl: string | undefined;

function writeIssue(
  id: string,
  body: Record<string, unknown>,
  description?: string,
): void {
  const dir = join(issuesRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "issue.json"), JSON.stringify({ id, ...body }));
  if (description !== undefined) {
    writeFileSync(join(dir, "description.md"), description);
  }
}

function seedProject(): void {
  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    createdAt: AT,
    updatedAt: AT,
  });
}

async function load() {
  const { list } = await import("./issues.js");
  const { mergeImplementingOverlay } = await import("./implementing-status.js");
  const { derive } = await import("./derive.js");
  const { createConversation } = await import("./conversations.js");
  const { conversationsDir } = await import("../config.js");
  return {
    list,
    derive,
    mergeImplementingOverlay,
    createConversation,
    conversationsDir,
    derivedOf() {
      return list().derived;
    },
  };
}

function markLive(conversationsDir: string, conversationId: string): void {
  writeFileSync(
    join(conversationsDir, conversationId, "run-live.json"),
    `${JSON.stringify({ pid: process.pid })}\n`,
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-implementing-status-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    server = undefined;
    baseUrl = undefined;
  }
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("mergeImplementingOverlay", () => {
  it("overlays in-progress and liveRun on a ready Epic with a live implementing run", async () => {
    seedProject();
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      order: 0,
      archived: false,
      blockedBy: [],
      createdAt: AT,
      updatedAt: AT,
    });
    const { createConversation, conversationsDir, derivedOf } = await load();
    const meta = await createConversation({
      title: "Implement ship-it",
      projectId: "platform",
      model: "auto",
      issueId: "ship-it",
      channel: "implementing",
    });
    markLive(conversationsDir, meta.id);

    const derived = derivedOf();
    expect(derived["ship-it"]?.epicStatus).toBe("in-progress");
    expect(derived["ship-it"]?.liveRun).toBe(true);
  });

  it("overlays in-progress and liveRun on a ready project-level Story", async () => {
    seedProject();
    writeIssue("solo-story", {
      kind: "story",
      title: "Solo story",
      partOf: "platform",
      order: 0,
      archived: false,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { createConversation, conversationsDir, derivedOf } = await load();
    const meta = await createConversation({
      title: "Implement solo-story",
      projectId: "platform",
      model: "auto",
      issueId: "solo-story",
      channel: "implementing",
    });
    markLive(conversationsDir, meta.id);

    const derived = derivedOf();
    expect(derived["solo-story"]?.storyStatus).toBe("in-progress");
    expect(derived["solo-story"]?.liveRun).toBe(true);
  });

  it("clears the overlay when the run is no longer live and branchName is unset", async () => {
    seedProject();
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      order: 0,
      archived: false,
      blockedBy: [],
      createdAt: AT,
      updatedAt: AT,
    });
    const { createConversation, conversationsDir, derivedOf } = await load();
    const meta = await createConversation({
      title: "Implement ship-it",
      projectId: "platform",
      model: "auto",
      issueId: "ship-it",
      channel: "implementing",
    });
    markLive(conversationsDir, meta.id);
    expect(derivedOf()["ship-it"]?.epicStatus).toBe("in-progress");

    rmSync(join(conversationsDir, meta.id, "run-live.json"));
    const derived = derivedOf();
    expect(derived["ship-it"]?.epicStatus).toBe("todo");
    expect(derived["ship-it"]?.liveRun).toBe(false);
  });

  it("does not overwrite epic done, or story merged / pr-open", async () => {
    seedProject();
    writeIssue("done-epic", {
      kind: "epic",
      title: "Done epic",
      partOf: "platform",
      order: 0,
      archived: false,
      blockedBy: [],
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("done-epic-story", {
      kind: "story",
      title: "Done epic story",
      partOf: "done-epic",
      order: 0,
      archived: false,
      merged: true,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("merged-story", {
      kind: "story",
      title: "Merged",
      partOf: "platform",
      order: 1,
      archived: false,
      merged: true,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("pr-story", {
      kind: "story",
      title: "PR open",
      partOf: "platform",
      order: 2,
      archived: false,
      merged: false,
      branchName: "pr-story",
      prUrl: "https://github.com/o/r/pull/1",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("done-task", {
      kind: "task",
      title: "Done",
      partOf: "pr-story",
      order: 0,
      status: "done",
      createdAt: AT,
      updatedAt: AT,
    });

    const { createConversation, conversationsDir, derivedOf } = await load();
    for (const issueId of ["done-epic", "merged-story", "pr-story"]) {
      const meta = await createConversation({
        title: `Implement ${issueId}`,
        projectId: "platform",
        model: "auto",
        issueId,
        channel: "implementing",
      });
      markLive(conversationsDir, meta.id);
    }

    const derived = derivedOf();
    expect(derived["done-epic"]?.epicStatus).toBe("done");
    expect(derived["merged-story"]?.storyStatus).toBe("merged");
    expect(derived["pr-story"]?.storyStatus).toBe("pr-open");
    expect(derived["done-epic"]?.liveRun).toBe(true);
    expect(derived["merged-story"]?.liveRun).toBe(true);
    expect(derived["pr-story"]?.liveRun).toBe(true);
  });

  it("leaves a child Story not-started when only the parent Epic has a live implementing run", async () => {
    seedProject();
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      order: 0,
      archived: false,
      blockedBy: [],
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("nested-story", {
      kind: "story",
      title: "Nested",
      partOf: "ship-it",
      order: 0,
      archived: false,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { createConversation, conversationsDir, derivedOf } = await load();
    const meta = await createConversation({
      title: "Implement ship-it",
      projectId: "platform",
      model: "auto",
      issueId: "ship-it",
      channel: "implementing",
    });
    markLive(conversationsDir, meta.id);

    const derived = derivedOf();
    expect(derived["ship-it"]?.epicStatus).toBe("in-progress");
    expect(derived["nested-story"]?.storyStatus).toBe("not-started");
    expect(derived["nested-story"]?.liveRun).toBe(false);
  });

  it("sets liveRun from any channel, not only implementing", async () => {
    seedProject();
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      order: 0,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { createConversation, conversationsDir, derivedOf } = await load();
    const meta = await createConversation({
      title: "Plan capture",
      projectId: "platform",
      model: "auto",
      issueId: "capture",
      channel: "planning",
    });
    markLive(conversationsDir, meta.id);

    expect(derivedOf().capture?.liveRun).toBe(true);
  });
});

describe("GET /api/issues implementing overlay", () => {
  it("returns epicStatus, storyStatus, and liveRun under derived", async () => {
    seedProject();
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      order: 0,
      archived: false,
      blockedBy: [],
      createdAt: AT,
      updatedAt: AT,
    });
    const { createConversation, conversationsDir } = await load();
    const meta = await createConversation({
      title: "Implement ship-it",
      projectId: "platform",
      model: "auto",
      issueId: "ship-it",
      channel: "implementing",
    });
    markLive(conversationsDir, meta.id);

    const { createApp } = await import("../app.js");
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server!.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP listen address");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${baseUrl}/api/issues`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      derived: Record<
        string,
        { epicStatus?: string; liveRun?: boolean }
      >;
    };
    expect(body.derived["ship-it"]?.epicStatus).toBe("in-progress");
    expect(body.derived["ship-it"]?.liveRun).toBe(true);
  });
});
