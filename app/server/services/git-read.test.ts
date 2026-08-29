import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { IssueError } from "./errors.js";
import {
  runGit,
  setGitSpawnerForTests,
  type GitSpawner,
} from "./git-read.js";

afterEach(() => {
  setGitSpawnerForTests(null);
});

function mockGitChild(opts: {
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

function stubGitSpawner(
  handler: (args: string[], workspace: string) => ReturnType<typeof mockGitChild>,
): void {
  const spawner: GitSpawner = (_command, args, options) =>
    handler(args, options.cwd);
  setGitSpawnerForTests(spawner);
}

describe("runGit", () => {
  it("passes read-only subcommands through with workspace as cwd", async () => {
    let seenArgs: string[] = [];
    let seenCwd = "";
    stubGitSpawner((args, workspace) => {
      seenArgs = args;
      seenCwd = workspace;
      return mockGitChild({ stdout: "abc123\n" });
    });

    await expect(runGit(["rev-parse", "HEAD"], "/repo/root")).resolves.toBe(
      "abc123\n",
    );
    expect(seenArgs).toEqual(["rev-parse", "HEAD"]);
    expect(seenCwd).toBe("/repo/root");
  });

  it("refuses mutating subcommands before spawning", async () => {
    let spawned = false;
    stubGitSpawner(() => {
      spawned = true;
      return mockGitChild({ stdout: "ok" });
    });

    await expect(
      runGit(["commit", "-m", "nope"], "/repo/root"),
    ).rejects.toMatchObject({
      code: "validation",
    });
    expect(spawned).toBe(false);
  });

  it("throws git-missing when the binary is absent", async () => {
    stubGitSpawner(() =>
      mockGitChild({
        error: Object.assign(new Error("spawn git ENOENT"), {
          code: "ENOENT",
        }),
      }),
    );

    await expect(runGit(["show", "HEAD"], "/tmp/ws")).rejects.toMatchObject({
      code: "git-missing",
    });
  });

  it("throws git-failed for non-zero exits", async () => {
    stubGitSpawner(() =>
      mockGitChild({
        code: 128,
        stderr: "fatal: bad object HEAD",
      }),
    );

    await expect(runGit(["show", "HEAD"], "/tmp/ws")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof IssueError &&
        err.code === "git-failed" &&
        err.message === "fatal: bad object HEAD",
    );
  });
});
