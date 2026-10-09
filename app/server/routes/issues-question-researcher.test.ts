import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentThreadView } from "../schemas.js";
import {
  createFakeAgentSdk,
  type FakeAgentSdk,
  type FakeAgentSdkOptions,
} from "../services/agent-sdk.fake.js";

const AT = "2026-09-29T12:00:00.000Z";
const GIT = [
  "-c",
  "user.name=test",
  "-c",
  "user.email=test@example.com",
  "-c",
  "commit.gpgsign=false",
];

let root: string;
let issuesRoot: string;
let workspace: string;
let tip: string;
let server: Server | undefined;
let baseUrl: string;
let fake: FakeAgentSdk;

function git(args: string[]): string {
  return execFileSync("git", [...GIT, ...args], {
    cwd: workspace,
    encoding: "utf8",
  }).trim();
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function conversationIds(): string[] {
  try {
    return readdirSync(join(dirname(issuesRoot), "conversations"));
  } catch {
    return [];
  }
}

function sentPrompt(sendIndex: number): string {
  const send = fake.handles.flatMap((handle) => handle.sends)[sendIndex];
  if (!send) throw new Error(`no send #${sendIndex}`);
  return typeof send.message === "string" ? send.message : send.message.text;
}

async function startApp(options: FakeAgentSdkOptions = {}): Promise<void> {
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);
  fake = createFakeAgentSdk(options);
  const { createAgentSessions } = await import("../services/agent-sessions.js");
  const { createApp } = await import("../app.js");
  const app = createApp(createAgentSessions(fake));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server!.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function askQuestion(body: Record<string, unknown>): Promise<string> {
  const res = await post("/api/issues/s/comments", {
    role: "human",
    name: "Jared",
    kind: "question",
    ...body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function thread(rootId: string): Promise<CommentThreadView> {
  const res = await fetch(`${baseUrl}/api/issues/s/comments`);
  const { threads } = (await res.json()) as { threads: CommentThreadView[] };
  const view = threads.find((t) => t.rootId === rootId);
  if (!view) throw new Error(`no thread ${rootId}`);
  return view;
}

const runningRun = { status: "running" as const, startedAt: expect.any(String) };

function failedRun(error: string) {
  return { status: "failed" as const, startedAt: expect.any(String), error };
}

function conversationIsLive(conversationId: string): boolean {
  return existsSync(
    join(dirname(issuesRoot), "conversations", conversationId, "run-live.json"),
  );
}

/**
 * The thread once its launch has a live run, or has failed before one exists.
 * A follow-up still shows `running` from the launch overlay while the previous
 * conversation id is on the thread, so a live marker is what shows the run started.
 */
async function launchedThread(rootId: string): Promise<CommentThreadView> {
  return vi.waitFor(async () => {
    const view = await thread(rootId);
    const status = view.researcherRun?.status;
    if (status === "failed") return view;
    const id = view.researcherConversationId;
    if (id && status === "running" && conversationIsLive(id)) return view;
    throw new Error(`researcher launch still ${status ?? "unset"}`);
  });
}

/** The thread once a live or posting run has settled. */
async function settledThread(rootId: string): Promise<CommentThreadView> {
  return vi.waitFor(async () => {
    const view = await thread(rootId);
    const status = view.researcherRun?.status;
    if (status === "running" || status === "finishing") {
      throw new Error(`researcher still ${status}`);
    }
    return view;
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-question-researcher-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  workspace = join(root, "workspace");
  mkdirSync(workspace);
  git(["init", "-b", "main"]);
  writeFileSync(join(workspace, "a.ts"), "one\n");
  git(["add", "-A"]);
  git(["commit", "-m", "base"]);
  git(["checkout", "-b", "s"]);
  writeFileSync(join(workspace, "a.ts"), "one\ntwo\n");
  git(["add", "-A"]);
  git(["commit", "-m", "add two"]);
  tip = git(["rev-parse", "HEAD"]);

  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s", {
    kind: "story",
    title: "Story",
    partOf: "p",
    order: 0,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("t", {
    kind: "task",
    title: "Task",
    partOf: "s",
    order: 0,
    status: "done",
    commits: [tip],
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    server = undefined;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("question researcher", () => {
  it("stays posting until the run-end marker, then fails when no reply landed", async () => {
    let release!: () => void;
    await startApp({ hold: new Promise<void>((r) => (release = r)) });
    const rootId = await askQuestion({ body: "Why?" });
    const live = await launchedThread(rootId);
    const conversationId = live.researcherConversationId!;
    rmSync(join(dirname(issuesRoot), "conversations", conversationId, "run-live.json"));

    expect((await thread(rootId)).researcherRun).toEqual({
      status: "finishing",
      startedAt: expect.any(String),
    });

    release();
    expect((await settledThread(rootId)).researcherRun).toEqual(
      failedRun("the run ended without a reply."),
    );
  });

  it("starts no researcher for a review comment", async () => {
    await startApp();
    const res = await post("/api/issues/s/comments", {
      role: "human",
      body: "Rename this.",
    });
    expect(res.status).toBe(201);
    const rootId = ((await res.json()) as { id: string }).id;
    const reply = await post("/api/issues/s/comments", {
      role: "human",
      body: "And here.",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    await thread(rootId);
    expect(conversationIds()).toEqual([]);
    expect(fake.handles).toEqual([]);
  });

  it("resumes an open question with the human reply", async () => {
    let release!: () => void;
    await startApp({
      sendScript: [{}, { hold: new Promise<void>((resolve) => (release = resolve)) }],
    });
    const rootId = await askQuestion({ body: "Why?" });
    await settledThread(rootId);
    await post("/api/issues/s/comments", {
      role: "agent",
      name: "Researcher",
      body: "Because a.ts needs it.",
      replyTo: rootId,
    });
    const before = (await thread(rootId)).researcherConversationId;

    const reply = await post("/api/issues/s/comments", {
      role: "human",
      name: "Jared",
      body: "And the tests?",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    const live = await launchedThread(rootId);
    expect(live.researcherConversationId).toBe(before);
    expect(live.researcherRun).toEqual(runningRun);
    expect(sentPrompt(1)).toBe("And the tests?");
    expect(fake.handles).toHaveLength(1);

    release();
    expect((await settledThread(rootId)).researcherRun).toEqual(
      failedRun("the run ended without a reply."),
    );
  });
});
