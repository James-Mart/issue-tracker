import { describe, expect, it } from "vitest";
import { fetchPrComments } from "./pr-comment-mirror.js";
import {
  OLD_SHA,
  PR_URL,
  SHA,
  WORKSPACE,
  commentNode,
  commentPages,
  ghCalls,
  githubParts,
  page,
  queryOf,
  reviewCommentNode,
  reviewNode,
  stubGh,
  threadNode,
  usePrCommentMirrorHarness,
} from "./pr-comment-mirror-harness.js";

usePrCommentMirrorHarness();

describe("fetchPrComments", () => {
  it("pages full history in created order and leaves edits empty", async () => {
    stubGh(commentPages([
      page(
        [commentNode({
          id: "IC_2",
          createdAt: "2024-04-01T00:00:00Z",
          updatedAt: "2024-04-01T00:00:00Z",
          body: "later",
        })],
        true,
        "cursor-1",
      ),
      page([
        commentNode({
          id: "IC_1",
          createdAt: "2024-03-01T00:00:00Z",
          updatedAt: "2024-03-01T00:00:00Z",
          body: "earlier",
        }),
        commentNode({
          id: "IC_bot",
          body: "rebased",
          createdAt: "2024-05-01T00:00:00Z",
          author: { __typename: "Bot", login: "dependabot[bot]" },
          updatedAt: "2024-05-01T00:00:00Z",
        }),
        commentNode({ id: "IC_gone", author: null, body: "deleted user" }),
        commentNode({ id: "IC_blank", body: "" }),
        commentNode({
          id: "IC_org",
          author: { __typename: "Organization", login: "acme" },
        }),
      ]),
    ]));

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);

    expect(ghCalls).toHaveLength(4);
    expect(queryOf(ghCalls[0]!)).toContain("CREATED_AT");
    expect(queryOf(ghCalls[0]!)).not.toContain("UPDATED_AT");
    expect(queryOf(ghCalls[1]!)).toContain('after: "cursor-1"');
    expect(result.edits).toEqual([]);
    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "IC_1",
      "IC_2",
      "IC_bot",
    ]);
    expect(result.comments[0]).toMatchObject({
      role: "human",
      name: "ada",
      body: "earlier",
      createdAt: "2024-03-01T00:00:00.000Z",
      source: {
        kind: "github",
        id: "IC_1",
        url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
      },
    });
    expect(result.comments[2]).toMatchObject({
      role: "github-bot",
      name: "dependabot[bot]",
    });
    expect(result.comments.every((comment) => comment.replyToSourceId === undefined)).toBe(
      true,
    );
  });

  it("stops an incremental fetch once comments are older than since", async () => {
    stubGh(commentPages([
      page(
        [
          commentNode({
            id: "IC_new",
            updatedAt: "2026-08-02T00:00:00Z",
            createdAt: "2026-08-02T00:00:00Z",
          }),
          commentNode({
            id: "IC_old",
            updatedAt: "2026-07-01T00:00:00Z",
            createdAt: "2026-07-01T00:00:00Z",
          }),
        ],
        true,
        "cursor-2",
      ),
      page([commentNode({ id: "IC_should_not_fetch" })]),
    ]));

    const result = await fetchPrComments(
      PR_URL,
      "2026-08-01T00:00:00.000Z",
      WORKSPACE,
    );

    expect(ghCalls).toHaveLength(3);
    expect(queryOf(ghCalls[0]!)).toContain("UPDATED_AT");
    expect(result.comments.map((comment) => comment.source.id)).toEqual(["IC_new"]);
    expect(result.edits).toEqual([]);
  });

  it("includes a comment updated at the since boundary", async () => {
    stubGh(commentPages([
      page([
        commentNode({
          id: "IC_edge",
          updatedAt: "2026-08-01T00:00:00Z",
          createdAt: "2026-07-01T00:00:00Z",
        }),
      ]),
    ]));

    const result = await fetchPrComments(
      PR_URL,
      "2026-08-01T00:00:00.000Z",
      WORKSPACE,
    );
    expect(result.comments.map((comment) => comment.source.id)).toEqual(["IC_edge"]);
    expect(result.edits).toEqual([
      {
        sourceId: "IC_edge",
        body: "ship it",
        editedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("reports edits for review summaries and inline comments updated after they were created", async () => {
    stubGh(
      githubParts({
        comments: [
          commentNode({
            id: "IC_same",
            createdAt: "2024-03-01T00:00:00Z",
            updatedAt: "2024-03-01T00:00:00Z",
          }),
        ],
        reviews: [
          reviewNode({
            id: "PRR_edited",
            body: "revised summary",
            submittedAt: "2024-06-03T00:00:00Z",
            updatedAt: "2024-06-05T00:00:00Z",
          }),
        ],
        threads: [
          threadNode([
            reviewCommentNode({
              id: "PRRC_edited",
              body: "renamed",
              createdAt: "2024-06-01T00:00:00Z",
              updatedAt: "2024-06-04T00:00:00Z",
            }),
          ]),
        ],
      }),
    );

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);

    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "IC_same",
      "PRRC_edited",
      "PRR_edited",
    ]);
    expect(result.edits).toEqual([
      {
        sourceId: "PRRC_edited",
        body: "renamed",
        editedAt: "2024-06-04T00:00:00.000Z",
      },
      {
        sourceId: "PRR_edited",
        body: "revised summary",
        editedAt: "2024-06-05T00:00:00.000Z",
      },
    ]);
  });

  it("fails loudly when the pull request is missing", async () => {
    stubGh(() => JSON.stringify({ data: { repository: { pullRequest: null } } }));
    await expect(fetchPrComments(PR_URL, undefined, WORKSPACE)).rejects.toMatchObject({
      code: "gh-failed",
      message: "gh graphql returned no pull request",
    });
  });

  it("refuses a URL that is not a GitHub pull request", async () => {
    await expect(
      fetchPrComments("https://example.com/acme/widgets/pull/7", undefined, WORKSPACE),
    ).rejects.toMatchObject({
      code: "not-github-pr-url",
    });
    expect(ghCalls).toHaveLength(0);
  });

  it("lands review summaries and skips pending or blank ones", async () => {
    stubGh(
      githubParts({
        reviews: [
          reviewNode(),
          reviewNode({
            id: "PRR_pending",
            state: "PENDING",
            body: "still drafting",
            submittedAt: null,
          }),
          reviewNode({ id: "PRR_blank", body: "" }),
          reviewNode({
            id: "PRR_bot",
            body: "coverage dropped",
            state: "COMMENTED",
            submittedAt: "2024-06-04T00:00:00Z",
            updatedAt: "2024-06-04T00:00:00Z",
            author: { __typename: "Bot", login: "github-actions[bot]" },
          }),
        ],
      }),
    );

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);

    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "PRR_1",
      "PRR_bot",
    ]);
    expect(result.comments[0]).toMatchObject({
      role: "human",
      name: "ada",
      body: "Looks good overall",
      createdAt: "2024-06-03T00:00:00.000Z",
    });
    expect(result.comments[0]?.replyToSourceId).toBeUndefined();
    expect(result.comments[0]?.anchor).toBeUndefined();
    expect(result.comments[1]).toMatchObject({
      role: "github-bot",
      name: "github-actions[bot]",
    });
  });

  it("anchors inline threads and keeps review replies pointed at their parent", async () => {
    const reply = reviewCommentNode({
      id: "PRRC_reply",
      body: "done",
      createdAt: "2024-06-01T01:00:00Z",
      updatedAt: "2024-06-01T01:00:00Z",
      replyTo: { id: "PRRC_1" },
      author: { __typename: "Bot", login: "coderabbit[bot]" },
    });
    stubGh(
      githubParts({
        threads: [
          threadNode(
            [reviewCommentNode(), reply],
            { id: "PRT_line", startLine: 10 },
          ),
          threadNode([reviewCommentNode({ id: "PRRC_left" })], {
            id: "PRT_left",
            diffSide: "LEFT",
            line: 4,
          }),
          threadNode(
            [
              reviewCommentNode({
                id: "PRRC_file",
                author: { __typename: "Bot", login: "dependabot[bot]" },
              }),
            ],
            {
              id: "PRT_file",
              subjectType: "FILE",
              line: null,
              originalLine: null,
              diffSide: "RIGHT",
              path: "README.md",
            },
          ),
          threadNode(
            [
              reviewCommentNode({
                id: "PRRC_old",
                commit: { oid: SHA },
                originalCommit: { oid: OLD_SHA },
              }),
            ],
            {
              id: "PRT_old",
              line: null,
              originalLine: 7,
              startLine: null,
              originalStartLine: 5,
              diffSide: "LEFT",
            },
          ),
          threadNode(
            [reviewCommentNode({ id: "PRRC_pending", state: "PENDING", body: "draft" })],
            { id: "PRT_pending" },
          ),
        ],
      }),
    );

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);
    const byId = new Map(result.comments.map((comment) => [comment.source.id, comment]));

    expect(byId.get("PRRC_1")).toMatchObject({
      anchor: { path: "src/app.ts", side: "new", line: 12, startLine: 10, commitSha: SHA },
    });
    expect(byId.get("PRRC_1")?.replyToSourceId).toBeUndefined();
    expect(byId.get("PRRC_reply")).toMatchObject({
      role: "github-bot",
      name: "coderabbit[bot]",
      replyToSourceId: "PRRC_1",
    });
    expect(byId.get("PRRC_reply")?.anchor).toBeUndefined();
    expect(byId.get("PRRC_left")?.anchor).toMatchObject({ side: "old", line: 4 });
    expect(byId.get("PRRC_file")?.anchor).toEqual({ path: "README.md", commitSha: SHA });
    expect(byId.get("PRRC_old")?.anchor).toEqual({
      path: "src/app.ts",
      side: "old",
      line: 7,
      startLine: 5,
      commitSha: OLD_SHA,
    });
    expect(byId.has("PRRC_pending")).toBe(false);
  });

  it("pages review-thread comments past the first page", async () => {
    const reply = reviewCommentNode({
      id: "PRRC_2",
      body: "second page",
      createdAt: "2024-06-02T00:00:00Z",
      replyTo: { id: "PRRC_1" },
    });
    stubGh(
      githubParts({
        threads: [
          threadNode([reviewCommentNode()], { id: "PRT_paged" }, {
            hasNextPage: true,
            endCursor: "thread-cursor",
          }),
        ],
        threadCommentPages: {
          PRT_paged: JSON.stringify({
            data: {
              node: {
                comments: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [reply],
                },
              },
            },
          }),
        },
      }),
    );

    const result = await fetchPrComments(PR_URL, undefined, WORKSPACE);

    expect(ghCalls.map(queryOf).some((query) => query.includes('after: "thread-cursor"'))).toBe(
      true,
    );
    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "PRRC_1",
      "PRRC_2",
    ]);
    expect(result.comments[1]?.replyToSourceId).toBe("PRRC_1");
  });

  it("keeps review items updated at or after since and still pages the whole connection", async () => {
    stubGh(
      githubParts({
        reviews: [
          reviewNode({
            id: "PRR_old",
            updatedAt: "2026-07-01T00:00:00Z",
            submittedAt: "2026-07-01T00:00:00Z",
          }),
          reviewNode({
            id: "PRR_new",
            updatedAt: "2026-08-02T00:00:00Z",
            submittedAt: "2026-08-02T00:00:00Z",
          }),
        ],
        threads: [
          threadNode([
            reviewCommentNode({
              id: "PRRC_old",
              updatedAt: "2026-07-01T00:00:00Z",
            }),
            reviewCommentNode({
              id: "PRRC_new",
              updatedAt: "2026-08-02T00:00:00Z",
              createdAt: "2026-08-02T00:00:00Z",
              replyTo: { id: "PRRC_old" },
            }),
          ]),
        ],
      }),
    );

    const result = await fetchPrComments(PR_URL, "2026-08-01T00:00:00.000Z", WORKSPACE);

    expect(result.comments.map((comment) => comment.source.id)).toEqual([
      "PRR_new",
      "PRRC_new",
    ]);
    expect(result.comments[1]?.replyToSourceId).toBe("PRRC_old");
    expect(result.comments[1]?.anchor).toBeUndefined();
  });

  it("fails loudly when an inline comment has no commit", async () => {
    stubGh(
      githubParts({
        threads: [
          threadNode([
            reviewCommentNode({ commit: null, originalCommit: null }),
          ]),
        ],
      }),
    );

    await expect(fetchPrComments(PR_URL, undefined, WORKSPACE)).rejects.toMatchObject({
      code: "gh-failed",
      message: "gh graphql returned a review comment without commit",
    });
  });
});
