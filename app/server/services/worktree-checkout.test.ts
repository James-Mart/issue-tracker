import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STAMP = "2026-01-01T00:00:00.000Z";

let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({
      id,
      title: id,
      createdAt: STAMP,
      updatedAt: STAMP,
      order: 0,
      ...body,
    }),
  );
}

function buildWritesCwd(marker: string): string {
  const script = join(root, "build.cjs");
  writeFileSync(
    script,
    `require("fs").writeFileSync(${JSON.stringify(marker)}, process.cwd()); process.exit(1);\n`,
  );
  return `node ${JSON.stringify(script)}`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-worktree-capability-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("agent-stack worktree resolution", () => {
  it("boots a review from its own checkout, not a Story checkout in the project", async () => {
    const storyDir = join(root, "story-checkout");
    const reviewDir = join(root, "review-checkout");
    mkdirSync(storyDir);
    mkdirSync(reviewDir);
    const marker = join(root, "cwd");
    writeIssue("p", {
      kind: "project",
      trunk: "main",
      runtime: {
        build: buildWritesCwd(marker),
        start: "sleep 30",
        baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
      },
    });
    writeIssue("e", { kind: "epic", partOf: "p", blockedBy: [] });
    writeIssue("s", {
      kind: "story",
      partOf: "e",
      merged: false,
      worktreePath: storyDir,
    });
    writeIssue("rev", {
      kind: "review",
      partOf: "p",
      order: 1,
      archived: false,
      marks: { all: {}, commits: {} },
      submissions: [],
      pr: {
        url: "https://github.com/example/repo/pull/1",
        number: 1,
        baseRef: "main",
        headRef: "feature",
        headSha: "abc",
        fork: false,
      },
      worktreePath: reviewDir,
    });
    const { startAgentStack } = await import("./agent-stack.js");

    await expect(startAgentStack("conv", { issueId: "rev" })).rejects.toThrow(
      /agent stack build failed/,
    );

    expect(readFileSync(marker, "utf8")).toBe(resolve(reviewDir));
  });
});
