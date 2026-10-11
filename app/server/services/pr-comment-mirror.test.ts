import { describe, expect, it } from "vitest";
import { fetchPrComments } from "./pr-comment-mirror.js";
import {
  PR_URL,
  WORKSPACE,
  commentNode,
  commentPages,
  ghCalls,
  githubParts,
  page,
  queryOf,
  reviewCommentNode,
  stubGh,
  threadNode,
  usePrCommentMirrorHarness,
} from "./pr-comment-mirror-harness.js";

usePrCommentMirrorHarness();

describe("fetchPrComments", () => {
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
});
