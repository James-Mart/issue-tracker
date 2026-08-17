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

function seedProjectAndIdea(ideaId = "capture"): void {
  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue(ideaId, {
    kind: "idea",
    title: "Capture",
    partOf: "platform",
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function load() {
  const { readAll } = await import("./issues.js");
  const { planningStatusById } = await import("./planning-status.js");
  const { createConversation, appendEvent } = await import("./conversations.js");
  const { conversationsDir } = await import("../config.js");
  return {
    readAll,
    planningStatusById,
    createConversation,
    appendEvent,
    conversationsDir,
    statusOf(ideaId = "capture") {
      return planningStatusById(readAll().issues)[ideaId];
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-planning-status-"));
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

describe("planningStatusById", () => {
  it("is captured when no planning session has run", async () => {
    seedProjectAndIdea();
    const { statusOf } = await load();
    expect(statusOf()).toBe("captured");
  });

  it("is captured when a planning session exists but has never run", async () => {
    seedProjectAndIdea();
    const { statusOf, createConversation } = await load();
    await createConversation({
      title: "Plan capture",
      projectId: "platform",
      model: "auto",
      issueId: "capture",
      channel: "planning",
    });
    expect(statusOf()).toBe("captured");
  });

  it("is awaiting-direction when a session stopped on a question and there is no plan", async () => {
    seedProjectAndIdea();
    const { statusOf, createConversation, appendEvent } = await load();
    const meta = await createConversation({
      title: "Plan capture",
      projectId: "platform",
      model: "auto",
      issueId: "capture",
      channel: "planning",
    });
    await appendEvent(meta.id, {
      type: "assistant",
      text: "What should this Idea become?",
    });
    expect(statusOf()).toBe("awaiting-direction");
  });

  it("is awaiting-direction when a session stopped on an error and there is no plan", async () => {
    seedProjectAndIdea();
    const { statusOf, createConversation, appendEvent } = await load();
    const meta = await createConversation({
      title: "Plan capture",
      projectId: "platform",
      model: "auto",
      issueId: "capture",
      channel: "planning",
    });
    await appendEvent(meta.id, { type: "error", message: "agent failed" });
    expect(statusOf()).toBe("awaiting-direction");
  });

  it("is planned when a project-level Story backlinks the Idea", async () => {
    seedProjectAndIdea();
    writeIssue(
      "solo-story",
      {
        kind: "story",
        title: "Solo story",
        partOf: "platform",
        order: 1,
        archived: false,
        createdAt: AT,
        updatedAt: AT,
      },
      "Source idea: [Capture](issue:capture)\n",
    );
    const { statusOf } = await load();
    expect(statusOf()).toBe("planned");
  });

  it("is planned when a plan root exists and the planning session has stopped", async () => {
    seedProjectAndIdea();
    writeIssue(
      "ship-it",
      {
        kind: "epic",
        title: "Ship it",
        partOf: "platform",
        order: 1,
        archived: false,
        createdAt: AT,
        updatedAt: AT,
      },
      "Source idea: [Capture](issue:capture)\n",
    );
    const { statusOf, createConversation, appendEvent } = await load();
    const meta = await createConversation({
      title: "Plan capture",
      projectId: "platform",
      model: "auto",
      issueId: "capture",
      channel: "planning",
    });
    await appendEvent(meta.id, {
      type: "assistant",
      text: "Plan is ready.",
    });
    expect(statusOf()).toBe("planned");
  });

  it("is planning when a run is live, even if a plan root already exists", async () => {
    seedProjectAndIdea();
    writeIssue(
      "ship-it",
      {
        kind: "epic",
        title: "Ship it",
        partOf: "platform",
        order: 1,
        archived: false,
        createdAt: AT,
        updatedAt: AT,
      },
      "Source idea: [Capture](issue:capture)\n",
    );
    const { statusOf, createConversation, conversationsDir } = await load();
    const meta = await createConversation({
      title: "Replan capture",
      projectId: "platform",
      model: "auto",
      issueId: "capture",
      channel: "planning",
    });
    writeFileSync(
      join(conversationsDir, meta.id, "run-live.json"),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
    expect(statusOf()).toBe("planning");
  });

  it("ignores a nested Story backlink and an implementing session", async () => {
    seedProjectAndIdea();
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      order: 1,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue(
      "nested-story",
      {
        kind: "story",
        title: "Nested",
        partOf: "ship-it",
        order: 0,
        archived: false,
        createdAt: AT,
        updatedAt: AT,
      },
      "Source idea: [Capture](issue:capture)\n",
    );
    const { statusOf, createConversation } = await load();
    await createConversation({
      title: "Implement ship-it",
      projectId: "platform",
      model: "auto",
      issueId: "ship-it",
      channel: "implementing",
    });
    expect(statusOf()).toBe("captured");
  });
});

describe("GET /api/issues ideaStatus", () => {
  it("returns ideaStatus under derived for Ideas", async () => {
    seedProjectAndIdea();
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
      derived: Record<string, { ideaStatus?: string }>;
    };
    expect(body.derived.capture?.ideaStatus).toBe("captured");
  });
});
