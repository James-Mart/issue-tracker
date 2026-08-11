import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { IssueError } from "./errors.js";
import {
  parsePrUrl,
  runGh,
  setGhSpawnerForTests,
  type GhSpawner,
} from "./delivery.js";

afterEach(() => {
  setGhSpawnerForTests(null);
});

function mockGhChild(opts: {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  error?: NodeJS.ErrnoException;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  setImmediate(() => {
    if (opts.error) {
      child.emit("error", opts.error);
      return;
    }
    if (opts.stdout) child.stdout.emit("data", opts.stdout);
    if (opts.stderr) child.stderr.emit("data", opts.stderr);
    child.emit("close", opts.code ?? 0);
  });

  return child;
}

function stubGhSpawner(
  handler: (args: string[], workspace: string) => ReturnType<typeof mockGhChild>,
): void {
  const spawner: GhSpawner = (_command, args, options) =>
    handler(args, options.cwd);
  setGhSpawnerForTests(spawner);
}

describe("runGh", () => {
  it("resolves stdout on success", async () => {
    stubGhSpawner(() => mockGhChild({ stdout: '{"state":"OPEN"}\n' }));
    await expect(runGh(["pr", "view", "1"], "/tmp/ws")).resolves.toBe(
      '{"state":"OPEN"}\n',
    );
  });

  it("throws gh-missing when the binary is absent", async () => {
    stubGhSpawner(() =>
      mockGhChild({
        error: Object.assign(new Error("spawn gh ENOENT"), {
          code: "ENOENT",
        }),
      }),
    );
    await expect(runGh(["auth", "status"], "/tmp/ws")).rejects.toMatchObject({
      code: "gh-missing",
    });
  });

  it("throws gh-unauthenticated when gh reports a missing token", async () => {
    stubGhSpawner(() =>
      mockGhChild({
        code: 4,
        stderr:
          "To use GitHub CLI in non-interactive mode, set the GH_TOKEN environment variable.",
      }),
    );
    await expect(runGh(["pr", "view", "1"], "/tmp/ws")).rejects.toMatchObject({
      code: "gh-unauthenticated",
    });
  });

  it("throws gh-failed with stderr for other non-zero exits", async () => {
    stubGhSpawner(() =>
      mockGhChild({
        code: 1,
        stderr: "GraphQL: Could not resolve to a PullRequest",
      }),
    );
    await expect(runGh(["pr", "view", "999"], "/tmp/ws")).rejects.toMatchObject({
      code: "gh-failed",
      message: "GraphQL: Could not resolve to a PullRequest",
    });
  });

  it("passes workspace as cwd and ambient env to gh", async () => {
    let seenCwd = "";
    stubGhSpawner((_args, workspace) => {
      seenCwd = workspace;
      return mockGhChild({ stdout: "ok" });
    });
    await runGh(["api", "repos/o/r"], "/repo/root");
    expect(seenCwd).toBe("/repo/root");
  });
});

describe("parsePrUrl", () => {
  it("accepts a GitHub pull request URL", () => {
    expect(
      parsePrUrl("https://github.com/acme/widgets/pull/42"),
    ).toEqual({
      owner: "acme",
      repo: "widgets",
      number: 42,
    });
  });

  it("rejects a non-GitHub host", () => {
    expect(() =>
      parsePrUrl("https://gitlab.com/acme/widgets/-/merge_requests/42"),
    ).toThrow(IssueError);
    try {
      parsePrUrl("https://gitlab.com/acme/widgets/-/merge_requests/42");
    } catch (err) {
      expect(err).toMatchObject({ code: "not-github-pr-url" });
    }
  });
});
