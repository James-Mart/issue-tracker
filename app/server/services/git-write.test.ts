import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { IssueError } from "./errors.js";
import {
  commitChanges,
  ensureOriginRemote,
  fetchOrigin,
  hasStagedChanges,
  initRepository,
  lsRemoteOrigin,
  pushMainToOrigin,
  runGitWrite,
  setGitWriteSpawnerForTests,
  setOriginRemote,
  showFileAtRef,
  stageAllChanges,
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

function stubGitWriteSpawner(
  handler: (args: string[], workspace: string) => ReturnType<typeof mockGitChild>,
): void {
  const spawner: GitWriteSpawner = (_command, args, options) =>
    handler(args, options.cwd);
  setGitWriteSpawnerForTests(spawner);
}

describe("initRepository", () => {
  it("initializes a repository on main", async () => {
    let seenArgs: string[] = [];
    stubGitWriteSpawner((args) => {
      seenArgs = args;
      return mockGitChild({});
    });

    await initRepository("/mirror/root");
    expect(seenArgs).toEqual(["init", "-b", "main"]);
  });
});

describe("setOriginRemote", () => {
  it("adds the origin remote with the supplied url", async () => {
    let seenArgs: string[] = [];
    stubGitWriteSpawner((args) => {
      seenArgs = args;
      return mockGitChild({});
    });

    await setOriginRemote("/mirror/root", "git@github.com:org/backup.git");
    expect(seenArgs).toEqual([
      "remote",
      "add",
      "origin",
      "git@github.com:org/backup.git",
    ]);
  });
});

describe("ensureOriginRemote", () => {
  it("adds origin when the remote list is empty", async () => {
    const seen: string[][] = [];
    stubGitWriteSpawner((args) => {
      seen.push(args);
      if (args[0] === "remote" && args.length === 1) {
        return mockGitChild({ stdout: "" });
      }
      return mockGitChild({});
    });

    await ensureOriginRemote("/mirror/root", "git@github.com:org/backup.git");
    expect(seen).toEqual([
      ["remote"],
      ["remote", "add", "origin", "git@github.com:org/backup.git"],
    ]);
  });

  it("updates origin when it already exists", async () => {
    const seen: string[][] = [];
    stubGitWriteSpawner((args) => {
      seen.push(args);
      if (args[0] === "remote" && args.length === 1) {
        return mockGitChild({ stdout: "origin\n" });
      }
      return mockGitChild({});
    });

    await ensureOriginRemote("/mirror/root", "git@github.com:org/other.git");
    expect(seen).toEqual([
      ["remote"],
      ["remote", "set-url", "origin", "git@github.com:org/other.git"],
    ]);
  });
});

describe("lsRemoteOrigin", () => {
  it("lists refs at origin", async () => {
    let seenArgs: string[] = [];
    stubGitWriteSpawner((args) => {
      seenArgs = args;
      return mockGitChild({ stdout: "" });
    });

    await expect(lsRemoteOrigin("/mirror/root")).resolves.toBe("");
    expect(seenArgs).toEqual(["ls-remote", "origin"]);
  });
});

describe("fetchOrigin", () => {
  it("fetches origin without merging", async () => {
    let seenArgs: string[] = [];
    stubGitWriteSpawner((args) => {
      seenArgs = args;
      return mockGitChild({});
    });

    await fetchOrigin("/mirror/root");
    expect(seenArgs).toEqual(["fetch", "origin"]);
  });
});

describe("showFileAtRef", () => {
  it("shows a path at a ref", async () => {
    let seenArgs: string[] = [];
    stubGitWriteSpawner((args) => {
      seenArgs = args;
      return mockGitChild({ stdout: '{"storeId":"abc"}\n' });
    });

    await expect(
      showFileAtRef("/mirror/root", "origin/main:backup-identity.json"),
    ).resolves.toBe('{"storeId":"abc"}\n');
    expect(seenArgs).toEqual(["show", "origin/main:backup-identity.json"]);
  });
});

describe("stageAllChanges", () => {
  it("stages all changes", async () => {
    let seenArgs: string[] = [];
    stubGitWriteSpawner((args) => {
      seenArgs = args;
      return mockGitChild({});
    });

    await stageAllChanges("/mirror/root");
    expect(seenArgs).toEqual(["add", "-A"]);
  });
});

describe("commitChanges", () => {
  it("commits with the supplied message", async () => {
    let seenArgs: string[] = [];
    stubGitWriteSpawner((args) => {
      seenArgs = args;
      return mockGitChild({});
    });

    await commitChanges("/mirror/root", "Mirror snapshot");
    expect(seenArgs).toEqual(["commit", "-m", "Mirror snapshot"]);
  });
});

describe("pushMainToOrigin", () => {
  it("pushes main to origin", async () => {
    let seenArgs: string[] = [];
    stubGitWriteSpawner((args) => {
      seenArgs = args;
      return mockGitChild({});
    });

    await pushMainToOrigin("/mirror/root");
    expect(seenArgs).toEqual(["push", "origin", "main"]);
  });
});

describe("hasStagedChanges", () => {
  it("returns true when porcelain output shows staged changes", async () => {
    stubGitWriteSpawner((args) => {
      expect(args).toEqual(["status", "--porcelain"]);
      return mockGitChild({ stdout: "M  issues/foo.json\n" });
    });

    await expect(hasStagedChanges("/mirror/root")).resolves.toBe(true);
  });

  it("returns false when nothing is staged", async () => {
    stubGitWriteSpawner(() =>
      mockGitChild({ stdout: "?? issues/new.json\n M issues/dirty.json\n" }),
    );

    await expect(hasStagedChanges("/mirror/root")).resolves.toBe(false);
  });
});

describe("runGitWrite", () => {
  it("passes allowlisted subcommands through with workspace as cwd", async () => {
    let seenArgs: string[] = [];
    let seenCwd = "";
    stubGitWriteSpawner((args, workspace) => {
      seenArgs = args;
      seenCwd = workspace;
      return mockGitChild({ stdout: "ok\n" });
    });

    await expect(runGitWrite(["status"], "/mirror/root")).resolves.toBe("ok\n");
    expect(seenArgs).toEqual(["status"]);
    expect(seenCwd).toBe("/mirror/root");
  });

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

  it("throws git-missing when the binary is absent", async () => {
    stubGitWriteSpawner(() =>
      mockGitChild({
        error: Object.assign(new Error("spawn git ENOENT"), {
          code: "ENOENT",
        }),
      }),
    );

    await expect(runGitWrite(["status"], "/mirror/root")).rejects.toMatchObject({
      code: "git-missing",
    });
  });

  it("throws git-failed with stderr for non-zero exits", async () => {
    stubGitWriteSpawner(() =>
      mockGitChild({
        code: 1,
        stderr: "error: failed to push some refs",
      }),
    );

    await expect(runGitWrite(["push", "origin", "main"], "/mirror/root")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof IssueError &&
        err.code === "git-failed" &&
        err.message === "error: failed to push some refs",
    );
  });
});
