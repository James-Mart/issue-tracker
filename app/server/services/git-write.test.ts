import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  runGitWrite,
  setGitWriteSpawnerForTests,
  type GitWriteSpawner,
} from "./git-write.js";

afterEach(() => {
  setGitWriteSpawnerForTests(null);
});

function mockGitChild(opts: {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  error?: NodeJS.ErrnoException;
}): ChildProcessByStdio<null, Readable, Readable> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new ChildProcess(), {
    stdin: null,
    stdout,
    stderr,
    stdio: [null, stdout, stderr, undefined, undefined] as const,
  });

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

function stubGitWriteSpawner(
  handler: (args: string[], workspace: string) => ReturnType<typeof mockGitChild>,
): void {
  const spawner: GitWriteSpawner = (_command, args, options) =>
    handler(args, options.cwd);
  setGitWriteSpawnerForTests(spawner);
}

describe("runGitWrite", () => {
  it("refuses subcommands outside the allowlist before spawning", async () => {
    let spawned = false;
    stubGitWriteSpawner(() => {
      spawned = true;
      return mockGitChild({ stdout: "ok" });
    });

    await expect(
      runGitWrite(["merge", "origin/main"], "/mirror/root"),
    ).rejects.toMatchObject({
      code: "validation",
    });
    expect(spawned).toBe(false);
  });
});
