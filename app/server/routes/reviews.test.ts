import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const SHA = "a".repeat(40);

let dir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function seedProjectTree(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: "e",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("t", {
    kind: "task",
    title: "T",
    partOf: "s",
    commits: [SHA],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("empty", {
    kind: "story",
    title: "Empty",
    partOf: "e",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("q", {
    kind: "project",
    title: "Q",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("other", {
    kind: "story",
    title: "Other",
    partOf: "q",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("other-task", {
    kind: "task",
    title: "Other task",
    partOf: "other",
    commits: [SHA],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function listen(): Promise<void> {
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
}

async function closeServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function openReview(projectId: string, storyId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/projects/${projectId}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: { kind: "story", storyId } }),
  });
}

describe("review record API", () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-reviews-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
    seedProjectTree();
    await listen();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeServer();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the same review on a second open-or-create", async () => {
    const created = await openReview("p", "s");
    expect(created.status).toBe(201);
    const first = (await created.json()) as {
      id: string;
      createdAt: string;
      updatedAt: string;
      effectiveStatus: string;
      archivedReason?: string;
    };

    const again = await openReview("p", "s");
    expect(again.status).toBe(200);
    const second = (await again.json()) as { id: string; createdAt: string; updatedAt: string };
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(first.updatedAt);

    const stored = JSON.parse(
      readFileSync(join(dir, "p", "reviews", `${first.id}.json`), "utf8"),
    ) as { effectiveStatus?: string; status: string; marks: unknown };
    expect(stored.status).toBe("open");
    expect(stored.effectiveStatus).toBeUndefined();
    expect(stored.marks).toEqual({ all: {}, commits: {} });
    expect(readdirSync(join(dir, "p", "reviews"))).toEqual([`${first.id}.json`]);
    expect(first.effectiveStatus).toBe("open");
    expect(first.archivedReason).toBeUndefined();
  });

  it("does not create a review when listing one story", async () => {
    const listed = await fetch(`${baseUrl}/api/projects/p/reviews?storyId=s`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ reviews: [] });
    expect(readdirSync(join(dir, "p"))).not.toContain("reviews");
  });

  it("flips effective status to archived/merged when the story is merged through update", async () => {
    const created = await openReview("p", "s");
    const review = (await created.json()) as { id: string };
    const { update } = await import("../services/issues.js");
    await update("s", { merged: true });

    const res = await fetch(`${baseUrl}/api/projects/p/reviews/${review.id}`);
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      status: string;
      postMortem: boolean;
      effectiveStatus: string;
      archivedReason?: string;
    };
    expect(view.status).toBe("open");
    expect(view.postMortem).toBe(false);
    expect(view.effectiveStatus).toBe("archived");
    expect(view.archivedReason).toBe("merged");

    const stored = JSON.parse(
      readFileSync(join(dir, "p", "reviews", `${review.id}.json`), "utf8"),
    ) as { status: string; postMortem: boolean };
    expect(stored.status).toBe("open");
    expect(stored.postMortem).toBe(false);
  });

  it("reopen on a merged story yields an open post-mortem review", async () => {
    const created = await openReview("p", "s");
    const review = (await created.json()) as { id: string };
    const { update } = await import("../services/issues.js");
    await update("s", { merged: true });

    const res = await fetch(`${baseUrl}/api/projects/p/reviews/${review.id}/reopen`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      status: string;
      postMortem: boolean;
      effectiveStatus: string;
      archivedReason?: string;
    };
    expect(view).toMatchObject({
      status: "open",
      postMortem: true,
      effectiveStatus: "open",
    });
    expect(view.archivedReason).toBeUndefined();
  });

  it("opens a post-mortem review created on an already merged story", async () => {
    const { update } = await import("../services/issues.js");
    await update("s", { merged: true });

    const created = await openReview("p", "s");
    expect(created.status).toBe(201);
    const view = (await created.json()) as {
      status: string;
      postMortem: boolean;
      effectiveStatus: string;
      archivedReason?: string;
    };
    expect(view).toMatchObject({
      status: "open",
      postMortem: true,
      effectiveStatus: "open",
    });
    expect(view.archivedReason).toBeUndefined();
  });

  it("archives explicitly and lists the story's review without creating another", async () => {
    const created = await openReview("p", "s");
    const review = (await created.json()) as { id: string };

    const archived = await fetch(
      `${baseUrl}/api/projects/p/reviews/${review.id}/archive`,
      { method: "POST" },
    );
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      id: review.id,
      status: "archived",
      effectiveStatus: "archived",
      archivedReason: "explicit",
    });

    const again = await openReview("p", "s");
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: review.id, status: "archived" });

    const listed = await fetch(`${baseUrl}/api/projects/p/reviews?storyId=s`);
    const body = (await listed.json()) as { reviews: { id: string }[] };
    expect(body.reviews.map((entry) => entry.id)).toEqual([review.id]);

    const all = await fetch(`${baseUrl}/api/projects/p/reviews`);
    const allBody = (await all.json()) as { reviews: { id: string }[] };
    expect(allBody.reviews.map((entry) => entry.id)).toEqual([review.id]);
  });

  it("refuses a story outside the project and a story with no task commits", async () => {
    const outside = await openReview("p", "other");
    expect(outside.status).toBe(400);
    expect(await outside.json()).toMatchObject({
      code: "validation",
      error: 'story "other" is outside project "p"',
    });

    const empty = await openReview("p", "empty");
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      code: "validation",
      error: 'story "empty" has no task commits',
    });

    const missing = await fetch(`${baseUrl}/api/projects/p/reviews/missing`);
    expect(missing.status).toBe(404);

    const notProject = await openReview("s", "s");
    expect(notProject.status).toBe(404);
  });
});

describe("review record API read-only", () => {
  const reviewId = "11111111-1111-4111-8111-111111111111";

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-reviews-ro-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "1");
    seedProjectTree();
    const review = {
      id: reviewId,
      projectId: "p",
      target: { kind: "story", storyId: "s" },
      status: "open",
      postMortem: false,
      createdAt: AT,
      updatedAt: AT,
      marks: { all: {}, commits: {} },
    };
    mkdirSync(join(dir, "p", "reviews"), { recursive: true });
    writeFileSync(
      join(dir, "p", "reviews", `${reviewId}.json`),
      `${JSON.stringify(review, null, 2)}\n`,
    );
    await listen();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeServer();
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses review writes and still reads the stored review", async () => {
    const before = readFileSync(join(dir, "p", "reviews", `${reviewId}.json`), "utf8");

    const created = await openReview("p", "s");
    expect(created.status).toBe(403);
    expect(await created.json()).toMatchObject({ code: "read_only" });

    const archived = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/archive`,
      { method: "POST" },
    );
    expect(archived.status).toBe(403);
    expect(await archived.json()).toMatchObject({ code: "read_only" });

    const reopened = await fetch(
      `${baseUrl}/api/projects/p/reviews/${reviewId}/reopen`,
      { method: "POST" },
    );
    expect(reopened.status).toBe(403);
    expect(await reopened.json()).toMatchObject({ code: "read_only" });

    expect(readFileSync(join(dir, "p", "reviews", `${reviewId}.json`), "utf8")).toBe(before);
    expect(readdirSync(join(dir, "p", "reviews"))).toEqual([`${reviewId}.json`]);

    const read = await fetch(`${baseUrl}/api/projects/p/reviews/${reviewId}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      id: reviewId,
      status: "open",
      effectiveStatus: "open",
    });
  });
});
