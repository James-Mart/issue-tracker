import {
  ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runGit, setGitSpawnerForTests, type GitSpawner } from "./git-read.js";

afterEach(() => {
  setGitSpawnerForTests(null);
});

function fakeChildProcess(): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdio: ChildProcessWithoutNullStreams["stdio"] = [
    stdin,
    stdout,
    stderr,
    undefined,
    undefined,
  ];
  return Object.assign(new ChildProcess(), { stdin, stdout, stderr, stdio });
}

function mockGitChild(opts: {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  error?: NodeJS.ErrnoException;
}) {
  const child = fakeChildProcess();

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
});
