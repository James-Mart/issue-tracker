import { describe, expect, it } from "vitest";
import {
  commentInputForComposer,
  composerDraftKey,
  newComposerForRange,
  pathForAnchorSide,
} from "./diff-thread-anchor";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";
const PATH = "app/server/services/diff-fetch.ts";

describe("newComposerForRange", () => {
  const file = { name: PATH };

  it("maps a single addition line", () => {
    expect(
      newComposerForRange({ start: 94, end: 94, side: "additions" }, file),
    ).toEqual({ kind: "new", path: PATH, side: "new", line: 94 });
  });

  it("maps a same-side range onto startLine + line", () => {
    expect(
      newComposerForRange({ start: 94, end: 96, side: "additions" }, file),
    ).toEqual({ kind: "new", path: PATH, side: "new", line: 96, startLine: 94 });
  });

  it("normalizes an upward drag so startLine is the lower line", () => {
    expect(
      newComposerForRange({ start: 96, end: 94, side: "additions" }, file),
    ).toEqual({ kind: "new", path: PATH, side: "new", line: 96, startLine: 94 });
  });

  it("drops startLine when the range crosses sides", () => {
    expect(
      newComposerForRange(
        {
          start: 90,
          end: 94,
          side: "deletions",
          endSide: "additions",
        },
        file,
      ),
    ).toEqual({ kind: "new", path: PATH, side: "new", line: 94 });
  });

  it("anchors a deletion on the pre-rename path", () => {
    expect(
      newComposerForRange(
        { start: 12, end: 12, side: "deletions" },
        { name: "new.ts", prevName: "old.ts" },
      ),
    ).toEqual({ kind: "new", path: "old.ts", side: "old", line: 12 });
  });
});

describe("pathForAnchorSide", () => {
  it("uses prevName on the old side of a rename", () => {
    expect(
      pathForAnchorSide({ name: "new.ts", prevName: "old.ts" }, "old"),
    ).toBe("old.ts");
    expect(
      pathForAnchorSide({ name: "new.ts", prevName: "old.ts" }, "new"),
    ).toBe("new.ts");
  });
});

describe("draft keys and write payloads", () => {
  it("scopes new-thread and reply drafts on different keys", () => {
    const neu = composerDraftKey("story-1", {
      kind: "new",
      path: PATH,
      side: "new",
      line: 94,
    });
    const reply = composerDraftKey("story-1", {
      kind: "reply",
      threadId: "current-root",
    });
    const range = composerDraftKey("story-1", {
      kind: "new",
      path: PATH,
      side: "new",
      line: 96,
      startLine: 94,
    });
    expect(neu).toBe(`review:story-1:line:${PATH}:new:94`);
    expect(reply).toBe("review:story-1:reply:current-root");
    expect(range).toBe(`review:story-1:line:${PATH}:new:94-96`);
    expect(neu).not.toBe(reply);
  });

  it("builds a single-line anchor post and a reply with no anchor", () => {
    expect(
      commentInputForComposer(
        { kind: "new", path: PATH, side: "new", line: 94 },
        "single",
        SHA,
      ),
    ).toEqual({
      role: "human",
      body: "single",
      anchor: { path: PATH, side: "new", line: 94, commitSha: SHA },
    });
    expect(
      commentInputForComposer(
        {
          kind: "new",
          path: PATH,
          side: "new",
          line: 96,
          startLine: 94,
        },
        "range",
        SHA,
      ),
    ).toEqual({
      role: "human",
      body: "range",
      anchor: {
        path: PATH,
        side: "new",
        line: 96,
        startLine: 94,
        commitSha: SHA,
      },
    });
    expect(
      commentInputForComposer(
        { kind: "reply", threadId: "current-root" },
        "reply body",
        SHA,
      ),
    ).toEqual({
      role: "human",
      body: "reply body",
      replyTo: "current-root",
    });
  });
});
