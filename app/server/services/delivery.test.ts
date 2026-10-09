import { ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { readPullRequests, setGhSpawnerForTests, type GhSpawner } from "./delivery.js";

afterEach(() => {
  setGhSpawnerForTests(null);
});

function mockGhChild(opts: {
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

function stubGhSpawner(
  handler: (args: string[], workspace: string) => ReturnType<typeof mockGhChild>,
): void {
  const spawner: GhSpawner = (_command, args, options) =>
    handler(args, options.cwd);
  setGhSpawnerForTests(spawner);
}

function ghPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    url: "https://github.com/acme/widgets/pull/1",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    headRefOid: "abc123",
    baseRefName: "main",
    updatedAt: "2026-08-01T00:00:00Z",
    comments: {
      totalCount: 0,
      nodes: [],
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: "SUCCESS",
              contexts: {
                totalCount: 0,
                checkRunCountsByState: [],
                statusContextCountsByState: [],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("readPullRequests", () => {
  it("maps merged and closed-without-merge states", async () => {
    stubGhSpawner(() =>
      mockGhChild({
        stdout: JSON.stringify({
          data: {
            repository: {
              pr_10: ghPullRequest({
                number: 10,
                url: "https://github.com/acme/widgets/pull/10",
                state: "MERGED",
                mergeable: "UNKNOWN",
                mergeStateStatus: "UNKNOWN",
              }),
              pr_11: ghPullRequest({
                number: 11,
                url: "https://github.com/acme/widgets/pull/11",
                state: "CLOSED",
                mergeable: "CONFLICTING",
                mergeStateStatus: "DIRTY",
              }),
            },
          },
        }),
      }),
    );

    const result = await readPullRequests(
      [
        "https://github.com/acme/widgets/pull/10",
        "https://github.com/acme/widgets/pull/11",
      ],
      "/tmp/ws",
    );

    expect(result.get("https://github.com/acme/widgets/pull/10")).toMatchObject({
      state: "merged",
    });
    expect(result.get("https://github.com/acme/widgets/pull/11")).toMatchObject({
      state: "closed",
    });
  });
});
