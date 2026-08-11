import { EventEmitter } from "node:events";
import type { GhSpawner } from "../server/services/delivery.js";

export function mockGhChild(opts: {
  code?: number | null;
  stdout?: string;
  stderr?: string;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  setImmediate(() => {
    if (opts.stdout) child.stdout.emit("data", opts.stdout);
    if (opts.stderr) child.stderr.emit("data", opts.stderr);
    child.emit("close", opts.code ?? 0);
  });

  return child;
}

export function ghPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    url: "https://github.com/acme/widgets/pull/1",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    headRefOid: "abc123def456",
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

type PullRequestFixture = ReturnType<typeof ghPullRequest>;

/** Stub `gh` for e2e: GraphQL PR reads and `gh pr merge` success. */
export function createGhStub(pullRequests: Record<number, PullRequestFixture>): {
  spawner: GhSpawner;
  mergeCalls: { args: string[]; cwd: string }[];
} {
  const mergeCalls: { args: string[]; cwd: string }[] = [];

  const spawner: GhSpawner = (_command, args, options) => {
    if (args[0] === "pr" && args[1] === "merge") {
      mergeCalls.push({ args, cwd: options.cwd });
      return mockGhChild({});
    }

    if (args[0] === "api" && args.includes("graphql")) {
      const repository: Record<string, PullRequestFixture> = {};
      for (const pr of Object.values(pullRequests)) {
        repository[`pr_${pr.number}`] = pr;
      }
      return mockGhChild({
        stdout: JSON.stringify({ data: { repository } }),
      });
    }

    return mockGhChild({
      code: 1,
      stderr: `unexpected gh invocation: ${args.join(" ")}\n`,
    });
  };

  return { spawner, mergeCalls };
}
