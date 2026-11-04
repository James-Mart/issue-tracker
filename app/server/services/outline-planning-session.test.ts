import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentBodyPath } from "../../src/lib/plugin-paths.js";
import { fakeLauncherSessions } from "./queue-launcher.test-helpers.js";

const AT = "2026-07-09T14:00:00.000Z";
let rootDir: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-outline-planning-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(rootDir, { recursive: true, force: true });
});

describe("startOutlinePlanningSession", () => {
  it("starts a decomposer session on the outline planning channel", async () => {
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("feature-outline", {
      kind: "outline",
      title: "Feature outline",
      partOf: "p",
      order: 1,
      bodyVersion: 2,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { sessions, started } = fakeLauncherSessions();
    const { startOutlinePlanningSession } = await import(
      "./outline-planning-session.js"
    );
    const { listConversations } = await import("./conversations.js");
    const { transcriptPathOf } = await import(
      "./conversation-transcript-seq.js"
    );

    await startOutlinePlanningSession(
      {
        outlineId: "feature-outline",
        role: "decomposer",
        version: 2,
        executionGate: "off",
        mergePolicy: "squash",
      },
      sessions,
    );

    expect(started).toHaveLength(1);
    const [meta] = listConversations();
    expect(meta).toMatchObject({
      issueId: "feature-outline",
      channel: "planning",
      model: "cursor-grok-4.7",
      title: "Decompose Feature outline",
    });
    const line = readFileSync(transcriptPathOf(meta!.id), "utf8").trim();
    expect(JSON.parse(line).text).toBe(
      "Decompose feature-outline in the issue tracker. " +
        `Read ${agentBodyPath("_issue-tracker-decomposer")} and follow it. ` +
        "Mode: `decompose`. Outline: `feature-outline`. Version: `2`. Execution gate: `off`. " +
        "Merge policy: `squash`.",
    );
  });
});
