import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setGhSpawnerForTests, type GhSpawner } from "./delivery.js";
import {
  PR_URL,
  commentNode,
  commentPages,
  dir,
  ghCalls,
  mockChild,
  page,
  project,
  queryOf,
  storedLines,
  story,
  stubGh,
  usePrCommentMirrorHarness,
} from "./pr-comment-mirror-harness.js";
import { mirrorPrComments } from "./pr-comment-mirror.js";
import type { PrSyncStepResult } from "./pr-sync-driver.js";

usePrCommentMirrorHarness();

describe("mirrorPrComments", () => {
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
    expect(failed.error).toBe("ship: gh exploded; other: gh exploded");
    expect(failed.facts).toBe(input.facts);
    expect(storedLines("ship")).toHaveLength(0);
    expect(ghCalls).toHaveLength(2);

    stubGh(commentPages([page([commentNode()])]));
    const retried = await mirrorPrComments("p", input);
    expect(retried.error).toBeUndefined();
    expect(queryOf(ghCalls[2]!)).toContain("direction: ASC");
    expect(storedLines("ship")).toHaveLength(1);
  });
});
