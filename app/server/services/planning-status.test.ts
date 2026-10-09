import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-08-17T12:00:00.000Z";

let root: string;
let issuesRoot: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  const dir = join(issuesRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "issue.json"), JSON.stringify({ id, ...body }));
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

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("planningStatusById", () => {
  it("is planning when a run is live, even if a plan root already exists", async () => {
    seedProjectAndIdea();
    writeIssue("ship-it", {
      kind: "epic",
      title: "Ship it",
      partOf: "platform",
      order: 1,
      archived: false,
      sourceIdea: "capture",
      createdAt: AT,
      updatedAt: AT,
    });
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

  it("is awaiting-approval when approvalPending is set and no run is live", async () => {
    seedProjectAndIdea();
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      order: 0,
      archived: false,
      approvalPending: true,
      createdAt: AT,
      updatedAt: AT,
    });
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
      text: "Does this outline look right?",
    });
    expect(statusOf()).toBe("awaiting-approval");
  });
});
