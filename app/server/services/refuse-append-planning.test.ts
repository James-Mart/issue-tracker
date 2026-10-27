import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { APPEND_TARGET_MERGED_PLANNING_BLOCKED } from "../append-planning-context.js";
import { loadService, useConversationFixtures } from "./conversations.test-fixtures.js";

useConversationFixtures();

const AT = "2026-07-09T14:00:00.000Z";
const idle = { isBusy: () => false, claimStart: () => ({ release() {} }) };
const worktrees: string[] = [];

function writeIssue(id: string, body: Record<string, unknown>): void {
  const dir = join(process.env.ISSUES_DIR!, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "issue.json"), JSON.stringify({ id, ...body }));
}

afterEach(() => {
  for (const path of worktrees) rmSync(path, { recursive: true, force: true });
  worktrees.length = 0;
});

function story(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf: "platform",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

function appendIdea(appendTo: string, extra: Record<string, unknown> = {}): void {
  writeIssue("capture", {
    kind: "idea",
    title: "Capture",
    partOf: "platform",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    appendTo,
    mergeBase: "release",
    ...extra,
  });
}

describe("refuseAppendPlanningCreate", () => {
  it("refuses a merged append target before writing a session", async () => {
    const path = mkdtempSync(join(tmpdir(), "append-planning-wt-"));
    worktrees.push(path);
    story("landed", { merged: true, worktreePath: path });
    appendIdea("landed");
    const { createIssueChannelSession, listConversations } = await loadService();

    await expect(
      createIssueChannelSession(
        {
          issueId: "capture",
          channel: "planning",
          projectId: "platform",
          title: "Plan",
          model: "composer-2.5",
        },
        idle,
      ),
    ).rejects.toThrow(APPEND_TARGET_MERGED_PLANNING_BLOCKED);
    expect(listConversations()).toEqual([]);
    expect(JSON.parse(readFileSync(join(process.env.ISSUES_DIR!, "capture", "issue.json"), "utf8")).mergeBase).toBe(
      "release",
    );
  });
});
