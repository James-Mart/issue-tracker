import { describe, expect, it } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { CommentMessage } from "@server/schemas";
import { groupCommentThreads } from "./comment-threads";
import { fileDiffsFromPatch } from "./issue-change-file-diffs";
import {
  mergeComposerAnnotation,
  placeThreadsInFile,
} from "./issue-change-inline-threads";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const PATCH = [
  "diff --git a/app/server/services/diff-fetch.ts b/app/server/services/diff-fetch.ts",
  "index 1111111..2222222 100644",
  "--- a/app/server/services/diff-fetch.ts",
  "+++ b/app/server/services/diff-fetch.ts",
  "@@ -88,4 +92,4 @@",
  " line88",
  " line89",
  "-old90",
  "+new94",
  " line91",
].join("\n");

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body">,
): CommentMessage {
  return {
    role: "code-quality-validator",
    ...overrides,
  };
}

function file(): FileDiffMetadata {
  const files = fileDiffsFromPatch(PATCH);
  const first = files[0];
  if (!first) throw new Error("expected parsed file");
  return first;
}

describe("placeThreadsInFile", () => {
  it("places current and outdated threads on their hunk lines and keeps unlocatable ones", () => {
    const current = comment({
      id: "current-root",
      at: "2026-08-30T14:22:00.000Z",
      body: "current",
      anchor: {
        path: "app/server/services/diff-fetch.ts",
        side: "new",
        line: 94,
        commitSha: SHA,
      },
    });
    const outdated = comment({
      id: "outdated-root",
      at: "2026-08-29T09:15:00.000Z",
      body: "outdated",
      outdated: true,
      anchor: {
        path: "app/server/services/diff-fetch.ts",
        side: "old",
        line: 90,
        startLine: 88,
        commitSha: SHA,
      },
    });
    const missing = comment({
      id: "missing-root",
      at: "2026-08-28T08:00:00.000Z",
      body: "missing",
      anchor: {
        path: "app/server/services/diff-fetch.ts",
        side: "new",
        line: 200,
        commitSha: SHA,
      },
    });
    const otherFile = comment({
      id: "other-root",
      at: "2026-08-30T16:00:00.000Z",
      body: "other",
      anchor: {
        path: "app/other.ts",
        side: "new",
        line: 94,
        commitSha: SHA,
      },
    });

    const placed = placeThreadsInFile(
      groupCommentThreads([current, outdated, missing, otherFile]),
      file(),
    );

    expect(
      placed.located.map((annotation) => ({
        side: annotation.side,
        lineNumber: annotation.lineNumber,
        ids: annotation.metadata.map((thread) => thread.root.id),
      })),
    ).toEqual([
      { side: "deletions", lineNumber: 90, ids: ["outdated-root"] },
      { side: "additions", lineNumber: 94, ids: ["current-root"] },
    ]);
    expect(placed.unlocated.map((thread) => thread.root.id)).toEqual([
      "missing-root",
    ]);
  });

  it("adds a composer-only annotation when that line has no threads", () => {
    const current = comment({
      id: "current-root",
      at: "2026-08-30T14:22:00.000Z",
      body: "current",
      anchor: {
        path: "app/server/services/diff-fetch.ts",
        side: "new",
        line: 94,
        commitSha: SHA,
      },
    });
    const { located } = placeThreadsInFile(
      groupCommentThreads([current]),
      file(),
    );

    expect(mergeComposerAnnotation(located, { side: "new", line: 94 })).toBe(
      located,
    );
    expect(
      mergeComposerAnnotation(located, { side: "new", line: 92 }),
    ).toEqual([
      ...located,
      { side: "additions", lineNumber: 92, metadata: [] },
    ]);
  });
});
