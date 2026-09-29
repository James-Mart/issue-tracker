import { describe, expect, it } from "vitest";
import { fileDiffsFromPatch } from "@/features/issues/lib/issue-change-file-diffs";
import type { ReviewDiffFile } from "@server/schemas";
import {
  collectDiffSearchMatches,
  snapshotSearchableDiff,
} from "./review-diff-search";

const PATCH = [
  "diff --git a/src/body.ts b/src/body.ts",
  "index 1111111..2222222 100644",
  "--- a/src/body.ts",
  "+++ b/src/body.ts",
  "@@ -1,3 +1,3 @@",
  " needle context",
  "-old needle",
  "+new needle needle",
  "diff --git a/src/quiet.ts b/src/quiet.ts",
  "index 3333333..4444444 100644",
  "--- a/src/quiet.ts",
  "+++ b/src/quiet.ts",
  "@@ -1 +1 @@",
  "-gone",
  "+unrelated",
].join("\n");

function file(path: string, tooLarge = false, oldPath?: string): ReviewDiffFile {
  return {
    path,
    oldPath,
    status: "modified",
    additions: 1,
    deletions: 1,
    blobSha: path,
    tooLarge,
  };
}

function diffs() {
  return new Map(
    fileDiffsFromPatch(PATCH).map((parsed) => [parsed.name, snapshotSearchableDiff(parsed)]),
  );
}

describe("collectDiffSearchMatches", () => {
  const files = [
    file("src/needle-path.ts", true),
    file("src/body.ts"),
    file("src/quiet.ts"),
  ];

  it("matches nothing for an empty or whitespace query", () => {
    expect(collectDiffSearchMatches(files, diffs(), "")).toEqual([]);
    expect(collectDiffSearchMatches(files, diffs(), "  ")).toEqual([]);
  });

  it("counts path-only and content-only hits, including both in one total", () => {
    const matches = collectDiffSearchMatches(files, diffs(), "NEEDLE");

    expect(matches.map((match) => ({ kind: match.kind, path: match.path }))).toEqual([
      { kind: "path", path: "src/needle-path.ts" },
      { kind: "content", path: "src/body.ts" },
      { kind: "content", path: "src/body.ts" },
      { kind: "content", path: "src/body.ts" },
      { kind: "content", path: "src/body.ts" },
    ]);
    expect(matches.filter((match) => match.kind === "path")).toHaveLength(1);
    expect(matches.filter((match) => match.kind === "content")).toHaveLength(4);
    expect(new Set(matches.map((match) => match.path))).toEqual(
      new Set(["src/needle-path.ts", "src/body.ts"]),
    );
  });

  it("counts a context line once and each change line on its own", () => {
    const matches = collectDiffSearchMatches([file("src/body.ts")], diffs(), "needle");
    const content = matches.filter((match) => match.kind === "content");

    expect(content.map((match) => match.lineType)).toEqual([
      "context",
      "change-deletion",
      "change-addition",
      "change-addition",
    ]);
    expect(content.map((match) => match.occurrence)).toEqual([0, 0, 0, 1]);
  });

  it("counts a rename's old path before the new path", () => {
    const matches = collectDiffSearchMatches(
      [file("src/after.ts", true, "src/before-needle.ts")],
      diffs(),
      "needle",
    );

    expect(matches).toEqual([
      {
        index: 0,
        path: "src/after.ts",
        kind: "path",
        field: "oldPath",
        occurrence: 0,
      },
    ]);
  });
});
