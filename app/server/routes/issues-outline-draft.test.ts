import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "../services/agent-sessions.js";
import { fakeLauncherSessions } from "../services/queue-launcher.test-helpers.js";

const AT = "2026-07-09T14:00:00.000Z";

let rootDir: string;
let issuesDir: string;
let server: Server;
let baseUrl: string;
let sessions: AgentSessions;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

function writeOutline(description: string): void {
  writeIssue("spec", {
    kind: "outline",
    title: "Feature outline",
    partOf: "p",
    bodyVersion: 3,
    order: 1,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeFileSync(join(issuesDir, "spec", "description.md"), description);
  mkdirSync(join(issuesDir, "spec", "versions"), { recursive: true });
  writeFileSync(join(issuesDir, "spec", "versions", "3.md"), description);
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-outline-draft-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);

  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: "/tmp/repo",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeOutline("saved\n");
  writeIssue("story-open", {
    kind: "story",
    title: "Open story",
    partOf: "p",
    order: 2,
    merged: false,
    createdAt: AT,
    updatedAt: AT,
  });

  sessions = fakeLauncherSessions().sessions;
  const { createApp } = await import("../app.js");
  const app = createApp(sessions);
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
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(rootDir, { recursive: true, force: true });
});

const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const SUBMISSION_ID = "sub";

async function writeOwnedDraft(body: string): Promise<void> {
  const { writeOutlineDraft } = await import("../services/outline-draft-store.js");
  writeOutlineDraft("spec", {
    body,
    review: REVIEW_ID,
    submission: SUBMISSION_ID,
  });
}

function writeWaitingReview(): void {
  writeIssue(REVIEW_ID, {
    kind: "review",
    title: "Open story",
    partOf: "p",
    story: "story-open",
    archived: false,
    marks: { all: {}, commits: {} },
    submissions: [
      {
        id: SUBMISSION_ID,
        at: AT,
        threadIds: ["thread-1"],
        status: "tasking",
        outlineCheck: { outline: "spec", status: "waiting" },
      },
    ],
    order: 4,
    createdAt: AT,
    updatedAt: AT,
  });
}

describe("outline draft HTTP API", () => {
  it("approves the draft as the next version through the outline-check gate", async () => {
    await writeOwnedDraft("next\n");
    writeWaitingReview();

    const approved = await request("POST", "/api/issues/spec/outline-draft/approve", {});
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      outline: "spec",
      status: "settled",
      version: 4,
      amended: true,
    });

    const detail = (await (await request("GET", "/api/issues/spec")).json()) as {
      bodyVersion: number;
      description: string;
      pendingDraft?: unknown;
    };
    expect(detail.bodyVersion).toBe(4);
    expect(detail.description).toBe("next\n");
    expect(detail.pendingDraft).toBeUndefined();
    expect(readFileSync(join(issuesDir, "spec", "versions", "3.md"), "utf8")).toBe(
      "saved\n",
    );
    expect(readFileSync(join(issuesDir, "spec", "versions", "4.md"), "utf8")).toBe(
      "next\n",
    );
  });
});
