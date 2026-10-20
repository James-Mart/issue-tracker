import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewRuntimeStatus } from "../schemas/review.js";

const STAMP = "2026-01-01T00:00:00.000Z";

let root: string;
let issuesDir: string;
let worktree: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({
      id,
      title: id,
      createdAt: STAMP,
      updatedAt: STAMP,
      order: 0,
      ...body,
    }),
  );
}

function nodeScript(source: string): string {
  const path = join(root, `phase-${Math.random().toString(16).slice(2)}.cjs`);
  writeFileSync(path, source);
  return `node ${JSON.stringify(path)}`;
}

function listenScript(marker: string): string {
  return nodeScript(`
    const fs = require("fs");
    const net = require("net");
    if (process.cwd() !== ${JSON.stringify(worktree)}) process.exit(2);
    fs.appendFileSync(${JSON.stringify(marker)}, "start\\n");
    net.createServer().listen(Number(process.env.AGENT_STACK_PORT), "127.0.0.1");
    setInterval(() => {}, 1e9);
  `);
}

function markerScript(marker: string, phase: string, exitCode = 0): string {
  return nodeScript(`
    const fs = require("fs");
    if (process.cwd() !== ${JSON.stringify(worktree)}) process.exit(2);
    fs.appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${phase}\n`)});
    process.exit(${exitCode});
  `);
}

async function boot(): Promise<void> {
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  vi.stubEnv("ISSUE_TRACKER_GUEST", "");
  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

function checkoutHead(dir: string): string {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Tester",
        GIT_AUTHOR_EMAIL: "tester@example.com",
        GIT_COMMITTER_NAME: "Tester",
        GIT_COMMITTER_EMAIL: "tester@example.com",
      },
    });
  git("init", "-b", "main");
  writeFileSync(join(dir, "file.txt"), "base\n");
  git("add", "file.txt");
  git("commit", "-m", "base");
  return git("rev-parse", "HEAD").trim();
}

function seedReview(runtime: Record<string, string>): void {
  const headSha = checkoutHead(worktree);
  writeIssue("proj", { kind: "project", workspace: worktree, runtime });
  writeIssue("rev", {
    kind: "review",
    partOf: "proj",
    archived: false,
    marks: { all: {}, commits: {} },
    submissions: [],
    pr: {
      url: "https://github.com/example/repo/pull/1",
      number: 1,
      baseRef: "main",
      headRef: "feature",
        headSha,
      fork: false,
    },
    worktreePath: worktree,
  });
}

async function runtime(method: string, id = "rev"): Promise<Response> {
  return fetch(`${baseUrl}/api/reviews/${id}/runtime`, { method });
}

async function until(
  state: ReviewRuntimeStatus["state"],
): Promise<ReviewRuntimeStatus> {
  const deadline = Date.now() + 8_000;
  let last: ReviewRuntimeStatus = { state: "stopped" };
  while (Date.now() < deadline) {
    const res = await runtime("GET");
    last = (await res.json()) as ReviewRuntimeStatus;
    if (last.state === state || last.state === "failed") return last;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out at ${JSON.stringify(last)}`);
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(200, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-review-runtime-"));
  issuesDir = join(root, "issues");
  worktree = join(root, "worktree");
  mkdirSync(issuesDir, { recursive: true });
  mkdirSync(worktree, { recursive: true });
});

afterEach(async () => {
  const { stopReviewRuntime } = await import("./review-runtime.js").catch(() => ({
    stopReviewRuntime: undefined,
  }));
  if (stopReviewRuntime) await stopReviewRuntime("rev").catch(() => undefined);
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("review runtime", () => {
  it("boots from the review worktree and stays off the conversation agent stack", async () => {
    const marker = join(root, "phases");
    seedReview({
      build: markerScript(marker, "build"),
      start: listenScript(marker),
      readiness: markerScript(marker, "readiness"),
      baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
    });
    await boot();

    const started = await runtime("POST");
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ state: "booting" });

    const running = await until("running");
    expect(running.state).toBe("running");
    expect(running.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(readFileSync(marker, "utf8").trim().split("\n")).toEqual([
      "build",
      "start",
      "readiness",
    ]);
    expect(existsSync(join(dirname(issuesDir), "conversations"))).toBe(false);

    const again = await runtime("POST");
    expect(await again.json()).toEqual(running);
    expect(readFileSync(marker, "utf8").trim().split("\n")).toEqual([
      "build",
      "start",
      "readiness",
    ]);

    const port = Number(running.baseUrl?.split(":").at(-1));
    expect(await portOpen(port)).toBe(true);
    const stopped = await runtime("DELETE");
    expect(await stopped.json()).toEqual({ state: "stopped" });
    expect(await (await runtime("GET")).json()).toEqual({ state: "stopped" });
    expect(await portOpen(port)).toBe(false);
  });

  it("stops a boot during build, collects the build group, and lets Start boot again", async () => {
    const marker = join(root, "phases");
    const buildChild = join(root, "build-child.pid");
    const gate = join(root, "build-may-finish");
    seedReview({
      build: `sleep 30 & echo $! > ${buildChild}; echo build >> ${marker}; while [ ! -e ${gate} ]; do sleep 0.05; done; kill $!`,
      start: listenScript(marker),
      baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
    });
    await boot();

    expect(await (await runtime("POST")).json()).toEqual({ state: "booting" });
    const deadline = Date.now() + 8_000;
    while (!existsSync(buildChild) || readFileSync(buildChild, "utf8").trim() === "") {
      if (Date.now() > deadline) throw new Error("build never started");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const sleepPid = Number(readFileSync(buildChild, "utf8").trim());
    const record = JSON.parse(
      readFileSync(join(dirname(issuesDir), "review-runtimes", "rev", "state.json"), "utf8"),
    ) as { bootPhase?: { phase: string } };
    expect(record.bootPhase?.phase).toBe("build");

    const stopped = await runtime("DELETE");
    expect(await stopped.json()).toEqual({ state: "stopped" });
    expect(existsSync(`/proc/${sleepPid}`)).toBe(false);
    expect(existsSync(join(dirname(issuesDir), "review-runtimes", "rev"))).toBe(false);
    expect(await (await runtime("GET")).json()).toEqual({ state: "stopped" });

    writeFileSync(gate, "");
    expect(await (await runtime("POST")).json()).toEqual({ state: "booting" });
    expect((await until("running")).state).toBe("running");
    expect(readFileSync(marker, "utf8").trim().split("\n")).toEqual(["build", "build", "start"]);
  });
});
