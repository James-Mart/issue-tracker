import { execFileSync } from "node:child_process";
import {
  existsSync,
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
  it("responds with the client id before the researcher launch, which shows as running", async () => {
    let release!: () => void;
    let finish!: () => void;
    await startApp({
      sendScript: [
        {
          sendHold: new Promise<void>((r) => (release = r)),
          hold: new Promise<void>((r) => (finish = r)),
        },
      ],
    });

    const res = await post("/api/issues/s/comments", {
      role: "human",
      kind: "question",
      body: "Why?",
      clientId: "client-1",
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; clientId?: string };
    expect(created.clientId).toBe("client-1");

    const starting = await thread(created.id);
    expect(starting.researcherRun).toEqual(runningRun);
    expect(starting.researcherConversationId).toBeUndefined();
    const comments = (await fetch(`${baseUrl}/api/issues/s/comments`).then((r) =>
      r.json(),
    )) as { messages: Array<{ id: string; clientId?: string }> };
    expect(comments.messages.find((m) => m.id === created.id)?.clientId).toBe(
      "client-1",
    );

    release();
    expect((await launchedThread(created.id)).researcherRun).toEqual(runningRun);
    finish();
  });

  it("shows a launch that fails before it opens a conversation as failed, and Retry recovers it", async () => {
    vi.doMock("../services/conversations.js", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../services/conversations.js")>();
      let refused = false;
      return {
        ...actual,
        createConversation: (input: Parameters<typeof actual.createConversation>[0]) => {
          if (refused) return actual.createConversation(input);
          refused = true;
          return Promise.reject(new Error("conversation store is read-only"));
        },
      };
    });
    try {
      let release!: () => void;
      await startApp({ hold: new Promise<void>((r) => (release = r)) });
      const rootId = await askQuestion({ body: "Why?" });

      expect((await launchedThread(rootId)).researcherRun).toEqual(
        failedRun("conversation store is read-only"),
      );
      expect(conversationIds()).toEqual([]);

      const retried = await post(`/api/issues/s/threads/${rootId}/researcher/retry`);
      expect(retried.status).toBe(204);
      expect((await thread(rootId)).researcherRun).toEqual(runningRun);
      release();
    } finally {
      vi.doUnmock("../services/conversations.js");
    }
  });

  it("starts a pinned researcher on the Story's review channel and shows it live", async () => {
    let release!: () => void;
    await startApp({ hold: new Promise<void>((r) => (release = r)) });

    const rootId = await askQuestion({
      body: "Why add two?",
      anchor: { path: "a.ts", side: "new", line: 2, startLine: 1, commitSha: tip },
    });

    const live = await launchedThread(rootId);
    expect(live.researcherRun).toEqual(runningRun);
    const conversationId = live.researcherConversationId!;
    expect(conversationMeta(conversationId)).toMatchObject({
      issueId: "s",
      channel: "review",
      role: "issue-tracker-review-question",
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
    expect((await settledThread(rootId)).researcherRun).toEqual(
      failedRun("the run ended without a reply."),
    );
  });

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

  it("gives a file-anchored question the path and commit without a line", async () => {
    await startApp();
    await launchedThread(
      await askQuestion({
        body: "Why this file?",
        anchor: { path: "a.ts", commitSha: tip },
      }),
    );
    expect(sentPrompt(0)).toContain(`Anchor: a.ts, commit ${tip}`);
    expect(sentPrompt(0)).not.toContain("new side");
  });

  it("gives a general question the Story's diff range", async () => {
    await startApp();
    await launchedThread(await askQuestion({ body: "What changed overall?" }));
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
    expect(failed.researcherRun).toEqual(failedRun("the run timed out"));

    const retried = await post(`/api/issues/s/threads/${rootId}/researcher/retry`);
    expect(retried.status).toBe(204);
    const live = await thread(rootId);
    expect(live.researcherRun).toEqual(runningRun);
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

    expect((await settledThread(rootId)).researcherRun).toEqual(
      failedRun('story "s" has no merge base'),
    );
    expect(fake.handles).toEqual([]);
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

  it("delivers a reply into the live researcher run", async () => {
    let release!: () => void;
    await startApp({ hold: new Promise<void>((resolve) => (release = resolve)) });
    const rootId = await askQuestion({ body: "Why?" });
    expect((await launchedThread(rootId)).researcherRun).toEqual(runningRun);

    const reply = await post("/api/issues/s/comments", {
      role: "human",
      body: "And the tests?",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    await launchedThread(rootId);
    expect(fake.handles.flatMap((handle) => handle.steers)).toEqual([
      "And the tests?",
    ]);
    expect(fake.handles.flatMap((handle) => handle.sends)).toHaveLength(1);
    release();
  });

  it("queues a mid-run reply when the run cannot take it", async () => {
    let release!: () => void;
    await startApp({
      hold: new Promise<void>((resolve) => (release = resolve)),
      steerResult: "revert_to_followup",
    });
    const rootId = await askQuestion({ body: "Why?" });
    const conversationId = (await launchedThread(rootId)).researcherConversationId!;

    const reply = await post("/api/issues/s/comments", {
      role: "human",
      body: "And the tests?",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    await launchedThread(rootId);
    expect(conversationMeta(conversationId).pendingMessage).toMatchObject({
      text: "And the tests?",
    });
    release();
  });

  it("starts a new session when the researcher conversation is archived", async () => {
    let release!: () => void;
    await startApp({
      sendScript: [
        {},
        { hold: new Promise<void>((resolve) => (release = resolve)) },
      ],
    });
    const rootId = await askQuestion({
      body: "Why add two?",
      anchor: { path: "a.ts", side: "new", line: 2, commitSha: tip },
    });
    await settledThread(rootId);
    const first = (await thread(rootId)).researcherConversationId!;
    await post("/api/issues/s/comments", {
      role: "agent",
      name: "Researcher",
      body: "Because a.ts:2 needs it.",
      replyTo: rootId,
    });
    const archived = await fetch(`${baseUrl}/api/conversations/${first}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    expect(archived.status).toBe(200);

    const reply = await post("/api/issues/s/comments", {
      role: "human",
      name: "Jared",
      body: "And the tests?",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    const live = await launchedThread(rootId);
    expect(live.researcherConversationId).not.toBe(first);
    expect(live.researcherRun).toEqual(runningRun);
    const prompt = sentPrompt(1);
    expect(prompt).toContain(
      "The previous researcher conversation for this thread is gone. This is a new session.",
    );
    expect(prompt).toContain(`Anchor: a.ts, new side, line 2, commit ${tip}`);
    expect(prompt).toContain("Jared:\nWhy add two?");
    expect(prompt).toContain("Researcher:\nBecause a.ts:2 needs it.");
    expect(prompt).toContain("Jared:\nAnd the tests?");

    const log = readFileSync(join(issuesRoot, "s", "comments.jsonl"), "utf8");
    expect(log).toContain(`"recovered":true`);
    expect(log).toContain(`"conversationId":"${live.researcherConversationId}"`);

    release();
    await settledThread(rootId);
    const answer = await post("/api/issues/s/comments", {
      role: "agent",
      name: "Researcher",
      body: "The tests cover the new line.",
      replyTo: rootId,
    });
    const answerId = ((await answer.json()) as { id: string }).id;
    const comments = (await fetch(`${baseUrl}/api/issues/s/comments`).then((r) =>
      r.json(),
    )) as { messages: Array<{ id: string; newSession?: boolean }> };
    expect(comments.messages.find((message) => message.id === answerId)?.newSession).toBe(
      true,
    );

    await post("/api/issues/s/comments", {
      role: "human",
      body: "Thanks.",
      replyTo: rootId,
    });
    await settledThread(rootId);
    const later = await post("/api/issues/s/comments", {
      role: "agent",
      name: "Researcher",
      body: "Anytime.",
      replyTo: rootId,
    });
    const laterId = ((await later.json()) as { id: string }).id;
    const again = (await fetch(`${baseUrl}/api/issues/s/comments`).then((r) =>
      r.json(),
    )) as { messages: Array<{ id: string; newSession?: boolean }> };
    expect(again.messages.find((message) => message.id === answerId)?.newSession).toBe(
      true,
    );
    expect(again.messages.find((message) => message.id === laterId)?.newSession).toBeUndefined();
  });

  it("starts a new session when the researcher conversation is gone", async () => {
    await startApp();
    const rootId = await askQuestion({ body: "Why?" });
    await settledThread(rootId);
    const first = (await thread(rootId)).researcherConversationId!;
    rmSync(join(dirname(issuesRoot), "conversations", first), {
      recursive: true,
    });

    const reply = await post("/api/issues/s/comments", {
      role: "human",
      name: "Jared",
      body: "Still there?",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    const live = await launchedThread(rootId);
    expect(fake.handles).toHaveLength(2);
    expect(sentPrompt(1)).toContain("Jared:\nWhy?");
    expect(sentPrompt(1)).toContain("Jared:\nStill there?");
    expect(sentPrompt(1)).toContain("This is a new session.");
    const log = readFileSync(join(issuesRoot, "s", "comments.jsonl"), "utf8");
    expect(log).toContain(
      `"conversationId":"${live.researcherConversationId}","recovered":true`,
    );
  });

  it("leaves a dismissed question's researcher idle when a human replies", async () => {
    await startApp();
    const rootId = await askQuestion({ body: "Why?" });
    await settledThread(rootId);
    const dismissed = await post(`/api/issues/s/threads/${rootId}/events`, {
      event: "dismissed",
    });
    expect(dismissed.status).toBe(201);

    const reply = await post("/api/issues/s/comments", {
      role: "human",
      body: "One more thing",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    await thread(rootId);
    expect(fake.handles.flatMap((handle) => handle.sends)).toHaveLength(1);
  });

  it("does not resume the researcher after the question is converted", async () => {
    await startApp();
    const rootId = await askQuestion({ body: "Why?" });
    await settledThread(rootId);
    const converted = await post(`/api/issues/s/threads/${rootId}/events`, {
      event: "converted",
      name: "Jared",
    });
    expect(converted.status).toBe(201);
    const view = await thread(rootId);
    expect(view.kind).toBe("review");
    expect(view.state).toBe("open");
    expect(view.readyToTask).toBe(true);
    expect(view.researcherConversationId).toBeUndefined();
    expect(view.researcherRun).toBeUndefined();
    expect(view.converted?.by).toEqual({ role: "human", name: "Jared" });

    const reply = await post("/api/issues/s/comments", {
      role: "human",
      name: "Jared",
      body: "Please task this.",
      replyTo: rootId,
    });
    expect(reply.status).toBe(201);
    await thread(rootId);
    expect(fake.handles.flatMap((handle) => handle.sends)).toHaveLength(1);
    const comments = (await fetch(`${baseUrl}/api/issues/s/comments`).then((r) =>
      r.json(),
    )) as { messages: Array<{ body: string }> };
    expect(comments.messages.map((message) => message.body)).toEqual([
      "Why?",
      "Please task this.",
    ]);
  });
});
