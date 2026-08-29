import { describe, expect, it } from "vitest";
import {
  fileDiffsFromPatch,
  fileLineCounts,
  filterFilesByPath,
} from "./issue-change-file-diffs";

const MULTI_FILE_PATCH = [
  "diff --git a/app/foo.ts b/app/foo.ts",
  "index 1111111..2222222 100644",
  "--- a/app/foo.ts",
  "+++ b/app/foo.ts",
  "@@ -1 +1,3 @@",
  " line",
  "+added",
  "+again",
  "diff --git a/app/bar.ts b/app/bar.ts",
  "index 3333333..4444444 100644",
  "--- a/app/bar.ts",
  "+++ b/app/bar.ts",
  "@@ -1,2 +1 @@",
  "-gone",
  " other",
  "diff --git a/lib/baz.ts b/lib/baz.ts",
  "index 5555555..6666666 100644",
  "--- a/lib/baz.ts",
  "+++ b/lib/baz.ts",
  "@@ -1 +1,2 @@",
  " keep",
  "+new",
].join("\n");

describe("fileLineCounts", () => {
  it("sums hunk addition and deletion lines per file", () => {
    const files = fileDiffsFromPatch(MULTI_FILE_PATCH);

    expect(files.map((file) => ({ name: file.name, ...fileLineCounts(file) }))).toEqual(
      [
        { name: "app/foo.ts", additions: 2, deletions: 0 },
        { name: "app/bar.ts", additions: 0, deletions: 1 },
        { name: "lib/baz.ts", additions: 1, deletions: 0 },
      ],
    );
  });
});

describe("filterFilesByPath", () => {
  const files = fileDiffsFromPatch(MULTI_FILE_PATCH);

  it("keeps every file when the query is empty or whitespace", () => {
    expect(filterFilesByPath(files, "").map((file) => file.name)).toEqual([
      "app/foo.ts",
      "app/bar.ts",
      "lib/baz.ts",
    ]);
    expect(filterFilesByPath(files, "  ").map((file) => file.name)).toEqual([
      "app/foo.ts",
      "app/bar.ts",
      "lib/baz.ts",
    ]);
  });

  it("narrows to paths that contain the query, case-insensitively", () => {
    expect(filterFilesByPath(files, "APP/").map((file) => file.name)).toEqual([
      "app/foo.ts",
      "app/bar.ts",
    ]);
    expect(filterFilesByPath(files, "baz").map((file) => file.name)).toEqual([
      "lib/baz.ts",
    ]);
  });
});
