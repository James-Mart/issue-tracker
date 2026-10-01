import { describe, expect, it } from "vitest";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { ALL_CHANGES_SCOPE } from "./review-scope";
import { reviewDiffThreadsByFile } from "./review-diff-threads";

const OLDER = "a3f91c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TIP = "c1d7f88aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function thread(
  id: string,
  anchor?: { path: string; commitSha: string; line?: number; file?: boolean },
  outdated = false,
): CommentThread {
  const stored = anchor
    ? anchor.file
      ? { path: anchor.path, commitSha: anchor.commitSha }
      : {
          side: "new" as const,
          line: anchor.line ?? 1,
          path: anchor.path,
          commitSha: anchor.commitSha,
        }
    : undefined;
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    root: {
      id,
      at: "2026-09-29T00:00:00.000Z",
      role: "human",
      body: id,
      ...(outdated ? { outdated: true } : {}),
      ...(stored ? { anchor: stored } : {}),
    },
    replies: [],
  };
}

const FILES = [{ path: "src/a.ts" }, { path: "src/b.ts", oldPath: "src/old-b.ts" }];

function ids(threads: CommentThread[] | undefined): string[] {
  return (threads ?? []).map((entry) => entry.root.id);
}

describe("reviewDiffThreadsByFile", () => {
  const threads = [
    thread("general"),
    thread("older", { path: "src/a.ts", commitSha: OLDER }),
    thread("tip", { path: "src/a.ts", commitSha: TIP }),
    thread("drifted", { path: "src/a.ts", commitSha: OLDER }, true),
    thread("renamed", { path: "src/old-b.ts", commitSha: TIP }),
    thread("elsewhere", { path: "src/c.ts", commitSha: TIP }),
  ];

  it("shows every anchored thread on All changes and groups outdated ones", () => {
    const byFile = reviewDiffThreadsByFile(threads, FILES, ALL_CHANGES_SCOPE);

    expect(ids(byFile.get("src/a.ts")?.inline)).toEqual(["older", "tip"]);
    expect(ids(byFile.get("src/a.ts")?.outdated)).toEqual(["drifted"]);
    expect(ids(byFile.get("src/b.ts")?.inline)).toEqual(["renamed"]);
    expect([...byFile.keys()].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("orders a file's Outdated group by anchor line", () => {
    const byFile = reviewDiffThreadsByFile(
      [
        thread("late", { path: "src/a.ts", commitSha: OLDER, line: 40 }, true),
        thread("early", { path: "src/a.ts", commitSha: OLDER, line: 7 }, true),
      ],
      FILES,
      ALL_CHANGES_SCOPE,
    );

    expect(ids(byFile.get("src/a.ts")?.outdated)).toEqual(["early", "late"]);
  });

  it("keeps a file anchor on its file and sorts an outdated one ahead of lines", () => {
    const byFile = reviewDiffThreadsByFile(
      [
        thread("file", { path: "src/a.ts", commitSha: TIP, file: true }),
        thread("gone", { path: "src/a.ts", commitSha: OLDER, file: true }, true),
        thread("late", { path: "src/a.ts", commitSha: OLDER, line: 40 }, true),
      ],
      FILES,
      ALL_CHANGES_SCOPE,
    );

    expect(ids(byFile.get("src/a.ts")?.file)).toEqual(["file"]);
    expect(byFile.get("src/a.ts")?.inline).toEqual([]);
    expect(ids(byFile.get("src/a.ts")?.outdated)).toEqual(["gone", "late"]);
  });

  it("shows only threads anchored to the viewed commit, outdated ones inline", () => {
    const older = reviewDiffThreadsByFile(threads, FILES, OLDER);

    expect(ids(older.get("src/a.ts")?.inline)).toEqual(["older", "drifted"]);
    expect(older.get("src/a.ts")?.outdated).toEqual([]);
    expect(older.has("src/b.ts")).toBe(false);

    const tip = reviewDiffThreadsByFile(threads, FILES, TIP);
    expect(ids(tip.get("src/a.ts")?.inline)).toEqual(["tip"]);
    expect(ids(tip.get("src/b.ts")?.inline)).toEqual(["renamed"]);
  });
});
