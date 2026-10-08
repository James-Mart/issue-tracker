import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSubmittable } from "../../src/features/reviews/lib/review-submittable.js";
import { readComments } from "./comment-append.js";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import {
  PR_URL,
  SHA,
  commentNode,
  commentPages,
  dir,
  ghCalls,
  githubParts,
  mockChild,
  page,
  previous,
  project,
  queryOf,
  reviewCommentNode,
  reviewNode,
  storedLines,
  story,
  stubGh,
  threadNode,
  usePrCommentMirrorHarness,
} from "./pr-comment-mirror-harness.js";
import { mirrorPrComments } from "./pr-comment-mirror.js";
import type { PrSyncStepResult } from "./pr-sync-driver.js";

usePrCommentMirrorHarness();

describe("mirrorPrComments", () => {
  it("makes no GitHub call when reconcile matched nothing", async () => {
    const input = previous();
    const result = await mirrorPrComments("p", input);
    expect(ghCalls).toHaveLength(0);
    expect(result).toBe(input);
  });

  it("lands conversation comments, including bots, and skips ones already mirrored", async () => {
    project();
    story("ship");
    writeFileSync(
      join(dir, "ship", "comments.jsonl"),
      `${JSON.stringify({
        id: "already",
        role: "human",
        name: "ada",
        body: "old",
        at: "2024-01-01T00:00:00.000Z",
        source: {
          kind: "github",
          id: "IC_old",
          url: "https://github.com/acme/widgets/pull/7#issuecomment-old",
        },
      })}\n`,
    );
    stubGh(commentPages([
      page([
        commentNode({
          id: "IC_old",
          body: "old",
          url: "https://github.com/acme/widgets/pull/7#issuecomment-old",
          createdAt: "2024-01-01T00:00:00Z",
        }),
        commentNode({
          id: "IC_new",
          body: "please rename this",
          url: "https://github.com/acme/widgets/pull/7#issuecomment-new",
          createdAt: "2024-06-01T00:00:00Z",
        }),
        commentNode({
          id: "IC_bot",
          body: "coverage dropped",
          author: { __typename: "Bot", login: "github-actions[bot]" },
          createdAt: "2024-06-02T00:00:00Z",
        }),
      ]),
    ]));

    const facts = new Map();
    const result = await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts,
    } as PrSyncStepResult);

    expect(result.error).toBeUndefined();
    expect(result.facts).toBe(facts);
    const lines = storedLines("ship");
    expect(lines.map((line) => line.id)).toEqual([
      "already",
      expect.any(String),
      expect.any(String),
    ]);
    expect(lines[1]).toMatchObject({
      role: "human",
      name: "ada",
      body: "please rename this",
      at: "2024-06-01T00:00:00.000Z",
      source: {
        kind: "github",
        id: "IC_new",
        url: "https://github.com/acme/widgets/pull/7#issuecomment-new",
      },
    });
    expect(lines[1]).not.toHaveProperty("createdAt");
    expect(lines[1]).not.toHaveProperty("replyToSourceId");
    expect(lines[2]).toMatchObject({
      role: "github-bot",
      name: "github-actions[bot]",
      body: "coverage dropped",
      source: { kind: "github", id: "IC_bot" },
    });
  });

  it("fetches the full history once per process, then only comments updated since", async () => {
    project();
    story("ship");
    stubGh(commentPages([
      page([commentNode()]),
      page([commentNode({ updatedAt: "2099-01-01T00:00:00Z" })]),
    ]));
    const input = {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult;

    await mirrorPrComments("p", input);
    await mirrorPrComments("p", input);

    const conversation = ghCalls.map(queryOf).filter((query) => query.includes("orderBy"));
    expect(conversation[0]).toContain("CREATED_AT");
    expect(conversation[1]).toContain("UPDATED_AT");
    expect(storedLines("ship")).toHaveLength(1);
  });

  it("does not advance the cursor when the read fails, and names the story", async () => {
    project();
    story("ship");
    story("other");
    const spawner: GhSpawner = (_command, args) => {
      ghCalls.push(args);
      return mockChild({ code: 1, stderr: "gh exploded" });
    };
    setGhSpawnerForTests(spawner);
    const input = {
      matches: new Map<string, string>([
        ["ship", PR_URL],
        ["other", "https://github.com/acme/widgets/pull/8"],
      ]),
      facts: new Map([["ship", { url: PR_URL }]]),
    } as PrSyncStepResult;

    const failed = await mirrorPrComments("p", input);
    expect(failed.error).toBe("ship: gh exploded");
    expect(failed.facts).toBe(input.facts);
    expect(storedLines("ship")).toHaveLength(0);
    expect(ghCalls).toHaveLength(1);

    stubGh(commentPages([page([commentNode()])]));
    const retried = await mirrorPrComments("p", input);
    expect(retried.error).toBeUndefined();
    expect(queryOf(ghCalls[1]!)).toContain("CREATED_AT");
    expect(storedLines("ship")).toHaveLength(1);
  });

  it("lands review summaries, inline threads, and bot authors", async () => {
    project();
    story("ship");
    const nested = reviewCommentNode({
      id: "PRRC_nested",
      body: "agree",
      createdAt: "2024-06-01T02:00:00Z",
      updatedAt: "2024-06-01T02:00:00Z",
      replyTo: { id: "PRRC_reply" },
    });
    stubGh(
      githubParts({
        reviews: [reviewNode()],
        threads: [
          threadNode(
            [
              reviewCommentNode(),
              reviewCommentNode({
                id: "PRRC_reply",
                body: "fixed",
                createdAt: "2024-06-01T01:00:00Z",
                updatedAt: "2024-06-01T01:00:00Z",
                replyTo: { id: "PRRC_1" },
                author: { __typename: "Bot", login: "coderabbit[bot]" },
              }),
              nested,
            ],
            { startLine: 10 },
          ),
          threadNode(
            [
              reviewCommentNode({
                id: "PRRC_bot_root",
                body: "this file changed",
                createdAt: "2024-06-05T00:00:00Z",
                updatedAt: "2024-06-05T00:00:00Z",
                author: { __typename: "Bot", login: "dependabot[bot]" },
              }),
            ],
            {
              id: "PRT_bot",
              subjectType: "FILE",
              path: "package.json",
              line: null,
              originalLine: null,
            },
          ),
        ],
      }),
    );

    const result = await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    expect(result.error).toBeUndefined();
    const lines = storedLines("ship");
    const summary = lines.find((line) => line.body === "Looks good overall");
    const root = lines.find((line) => line.body === "rename this");
    const reply = lines.find((line) => line.body === "fixed");
    const nestedLine = lines.find((line) => line.body === "agree");
    const botRoot = lines.find((line) => line.body === "this file changed");
    expect(summary).toMatchObject({
      role: "human",
      name: "ada",
      at: "2024-06-03T00:00:00.000Z",
      source: { kind: "github", id: "PRR_1" },
    });
    expect(summary).not.toHaveProperty("anchor");
    expect(summary).not.toHaveProperty("replyTo");
    expect(root).toMatchObject({
      role: "human",
      anchor: {
        path: "src/app.ts",
        side: "new",
        line: 12,
        startLine: 10,
        commitSha: SHA,
      },
    });
    expect(reply).toMatchObject({
      role: "github-bot",
      name: "coderabbit[bot]",
      replyTo: root?.id,
    });
    expect(reply).not.toHaveProperty("replyToSourceId");
    expect(reply).not.toHaveProperty("anchor");
    expect(nestedLine).toMatchObject({ replyTo: root?.id });
    expect(botRoot).toMatchObject({
      role: "github-bot",
      name: "dependabot[bot]",
      anchor: { path: "package.json", commitSha: SHA },
    });

    const threads = readComments("ship").threads;
    for (const rootId of [root?.id, botRoot?.id]) {
      const thread = threads.find((item) => item.rootId === rootId);
      expect(thread).toMatchObject({ kind: "review", state: "open", readyToTask: true });
      expect(isSubmittable(thread!, [])).toBe(true);
    }
  });

  it("resolves a reply onto a root mirrored on an earlier pass", async () => {
    project();
    story("ship");
    writeFileSync(
      join(dir, "ship", "comments.jsonl"),
      `${JSON.stringify({
        id: "root-1",
        role: "human",
        name: "ada",
        body: "rename this",
        at: "2024-06-01T00:00:00.000Z",
        anchor: { path: "src/app.ts", side: "new", line: 12, commitSha: SHA },
        source: {
          kind: "github",
          id: "PRRC_1",
          url: "https://github.com/acme/widgets/pull/7#discussion_r1",
        },
      })}\n`,
    );
    stubGh(
      githubParts({
        threads: [
          threadNode([
            reviewCommentNode({
              id: "PRRC_reply",
              body: "fixed",
              createdAt: "2024-06-02T00:00:00Z",
              replyTo: { id: "PRRC_1" },
              author: { __typename: "Bot", login: "coderabbit[bot]" },
            }),
          ]),
        ],
      }),
    );

    await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    const lines = storedLines("ship");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      role: "github-bot",
      name: "coderabbit[bot]",
      replyTo: "root-1",
    });
  });

  it("skips a reply whose parent is not a tracker comment", async () => {
    project();
    story("ship");
    stubGh(
      githubParts({
        threads: [
          threadNode([
            reviewCommentNode({ id: "PRRC_gone", author: null, body: "deleted" }),
            reviewCommentNode({
              id: "PRRC_orphan",
              body: "reply to nobody",
              createdAt: "2024-06-02T00:00:00Z",
              replyTo: { id: "PRRC_gone" },
            }),
          ]),
        ],
      }),
    );

    const result = await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    expect(result.error).toBeUndefined();
    expect(storedLines("ship")).toHaveLength(0);
  });

  it("appends a comment-edit when the GitHub body differs from the current tracker body", async () => {
    project();
    story("ship");
    const source = {
      kind: "github",
      id: "IC_1",
      url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
    };
    writeFileSync(
      join(dir, "ship", "comments.jsonl"),
      `${JSON.stringify({
        id: "c1",
        role: "human",
        name: "ada",
        body: "old",
        at: "2024-03-01T00:00:00.000Z",
        source,
      })}\n${JSON.stringify({
        type: "comment-edit",
        commentId: "c1",
        body: "current",
        at: "2024-04-01T00:00:00.000Z",
        role: "human",
        name: "ada",
      })}\n`,
    );
    const edited = commentNode({
      body: "rewritten",
      updatedAt: "2099-01-01T00:00:00Z",
    });
    stubGh(commentPages([page([edited]), page([edited])]));
    const input = {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult;

    await mirrorPrComments("p", input);

    const lines = storedLines("ship");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ body: "old" });
    expect(lines[2]).toEqual({
      type: "comment-edit",
      commentId: "c1",
      body: "rewritten",
      at: "2099-01-01T00:00:00.000Z",
      role: "human",
      name: "ada",
    });
    expect(readComments("ship").messages[0]?.body).toBe("rewritten");

    await mirrorPrComments("p", input);
    expect(storedLines("ship")).toHaveLength(3);
  });

  it("does not append a comment-edit when the GitHub body matches the current body", async () => {
    project();
    story("ship");
    writeFileSync(
      join(dir, "ship", "comments.jsonl"),
      `${JSON.stringify({
        id: "c1",
        role: "human",
        name: "ada",
        body: "old",
        at: "2024-03-01T00:00:00.000Z",
        source: {
          kind: "github",
          id: "IC_1",
          url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
        },
      })}\n${JSON.stringify({
        type: "comment-edit",
        commentId: "c1",
        body: "current",
        at: "2024-04-01T00:00:00.000Z",
        role: "human",
        name: "ada",
      })}\n`,
    );
    stubGh(
      commentPages([
        page([
          commentNode({
            body: "current",
            updatedAt: "2024-05-01T00:00:00Z",
          }),
        ]),
      ]),
    );

    await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    expect(storedLines("ship")).toHaveLength(2);
    expect(readComments("ship").messages[0]?.body).toBe("current");
  });

  it("stores an already-edited comment once and does not also append a comment-edit", async () => {
    project();
    story("ship");
    stubGh(
      commentPages([
        page([
          commentNode({
            body: "already revised",
            createdAt: "2024-03-01T00:00:00Z",
            updatedAt: "2024-05-01T00:00:00Z",
          }),
        ]),
      ]),
    );

    await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    const lines = storedLines("ship");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      body: "already revised",
      at: "2024-03-01T00:00:00.000Z",
      source: { kind: "github", id: "IC_1" },
    });
    expect(lines[0]).not.toHaveProperty("type");
  });

  it("appends a comment-edit for an edited inline bot comment", async () => {
    project();
    story("ship");
    writeFileSync(
      join(dir, "ship", "comments.jsonl"),
      `${JSON.stringify({
        id: "bot-1",
        role: "github-bot",
        name: "coderabbit[bot]",
        body: "rename this",
        at: "2024-06-01T00:00:00.000Z",
        anchor: { path: "src/app.ts", side: "new", line: 12, commitSha: SHA },
        source: {
          kind: "github",
          id: "PRRC_1",
          url: "https://github.com/acme/widgets/pull/7#discussion_r1",
        },
      })}\n`,
    );
    stubGh(
      githubParts({
        threads: [
          threadNode([
            reviewCommentNode({
              body: "renamed",
              updatedAt: "2024-06-04T00:00:00Z",
              author: { __typename: "Bot", login: "coderabbit[bot]" },
            }),
          ]),
        ],
      }),
    );

    await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    const lines = storedLines("ship");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ body: "rename this" });
    expect(lines[1]).toEqual({
      type: "comment-edit",
      commentId: "bot-1",
      body: "renamed",
      at: "2024-06-04T00:00:00.000Z",
      role: "github-bot",
      name: "coderabbit[bot]",
    });
    expect(readComments("ship").messages[0]?.body).toBe("renamed");
  });

  it("leaves the tracker copy in place when GitHub no longer returns the comment", async () => {
    project();
    story("ship");
    const stored = {
      id: "gone",
      role: "human",
      name: "ada",
      body: "keep me",
      at: "2024-03-01T00:00:00.000Z",
      source: {
        kind: "github",
        id: "IC_deleted",
        url: "https://github.com/acme/widgets/pull/7#issuecomment-deleted",
      },
    };
    writeFileSync(join(dir, "ship", "comments.jsonl"), `${JSON.stringify(stored)}\n`);
    stubGh(commentPages([page([])]));

    await mirrorPrComments("p", {
      matches: new Map([["ship", PR_URL]]),
      facts: new Map(),
    } as PrSyncStepResult);

    expect(storedLines("ship")).toEqual([stored]);
    expect(readComments("ship").messages.map((message) => message.body)).toEqual(["keep me"]);
  });
});
