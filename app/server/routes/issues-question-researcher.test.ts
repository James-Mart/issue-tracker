import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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

function conversationMeta(id: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(dirname(issuesRoot), "conversations", id, "meta.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
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

async function settledThread(rootId: string): Promise<CommentThreadView> {
  return vi.waitFor(async () => {
    const view = await thread(rootId);
    if (view.researcherRun?.status === "running") {
      throw new Error("researcher still running");
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
  it("starts a pinned researcher on the Story's review channel and shows it live", async () => {
    let release!: () => void;
    await startApp({ hold: new Promise<void>((r) => (release = r)) });

    const rootId = await askQuestion({
      body: "Why add two?",
      anchor: { path: "a.ts", side: "new", line: 2, startLine: 1, commitSha: tip },
    });

    const live = await thread(rootId);
    expect(live.researcherRun).toEqual({ status: "running" });
    const conversationId = live.researcherConversationId!;
    expect(conversationMeta(conversationId)).toMatchObject({
      issueId: "s",
      channel: "review",
      model: "composer-2.5",
    });

    const prompt = sentPrompt(0);
    expect(prompt).toMatch(/^You are the \*\*researcher\*\*/);
    expect(prompt).toContain(
      [
        "A reviewer asked a question about this Story's changes.",
        "",
        "Story: s — Story",
        `Thread: ${rootId}`,
        `Workspace: ${workspace}`,
        `Anchor: a.ts, new side, lines 1-2, commit ${tip}`,
        "Question:",
        "Why add two?",
      ].join("\n"),
    );

    const runs = await fetch(`${baseUrl}/api/issues/s/agent-runs`);
    expect(((await runs.json()) as { runs: unknown[] }).runs).toEqual([
      expect.objectContaining({
        role: "issue-tracker-review-question",
        conversationId,
        status: "running",
      }),
    ]);

    release();
    expect((await settledThread(rootId)).researcherRun).toEqual({
      status: "failed",
      error: "the run ended without a reply.",
    });
  });

  it("gives a general question the Story's diff range", async () => {
    await startApp();
    await askQuestion({ body: "What changed overall?" });
    expect(sentPrompt(0)).toMatch(
      new RegExp(`\\nDiff: \\S+\\.\\.\\.${tip}\\nQuestion:\\nWhat changed overall\\?$`),
    );
  });

  it("clears the researcher state once the Researcher replies", async () => {
    await startApp();
    const rootId = await askQuestion({ body: "Why?" });
    await settledThread(rootId);

    const reply = await post("/api/issues/s/comments", {
      role: "agent",
      name: "Researcher",
      body: "Because a.ts:2 needs it.",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    expect((await thread(rootId)).researcherRun).toBeUndefined();
  });

  it("shows a failed run's error, and Retry starts a fresh researcher", async () => {
    let release!: () => void;
    await startApp({
      sendScript: [
        { waitResult: { id: "run-1", status: "error", error: { message: "the run timed out" } } },
        { hold: new Promise<void>((r) => (release = r)) },
      ],
    });
    const rootId = await askQuestion({ body: "Why?" });

    const failed = await settledThread(rootId);
    expect(failed.researcherRun).toEqual({
      status: "failed",
      error: "the run timed out",
    });

    const retried = await post(`/api/issues/s/threads/${rootId}/researcher/retry`);
    expect(retried.status).toBe(204);
    const live = await thread(rootId);
    expect(live.researcherRun).toEqual({ status: "running" });
    expect(live.researcherConversationId).not.toBe(failed.researcherConversationId);
    expect(sentPrompt(1)).toContain("Question:\nWhy?");

    const refused = await post(`/api/issues/s/threads/${rootId}/researcher/retry`);
    expect(refused.status).toBe(409);
    release();
  });

  it("records a researcher that fails to start as failed", async () => {
    await startApp({ sendScript: [{ sendError: new Error("model unavailable") }] });
    const rootId = await askQuestion({ body: "Why?" });

    const view = await settledThread(rootId);
    expect(view.researcherRun?.status).toBe("failed");
    expect(view.researcherRun).toMatchObject({
      error: expect.stringContaining("model unavailable"),
    });
  });

  it("fails a general question's researcher when the Story has no merge base", async () => {
    const story = { kind: "story", title: "Story", partOf: "p", merged: false, createdAt: AT, updatedAt: AT };
    writeIssue("base", { ...story, title: "Base", order: 0 });
    writeIssue("s", { ...story, order: 1, stackedOn: "base" });
    await startApp();
    const rootId = await askQuestion({ body: "What changed overall?" });

    expect((await settledThread(rootId)).researcherRun).toEqual({
      status: "failed",
      error: 'story "s" has no merge base',
    });
    expect(fake.handles).toEqual([]);
  });

  it("starts no researcher for a review comment", async () => {
    await startApp();
    const res = await post("/api/issues/s/comments", {
      role: "human",
      body: "Rename this.",
    });
    expect(res.status).toBe(201);
    expect(conversationIds()).toEqual([]);
    expect(fake.handles).toEqual([]);
  });
});
