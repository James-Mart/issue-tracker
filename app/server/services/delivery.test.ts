import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { IssueError } from "./errors.js";
import {
  parsePrUrl,
  readPullRequests,
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

  it("resolves GraphQL stdout when exit is non-zero but data is present", async () => {
    const body = JSON.stringify({
      data: { repository: { pr_1: null } },
      errors: [{ message: "Could not resolve to a PullRequest" }],
    });
    stubGhSpawner(() =>
      mockGhChild({
        code: 1,
        stdout: body,
        stderr: "gh: Could not resolve to a PullRequest",
      }),
    );
    await expect(
      runGh(["api", "graphql", "-f", "query=query { viewer { login } }"], "/tmp"),
    ).resolves.toBe(body);
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
  it("issues one GraphQL call per repo", async () => {
    const calls: string[][] = [];
    stubGhSpawner((args) => {
      calls.push(args);
      const queryArg = args.find((a) => a.startsWith("query=")) ?? "";
      const repo =
        /name: "([^"]+)"/.exec(queryArg)?.[1] ??
        /name:\\"([^\\]+)\\"/.exec(queryArg)?.[1];
      if (repo === "widgets") {
        return mockGhChild({
          stdout: JSON.stringify({
            data: {
              repository: {
                pr_1: ghPullRequest({
                  number: 1,
                  url: "https://github.com/acme/widgets/pull/1",
                }),
                pr_2: ghPullRequest({
                  number: 2,
                  url: "https://github.com/acme/widgets/pull/2",
                }),
              },
            },
          }),
        });
      }
      return mockGhChild({
        stdout: JSON.stringify({
          data: {
            repository: {
              pr_9: ghPullRequest({
                number: 9,
                url: "https://github.com/acme/gadgets/pull/9",
              }),
            },
          },
        }),
      });
    });

    const result = await readPullRequests(
      [
        "https://github.com/acme/widgets/pull/1",
        "https://github.com/acme/widgets/pull/2",
        "https://github.com/acme/gadgets/pull/9",
      ],
      "/tmp/ws",
    );

    expect(calls).toHaveLength(2);
    expect(calls.every((args) => args[0] === "api" && args[1] === "graphql")).toBe(
      true,
    );
    expect(result.size).toBe(3);
    expect(result.get("https://github.com/acme/widgets/pull/1")).toMatchObject({
      number: 1,
      state: "open",
    });
    expect(result.get("https://github.com/acme/gadgets/pull/9")).toMatchObject({
      number: 9,
    });
  });

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

  it("maps a null pullRequest to not-found", async () => {
    stubGhSpawner(() =>
      mockGhChild({
        code: 1,
        stdout: JSON.stringify({
          data: { repository: { pr_404: null } },
          errors: [{ message: "Could not resolve to a PullRequest" }],
        }),
        stderr: "gh: Could not resolve to a PullRequest",
      }),
    );

    const result = await readPullRequests(
      ["https://github.com/acme/widgets/pull/404"],
      "/tmp/ws",
    );

    expect(result.get("https://github.com/acme/widgets/pull/404")).toEqual({
      reason: "not-found",
    });
  });

  it("uses comments.totalCount for commentCount", async () => {
    stubGhSpawner(() =>
      mockGhChild({
        stdout: JSON.stringify({
          data: {
            repository: {
              pr_3: ghPullRequest({
                number: 3,
                url: "https://github.com/acme/widgets/pull/3",
                comments: {
                  totalCount: 25,
                  nodes: [
                    {
                      author: { login: "ada" },
                      body: "one",
                      createdAt: "2026-08-01T00:00:00Z",
                      url: "https://github.com/acme/widgets/pull/3#issuecomment-1",
                    },
                  ],
                },
              }),
            },
          },
        }),
      }),
    );

    const result = await readPullRequests(
      ["https://github.com/acme/widgets/pull/3"],
      "/tmp/ws",
    );
    const facts = result.get("https://github.com/acme/widgets/pull/3");
    expect(facts).toMatchObject({
      commentCount: 25,
      comments: [{ author: "ada", body: "one" }],
    });
    expect(
      facts && "comments" in facts ? facts.comments.length : -1,
    ).toBe(1);
  });

  it("does not request reviewRequests in the GraphQL query", async () => {
    let query = "";
    stubGhSpawner((args) => {
      query = args.find((a) => a.startsWith("query="))?.slice("query=".length) ?? "";
      return mockGhChild({
        stdout: JSON.stringify({
          data: {
            repository: {
              pr_1: ghPullRequest(),
            },
          },
        }),
      });
    });

    await readPullRequests(
      ["https://github.com/acme/widgets/pull/1"],
      "/tmp/ws",
    );

    expect(query).not.toMatch(/reviewRequests/);
    expect(query).toMatch(/statusCheckRollup/);
    expect(query).toMatch(/comments\(last: 10\)/);
  });
});
