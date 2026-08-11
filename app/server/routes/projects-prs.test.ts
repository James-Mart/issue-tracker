import { EventEmitter } from "node:events";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSpawner } from "../services/delivery.js";

const AT = "2026-07-09T14:00:00.000Z";
const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../testdata/supporting-docs",
);

let dir: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;
let setGhSpawnerForTests: (next: GhSpawner | null) => void;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function makeFixtureWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "issue-workspace-prs-route-"));
  mkdirSync(join(ws, ".git"));
  cpSync(FIXTURES, ws, { recursive: true });
  return ws;
}

function mockGhChild(opts: {
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

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-prs-route-"));
  workspaceDir = makeFixtureWorkspace();
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);

  ({ setGhSpawnerForTests } = await import("../services/delivery.js"));
  setGhSpawnerForTests(null);

  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    workspace: workspaceDir,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "Epic",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s1", {
    kind: "story",
    title: "Story one",
    partOf: "e",
    order: 0,
    merged: false,
    prUrl: "https://github.com/acme/widgets/pull/1",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s2", {
    kind: "story",
    title: "Story two",
    partOf: "e",
    order: 1,
    merged: false,
    prUrl: "https://github.com/acme/widgets/pull/2",
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s-no-pr", {
    kind: "story",
    title: "No PR",
    partOf: "e",
    order: 2,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
  });

  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  if (setGhSpawnerForTests) setGhSpawnerForTests(null);
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

async function getProjectPrs(projectId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/${projectId}/prs`);
}

describe("project PRs HTTP API", () => {
  it("returns live PR facts keyed by story id", async () => {
    const calls: string[][] = [];
    stubGhSpawner((args) => {
      calls.push(args);
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
                isDraft: true,
              }),
            },
          },
        }),
      });
    });

    const res = await getProjectPrs("p");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls).toHaveLength(1);
    expect(body).toEqual({
      prs: {
        s1: expect.objectContaining({
          number: 1,
          url: "https://github.com/acme/widgets/pull/1",
          state: "open",
        }),
        s2: expect.objectContaining({
          number: 2,
          url: "https://github.com/acme/widgets/pull/2",
          isDraft: true,
        }),
      },
    });
    expect(body.prs).not.toHaveProperty("s-no-pr");
  });

  it("returns an empty map without calling gh when no story has a prUrl", async () => {
    writeIssue("empty", {
      kind: "project",
      title: "Empty",
      order: 1,
      workspace: workspaceDir,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("solo", {
      kind: "story",
      title: "Solo",
      partOf: "empty",
      order: 0,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });

    let ghCalled = false;
    stubGhSpawner(() => {
      ghCalled = true;
      return mockGhChild({ stdout: "{}" });
    });

    const res = await getProjectPrs("empty");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prs: {} });
    expect(ghCalled).toBe(false);
  });

  it("returns 404 for an unknown project", async () => {
    const res = await getProjectPrs("missing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'unknown issue "missing"',
      code: "not_found",
    });
  });

  it("surfaces gh-unauthenticated with its code", async () => {
    stubGhSpawner(() =>
      mockGhChild({
        code: 4,
        stderr:
          "To use GitHub CLI in non-interactive mode, set the GH_TOKEN environment variable.",
      }),
    );

    const res = await getProjectPrs("p");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error:
        "To use GitHub CLI in non-interactive mode, set the GH_TOKEN environment variable.",
      code: "gh-unauthenticated",
    });
  });
});
