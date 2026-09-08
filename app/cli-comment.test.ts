import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  dir,
  env,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

const COMMIT_SHA = "deadbeef00000000000000000000000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/;

useCliTestFixtures();

describe("comment anchor and reply flags", () => {
  beforeEach(() => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("t", {
      kind: "task",
      title: "Task",
      partOf: "p",
      order: 0,
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("appends an anchored comment and prints its id", async () => {
    const { stdout, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "on this line",
        "--path",
        "app/cli-ops.ts",
        "--side",
        "new",
        "--line",
        "42",
        "--start-line",
        "40",
        "--commit",
        COMMIT_SHA,
      ],
      { env: env() },
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(UUID_RE);

    const stored = JSON.parse(
      readFileSync(join(dir, "t", "comments.jsonl"), "utf8").trim(),
    );
    expect(stored.id).toBe(stdout.trim());
    expect(stored.anchor).toEqual({
      path: "app/cli-ops.ts",
      side: "new",
      line: 42,
      startLine: 40,
      commitSha: COMMIT_SHA,
    });
  });

  it("appends a reply and prints its id", async () => {
    writeFileSync(
      join(dir, "t", "comments.jsonl"),
      `${JSON.stringify({
        id: "root-id",
        role: "agent",
        body: "root",
        at: nextAt(),
      })}\n`,
    );

    const { stdout, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "human",
        "--body",
        "reply text",
        "--reply-to",
        "root-id",
      ],
      { env: env() },
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(UUID_RE);

    const lines = readFileSync(join(dir, "t", "comments.jsonl"), "utf8")
      .trim()
      .split("\n");
    const reply = JSON.parse(lines[1]!);
    expect(reply.id).toBe(stdout.trim());
    expect(reply.replyTo).toBe("root-id");
  });

  it("refuses a partial anchor missing --commit", async () => {
    const { stderr, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "incomplete",
        "--path",
        "app/cli-ops.ts",
        "--side",
        "new",
        "--line",
        "1",
      ],
      { env: env() },
    );
    expect(status).toBe(1);
    expect(stderr).toContain("anchor requires --path, --side, --line, and --commit");
  });

  it("refuses --reply-to combined with --path", async () => {
    const { stderr, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "conflict",
        "--reply-to",
        "root-id",
        "--path",
        "app/cli-ops.ts",
        "--side",
        "new",
        "--line",
        "1",
        "--commit",
        COMMIT_SHA,
      ],
      { env: env() },
    );
    expect(status).toBe(1);
    expect(stderr).toContain("--reply-to cannot be combined with anchor flags");
  });

  it("supports anchor flags on kind-scoped comment", async () => {
    const { stdout, status } = await runIssueCli(
      [
        "task",
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "scoped anchor",
        "--path",
        "app/cli-ops.ts",
        "--side",
        "old",
        "--line",
        "10",
        "--commit",
        COMMIT_SHA,
      ],
      { env: env() },
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(UUID_RE);

    const stored = JSON.parse(
      readFileSync(join(dir, "t", "comments.jsonl"), "utf8").trim(),
    );
    expect(stored.anchor?.side).toBe("old");
  });
});
